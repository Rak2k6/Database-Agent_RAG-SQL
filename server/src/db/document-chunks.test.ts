import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  DocumentChunkMappingStore,
  type DocumentChunkMappingInput,
} from './document-chunks.js';

const docVer = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const documentId = "doc'); DROP TABLE dbo.documents;--";
const mappings: DocumentChunkMappingInput[] = [
  {
    chunkIndex: 0,
    vectorId: randomUUID(),
    chunkHash: hash,
    status: 'pending',
  },
  {
    chunkIndex: 1,
    vectorId: randomUUID(),
    chunkHash: 'c'.repeat(64),
    status: 'processing',
    errorMessage: null,
  },
];

function mockStore(result: unknown = 2): {
  store: DocumentChunkMappingStore;
  calls: Array<{ statement: string; command: unknown }>;
} {
  const calls: Array<{ statement: string; command: unknown }> = [];
  const store = new DocumentChunkMappingStore(async (statement, command) => {
    calls.push({ statement, command });
    return result;
  });
  return { store, calls };
}

test('persists chunk mappings with a parameterized idempotent SQL Server MERGE', async () => {
  const { store, calls } = mockStore();
  await store.upsert(documentId, docVer, mappings);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.statement, /MERGE dbo\.document_chunks WITH \(HOLDLOCK\)/);
  assert.match(calls[0]!.statement, /OPENJSON\(@mappingsJson\)/);
  assert.match(calls[0]!.statement, /target\.chunk_index = source\.chunk_index/);
  assert.doesNotMatch(calls[0]!.statement, /DROP TABLE/);
  const command = calls[0]!.command as { operation: string; documentId: string; docVer: string; mappingsJson: string };
  assert.equal(command.operation, 'upsert');
  assert.equal(command.documentId, documentId);
  assert.equal(command.docVer, docVer);
  assert.deepEqual(JSON.parse(command.mappingsJson), [
    {
      chunkIndex: 0,
      vectorId: mappings[0]!.vectorId,
      chunkHash: hash,
      status: 'pending',
      errorMessage: null,
    },
    {
      chunkIndex: 1,
      vectorId: mappings[1]!.vectorId,
      chunkHash: 'c'.repeat(64),
      status: 'processing',
      errorMessage: null,
    },
  ]);
});

test('rejects malformed IDs, hashes, statuses, bounds, and duplicate mapping keys before SQL', async () => {
  const { store, calls } = mockStore();

  await assert.rejects(store.upsert('', docVer, mappings), /INVALID_DOCUMENT_CHUNK_DOCUMENT_ID/);
  await assert.rejects(store.upsert('document-1', 'short-version', mappings), /INVALID_DOCUMENT_CHUNK_VERSION/);
  await assert.rejects(store.upsert('document-1', docVer, []), /DOCUMENT_CHUNK_MAPPINGS_REQUIRED/);
  await assert.rejects(
    store.upsert('document-1', docVer, [{ ...mappings[0]!, vectorId: 'not-a-uuid' }]),
    /INVALID_DOCUMENT_CHUNK_VECTOR_ID/,
  );
  await assert.rejects(
    store.upsert('document-1', docVer, [{ ...mappings[0]!, chunkHash: 'short' }]),
    /INVALID_DOCUMENT_CHUNK_HASH/,
  );
  await assert.rejects(
    store.upsert('document-1', docVer, [{ ...mappings[0]!, chunkIndex: -1 }]),
    /INVALID_DOCUMENT_CHUNK_INDEX/,
  );
  await assert.rejects(
    store.upsert('document-1', docVer, [mappings[0]!, { ...mappings[1]!, chunkIndex: 0 }]),
    /DUPLICATE_DOCUMENT_CHUNK_MAPPING/,
  );
  assert.equal(calls.length, 0);
});

test('lists and validates stored mappings scoped by document and optional version', async () => {
  const createdAt = new Date('2026-01-02T03:04:05.000Z');
  const updatedAt = new Date('2026-01-03T03:04:05.000Z');
  const storedRow = {
    id: randomUUID(),
    document_id: 'document-1',
    doc_ver: docVer,
    chunk_index: 0,
    vector_id: mappings[0]!.vectorId,
    chunk_hash: hash,
    status: 'indexed',
    error_message: null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const { store, calls } = mockStore([storedRow]);
  const rows = await store.list('document-1', docVer);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], storedRow);
  assert.deepEqual(calls[0]!.command, {
    operation: 'list',
    documentId: 'document-1',
    docVer,
  });
  assert.match(calls[0]!.statement, /@docVer IS NULL OR doc_ver = @docVer/);
});

test('updates status using parameters and reports missing mappings', async () => {
  const { store, calls } = mockStore(3);
  const affected = await store.updateStatus('document-1', docVer, 'failed', 'Embedding failed', 1);

  assert.equal(affected, 3);
  assert.deepEqual(calls[0]!.command, {
    operation: 'update-status',
    documentId: 'document-1',
    docVer,
    chunkIndex: 1,
    status: 'failed',
    errorMessage: 'Embedding failed',
  });
  assert.match(calls[0]!.statement, /error_message = @errorMessage/);

  const missing = mockStore(0);
  await assert.rejects(
    missing.store.updateStatus('document-1', docVer, 'indexed'),
    /DOCUMENT_CHUNK_MAPPING_NOT_FOUND/,
  );
});

test('deletes mappings for exactly one document version and accepts idempotent retries', async () => {
  const { store, calls } = mockStore(2);
  assert.equal(await store.deleteVersion('document-1', docVer), 2);
  assert.deepEqual(calls[0]!.command, {
    operation: 'delete-version',
    documentId: 'document-1',
    docVer,
  });
  assert.match(calls[0]!.statement, /WHERE document_id = @documentId\s+AND doc_ver = @docVer/);

  const retry = mockStore(0);
  assert.equal(await retry.store.deleteVersion('document-1', docVer), 0);
});
