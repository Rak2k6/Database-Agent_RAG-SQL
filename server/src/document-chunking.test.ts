import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chunkDocumentText,
  DEFAULT_DOCUMENT_CHUNK_OVERLAP,
  DEFAULT_DOCUMENT_CHUNK_SIZE,
} from './document-chunking.js';

test('uses documented defaults and preserves a short document exactly', () => {
  assert.equal(DEFAULT_DOCUMENT_CHUNK_SIZE, 1200);
  assert.equal(DEFAULT_DOCUMENT_CHUNK_OVERLAP, 200);
  assert.deepEqual(chunkDocumentText('Short paragraph.\n\nSecond paragraph.'), [{
    text: 'Short paragraph.\n\nSecond paragraph.',
    start: 0,
    end: 35,
  }]);
});

test('splits at paragraph boundaries when they fit inside the configured size', () => {
  const firstParagraph = 'First paragraph. '.repeat(3);
  const secondParagraph = 'Second paragraph. '.repeat(3);
  const text = `${firstParagraph}\n\n${secondParagraph}`;
  const chunks = chunkDocumentText(text, { chunkSize: firstParagraph.length + 20, overlap: 5 });

  assert.equal(chunks[0]!.text.endsWith('\n\n'), true);
  assert.equal(chunks.map((chunk) => text.slice(chunk.start, chunk.end)).join(''), chunks.map((chunk) => chunk.text).join(''));
  assert.equal(chunks[1]!.start < chunks[0]!.end, true);
  assert(chunks[0]!.end - chunks[1]!.start <= 5);
});

test('handles long unbroken paragraphs without exceeding size, stalling, or duplicating chunks', () => {
  const text = Array.from({ length: 113 }, (_value, index) => String.fromCharCode(33 + (index % 90))).join('');
  const chunks = chunkDocumentText(text, { chunkSize: 17, overlap: 4 });

  assert(chunks.length > 1);
  assert(chunks.every((chunk) => chunk.text.length <= 17));
  assert(chunks.every((chunk) => chunk.text === text.slice(chunk.start, chunk.end)));
  assert(chunks.every((chunk, index) => index === 0 || chunk.start > chunks[index - 1]!.start));
  assert(chunks.every((chunk, index) => index === 0 || chunk.text !== chunks[index - 1]!.text));
  assert(chunks.every((chunk, index) => index === 0 || chunks[index - 1]!.end - chunk.start === 4));
  assert.equal(chunks[0]!.start, 0);
  assert.equal(chunks.at(-1)!.end, text.length);
});

test('does not exceed chunk size when a line break falls exactly at the boundary', () => {
  const text = `${'a'.repeat(10)}\n${'b'.repeat(15)}`;
  const chunks = chunkDocumentText(text, { chunkSize: 10, overlap: 2 });

  assert(chunks.every((chunk) => chunk.text.length <= 10));
  assert(chunks.every((chunk) => text.slice(chunk.start, chunk.end) === chunk.text));
});

test('preserves Unicode and multiline content and returns no empty chunks', () => {
  const text = 'Résumé — 東京 😀😃\nLine two.\n\nA longer note.';
  const chunks = chunkDocumentText(text, { chunkSize: 12, overlap: 3 });

  assert(chunks.length > 1);
  assert(chunks.every((chunk) => chunk.text.trim().length > 0));
  assert(chunks.every((chunk) => text.slice(chunk.start, chunk.end) === chunk.text));
  assert(chunks.every((chunk) => Buffer.from(chunk.text, 'utf8').toString('utf8') === chunk.text));
  assert.equal(chunks[0]!.start, 0);
  assert.equal(chunks.at(-1)!.end, text.length);
});

test('validates chunk size and overlap settings', () => {
  assert.throws(() => chunkDocumentText('text', { chunkSize: 0 }), RangeError);
  assert.throws(() => chunkDocumentText('text', { overlap: DEFAULT_DOCUMENT_CHUNK_SIZE }), RangeError);
  assert.deepEqual(chunkDocumentText(' \n\t'), []);
});
