import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';

export const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;
const uploadModuleUrl = (() => {
  // @ts-expect-error - the runtime uses ESM via tsx; api:check compiles as CommonJS.
  return import.meta.url;
})();
export const DOCUMENT_UPLOAD_DIRECTORY = fileURLToPath(new URL('../uploads/', uploadModuleUrl));

export interface StoredDocumentFile {
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
}

export class DocumentUploadValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DocumentUploadValidationError';
  }
}

export class DocumentStorageError extends Error {
  constructor(readonly cause: unknown) {
    super('Could not store the uploaded document.');
    this.name = 'DocumentStorageError';
  }
}

export class DocumentUploadCleanupError extends Error {
  constructor(
    readonly databaseError: unknown,
    readonly cleanupError: unknown,
  ) {
    super('Document metadata creation failed and its uploaded file could not be removed.');
    this.name = 'DocumentUploadCleanupError';
  }
}

function rejectUpload(message: string): never {
  throw new DocumentUploadValidationError(message, 'INVALID_DOCUMENT_FILE', 400);
}

function isAllowedMimeType(mimeType: string, accepted: string[]): boolean {
  return accepted.includes(mimeType) || mimeType === 'application/octet-stream';
}

function hasDocxPackageEntries(buffer: Buffer): boolean {
  const minimumEocdLength = 22;
  const maxCommentLength = 0xffff;
  const searchStart = Math.max(0, buffer.length - minimumEocdLength - maxCommentLength);
  let eocdOffset = -1;

  for (let offset = buffer.length - minimumEocdLength; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return false;

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) return false;

  let offset = centralDirectoryOffset;
  const entries = new Set<string>();
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > centralDirectoryOffset + centralDirectorySize) return false;
    entries.add(buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength));
    offset = entryEnd;
  }

  return entries.has('[Content_Types].xml') && entries.has('word/document.xml');
}

function validateDocumentFile(file: Express.Multer.File): { extension: string; fileType: string } {
  const originalName = file.originalname;
  if (
    !originalName ||
    originalName.length > 246 ||
    /[\0\r\n]/.test(originalName) ||
    /[\\/]/.test(originalName) ||
    path.posix.isAbsolute(originalName) ||
    path.win32.isAbsolute(originalName) ||
    /^[a-z]:/i.test(originalName)
  ) {
    rejectUpload('The uploaded filename is invalid.');
  }

  if (file.size <= 0 || file.size > MAX_DOCUMENT_FILE_SIZE || file.buffer.length !== file.size) {
    throw new DocumentUploadValidationError(
      `Choose a non-empty file no larger than ${MAX_DOCUMENT_FILE_SIZE / (1024 * 1024)} MB.`,
      file.size > MAX_DOCUMENT_FILE_SIZE ? 'FILE_TOO_LARGE' : 'INVALID_DOCUMENT_FILE',
      file.size > MAX_DOCUMENT_FILE_SIZE ? 413 : 400,
    );
  }

  const extension = path.extname(originalName).toLowerCase();
  if (extension === '.pdf') {
    if (!isAllowedMimeType(file.mimetype, ['application/pdf'])) rejectUpload('The PDF file type is invalid.');
    if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) rejectUpload('The uploaded file is not a valid PDF.');
    return { extension, fileType: 'application/pdf' };
  }

  if (extension === '.docx') {
    if (!isAllowedMimeType(file.mimetype, ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])) {
      rejectUpload('The DOCX file type is invalid.');
    }
    if (
      file.buffer.length < 4 ||
      file.buffer.readUInt32LE(0) !== 0x04034b50 ||
      !hasDocxPackageEntries(file.buffer)
    ) {
      rejectUpload('The uploaded file is not a valid DOCX document.');
    }
    return { extension, fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  if (extension === '.md') {
    if (!isAllowedMimeType(file.mimetype, ['text/markdown', 'text/plain'])) rejectUpload('The Markdown file type is invalid.');
    if (file.buffer.includes(0)) rejectUpload('The uploaded Markdown file contains invalid binary data.');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      rejectUpload('The uploaded Markdown file must contain valid UTF-8 text.');
    }
    return { extension, fileType: 'text/markdown' };
  }

  rejectUpload('Only PDF, DOCX, and Markdown (.md) files are supported.');
}

export function validateUploadedDocument(file: Express.Multer.File): void {
  validateDocumentFile(file);
}

function safeFilenameStem(originalName: string): string {
  const extension = path.extname(originalName);
  const stem = originalName.slice(0, -extension.length);
  return stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'document';
}

async function writeFileExclusively(filePath: string, buffer: Buffer): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  let writeError: unknown;
  try {
    await handle.writeFile(buffer);
  } catch (error) {
    writeError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    writeError ??= error;
  }
  if (writeError) {
    try {
      await rm(filePath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([writeError, cleanupError], 'Could not clean up a partially written document file.');
    }
    throw writeError;
  }
}

export async function persistUploadedDocument<T>(
  file: Express.Multer.File,
  uploadDirectory: string,
  createRecord: (storedFile: StoredDocumentFile) => Promise<T>,
): Promise<T> {
  const { extension, fileType } = validateDocumentFile(file);
  let storedFile: StoredDocumentFile | undefined;

  try {
    await mkdir(uploadDirectory, { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const storageName = `doc_${randomUUID()}_${safeFilenameStem(file.originalname)}${extension}`;
      const storagePath = path.join(uploadDirectory, storageName);
      try {
        await writeFileExclusively(storagePath, file.buffer);
        storedFile = {
          fileName: file.originalname,
          filePath: `/uploads/${storageName}`,
          fileType,
          fileSize: file.size,
          storagePath,
        };
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 2) continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof DocumentUploadValidationError) throw error;
    throw new DocumentStorageError(error);
  }

  if (!storedFile) {
    throw new DocumentStorageError(new Error('Could not allocate a unique document filename.'));
  }

  try {
    return await createRecord(storedFile);
  } catch (databaseError) {
    try {
      await rm(storedFile.storagePath, { force: true });
    } catch (cleanupError) {
      throw new DocumentUploadCleanupError(databaseError, cleanupError);
    }
    throw databaseError;
  }
}
