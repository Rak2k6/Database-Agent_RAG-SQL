import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { afterEach, test } from 'node:test';
import {
  DocumentUploadValidationError,
  MAX_DOCUMENT_FILE_SIZE,
  persistUploadedDocument,
} from './document-upload.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'northstar-documents-'));
  temporaryDirectories.push(directory);
  return directory;
}

function uploadFile(originalname: string, mimetype: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function createDocxBuffer(): Buffer {
  const names = ['[Content_Types].xml', 'word/document.xml'];
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const name of names) {
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    localEntries.push(local);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(localOffset, 42);
    filename.copy(central, 46);
    centralEntries.push(central);
    localOffset += local.length;
  }

  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localEntries, centralDirectory, end]);
}

async function assertStoredFile(
  originalName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<{ fileName: string; filePath: string; storagePath: string; fileType: string }> {
  const directory = await createTemporaryDirectory();
  let received: Awaited<ReturnType<typeof persistUploadedDocument<{ fileName: string; filePath: string; storagePath: string; fileType: string }>>> | undefined;
  const result = await persistUploadedDocument(
    uploadFile(originalName, mimeType, buffer),
    directory,
    async (stored) => {
      received = stored;
      return stored;
    },
  );

  assert.equal(result.fileName, originalName);
  assert.equal(received?.filePath, result.filePath);
  assert.equal(received?.fileName, originalName);
  assert.equal(path.dirname(result.storagePath), directory);
  assert.equal(await readFile(result.storagePath).then((contents) => contents.equals(buffer)), true);
  assert.match(result.filePath, /^\/uploads\/doc_[0-9a-f-]{36}_[a-zA-Z0-9_-]+\.(pdf|docx|md)$/);
  return result;
}

test('stores PDF bytes and passes the original filename and generated path to document creation', async () => {
  const result = await assertStoredFile('Project Requirements.pdf', 'application/pdf', Buffer.from('%PDF-1.7\ncontent'));
  assert.equal(result.fileType, 'application/pdf');
  assert.match(result.filePath, /Project_Requirements\.pdf$/);
});

test('stores a valid DOCX package and identifies its content type', async () => {
  const result = await assertStoredFile(
    'Planning Brief.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    createDocxBuffer(),
  );
  assert.equal(result.fileType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(result.filePath, /Planning_Brief\.docx$/);
});

test('stores Markdown bytes and identifies its content type', async () => {
  const result = await assertStoredFile('Notes.md', 'text/markdown', Buffer.from('# Notes\n'));
  assert.equal(result.fileType, 'text/markdown');
  assert.match(result.filePath, /Notes\.md$/);
});

test('rejects unsupported file types and path traversal filenames', async () => {
  const directory = await createTemporaryDirectory();
  await assert.rejects(
    persistUploadedDocument(uploadFile('image.png', 'image/png', Buffer.from('image')), directory, async () => 'unused'),
    (error: unknown) => error instanceof DocumentUploadValidationError && error.status === 400,
  );
  await assert.rejects(
    persistUploadedDocument(uploadFile('../document.pdf', 'application/pdf', Buffer.from('%PDF-1.7')), directory, async () => 'unused'),
    (error: unknown) => error instanceof DocumentUploadValidationError && error.status === 400,
  );
});

test('rejects files exceeding the server-side size limit', async () => {
  const directory = await createTemporaryDirectory();
  const buffer = Buffer.alloc(MAX_DOCUMENT_FILE_SIZE + 1);
  buffer.write('%PDF-1.7');
  await assert.rejects(
    persistUploadedDocument(uploadFile('large.pdf', 'application/pdf', buffer), directory, async () => 'unused'),
    (error: unknown) => error instanceof DocumentUploadValidationError && error.status === 413 && error.code === 'FILE_TOO_LARGE',
  );
});

test('uses collision-resistant generated filenames and does not overwrite prior files', async () => {
  const directory = await createTemporaryDirectory();
  const file = uploadFile('same-name.pdf', 'application/pdf', Buffer.from('%PDF-1.7\ncontent'));
  const save = () => persistUploadedDocument(file, directory, async (stored) => stored);
  const [first, second] = await Promise.all([save(), save()]);

  assert.notEqual(first.filePath, second.filePath);
  assert.notEqual(first.storagePath, second.storagePath);
  assert.deepEqual((await readdir(directory)).sort(), [path.basename(first.storagePath), path.basename(second.storagePath)].sort());
});

test('removes the stored file when document metadata creation fails', async () => {
  const directory = await createTemporaryDirectory();
  let savedPath = '';
  await assert.rejects(
    persistUploadedDocument(
      uploadFile('Failure.pdf', 'application/pdf', Buffer.from('%PDF-1.7\ncontent')),
      directory,
      async (stored) => {
        savedPath = stored.storagePath;
        throw new Error('Stored procedure failed');
      },
    ),
    /Stored procedure failed/,
  );
  await assert.rejects(readFile(savedPath), { code: 'ENOENT' });
});

test('reports the exact stored filename, path, content type, and size to the database callback', async () => {
  const directory = await createTemporaryDirectory();
  const original = uploadFile('Original.md', 'text/markdown', Buffer.from('body'));
  const result = await persistUploadedDocument(original, directory, async (stored) => {
    assert.equal(stored.fileName, 'Original.md');
    assert.match(stored.filePath, /^\/uploads\/doc_/);
    assert.equal(stored.fileType, 'text/markdown');
    assert.equal(stored.fileSize, original.size);
    return stored;
  });
  assert.equal(await readFile(result.storagePath, 'utf8'), 'body');
});

test('creates a missing upload directory automatically', async () => {
  const parent = await createTemporaryDirectory();
  const directory = path.join(parent, 'new', 'uploads');
  const result = await persistUploadedDocument(
    uploadFile('Automatic.pdf', 'application/pdf', Buffer.from('%PDF-1.7\ncontent')),
    directory,
    async (stored) => stored,
  );
  assert.equal(await readFile(result.storagePath).then((contents) => contents.length > 0), true);
});
