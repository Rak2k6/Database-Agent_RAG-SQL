export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text:latest';
export const OLLAMA_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_OLLAMA_EMBEDDING_TIMEOUT_MS = 30_000;

export interface EmbeddingServiceOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class EmbeddingServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingServiceError';
  }
}

function readConfiguration(options: EmbeddingServiceOptions): {
  endpoint: string;
  model: string;
  timeoutMs: number;
  fetch: typeof globalThis.fetch;
} {
  const baseUrl = options.baseUrl
    ?? process.env.OLLAMA_BASE_URL
    ?? process.env.OLLAMA_URL
    ?? DEFAULT_OLLAMA_BASE_URL;
  const model = options.model
    ?? process.env.OLLAMA_EMBEDDING_MODEL
    ?? DEFAULT_OLLAMA_EMBEDDING_MODEL;
  const configuredTimeout = process.env.OLLAMA_EMBEDDING_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs
    ?? (configuredTimeout === undefined ? DEFAULT_OLLAMA_EMBEDDING_TIMEOUT_MS : Number(configuredTimeout));

  let endpoint: string;
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
      throw new Error('Invalid Ollama URL.');
    }
    endpoint = new URL('/api/embed', base).toString();
  } catch {
    throw new EmbeddingServiceError('The Ollama base URL is invalid.', 'INVALID_CONFIGURATION');
  }

  if (!model.trim() || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new EmbeddingServiceError('The Ollama embedding configuration is invalid.', 'INVALID_CONFIGURATION');
  }

  return {
    endpoint,
    model,
    timeoutMs,
    fetch: options.fetch ?? globalThis.fetch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateEmbeddings(
  payload: unknown,
  model: string,
  expectedCount: number,
): number[][] {
  if (!isRecord(payload) || payload['model'] !== model) {
    throw new EmbeddingServiceError(
      'Ollama returned an unexpected embedding model.',
      'UNEXPECTED_MODEL',
    );
  }

  const embeddings = payload['embeddings'];
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new EmbeddingServiceError(
      'Ollama returned an invalid number of embeddings.',
      'INVALID_RESPONSE',
    );
  }

  return embeddings.map((vector: unknown) => {
    if (
      !Array.isArray(vector) ||
      vector.length !== OLLAMA_EMBEDDING_DIMENSIONS ||
      !vector.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new EmbeddingServiceError(
        `Each embedding must contain exactly ${OLLAMA_EMBEDDING_DIMENSIONS} finite numbers.`,
        'INVALID_VECTOR',
      );
    }
    return vector;
  });
}

export async function embedTexts(
  texts: readonly string[],
  options: EmbeddingServiceOptions = {},
): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new EmbeddingServiceError('Embedding input must contain non-empty text.', 'INVALID_INPUT');
  }

  const configuration = readConfiguration(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);

  try {
    let response: Response;
    let payload: unknown;
    try {
      response = await configuration.fetch(configuration.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: configuration.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EmbeddingServiceError(
          `Ollama embedding request failed with HTTP ${response.status}.`,
          'OLLAMA_REQUEST_FAILED',
          response.status,
        );
      }
      payload = await response.json() as unknown;
    } catch (error) {
      if (error instanceof EmbeddingServiceError) throw error;
      if (controller.signal.aborted) {
        throw new EmbeddingServiceError('Ollama embedding request timed out.', 'OLLAMA_TIMEOUT');
      }
      if (error instanceof SyntaxError) {
        throw new EmbeddingServiceError('Ollama returned malformed JSON.', 'INVALID_RESPONSE');
      }
      throw new EmbeddingServiceError('Ollama embedding service is unavailable.', 'OLLAMA_UNAVAILABLE');
    }
    return validateEmbeddings(payload, configuration.model, texts.length);
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedText(
  text: string,
  options: EmbeddingServiceOptions = {},
): Promise<number[]> {
  const [embedding] = await embedTexts([text], options);
  if (!embedding) {
    throw new EmbeddingServiceError('Ollama returned no embedding.', 'INVALID_RESPONSE');
  }
  return embedding;
}
