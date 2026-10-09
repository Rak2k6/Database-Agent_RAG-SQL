import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createChunkPointId, type QdrantChunkPointInput, type QdrantRetrievedPoint } from './qdrant.js';
import {
  DOCUMENT_EMBEDDING_BATCH_SIZE,
  DocumentIndexingError,
  indexProcessedDocument,
  withDocumentContentLock,
} from './document-indexing.js';
import { EmbeddingServiceError } from './embeddings.js';
import type { ProcessedDocumentChunk } from '../document-processing.js';
import type { DocumentChunkStatus } from '../db/document-chunks.js';

const documentId = 'document-stage-e';
const projectId = 'project-stage-e';
const docVer = 'd'.repeat(64);
const vector = () => Array.from({ length: 768 }, () => 0.125);

function makeChunks(count: number): ProcessedDocumentChunk[] {
  return Array.from({ length: count }, (_value, chunkIndex) => ({
    documentId,
    projectId,
    originalFilename: 'fixture.md',
    chunkIndex,
    pageNumber: chunkIndex + 1,
    section: `Section ${chunkIndex + 1}`,
    processingStatus: 'processed',
    text: `Synthetic chunk ${chunkIndex + 1} — 東京.`,
  }));
}

function successfulDependencies() {
  const statuses: string[] = [];
  const embeddingBatches: string[][] = [];
  const upsertedPoints: QdrantChunkPointInput[][] = [];
  const storedPoints: QdrantRetrievedPoint[] = [];
  const mappingEntries: Array<{ documentId: string; docVer: string; chunkIndex: number; vectorId: string; chunkHash: string; status: DocumentChunkStatus }> = [];
  const cleanupEvents: string[] = [];
  const dependencies = {
    embedder: {
      async embedTexts(texts: readonly string[]) {
        embeddingBatches.push([...texts]);
        return texts.map(() => vector());
      },
    },
    qdrant: {
      async upsertPoints(points: readonly QdrantChunkPointInput[]) {
        upsertedPoints.push([...points]);
        for (const point of points) {
          const id = createChunkPointId(point.documentId, point.docVer, point.chunkIndex);
          const payload = {
            document_id: point.documentId,
            ...(point.projectId === null || point.projectId === undefined ? {} : { project_id: point.projectId }),
            doc_ver: point.docVer,
            chunk_index: point.chunkIndex,
            chunk_hash: point.chunkHash,
            ...(point.pageNumber === undefined ? {} : { page_number: point.pageNumber }),
            ...(point.section === undefined ? {} : { section: point.section }),
            text: point.text,
          };
          const index = storedPoints.findIndex((stored) => stored.id === id);
          const stored = { id, payload, vector: [...point.vector] };
          if (index >= 0) storedPoints[index] = stored;
          else storedPoints.push(stored);
        }
        return points.map((point) => createChunkPointId(point.documentId, point.docVer, point.chunkIndex));
      },
      async retrievePoints(ids: readonly string[]) {
        return storedPoints.filter((point) => ids.includes(point.id));
      },
      async deletePoints(ids: readonly string[]) {
        cleanupEvents.push(`delete:${ids.length}`);
        for (let index = storedPoints.length - 1; index >= 0; index -= 1) {
          if (ids.includes(storedPoints[index]!.id)) storedPoints.splice(index, 1);
        }
      },
    },
    mappings: {
      async upsert(_documentId: string, _docVer: string, mappings: readonly { chunkIndex: number; vectorId: string; chunkHash: string }[]) {
        statuses.push(`upsert:${mappings.length}`);
        for (const mapping of mappings) {
          const index = mappingEntries.findIndex((entry) =>
            entry.documentId === _documentId && entry.docVer === _docVer && entry.chunkIndex === mapping.chunkIndex);
          const entry: typeof mappingEntries[number] = {
            documentId: _documentId,
            docVer: _docVer,
            ...mapping,
            status: 'pending',
          };
          if (index >= 0) mappingEntries[index] = entry;
          else mappingEntries.push(entry);
        }
      },
      async updateStatus(_documentId: string, _docVer: string, status: DocumentChunkStatus) {
        statuses.push(status);
        for (const entry of mappingEntries) {
          if (entry.documentId === _documentId && entry.docVer === _docVer) entry.status = status;
        }
        return 1;
      },
      async list(_documentId: string, version?: string) {
        return mappingEntries
          .filter((entry) => entry.documentId === _documentId && (version === undefined || entry.docVer === version))
          .map((entry) => ({
            id: randomUUID(),
            document_id: entry.documentId,
            doc_ver: entry.docVer,
            chunk_index: entry.chunkIndex,
            vector_id: entry.vectorId,
            chunk_hash: entry.chunkHash,
            status: entry.status,
            error_message: null,
            created_at: new Date(),
            updated_at: new Date(),
          }));
      },
      async deleteVersion(_documentId: string, version: string) {
        cleanupEvents.push(`mapping-delete:${version}`);
        for (let index = mappingEntries.length - 1; index >= 0; index -= 1) {
          if (mappingEntries[index]!.documentId === _documentId && mappingEntries[index]!.docVer === version) {
            mappingEntries.splice(index, 1);
          }
        }
        return 1;
      },
    },
  };
  return { dependencies, statuses, embeddingBatches, upsertedPoints, storedPoints, cleanupEvents };
}

test('indexes extracted chunks in order, persists metadata, and verifies mapping completion', async () => {
  const mock = successfulDependencies();
  const result = await indexProcessedDocument({
    documentId,
    projectId,
    docVer,
    chunks: makeChunks(2),
  }, mock.dependencies);

  assert.deepEqual(result, {
    documentId,
    projectId,
    docVer,
    chunkCount: 2,
    processingStatus: 'indexed',
    reusedExistingIndex: false,
    cleanupPending: false,
  });
  assert.deepEqual(mock.statuses, ['upsert:2', 'processing', 'indexed']);
  assert.deepEqual(mock.embeddingBatches, [[makeChunks(2)[0]!.text, makeChunks(2)[1]!.text]]);
  assert.equal(mock.upsertedPoints[0]![0]!.pageNumber, 1);
  assert.equal(mock.upsertedPoints[0]![0]!.section, 'Section 1');
  assert.equal(mock.upsertedPoints[0]![0]!.text, makeChunks(2)[0]!.text);
  assert.equal(mock.upsertedPoints[0]![0]!.chunkHash.length, 64);
});

test('reuses an already verified mapping and Qdrant point set without re-embedding', async () => {
  const mock = successfulDependencies();
  const input = { documentId, projectId, docVer, chunks: makeChunks(2) };
  await indexProcessedDocument(input, mock.dependencies);
  const upsertCount = mock.upsertedPoints.length;
  const result = await indexProcessedDocument(input, mock.dependencies);

  assert.equal(result.reusedExistingIndex, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(mock.upsertedPoints.length, upsertCount);
  assert.equal(mock.embeddingBatches.length, 1);
});

test('repairs an interrupted mapping status when its Qdrant points already verify', async () => {
  const mock = successfulDependencies();
  const input = { documentId, projectId, docVer, chunks: makeChunks(1) };
  await indexProcessedDocument(input, mock.dependencies);
  await mock.dependencies.mappings.updateStatus(documentId, docVer, 'failed');
  const result = await indexProcessedDocument(input, mock.dependencies);

  assert.equal(result.reusedExistingIndex, true);
  assert.equal(mock.embeddingBatches.length, 1);
  assert.equal(mock.statuses.at(-1), 'indexed');
});

test('bounds embedding and Qdrant calls into stable batches', async () => {
  const mock = successfulDependencies();
  const result = await indexProcessedDocument({
    documentId,
    projectId,
    docVer,
    chunks: makeChunks(DOCUMENT_EMBEDDING_BATCH_SIZE + 1),
  }, mock.dependencies);

  assert.equal(result.chunkCount, DOCUMENT_EMBEDDING_BATCH_SIZE + 1);
  assert.deepEqual(mock.embeddingBatches.map((batch) => batch.length), [DOCUMENT_EMBEDDING_BATCH_SIZE, 1]);
  assert.deepEqual(mock.upsertedPoints.map((batch) => batch.length), [DOCUMENT_EMBEDDING_BATCH_SIZE, 1]);
});

test('marks persisted mappings failed when embedding generation fails', async () => {
  const mock = successfulDependencies();
  let qdrantCalls = 0;
  mock.dependencies.embedder.embedTexts = async () => {
    throw new EmbeddingServiceError('Ollama embedding service is unavailable.', 'OLLAMA_UNAVAILABLE');
  };
  mock.dependencies.qdrant.upsertPoints = async () => {
    qdrantCalls += 1;
    return [];
  };

  await assert.rejects(indexProcessedDocument({
    documentId,
    projectId,
    docVer,
    chunks: makeChunks(1),
  }, mock.dependencies), (error: unknown) => {
    assert(error instanceof DocumentIndexingError);
    assert.equal(error.code, 'OLLAMA_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(mock.statuses, ['upsert:1', 'processing', 'failed']);
  assert.equal(qdrantCalls, 0);
});

test('retries a failed version using stable mapping and Qdrant identities', async () => {
  const mock = successfulDependencies();
  let shouldFail = true;
  mock.dependencies.embedder.embedTexts = async (texts) => {
    if (shouldFail) {
      shouldFail = false;
      throw new EmbeddingServiceError('Ollama embedding service is unavailable.', 'OLLAMA_UNAVAILABLE');
    }
    return texts.map(() => vector());
  };
  const input = { documentId, projectId, docVer, chunks: makeChunks(1) };

  await assert.rejects(indexProcessedDocument(input, mock.dependencies), {
    name: 'DocumentIndexingError',
    code: 'OLLAMA_UNAVAILABLE',
  });
  const retry = await indexProcessedDocument(input, mock.dependencies);

  assert.equal(retry.processingStatus, 'indexed');
  assert.equal(retry.reusedExistingIndex, false);
  assert.deepEqual(mock.statuses, ['upsert:1', 'processing', 'failed', 'upsert:1', 'processing', 'indexed']);
  assert.equal(mock.storedPoints.length, 1);
});

test('cleans obsolete versions only after the replacement version is verified', async () => {
  const mock = successfulDependencies();
  const newerVersion = 'e'.repeat(64);
  const chunks = makeChunks(1);
  await indexProcessedDocument({ documentId, projectId, docVer, chunks }, mock.dependencies);
  const result = await indexProcessedDocument({
    documentId,
    projectId,
    docVer: newerVersion,
    chunks,
  }, mock.dependencies);

  assert.equal(result.processingStatus, 'indexed');
  assert.equal(result.cleanupPending, false);
  assert.deepEqual(mock.cleanupEvents, [`delete:1`, `mapping-delete:${docVer}`]);
  assert.equal(mock.storedPoints.length, 1);
  assert.equal(mock.storedPoints[0]!.payload['doc_ver'], newerVersion);
});

test('reports and retries obsolete-version cleanup without re-embedding', async () => {
  const mock = successfulDependencies();
  const newerVersion = 'e'.repeat(64);
  const chunks = makeChunks(1);
  await indexProcessedDocument({ documentId, projectId, docVer, chunks }, mock.dependencies);
  const deletePoints = mock.dependencies.qdrant.deletePoints;
  mock.dependencies.qdrant.deletePoints = async () => {
    throw new Error('synthetic deletion failure');
  };
  const first = await indexProcessedDocument({
    documentId,
    projectId,
    docVer: newerVersion,
    chunks,
  }, mock.dependencies);
  assert.equal(first.processingStatus, 'indexed');
  assert.equal(first.cleanupPending, true);
  const embeddingsBeforeRetry = mock.embeddingBatches.length;

  mock.dependencies.qdrant.deletePoints = deletePoints;
  const retry = await indexProcessedDocument({
    documentId,
    projectId,
    docVer: newerVersion,
    chunks,
  }, mock.dependencies);
  assert.equal(retry.reusedExistingIndex, true);
  assert.equal(retry.cleanupPending, false);
  assert.equal(mock.embeddingBatches.length, embeddingsBeforeRetry);
});

test('serializes same-scope content operations', async () => {
  const order: string[] = [];
  const first = withDocumentContentLock('p', 'u', docVer, async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push('first-end');
  });
  const second = withDocumentContentLock('p', 'u', docVer, async () => {
    order.push('second');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('does not serialize matching content across different ownership scopes', async () => {
  let releaseFirst: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const first = withDocumentContentLock('project-a', 'user-a', docVer, async () => {
    signalStarted?.();
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
  });
  await started;
  let otherScopeEntered = false;
  await withDocumentContentLock('project-a', 'user-b', docVer, async () => {
    otherScopeEntered = true;
  });
  assert.equal(otherScopeEntered, true);
  releaseFirst?.();
  await first;
});

test('does not report indexed if persisted mapping rows are incomplete', async () => {
  const mock = successfulDependencies();
  mock.dependencies.mappings.list = async () => [];

  await assert.rejects(indexProcessedDocument({
    documentId,
    projectId,
    docVer,
    chunks: makeChunks(1),
  }, mock.dependencies), (error: unknown) => {
    assert(error instanceof DocumentIndexingError);
    assert.equal(error.code, 'DOCUMENT_INDEX_VERIFICATION_FAILED');
    return true;
  });
  assert.deepEqual(mock.statuses, ['upsert:1', 'processing', 'indexed', 'failed']);
});

test('rejects mismatched document, project, or unstable chunk indexes before persistence', async () => {
  const mock = successfulDependencies();
  const mismatched = makeChunks(1);
  mismatched[0] = { ...mismatched[0]!, documentId: 'another-document' };

  await assert.rejects(indexProcessedDocument({
    documentId,
    projectId,
    docVer,
    chunks: mismatched,
  }, mock.dependencies), {
    name: 'DocumentIndexingError',
    code: 'INVALID_DOCUMENT_CHUNK',
  });
  assert.deepEqual(mock.statuses, []);
});
