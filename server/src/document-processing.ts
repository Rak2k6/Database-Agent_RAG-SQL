import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { DocumentChunkRange, DocumentChunkingOptions } from './document-chunking.js';
import { chunkDocumentText } from './document-chunking.js';
import { DOCUMENT_UPLOAD_DIRECTORY, MAX_DOCUMENT_FILE_SIZE } from './document-upload.js';

const MAX_PDF_PAGES = 1000;
const processingModuleUrl = (() => {
  // @ts-expect-error - the runtime uses ESM via tsx; api:check compiles as CommonJS.
  return import.meta.url;
})();
const require = createRequire(fileURLToPath(processingModuleUrl));
const pdfjsBuildPath = 'pdfjs-dist/legacy/build/pdf.mjs';
const standardFontDataUrl = pathToFileURL(
  `${path.resolve(path.dirname(require.resolve('pdfjs-dist')), '../standard_fonts')}${path.sep}`,
).href;

export type DocumentProcessingStatus = 'processed' | 'failed';

export interface DocumentChunkMetadata {
  documentId: string;
  projectId: string | null;
  originalFilename: string;
  chunkIndex: number;
  pageNumber?: number;
  section?: string;
  processingStatus: DocumentProcessingStatus;
}

export interface ProcessedDocumentChunk extends DocumentChunkMetadata {
  text: string;
}

export interface DocumentProcessingErrorInfo {
  code: string;
  message: string;
}

export interface ProcessStoredDocumentResult {
  documentId: string;
  projectId: string | null;
  originalFilename: string;
  sourceHash?: string;
  processingStatus: DocumentProcessingStatus;
  chunks: ProcessedDocumentChunk[];
  extractionError?: DocumentProcessingErrorInfo;
}

export interface StoredDocumentMetadata {
  documentId: string;
  projectId?: string | null;
  originalFilename: string;
  filePath: string;
}

export interface DocumentProcessingOptions extends DocumentChunkingOptions {
  uploadDirectory?: string;
}

interface SourceLocation {
  start: number;
  end: number;
  pageNumber?: number;
  section?: string;
}

interface ExtractedText {
  text: string;
  locations: SourceLocation[];
}

export class DocumentProcessingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

function failure(code: string, message: string): never {
  throw new DocumentProcessingError(message, code);
}

function resolveStoredDocumentPath(filePath: string, uploadDirectory: string): string {
  const match = /^\/uploads\/(doc_[0-9a-f-]{36}_[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12})$/.exec(filePath);
  if (!match) failure('INVALID_DOCUMENT_PATH', 'The stored document path is invalid.');

  const root = path.resolve(uploadDirectory);
  const resolved = path.resolve(root, match[1]!);
  if (path.dirname(resolved) !== root) {
    failure('INVALID_DOCUMENT_PATH', 'The stored document path is invalid.');
  }
  return resolved;
}

async function readStoredDocument(filePath: string, uploadDirectory: string): Promise<{ absolutePath: string; buffer: Buffer }> {
  const absolutePath = resolveStoredDocumentPath(filePath, uploadDirectory);
  let rootRealPath: string;
  let fileRealPath: string;
  let fileStats;
  try {
    [rootRealPath, fileRealPath, fileStats] = await Promise.all([
      realpath(uploadDirectory),
      realpath(absolutePath),
      stat(absolutePath),
    ]);
  } catch {
    failure('DOCUMENT_FILE_UNAVAILABLE', 'The stored document could not be found or read.');
  }
  const relative = path.relative(rootRealPath, fileRealPath);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    failure('INVALID_DOCUMENT_PATH', 'The stored document path is outside the upload directory.');
  }
  if (!fileStats.isFile()) failure('DOCUMENT_FILE_UNAVAILABLE', 'The stored document is not a regular file.');
  if (fileStats.size <= 0 || fileStats.size > MAX_DOCUMENT_FILE_SIZE) {
    failure('INVALID_DOCUMENT_FILE', 'The stored document is empty or exceeds the allowed size.');
  }

  try {
    return { absolutePath: fileRealPath, buffer: await readFile(fileRealPath) };
  } catch {
    failure('DOCUMENT_FILE_UNAVAILABLE', 'The stored document could not be found or read.');
  }
}

function appendText(
  current: string,
  value: string,
  location: Omit<SourceLocation, 'start' | 'end'> = {},
): { text: string; location: SourceLocation } {
  const start = current.length;
  const text = current + value;
  return { text, location: { ...location, start, end: text.length } };
}

function extractMarkdown(buffer: Buffer): ExtractedText {
  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    failure('INVALID_DOCUMENT_FILE', 'The Markdown document is not valid UTF-8 text.');
  }
  if (markdown.includes('\0')) failure('INVALID_DOCUMENT_FILE', 'The Markdown document contains invalid binary data.');
  const locations: SourceLocation[] = [];
  let section: string | undefined;
  let offset = 0;
  for (const line of markdown.split(/(?<=\n)/)) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*(?:\r?\n)?$/.exec(line);
    if (heading) section = heading[1]!.trim();
    locations.push({ start: offset, end: offset + line.length, section });
    offset += line.length;
  }
  return { text: markdown, locations };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    failure('INVALID_DOCUMENT_FILE', 'The stored file is not a valid PDF.');
  }

  let loadingTask: PDFDocumentLoadingTask | undefined;
  try {
    const pdfjs = await import(pdfjsBuildPath) as typeof import('pdfjs-dist');
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      stopAtErrors: true,
      standardFontDataUrl,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      await loadingTask.destroy();
      failure('DOCUMENT_TOO_COMPLEX', 'The PDF exceeds the supported page limit.');
    }
    let text = '';
    const locations: SourceLocation[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if ('str' in item) pageText += `${item.str}${item.hasEOL ? '\n' : ''}`;
      }
      if (pageNumber > 1) {
        const separator = appendText(text, '\n\n');
        text = separator.text;
      }
      const pageLocation = appendText(text, pageText, { pageNumber });
      locations.push(pageLocation.location);
      text = pageLocation.text;
      page.cleanup();
    }
    await loadingTask.destroy();
    return { text, locations };
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        // The PDF.js worker may already have been destroyed while rejecting the load.
      }
    }
    failure('EXTRACTION_FAILED', 'The PDF could not be read or its text could not be extracted.');
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    failure('INVALID_DOCUMENT_FILE', 'The stored file is not a valid DOCX document.');
  }
  try {
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.some((message) => message.type === 'error')) {
      failure('EXTRACTION_FAILED', 'The DOCX document could not be read.');
    }
    return { text: result.value, locations: [] };
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    failure('EXTRACTION_FAILED', 'The DOCX document could not be read or its text could not be extracted.');
  }
}

async function extractDocumentText(filePath: string, buffer: Buffer): Promise<ExtractedText> {
  switch (path.extname(filePath).toLowerCase()) {
    case '.pdf':
      return extractPdf(buffer);
    case '.docx':
      return extractDocx(buffer);
    case '.md':
      return extractMarkdown(buffer);
    default:
      failure('UNSUPPORTED_DOCUMENT_TYPE', 'Only PDF, DOCX, and Markdown documents are supported.');
  }
}

function metadataForChunk(
  chunk: DocumentChunkRange,
  locations: SourceLocation[],
): Pick<DocumentChunkMetadata, 'pageNumber' | 'section'> {
  const location = locations.find((candidate) => candidate.start <= chunk.start && candidate.end > chunk.start)
    ?? locations.find((candidate) => candidate.start >= chunk.start);
  if (!location) return {};
  return {
    ...(location.pageNumber === undefined ? {} : { pageNumber: location.pageNumber }),
    ...(location.section === undefined ? {} : { section: location.section }),
  };
}

export async function processStoredDocument(
  metadata: StoredDocumentMetadata,
  options: DocumentProcessingOptions = {},
): Promise<ProcessStoredDocumentResult> {
  const base = {
    documentId: metadata.documentId,
    projectId: metadata.projectId ?? null,
    originalFilename: metadata.originalFilename,
  };
  let sourceHash: string | undefined;

  try {
    if (!['.pdf', '.docx', '.md'].includes(path.posix.extname(metadata.filePath).toLowerCase())) {
      failure('UNSUPPORTED_DOCUMENT_TYPE', 'Only PDF, DOCX, and Markdown documents are supported.');
    }
    const { absolutePath, buffer } = await readStoredDocument(
      metadata.filePath,
      options.uploadDirectory ?? DOCUMENT_UPLOAD_DIRECTORY,
    );
    sourceHash = createHash('sha256').update(buffer).digest('hex');
    const extracted = await extractDocumentText(absolutePath, buffer);
    if (!extracted.text.trim()) {
      failure('EMPTY_DOCUMENT_TEXT', 'No readable text was found in the document.');
    }

    const chunks = chunkDocumentText(extracted.text, options).map((chunk, chunkIndex) => ({
      ...base,
      ...metadataForChunk(chunk, extracted.locations),
      chunkIndex,
      processingStatus: 'processed' as const,
      text: chunk.text,
    }));
    if (chunks.length === 0) {
      failure('EMPTY_DOCUMENT_TEXT', 'No readable text was found in the document.');
    }

    return { ...base, sourceHash, processingStatus: 'processed', chunks };
  } catch (error) {
    const processingError = error instanceof DocumentProcessingError
      ? { code: error.code, message: error.message }
      : { code: 'DOCUMENT_PROCESSING_FAILED', message: 'The document could not be processed.' };
    return {
      ...base,
      ...(sourceHash === undefined ? {} : { sourceHash }),
      processingStatus: 'failed',
      chunks: [],
      extractionError: processingError,
    };
  }
}
