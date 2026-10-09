import { createHash } from 'node:crypto';
import {
  embedTexts,
  EmbeddingServiceError,
} from './embeddings.js';
import {
  createChunkPointId,
  QdrantService,
  QdrantServiceError,
  type QdrantChunkPointInput,
  type QdrantRetrievedPoint,
} from './qdrant.js';
import type { ProcessedDocumentChunk } from '../document-processing.js';
import {
  documentChunkMappings,
  DocumentChunkMappingStore,
  type DocumentChunkMappingRow,
} from '../db/document-chunks.js';

export const DOCUMENT_EMBEDDING_BATCH_SIZE = 32;

export interface IndexProcessedDocumentInput {
  documentId: string;
  projectId: string | null;
  docVer: string;
  chunks: readonly ProcessedDocumentChunk[];
}

export interface IndexedDocumentResult {
  documentId: string;
  projectId: string | null;
  docVer: string;
  chunkCount: number;
  processingStatus: 'indexed';
  reusedExistingIndex: boolean;
  cleanupPending: boolean;
  cleanupError?: { code: string; message: string };
}

export class DocumentIndexingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentIndexingError';
  }
}

export interface DocumentIndexingDependencies {
  embedder?: {
    embedTexts(texts: readonly string[]): Promise<number[][]>;
  };
  qdrant?: Pick<QdrantService, 'upsertPoints' | 'retrievePoints' | 'deletePoints'>;
  mappings?: Pick<DocumentChunkMappingStore, 'upsert' | 'updateStatus' | 'list' | 'deleteVersion'>;
}

type IndexingPhase = 'mapping' | 'embedding' | 'qdrant' | 'verification';

const keyedOperations = new Map<string, Promise<void>>();

async function withKeyedOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = keyedOperations.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  keyedOperations.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (keyedOperations.get(key) === queued) keyedOperations.delete(key);
  }
}

export function withDocumentContentLock<T>(
  projectId: string,
  uploadedBy: string,
  docVer: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withKeyedOperation(JSON.stringify(['content', projectId, uploadedBy, docVer]), operation);
}

function getFailure(error: unknown, phase: IndexingPhase): { code: string; message: string } {
  if (error instanceof DocumentIndexingError) return { code: error.code, message: error.message };
  if (error instanceof EmbeddingServiceError || error instanceof QdrantServiceError) {
    return { code: error.code, message: error.message };
  }
  switch (phase) {
    case 'mapping':
      return { code: 'DOCUMENT_MAPPING_FAILED', message: 'Could not persist document chunk mappings.' };
    case 'embedding':
      return { code: 'DOCUMENT_EMBEDDING_FAILED', message: 'Could not generate embeddings for the document.' };
    case 'qdrant':
      return { code: 'DOCUMENT_VECTOR_UPSERT_FAILED', message: 'Could not store and verify document vectors.' };
    case 'verification':
      return { code: 'DOCUMENT_INDEX_VERIFICATION_FAILED', message: 'Could not verify completed document indexing.' };
  }
}

function validateInput(input: IndexProcessedDocumentInput): void {
  if (!input.documentId.trim() || input.documentId.length > 255) {
    throw new DocumentIndexingError('The document ID is invalid.', 'INVALID_DOCUMENT_ID');
  }
  if (!/^[a-f\d]{64}$/i.test(input.docVer)) {
    throw new DocumentIndexingError('The document version must be a SHA-256 digest.', 'INVALID_DOCUMENT_VERSION');
  }
  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
    throw new DocumentIndexingError('The document contains no chunks to index.', 'EMPTY_DOCUMENT_CHUNKS');
  }
  input.chunks.forEach((chunk, index) => {
    if (
      chunk.documentId !== input.documentId ||
      chunk.projectId !== input.projectId ||
      chunk.processingStatus !== 'processed' ||
      chunk.chunkIndex !== index ||
      !chunk.text.trim()
    ) {
      throw new DocumentIndexingError('The extracted chunk metadata is inconsistent.', 'INVALID_DOCUMENT_CHUNK');
    }
  });
}

export function createChunkHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function mappingRowsMatch(
  rows: DocumentChunkMappingRow[],
  mappings: Array<{ chunkIndex: number; vectorId: string; chunkHash: string }>,
  requireIndexed = true,
): boolean {
  if (rows.length !== mappings.length) return false;
  const rowByIndex = new Map(rows.map((row) => [row.chunk_index, row]));
  return mappings.every((mapping) => {
    const row = rowByIndex.get(mapping.chunkIndex);
    return row !== undefined &&
      (!requireIndexed || row.status === 'indexed') &&
      row.vector_id.toLowerCase() === mapping.vectorId.toLowerCase() &&
      row.chunk_hash.toLowerCase() === mapping.chunkHash.toLowerCase();
  });
}

function makeQdrantPayload(input: IndexProcessedDocumentInput, chunk: {
  chunkIndex: number;
  chunkHash: string;
  pageNumber?: number;
  section?: string;
  text: string;
}): Record<string, unknown> {
  return {
    document_id: input.documentId,
    ...(input.projectId === null ? {} : { project_id: input.projectId }),
    doc_ver: input.docVer,
    chunk_index: chunk.chunkIndex,
    chunk_hash: chunk.chunkHash,
    ...(chunk.pageNumber === undefined ? {} : { page_number: chunk.pageNumber }),
    ...(chunk.section === undefined ? {} : { section: chunk.section }),
    text: chunk.text,
  };
}

function qdrantPointsMatch(
  points: QdrantRetrievedPoint[],
  input: IndexProcessedDocumentInput,
  chunks: Array<{ chunkIndex: number; chunkHash: string; vectorId: string; pageNumber?: number; section?: string; text: string }>,
): boolean {
  if (points.length !== chunks.length) return false;
  const pointById = new Map(points.map((point) => [point.id.toLowerCase(), point]));
  return chunks.every((chunk) => {
    const point = pointById.get(chunk.vectorId.toLowerCase());
    const expectedPayload = makeQdrantPayload(input, chunk);
    return Boolean(
      point &&
      point.vector.length === 768 &&
      Object.keys(point.payload).length === Object.keys(expectedPayload).length &&
      Object.entries(expectedPayload).every(([key, value]) => point.payload[key] === value),
    );
  });
}

async function cleanObsoleteVersions(
  input: IndexProcessedDocumentInput,
  mappingStore: Pick<DocumentChunkMappingStore, 'list' | 'updateStatus' | 'deleteVersion'>,
  qdrant: Pick<QdrantService, 'deletePoints'>,
): Promise<{ pending: boolean; error?: { code: string; message: string } }> {
  try {
    const mappings = await mappingStore.list(input.documentId);
    const obsoleteVersions = [...new Set(mappings
      .map((mapping) => mapping.doc_ver)
      .filter((docVer) => docVer !== input.docVer))];

    for (const docVer of obsoleteVersions) {
      const obsoleteRows = mappings.filter((mapping) => mapping.doc_ver === docVer);
      await mappingStore.updateStatus(
        input.documentId,
        docVer,
        'failed',
        `Superseded by indexed document version ${input.docVer}.`,
      );
      const pointIds = obsoleteRows.map((mapping) => mapping.vector_id);
      if (pointIds.length > 0) await qdrant.deletePoints(pointIds);
      await mappingStore.deleteVersion(input.documentId, docVer);
      console.info('[DOCUMENT_INDEXING] obsolete version removed', {
        documentId: input.documentId,
        docVer,
        pointCount: pointIds.length,
      });
    }
    return { pending: false };
  } catch (error) {
    const failure = getFailure(error, 'mapping');
    console.error('[DOCUMENT_INDEXING] obsolete version cleanup pending', {
      documentId: input.documentId,
      docVer: input.docVer,
      code: failure.code,
    });
    return {
      pending: true,
      error: { code: 'OBSOLETE_VERSION_CLEANUP_FAILED', message: 'The new version is indexed, but obsolete-version cleanup must be retried.' },
    };
  }
}

async function finishIndexedVersion(
  input: IndexProcessedDocumentInput,
  chunks: Array<{ chunkIndex: number; chunkHash: string; vectorId: string; pageNumber?: number; section?: string; text: string }>,
  mappingStore: Pick<DocumentChunkMappingStore, 'list' | 'updateStatus' | 'deleteVersion'>,
  qdrant: Pick<QdrantService, 'deletePoints'>,
  reusedExistingIndex: boolean,
): Promise<IndexedDocumentResult> {
  const cleanup = await cleanObsoleteVersions(input, mappingStore, qdrant);
  if (!cleanup.pending) {
    console.info('[DOCUMENT_INDEXING] completed', {
      documentId: input.documentId,
      docVer: input.docVer,
      chunkCount: chunks.length,
      reusedExistingIndex,
    });
  }
  return {
    documentId: input.documentId,
    projectId: input.projectId,
    docVer: input.docVer,
    chunkCount: chunks.length,
    processingStatus: 'indexed',
    reusedExistingIndex,
    cleanupPending: cleanup.pending,
    ...(cleanup.error === undefined ? {} : { cleanupError: cleanup.error }),
  };
}

export async function indexProcessedDocument(
  input: IndexProcessedDocumentInput,
  dependencies: DocumentIndexingDependencies = {},
): Promise<IndexedDocumentResult> {
  validateInput(input);
  return withKeyedOperation(
    JSON.stringify(['document', input.documentId]),
    () => indexProcessedDocumentUnlocked(input, dependencies),
  );
}

async function indexProcessedDocumentUnlocked(
  input: IndexProcessedDocumentInput,
  dependencies: DocumentIndexingDependencies,
): Promise<IndexedDocumentResult> {
  const chunkMetadata = input.chunks.map((chunk) => {
    const chunkHash = createChunkHash(chunk.text);
    return {
      chunkIndex: chunk.chunkIndex,
      chunkHash,
      vectorId: createChunkPointId(input.documentId, input.docVer, chunk.chunkIndex),
      pageNumber: chunk.pageNumber,
      section: chunk.section,
      text: chunk.text,
    };
  });
  const mappingStore = dependencies.mappings ?? documentChunkMappings;
  let mappingsPersisted = false;
  let phase: IndexingPhase = 'verification';
  let qdrant: (Pick<QdrantService, 'upsertPoints' | 'retrievePoints' | 'deletePoints'>) | undefined;

  try {
    qdrant = dependencies.qdrant ?? new QdrantService();
    const embedder = dependencies.embedder ?? { embedTexts };
    const existingMappings = await mappingStore.list(input.documentId, input.docVer);
    if (mappingRowsMatch(existingMappings, chunkMetadata, false)) {
      const existingPoints = await qdrant.retrievePoints(chunkMetadata.map((chunk) => chunk.vectorId));
      if (qdrantPointsMatch(existingPoints, input, chunkMetadata)) {
        if (!mappingRowsMatch(existingMappings, chunkMetadata)) {
          phase = 'mapping';
          mappingsPersisted = true;
          await mappingStore.updateStatus(input.documentId, input.docVer, 'indexed');
          phase = 'verification';
          const repairedMappings = await mappingStore.list(input.documentId, input.docVer);
          if (!mappingRowsMatch(repairedMappings, chunkMetadata)) {
            throw new DocumentIndexingError(
              'The recovered SQL mappings do not match the verified vector set.',
              'DOCUMENT_INDEX_VERIFICATION_FAILED',
            );
          }
        }
        return finishIndexedVersion(input, chunkMetadata, mappingStore, qdrant, true);
      }
    }

    phase = 'mapping';
    console.info('[DOCUMENT_INDEXING] version identified', {
      documentId: input.documentId,
      docVer: input.docVer,
      chunkCount: chunkMetadata.length,
    });
    await mappingStore.upsert(
      input.documentId,
      input.docVer,
      chunkMetadata.map(({ chunkIndex, vectorId, chunkHash }) => ({
        chunkIndex,
        vectorId,
        chunkHash,
        status: 'pending' as const,
      })),
    );
    mappingsPersisted = true;
    await mappingStore.updateStatus(input.documentId, input.docVer, 'processing');

    let batchNumber = 0;
    for (let offset = 0; offset < chunkMetadata.length; offset += DOCUMENT_EMBEDDING_BATCH_SIZE) {
      batchNumber += 1;
      const batch = chunkMetadata.slice(offset, offset + DOCUMENT_EMBEDDING_BATCH_SIZE);
      phase = 'embedding';
      const embeddings = await embedder.embedTexts(batch.map((chunk) => chunk.text));
      if (embeddings.length !== batch.length) {
        throw new DocumentIndexingError(
          'The embedding service returned an incomplete batch.',
          'INVALID_EMBEDDING_BATCH',
        );
      }
      console.info('[DOCUMENT_INDEXING] embedding batch completed', {
        documentId: input.documentId,
        docVer: input.docVer,
        batchNumber,
        chunkCount: batch.length,
      });

      phase = 'qdrant';
      const points: QdrantChunkPointInput[] = batch.map((chunk, index) => ({
        documentId: input.documentId,
        projectId: input.projectId,
        docVer: input.docVer,
        chunkIndex: chunk.chunkIndex,
        chunkHash: chunk.chunkHash,
        ...(chunk.pageNumber === undefined ? {} : { pageNumber: chunk.pageNumber }),
        ...(chunk.section === undefined ? {} : { section: chunk.section }),
        text: chunk.text,
        vector: embeddings[index]!,
      }));
      const storedIds = await qdrant.upsertPoints(points);
      const expectedIds = batch.map((chunk) => chunk.vectorId);
      if (
        storedIds.length !== expectedIds.length ||
        storedIds.some((id, index) => id.toLowerCase() !== expectedIds[index]!.toLowerCase())
      ) {
        throw new DocumentIndexingError(
          'Qdrant returned unexpected point identities.',
          'INVALID_QDRANT_UPSERT_RESULT',
        );
      }
      console.info('[DOCUMENT_INDEXING] Qdrant batch verified', {
        documentId: input.documentId,
        docVer: input.docVer,
        batchNumber,
        pointCount: storedIds.length,
      });
    }

    phase = 'verification';
    const verifiedPoints = await qdrant.retrievePoints(chunkMetadata.map((chunk) => chunk.vectorId));
    if (!qdrantPointsMatch(verifiedPoints, input, chunkMetadata)) {
      throw new DocumentIndexingError(
        'The complete Qdrant point set did not match the expected chunk payloads.',
        'DOCUMENT_VECTOR_VERIFICATION_FAILED',
      );
    }

    phase = 'mapping';
    await mappingStore.updateStatus(input.documentId, input.docVer, 'indexed');
    console.info('[DOCUMENT_INDEXING] SQL mappings marked indexed', {
      documentId: input.documentId,
      docVer: input.docVer,
      chunkCount: chunkMetadata.length,
    });
    phase = 'verification';
    const persistedMappings = await mappingStore.list(input.documentId, input.docVer);
    if (!mappingRowsMatch(persistedMappings, chunkMetadata)) {
      throw new DocumentIndexingError(
        'The stored SQL mappings do not match the verified vector set.',
        'DOCUMENT_INDEX_VERIFICATION_FAILED',
      );
    }

    return finishIndexedVersion(input, chunkMetadata, mappingStore, qdrant, false);
  } catch (error) {
    const failure = getFailure(error, phase);
    if (mappingsPersisted) {
      try {
        await mappingStore.updateStatus(
          input.documentId,
          input.docVer,
          'failed',
          `${failure.code}: ${failure.message}`.slice(0, 2000),
        );
      } catch (statusError) {
        throw new DocumentIndexingError(
          'Indexing failed and its failure status could not be persisted.',
          'DOCUMENT_INDEXING_STATE_FAILED',
          { cause: new AggregateError([error, statusError]) },
        );
      }
    }
    throw new DocumentIndexingError(failure.message, failure.code, { cause: error });
  }
}
