import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createChunkPointId,
  DEFAULT_QDRANT_COLLECTION,
  DEFAULT_QDRANT_VECTOR_SIZE,
  QdrantService,
  QdrantServiceError,
  type QdrantChunkPointInput,
} from './qdrant.js';

const vector = (value = 0.5) => Array.from({ length: DEFAULT_QDRANT_VECTOR_SIZE }, () => value);
const point: QdrantChunkPointInput = {
  documentId: 'document-123',
  projectId: 'project-456',
  docVer: 'a'.repeat(64),
  chunkIndex: 2,
  chunkHash: 'b'.repeat(64),
  pageNumber: 4,
  section: 'Architecture decisions',
  text: 'Original chunk text with Unicode: café 東京.',
  vector: vector(),
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function collectionResponse(
  size = DEFAULT_QDRANT_VECTOR_SIZE,
  distance = 'Cosine',
): Response {
  return response({
    status: 'ok',
    result: {
      config: {
        params: {
          vectors: { size, distance },
        },
      },
    },
  });
}

function mockQdrant(options: {
  collection?: Response;
  omitRetrievedPoints?: boolean;
  unavailable?: boolean;
  searchResults?: unknown[];
} = {}): {
  fetch: typeof globalThis.fetch;
  requests: Array<{ url: string; init: RequestInit }>;
  stored: Map<string, { id: string; vector: number[]; payload: Record<string, unknown> }>;
} {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const stored = new Map<string, { id: string; vector: number[]; payload: Record<string, unknown> }>();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (options.unavailable) throw new TypeError('private transport details');
    if (init.method === 'GET') return options.collection ?? collectionResponse();

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (init.method === 'POST' && url.endsWith('/points/query')) {
      return response({ status: 'ok', result: { points: options.searchResults ?? [] } });
    }
    if (init.method === 'PUT' && url.includes('/points?wait=true')) {
      for (const rawPoint of body['points'] as Array<Record<string, unknown>>) {
        const storedPoint = {
          id: String(rawPoint['id']),
          vector: rawPoint['vector'] as number[],
          payload: rawPoint['payload'] as Record<string, unknown>,
        };
        stored.set(storedPoint.id, storedPoint);
      }
      return response({ status: 'ok', result: { operation_id: 1, status: 'completed' } });
    }
    if (init.method === 'POST' && url.includes('/points/delete?wait=true')) {
      for (const id of body['points'] as string[]) stored.delete(id);
      return response({ status: 'ok', result: { operation_id: 2, status: 'completed' } });
    }
    if (init.method === 'POST' && url.endsWith('/points')) {
      const ids = body['ids'] as string[];
      const points = options.omitRetrievedPoints
        ? []
        : ids.map((id) => stored.get(id)).filter((storedPoint) => storedPoint !== undefined);
      return response({ status: 'ok', result: points });
    }
    return response({ status: 'error', result: null }, 404);
  };
  return { fetch, requests, stored };
}

const makeService = (fetch: typeof globalThis.fetch) => new QdrantService({
  baseUrl: 'http://qdrant.test:6333',
  collection: DEFAULT_QDRANT_COLLECTION,
  vectorSize: DEFAULT_QDRANT_VECTOR_SIZE,
  timeoutMs: 1000,
  fetch,
});

test('verifies the existing collection dimension and cosine distance', async () => {
  const mocked = mockQdrant();
  const result = await makeService(mocked.fetch).verifyCollection();

  assert.deepEqual(result, {
    collection: DEFAULT_QDRANT_COLLECTION,
    vectorSize: DEFAULT_QDRANT_VECTOR_SIZE,
    distance: 'Cosine',
  });
  assert.equal(mocked.requests[0]!.init.method, 'GET');
  assert.equal(
    mocked.requests[0]!.url,
    'http://qdrant.test:6333/collections/northstar_document_chunks',
  );
});

test('runs scoped vector search and returns validated scores and payloads', async () => {
  const id = createChunkPointId(point.documentId, point.docVer, point.chunkIndex);
  const mocked = mockQdrant({
    searchResults: [{ id, score: 0.83, payload: { document_id: point.documentId, text: point.text } }],
  });
  const results = await makeService(mocked.fetch).searchPoints(point.vector, {
    limit: 8,
    projectIds: [point.projectId!],
    documentIds: [point.documentId],
  });

  assert.deepEqual(results, [{
    id,
    score: 0.83,
    payload: { document_id: point.documentId, text: point.text },
  }]);
  const queryRequest = mocked.requests.find((request) => request.url.endsWith('/points/query'))!;
  const requestBody = JSON.parse(String(queryRequest.init.body)) as Record<string, unknown>;
  assert.equal(requestBody['limit'], 8);
  assert.deepEqual(requestBody['filter'], {
    should: [
      { key: 'project_id', match: { any: [point.projectId] } },
      { key: 'document_id', match: { any: [point.documentId] } },
    ],
  });
});

test('rejects unscoped vector search and malformed search results', async () => {
  const mocked = mockQdrant({
    searchResults: [{ id: createChunkPointId(point.documentId, point.docVer, point.chunkIndex), score: 'high', payload: {} }],
  });
  const service = makeService(mocked.fetch);
  await assert.rejects(service.searchPoints(point.vector, { limit: 5 }), {
    name: 'QdrantServiceError',
    code: 'INVALID_SEARCH',
  });
  await assert.rejects(service.searchPoints(point.vector, { limit: 5, projectIds: [point.projectId!] }), {
    name: 'QdrantServiceError',
    code: 'INVALID_RESPONSE',
  });
});

test('rejects a collection with the wrong vector size, distance, or named-vector config', async () => {
  const wrongSize = mockQdrant({ collection: collectionResponse(384) });
  const wrongDistance = mockQdrant({ collection: collectionResponse(768, 'Euclid') });
  const namedVectors = mockQdrant({
    collection: response({
      status: 'ok',
      result: { config: { params: { vectors: { default: { size: 768, distance: 'Cosine' } } } } },
    }),
  });

  for (const mocked of [wrongSize, wrongDistance, namedVectors]) {
    await assert.rejects(makeService(mocked.fetch).verifyCollection(), {
      name: 'QdrantServiceError',
      code: 'INCOMPATIBLE_COLLECTION',
    });
  }
});

test('upserts, retrieves, and verifies the exact vector and minimal payload', async () => {
  const mocked = mockQdrant();
  const service = makeService(mocked.fetch);
  const [pointId] = await service.upsertPoints([point]);

  assert.equal(pointId, createChunkPointId(point.documentId, point.docVer, point.chunkIndex));
  assert.equal(mocked.stored.size, 1);
  const stored = mocked.stored.get(pointId!)!;
  assert.deepEqual(stored.payload, {
    document_id: point.documentId,
    project_id: point.projectId,
    doc_ver: point.docVer,
    chunk_index: point.chunkIndex,
    chunk_hash: point.chunkHash,
    page_number: point.pageNumber,
    section: point.section,
    text: point.text,
  });
  assert.deepEqual(stored.vector, point.vector);
  const retrieved = await service.retrievePoints([pointId!]);
  assert.deepEqual(retrieved[0], stored);
  const retrievalRequest = mocked.requests.find((request) => request.url.endsWith('/points'))!;
  assert.deepEqual(JSON.parse(String(retrievalRequest.init.body)), {
    ids: [pointId],
    with_payload: true,
    with_vector: true,
  });
});

test('uses stable UUID v5 identities across retries without colliding between content versions', async () => {
  const mocked = mockQdrant();
  const service = makeService(mocked.fetch);
  const firstAttempt = await service.upsertPoints([point]);
  const retry = await service.upsertPoints([point]);
  const changedVersion = await service.upsertPoints([{ ...point, docVer: 'c'.repeat(64) }]);

  assert.deepEqual(retry, firstAttempt);
  assert.notEqual(changedVersion[0], firstAttempt[0]);
  assert.equal(mocked.stored.size, 2);
  assert.equal(firstAttempt[0], createChunkPointId('document-123', 'a'.repeat(64), 2));
});

test('omits absent project IDs and rejects invalid vectors and duplicate identities', async () => {
  const mocked = mockQdrant();
  const service = makeService(mocked.fetch);

  await assert.rejects(service.upsertPoints([{ ...point, vector: vector().slice(1) }]), {
    name: 'QdrantServiceError',
    code: 'INVALID_VECTOR',
  });
  await assert.rejects(service.upsertPoints([point, point]), {
    name: 'QdrantServiceError',
    code: 'INVALID_INPUT',
  });
  const [id] = await service.upsertPoints([{ ...point, projectId: null }]);
  assert.equal('project_id' in mocked.stored.get(id!)!.payload, false);
});

test('rejects a successful upsert response if retrieval cannot verify all points', async () => {
  const mocked = mockQdrant({ omitRetrievedPoints: true });

  await assert.rejects(makeService(mocked.fetch).upsertPoints([point]), {
    name: 'QdrantServiceError',
    code: 'UPSERT_VERIFICATION_FAILED',
  });
});

test('deletes only requested point IDs and verifies their removal', async () => {
  const mocked = mockQdrant();
  const service = makeService(mocked.fetch);
  const [pointId] = await service.upsertPoints([point]);
  const unrelatedId = createChunkPointId('other-document', 'd'.repeat(64), 0);
  mocked.stored.set(unrelatedId, {
    id: unrelatedId,
    vector: vector(),
    payload: { document_id: 'other-document' },
  });

  await service.deletePoints([pointId!]);

  assert.equal(mocked.stored.has(pointId!), false);
  assert.equal(mocked.stored.has(unrelatedId), true);
});

test('handles unavailable Qdrant and HTTP failures without echoing server details', async () => {
  const unavailable = mockQdrant({ unavailable: true });
  const failingHttp: typeof globalThis.fetch = async () => response(
    { status: 'error', message: 'private server details' },
    503,
  );

  await assert.rejects(makeService(unavailable.fetch).verifyCollection(), (error: unknown) => {
    assert(error instanceof QdrantServiceError);
    assert.equal(error.code, 'QDRANT_UNAVAILABLE');
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  await assert.rejects(makeService(failingHttp).verifyCollection(), (error: unknown) => {
    assert(error instanceof QdrantServiceError);
    assert.equal(error.code, 'QDRANT_REQUEST_FAILED');
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test('aborts Qdrant requests at the configured timeout', async () => {
  const fetch: typeof globalThis.fetch = async (_input, init = {}) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const service = new QdrantService({
    baseUrl: 'http://qdrant.test:6333',
    timeoutMs: 5,
    fetch,
  });

  await assert.rejects(service.verifyCollection(), {
    name: 'QdrantServiceError',
    code: 'QDRANT_TIMEOUT',
  });
});

test('rejects invalid point identifiers and invalid service configuration', async () => {
  const mocked = mockQdrant();
  const service = makeService(mocked.fetch);

  await assert.rejects(service.retrievePoints(['not-a-uuid']), {
    name: 'QdrantServiceError',
    code: 'INVALID_POINT_ID',
  });
  assert.throws(() => new QdrantService({ baseUrl: 'file:///tmp' }), {
    name: 'QdrantServiceError',
    code: 'INVALID_CONFIGURATION',
  });
});
