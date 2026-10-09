import { validate as isUuid, v5 as uuidV5 } from 'uuid';

export const DEFAULT_QDRANT_URL = 'http://localhost:6333';
export const DEFAULT_QDRANT_COLLECTION = 'northstar_document_chunks';
export const DEFAULT_QDRANT_VECTOR_SIZE = 768;
export const DEFAULT_QDRANT_TIMEOUT_MS = 10_000;

const DOCUMENT_CHUNK_NAMESPACE = '6ea09412-9472-4c98-9d85-853891ead56c';

export interface QdrantServiceOptions {
  baseUrl?: string;
  collection?: string;
  vectorSize?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface QdrantChunkPointInput {
  documentId: string;
  projectId?: string | null;
  docVer: string;
  chunkIndex: number;
  chunkHash: string;
  pageNumber?: number;
  section?: string;
  text: string;
  vector: readonly number[];
}

export interface QdrantRetrievedPoint {
  id: string;
  payload: Record<string, unknown>;
  vector: number[];
}

export interface QdrantSearchOptions {
  limit: number;
  projectIds?: readonly string[];
  documentIds?: readonly string[];
}

export interface QdrantSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantCollectionInfo {
  collection: string;
  vectorSize: number;
  distance: 'Cosine';
}

export class QdrantServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'QdrantServiceError';
  }
}

interface QdrantConfiguration {
  baseUrl: URL;
  collection: string;
  vectorSize: number;
  timeoutMs: number;
  fetch: typeof globalThis.fetch;
}

function configuration(options: QdrantServiceOptions): QdrantConfiguration {
  const baseUrl = options.baseUrl ?? process.env.QDRANT_URL ?? DEFAULT_QDRANT_URL;
  const collection = options.collection ?? process.env.QDRANT_COLLECTION ?? DEFAULT_QDRANT_COLLECTION;
  const configuredSize = process.env.QDRANT_VECTOR_SIZE;
  const vectorSize = options.vectorSize
    ?? (configuredSize === undefined ? DEFAULT_QDRANT_VECTOR_SIZE : Number(configuredSize));
  const configuredTimeout = process.env.QDRANT_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs
    ?? (configuredTimeout === undefined ? DEFAULT_QDRANT_TIMEOUT_MS : Number(configuredTimeout));

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new Error('Invalid Qdrant URL.');
    }
  } catch {
    throw new QdrantServiceError('The Qdrant URL is invalid.', 'INVALID_CONFIGURATION');
  }
  if (
    !collection.trim() ||
    collection.includes('/') ||
    !Number.isInteger(vectorSize) ||
    vectorSize <= 0 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new QdrantServiceError('The Qdrant configuration is invalid.', 'INVALID_CONFIGURATION');
  }

  return {
    baseUrl: parsedUrl,
    collection,
    vectorSize,
    timeoutMs,
    fetch: options.fetch ?? globalThis.fetch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectionPath(config: QdrantConfiguration, suffix = ''): string {
  const url = new URL(
    `/collections/${encodeURIComponent(config.collection)}${suffix}`,
    config.baseUrl,
  );
  return url.toString();
}

function requiredText(value: string, field: string, maxLength: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new QdrantServiceError(`The ${field} value is invalid.`, 'INVALID_POINT');
  }
}

function validatePoint(
  point: QdrantChunkPointInput,
  vectorSize: number,
): void {
  requiredText(point.documentId, 'document ID', 255);
  requiredText(point.docVer, 'document version', 64);
  requiredText(point.text, 'chunk text', Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(point.chunkIndex) || point.chunkIndex < 0) {
    throw new QdrantServiceError('The chunk index is invalid.', 'INVALID_POINT');
  }
  if (!/^[a-f\d]{64}$/i.test(point.chunkHash)) {
    throw new QdrantServiceError('The chunk hash must be a SHA-256 hexadecimal digest.', 'INVALID_POINT');
  }
  if (point.projectId != null) requiredText(point.projectId, 'project ID', 255);
  if (point.pageNumber !== undefined && (!Number.isInteger(point.pageNumber) || point.pageNumber < 1)) {
    throw new QdrantServiceError('The chunk page number is invalid.', 'INVALID_POINT');
  }
  if (point.section !== undefined) requiredText(point.section, 'chunk section', 1000);
  if (
    !Array.isArray(point.vector) ||
    point.vector.length !== vectorSize ||
    !point.vector.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new QdrantServiceError(
      `Each vector must contain exactly ${vectorSize} finite numbers.`,
      'INVALID_VECTOR',
    );
  }
}

function makePayload(point: QdrantChunkPointInput): Record<string, unknown> {
  return {
    document_id: point.documentId,
    ...(point.projectId == null ? {} : { project_id: point.projectId }),
    doc_ver: point.docVer,
    chunk_index: point.chunkIndex,
    chunk_hash: point.chunkHash,
    ...(point.pageNumber === undefined ? {} : { page_number: point.pageNumber }),
    ...(point.section === undefined ? {} : { section: point.section }),
    text: point.text,
  };
}

export function createChunkPointId(documentId: string, docVer: string, chunkIndex: number): string {
  requiredText(documentId, 'document ID', 255);
  requiredText(docVer, 'document version', 64);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new QdrantServiceError('The chunk index is invalid.', 'INVALID_POINT');
  }
  return uuidV5(JSON.stringify([documentId, docVer, chunkIndex]), DOCUMENT_CHUNK_NAMESPACE);
}

export class QdrantService {
  private readonly config: QdrantConfiguration;

  constructor(options: QdrantServiceOptions = {}) {
    this.config = configuration(options);
  }

  async verifyCollection(): Promise<QdrantCollectionInfo> {
    const response = await this.request('GET', collectionPath(this.config));
    const result = response['result'];
    const params = isRecord(result) && isRecord(result['config']) && isRecord(result['config']['params'])
      ? result['config']['params']
      : undefined;
    const vectors = params?.['vectors'];
    if (
      !isRecord(vectors) ||
      vectors['size'] !== this.config.vectorSize ||
      vectors['distance'] !== 'Cosine'
    ) {
      throw new QdrantServiceError(
        'The existing Qdrant collection has an incompatible vector size or distance metric.',
        'INCOMPATIBLE_COLLECTION',
      );
    }
    return {
      collection: this.config.collection,
      vectorSize: this.config.vectorSize,
      distance: 'Cosine',
    };
  }

  async upsertPoints(points: readonly QdrantChunkPointInput[]): Promise<string[]> {
    if (!Array.isArray(points) || points.length === 0) {
      throw new QdrantServiceError('At least one chunk point is required.', 'INVALID_INPUT');
    }
    points.forEach((point) => validatePoint(point, this.config.vectorSize));
    const ids = points.map((point) => createChunkPointId(point.documentId, point.docVer, point.chunkIndex));
    if (new Set(ids).size !== ids.length) {
      throw new QdrantServiceError('The upsert batch contains duplicate chunk identities.', 'INVALID_INPUT');
    }

    await this.verifyCollection();
    const response = await this.request('PUT', collectionPath(this.config, '/points?wait=true'), {
      points: points.map((point, index) => ({
        id: ids[index]!,
        vector: point.vector,
        payload: makePayload(point),
      })),
    });
    this.assertOperationCompleted(response);

    const retrieved = await this.retrievePointsWithoutCollectionCheck(ids);
    const retrievedById = new Map(retrieved.map((point) => [point.id, point]));
    for (let index = 0; index < ids.length; index += 1) {
      const expectedId = ids[index]!;
      const stored = retrievedById.get(expectedId);
      const expectedPayload = makePayload(points[index]!);
      if (
        !stored ||
        stored.vector.length !== this.config.vectorSize ||
        Object.entries(expectedPayload).some(([key, value]) => stored.payload[key] !== value)
      ) {
        throw new QdrantServiceError(
          'Qdrant did not return all upserted points with their expected metadata.',
          'UPSERT_VERIFICATION_FAILED',
        );
      }
    }
    return ids;
  }

  async retrievePoints(ids: readonly string[]): Promise<QdrantRetrievedPoint[]> {
    this.validatePointIds(ids);
    await this.verifyCollection();
    return this.retrievePointsWithoutCollectionCheck(ids);
  }

  async searchPoints(
    vector: readonly number[],
    options: QdrantSearchOptions,
  ): Promise<QdrantSearchResult[]> {
    if (
      !Array.isArray(vector) ||
      vector.length !== this.config.vectorSize ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    ) {
      throw new QdrantServiceError('The vector search input is invalid.', 'INVALID_SEARCH');
    }

    const projectIds = options.projectIds ?? [];
    const documentIds = options.documentIds ?? [];
    if (
      (projectIds.length === 0 && documentIds.length === 0) ||
      projectIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 255) ||
      documentIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 255)
    ) {
      throw new QdrantServiceError('A scoped document filter is required for vector search.', 'INVALID_SEARCH');
    }

    const should = [
      ...(projectIds.length === 0
        ? []
        : [{ key: 'project_id', match: { any: [...new Set(projectIds)] } }]),
      ...(documentIds.length === 0
        ? []
        : [{ key: 'document_id', match: { any: [...new Set(documentIds)] } }]),
    ];
    await this.verifyCollection();
    const response = await this.request('POST', collectionPath(this.config, '/points/query'), {
      query: vector,
      limit: options.limit,
      with_payload: true,
      with_vector: false,
      filter: { should },
    });
    const result = response['result'];
    if (!isRecord(result) || !Array.isArray(result['points'])) {
      throw new QdrantServiceError('Qdrant returned an invalid vector search response.', 'INVALID_RESPONSE');
    }

    return result['points'].map((rawPoint: unknown) => {
      if (
        !isRecord(rawPoint) ||
        typeof rawPoint['id'] !== 'string' ||
        !isUuid(rawPoint['id']) ||
        typeof rawPoint['score'] !== 'number' ||
        !Number.isFinite(rawPoint['score']) ||
        !isRecord(rawPoint['payload'])
      ) {
        throw new QdrantServiceError('Qdrant returned a malformed vector search result.', 'INVALID_RESPONSE');
      }
      return {
        id: rawPoint['id'],
        score: rawPoint['score'],
        payload: rawPoint['payload'],
      };
    });
  }

  async deletePoints(ids: readonly string[]): Promise<void> {
    this.validatePointIds(ids);
    await this.verifyCollection();
    const response = await this.request('POST', collectionPath(this.config, '/points/delete?wait=true'), {
      points: ids,
    });
    this.assertOperationCompleted(response);
    const remaining = await this.retrievePointsWithoutCollectionCheck(ids);
    if (remaining.length > 0) {
      throw new QdrantServiceError(
        'Qdrant still contains points after the delete operation completed.',
        'DELETE_VERIFICATION_FAILED',
      );
    }
  }

  private validatePointIds(ids: readonly string[]): void {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !isUuid(id))) {
      throw new QdrantServiceError('At least one valid point UUID is required.', 'INVALID_POINT_ID');
    }
  }

  private async retrievePointsWithoutCollectionCheck(ids: readonly string[]): Promise<QdrantRetrievedPoint[]> {
    const response = await this.request('POST', collectionPath(this.config, '/points'), {
      ids,
      with_payload: true,
      with_vector: true,
    });
    const result = response['result'];
    if (!Array.isArray(result)) {
      throw new QdrantServiceError('Qdrant returned an invalid point response.', 'INVALID_RESPONSE');
    }
    return result.map((point: unknown) => {
      if (
        !isRecord(point) ||
        typeof point['id'] !== 'string' ||
        !isUuid(point['id']) ||
        !isRecord(point['payload']) ||
        !Array.isArray(point['vector']) ||
        point['vector'].length !== this.config.vectorSize ||
        !point['vector'].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new QdrantServiceError('Qdrant returned a malformed point.', 'INVALID_RESPONSE');
      }
      return {
        id: point['id'],
        payload: point['payload'],
        vector: point['vector'],
      };
    });
  }

  private assertOperationCompleted(response: Record<string, unknown>): void {
    const result = response['result'];
    if (!isRecord(result) || result['status'] !== 'completed') {
      throw new QdrantServiceError('Qdrant did not confirm that the operation completed.', 'OPERATION_INCOMPLETE');
    }
  }

  private async request(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.config.fetch(endpoint, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new QdrantServiceError('Qdrant request timed out.', 'QDRANT_TIMEOUT');
        }
        throw new QdrantServiceError('Qdrant service is unavailable.', 'QDRANT_UNAVAILABLE');
      }
      if (!response.ok) {
        throw new QdrantServiceError(
          `Qdrant request failed with HTTP ${response.status}.`,
          'QDRANT_REQUEST_FAILED',
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch {
        if (controller.signal.aborted) {
          throw new QdrantServiceError('Qdrant request timed out.', 'QDRANT_TIMEOUT');
        }
        throw new QdrantServiceError('Qdrant returned malformed JSON.', 'INVALID_RESPONSE');
      }
      if (!isRecord(payload) || payload['status'] !== 'ok') {
        throw new QdrantServiceError('Qdrant returned an invalid response.', 'INVALID_RESPONSE');
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}
