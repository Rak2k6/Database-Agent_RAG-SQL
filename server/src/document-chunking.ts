export const DEFAULT_DOCUMENT_CHUNK_SIZE = 1200;
export const DEFAULT_DOCUMENT_CHUNK_OVERLAP = 200;

export interface DocumentChunkRange {
  text: string;
  start: number;
  end: number;
}

export interface DocumentChunkingOptions {
  chunkSize?: number;
  overlap?: number;
}

function isSurrogatePairBoundary(text: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}

function findBoundary(text: string, start: number, limit: number): number {
  const minimum = Math.max(start + Math.floor((limit - start) * 0.55), start + 1);
  const paragraph = text.lastIndexOf('\n\n', limit - 2);
  if (paragraph >= minimum) return paragraph + 2;

  const sentence = Math.max(
    text.lastIndexOf('. ', limit - 2),
    text.lastIndexOf('! ', limit - 2),
    text.lastIndexOf('? ', limit - 2),
  );
  if (sentence >= minimum) return sentence + 2;

  const newline = text.lastIndexOf('\n', limit - 1);
  if (newline >= minimum) return newline + 1;

  const whitespace = text.lastIndexOf(' ', limit - 1);
  if (whitespace >= minimum) return whitespace + 1;

  const adjustedLimit = isSurrogatePairBoundary(text, limit) ? limit - 1 : limit;
  return adjustedLimit === start ? Math.min(text.length, start + 2) : adjustedLimit;
}

function nextChunkStart(text: string, start: number, end: number, overlap: number): number {
  const desiredStart = end - overlap;
  if (desiredStart <= start) return end;

  const paragraph = text.indexOf('\n\n', desiredStart);
  if (paragraph !== -1 && paragraph + 2 <= end - Math.floor(overlap / 2)) {
    return Math.max(start + 1, paragraph + 2);
  }

  const sentence = text.slice(desiredStart, end).search(/[.!?]\s/);
  if (sentence !== -1 && desiredStart + sentence + 2 <= end - Math.floor(overlap / 2)) {
    return Math.max(start + 1, desiredStart + sentence + 2);
  }

  const newline = text.indexOf('\n', desiredStart);
  if (newline !== -1 && newline < end - Math.floor(overlap / 2)) return Math.max(start + 1, newline + 1);

  const whitespace = text.indexOf(' ', desiredStart);
  if (whitespace !== -1 && whitespace < end - Math.floor(overlap / 2)) return Math.max(start + 1, whitespace + 1);

  const adjustedStart = isSurrogatePairBoundary(text, desiredStart) ? desiredStart + 1 : desiredStart;
  return Math.max(start + 1, adjustedStart);
}

export function chunkDocumentText(
  text: string,
  options: DocumentChunkingOptions = {},
): DocumentChunkRange[] {
  const chunkSize = options.chunkSize ?? DEFAULT_DOCUMENT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_DOCUMENT_CHUNK_OVERLAP;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('Chunk size must be a positive integer.');
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new RangeError('Chunk overlap must be a non-negative integer smaller than the chunk size.');
  }

  if (!text.trim()) return [];

  const chunks: DocumentChunkRange[] = [];
  let start = 0;
  while (start < text.length) {
    const limit = Math.min(start + chunkSize, text.length);
    const end = limit === text.length ? limit : findBoundary(text, start, limit);
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push({ text: chunk, start, end });
    if (end === text.length) break;
    start = nextChunkStart(text, start, end, overlap);
  }

  return chunks;
}
