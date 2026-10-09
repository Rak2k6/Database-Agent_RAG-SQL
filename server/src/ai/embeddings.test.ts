import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  embedText,
  embedTexts,
  EmbeddingServiceError,
  OLLAMA_EMBEDDING_DIMENSIONS,
} from './embeddings.js';

const model = 'nomic-embed-text:latest';
const vector = (value = 0.25) => Array.from({ length: OLLAMA_EMBEDDING_DIMENSIONS }, () => value);

function mockFetch(payload: unknown, status = 200): {
  fetch: typeof globalThis.fetch;
  requests: Array<{ url: string; init: RequestInit }>;
} {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, requests };
}

function options(fetch: typeof globalThis.fetch) {
  return { baseUrl: 'http://ollama.test:11434/', model, timeoutMs: 1000, fetch };
}

test('embeds one string using POST /api/embed and returns a validated 768-dimensional vector', async () => {
  const mocked = mockFetch({ model, embeddings: [vector()] });
  const result = await embedText('A sample query', options(mocked.fetch));

  assert.equal(result.length, OLLAMA_EMBEDDING_DIMENSIONS);
  assert.equal(result[0], 0.25);
  assert.equal(mocked.requests.length, 1);
  assert.equal(mocked.requests[0]!.url, 'http://ollama.test:11434/api/embed');
  assert.equal(mocked.requests[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(mocked.requests[0]!.init.body)), {
    model,
    input: ['A sample query'],
  });
});

test('embeds batches in one request while preserving order', async () => {
  const mocked = mockFetch({ model, embeddings: [vector(0.1), vector(0.2)] });
  const result = await embedTexts(['first chunk', 'second chunk'], options(mocked.fetch));

  assert.equal(result.length, 2);
  assert.equal(result[0]![0], 0.1);
  assert.equal(result[1]![0], 0.2);
  assert.deepEqual(JSON.parse(String(mocked.requests[0]!.init.body)), {
    model,
    input: ['first chunk', 'second chunk'],
  });
});

test('rejects empty input without making a request', async () => {
  const mocked = mockFetch({ model, embeddings: [] });

  await assert.rejects(embedTexts([], options(mocked.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_INPUT',
  });
  await assert.rejects(embedText(' \n ', options(mocked.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_INPUT',
  });
  assert.equal(mocked.requests.length, 0);
});

test('rejects wrong dimensions, non-finite values, and wrong embedding counts', async () => {
  const shortVector = mockFetch({ model, embeddings: [vector().slice(1)] });
  const nonFiniteVector = mockFetch({ model, embeddings: [vector(Number.NaN)] });
  const wrongCount = mockFetch({ model, embeddings: [] });

  await assert.rejects(embedText('input', options(shortVector.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_VECTOR',
  });
  await assert.rejects(embedText('input', options(nonFiniteVector.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_VECTOR',
  });
  await assert.rejects(embedTexts(['first', 'second'], options(wrongCount.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_RESPONSE',
  });
});

test('rejects an unexpected or missing returned model instead of silently accepting it', async () => {
  const wrongModel = mockFetch({ model: 'another-model:latest', embeddings: [vector()] });
  const missingModel = mockFetch({ embeddings: [vector()] });

  await assert.rejects(embedText('input', options(wrongModel.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'UNEXPECTED_MODEL',
  });
  await assert.rejects(embedText('input', options(missingModel.fetch)), {
    name: 'EmbeddingServiceError',
    code: 'UNEXPECTED_MODEL',
  });
});

test('rejects malformed JSON responses', async () => {
  const fetch: typeof globalThis.fetch = async () => new Response('not-json');

  await assert.rejects(embedText('input', options(fetch)), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_RESPONSE',
  });
});

test('reports HTTP errors without exposing response bodies', async () => {
  const mocked = mockFetch({ error: 'private or content-bearing response' }, 503);

  await assert.rejects(embedText('input', options(mocked.fetch)), (error: unknown) => {
    assert(error instanceof EmbeddingServiceError);
    assert.equal(error.code, 'OLLAMA_REQUEST_FAILED');
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private|content-bearing/);
    return true;
  });
});

test('reports unavailable Ollama without echoing transport error details', async () => {
  const fetch: typeof globalThis.fetch = async () => {
    throw new TypeError('sensitive transport detail');
  };

  await assert.rejects(embedText('input', options(fetch)), (error: unknown) => {
    assert(error instanceof EmbeddingServiceError);
    assert.equal(error.code, 'OLLAMA_UNAVAILABLE');
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
});

test('aborts requests at the configured timeout', async () => {
  const fetch: typeof globalThis.fetch = async (_input, init = {}) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });

  await assert.rejects(embedText('input', { ...options(fetch), timeoutMs: 5 }), {
    name: 'EmbeddingServiceError',
    code: 'OLLAMA_TIMEOUT',
  });
});

test('rejects invalid endpoint and timeout configuration', async () => {
  const mocked = mockFetch({ model, embeddings: [vector()] });

  await assert.rejects(embedText('input', { ...options(mocked.fetch), baseUrl: 'file:///private' }), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_CONFIGURATION',
  });
  await assert.rejects(embedText('input', { ...options(mocked.fetch), timeoutMs: 0 }), {
    name: 'EmbeddingServiceError',
    code: 'INVALID_CONFIGURATION',
  });
});
