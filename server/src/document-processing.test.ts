import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, test } from 'node:test';
import { processStoredDocument } from './document-processing.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStoredFile(extension: string, contents: Buffer): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'northstar-processing-'));
  temporaryDirectories.push(directory);
  const storageName = `doc_${randomUUID()}_fixture.${extension}`;
  await writeFile(path.join(directory, storageName), contents);
  return { directory, filePath: `/uploads/${storageName}` };
}

function createPdf(text: string): Buffer {
  const escapedText = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, 'ascii');
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createDocx(files: Record<string, string>): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const content = Buffer.from(value);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    localEntries.push(Buffer.concat([local, compressed]));

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(localOffset, 42);
    filename.copy(central, 46);
    centralEntries.push(central);
    localOffset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localEntries, centralDirectory, end]);
}

function minimalDocx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  return createDocx({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

const metadata = (filePath: string) => ({
  documentId: 'doc-test-1',
  projectId: 'project-test-1',
  originalFilename: 'original-name',
  filePath,
});

test('extracts actual PDF text and attaches page number and document metadata to chunks', async () => {
  const stored = await createStoredFile('pdf', createPdf('PDF extraction fixture'));
  const result = await processStoredDocument(
    { ...metadata(stored.filePath), originalFilename: 'Requirements.pdf' },
    { uploadDirectory: stored.directory },
  );

  assert.equal(result.processingStatus, 'processed', JSON.stringify(result.extractionError));
  assert.equal(result.projectId, 'project-test-1');
  assert.equal(result.chunks[0]!.documentId, 'doc-test-1');
  assert.equal(result.chunks[0]!.originalFilename, 'Requirements.pdf');
  assert.equal(result.chunks[0]!.pageNumber, 1);
  assert.equal(result.chunks[0]!.text.trim(), 'PDF extraction fixture');
});

test('extracts DOCX paragraphs without sending contents outside the process', async () => {
  const stored = await createStoredFile('docx', minimalDocx(['First DOCX paragraph.', 'Second paragraph.']));
  const result = await processStoredDocument(
    { ...metadata(stored.filePath), projectId: null, originalFilename: 'Brief.docx' },
    { uploadDirectory: stored.directory },
  );

  assert.equal(result.processingStatus, 'processed');
  assert.equal(result.projectId, null);
  assert.match(result.chunks[0]!.text, /First DOCX paragraph\.\s+Second paragraph\./);
});

test('extracts Unicode Markdown while preserving section information and multiline text', async () => {
  const markdown = '# Résumé 東京\n\nLine one.\nLine two.\n\n## Next Section\nMore text.';
  const stored = await createStoredFile('md', Buffer.from(markdown, 'utf8'));
  const result = await processStoredDocument(
    { ...metadata(stored.filePath), originalFilename: 'Notes.md' },
    { uploadDirectory: stored.directory, chunkSize: 1000 },
  );

  assert.equal(result.processingStatus, 'processed');
  assert.equal(result.sourceHash, createHash('sha256').update(markdown, 'utf8').digest('hex'));
  assert.equal(result.chunks[0]!.text, markdown);
  assert.equal(result.chunks[0]!.section, 'Résumé 東京');
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.chunkIndex),
    result.chunks.map((_chunk, index) => index),
  );
});

test('reports empty and malformed supported documents as failed processing states', async () => {
  const empty = await createStoredFile('md', Buffer.from(' \n\t'));
  const malformed = await createStoredFile('pdf', Buffer.from('%PDF-not a readable PDF'));
  const docx = await createStoredFile('docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const emptyDocx = await createStoredFile('docx', minimalDocx([]));

  const results = await Promise.all([
    processStoredDocument(metadata(empty.filePath), { uploadDirectory: empty.directory }),
    processStoredDocument(metadata(malformed.filePath), { uploadDirectory: malformed.directory }),
    processStoredDocument(metadata(docx.filePath), { uploadDirectory: docx.directory }),
    processStoredDocument(metadata(emptyDocx.filePath), { uploadDirectory: emptyDocx.directory }),
  ]);

  assert.equal(results[0]!.extractionError?.code, 'EMPTY_DOCUMENT_TEXT');
  assert.equal(results[1]!.processingStatus, 'failed');
  assert.equal(results[2]!.processingStatus, 'failed');
  assert.equal(results[3]!.extractionError?.code, 'EMPTY_DOCUMENT_TEXT');
  assert(results.every((result) => result.chunks.length === 0));
});

test('rejects unsupported extensions, invalid paths, and missing stored files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'northstar-processing-'));
  temporaryDirectories.push(directory);
  const unsupportedFile = `doc_${randomUUID()}_fixture.txt`;
  await writeFile(path.join(directory, unsupportedFile), 'unsupported');

  const unsupported = await processStoredDocument(metadata(`/uploads/${unsupportedFile}`), { uploadDirectory: directory });
  const traversal = await processStoredDocument(metadata('/uploads/../outside.md'), { uploadDirectory: directory });
  const missing = await processStoredDocument(metadata(`/uploads/doc_${randomUUID()}_missing.md`), { uploadDirectory: directory });

  assert.equal(unsupported.extractionError?.code, 'UNSUPPORTED_DOCUMENT_TYPE');
  assert.equal(traversal.extractionError?.code, 'INVALID_DOCUMENT_PATH');
  assert.equal(missing.extractionError?.code, 'DOCUMENT_FILE_UNAVAILABLE');
});

test('chunks extracted paragraphs with stable consecutive indexes and bounded overlap', async () => {
  const text = `${'First sentence. '.repeat(30)}\n\n${'Second sentence. '.repeat(30)}`;
  const stored = await createStoredFile('md', Buffer.from(text));
  const result = await processStoredDocument(
    { ...metadata(stored.filePath), projectId: null },
    { uploadDirectory: stored.directory, chunkSize: 90, overlap: 12 },
  );

  assert.equal(result.processingStatus, 'processed');
  assert(result.chunks.length > 2);
  assert.deepEqual(result.chunks.map((chunk) => chunk.chunkIndex), result.chunks.map((_chunk, index) => index));
  assert(result.chunks.every((chunk) => chunk.text.length <= 90));
  assert(result.chunks.every((chunk) => chunk.processingStatus === 'processed'));
});
