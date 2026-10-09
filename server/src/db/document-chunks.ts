import sql from 'mssql';
import { validate as isUuid } from 'uuid';
import { getPool } from './pool.js';

export type DocumentChunkStatus = 'pending' | 'processing' | 'indexed' | 'failed';

export interface DocumentChunkMappingInput {
  chunkIndex: number;
  vectorId: string;
  chunkHash: string;
  status: DocumentChunkStatus;
  errorMessage?: string | null;
}

export interface DocumentChunkMappingRow {
  id: string;
  document_id: string;
  doc_ver: string;
  chunk_index: number;
  vector_id: string;
  chunk_hash: string;
  status: DocumentChunkStatus;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

type DocumentChunkSqlCommand =
  | { operation: 'upsert'; documentId: string; docVer: string; mappingsJson: string }
  | { operation: 'list'; documentId: string; docVer: string | null }
  | {
    operation: 'update-status';
    documentId: string;
    docVer: string;
    chunkIndex: number | null;
    status: DocumentChunkStatus;
    errorMessage: string | null;
  }
  | { operation: 'delete-version'; documentId: string; docVer: string };

type DocumentChunkSqlExecutor = (
  statement: string,
  command: DocumentChunkSqlCommand,
) => Promise<unknown>;

const UPSERT_MAPPINGS_SQL = `
  MERGE dbo.document_chunks WITH (HOLDLOCK) AS target
  USING (
    SELECT
      @documentId AS document_id,
      @docVer AS doc_ver,
      input.chunk_index,
      input.vector_id,
      input.chunk_hash,
      input.status,
      input.error_message
    FROM OPENJSON(@mappingsJson)
    WITH (
      chunk_index INT '$.chunkIndex',
      vector_id UNIQUEIDENTIFIER '$.vectorId',
      chunk_hash CHAR(64) '$.chunkHash',
      status NVARCHAR(20) '$.status',
      error_message NVARCHAR(2000) '$.errorMessage'
    ) AS input
  ) AS source
    ON target.document_id = source.document_id
    AND target.doc_ver = source.doc_ver
    AND target.chunk_index = source.chunk_index
  WHEN MATCHED THEN
    UPDATE SET
      vector_id = source.vector_id,
      chunk_hash = source.chunk_hash,
      status = source.status,
      error_message = source.error_message,
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (
      id,
      document_id,
      doc_ver,
      chunk_index,
      vector_id,
      chunk_hash,
      status,
      error_message,
      created_at,
      updated_at
    )
    VALUES (
      NEWID(),
      source.document_id,
      source.doc_ver,
      source.chunk_index,
      source.vector_id,
      source.chunk_hash,
      source.status,
      source.error_message,
      SYSUTCDATETIME(),
      SYSUTCDATETIME()
    );
`;

const LIST_MAPPINGS_SQL = `
  SELECT
    id,
    document_id,
    doc_ver,
    chunk_index,
    vector_id,
    chunk_hash,
    status,
    error_message,
    created_at,
    updated_at
  FROM dbo.document_chunks
  WHERE document_id = @documentId
    AND (@docVer IS NULL OR doc_ver = @docVer)
  ORDER BY doc_ver, chunk_index
`;

const UPDATE_STATUS_SQL = `
  UPDATE dbo.document_chunks
  SET
    status = @status,
    error_message = @errorMessage,
    updated_at = SYSUTCDATETIME()
  WHERE document_id = @documentId
    AND doc_ver = @docVer
    AND (@chunkIndex IS NULL OR chunk_index = @chunkIndex)
`;

const DELETE_VERSION_SQL = `
  DELETE FROM dbo.document_chunks
  WHERE document_id = @documentId
    AND doc_ver = @docVer
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateDocumentKey(documentId: string, docVer: string): void {
  if (typeof documentId !== 'string' || !documentId.trim() || documentId.length > 255) {
    throw new Error('INVALID_DOCUMENT_CHUNK_DOCUMENT_ID');
  }
  if (typeof docVer !== 'string' || !/^[a-f\d]{64}$/i.test(docVer)) {
    throw new Error('INVALID_DOCUMENT_CHUNK_VERSION');
  }
}

function validateMappings(mappings: readonly DocumentChunkMappingInput[]): void {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error('DOCUMENT_CHUNK_MAPPINGS_REQUIRED');
  }

  const indexes = new Set<number>();
  const vectorIds = new Set<string>();
  for (const mapping of mappings) {
    if (!Number.isInteger(mapping.chunkIndex) || mapping.chunkIndex < 0) {
      throw new Error('INVALID_DOCUMENT_CHUNK_INDEX');
    }
    if (!isUuid(mapping.vectorId)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_VECTOR_ID');
    }
    if (!/^[a-f\d]{64}$/i.test(mapping.chunkHash)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_HASH');
    }
    if (!['pending', 'processing', 'indexed', 'failed'].includes(mapping.status)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_STATUS');
    }
    if (mapping.errorMessage != null && mapping.errorMessage.length > 2000) {
      throw new Error('DOCUMENT_CHUNK_ERROR_TOO_LONG');
    }
    if (indexes.has(mapping.chunkIndex) || vectorIds.has(mapping.vectorId.toLowerCase())) {
      throw new Error('DUPLICATE_DOCUMENT_CHUNK_MAPPING');
    }
    indexes.add(mapping.chunkIndex);
    vectorIds.add(mapping.vectorId.toLowerCase());
  }
}

function parseDate(value: unknown): Date {
  const date = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_DOCUMENT_CHUNK_MAPPING_DATE');
  return date;
}

function parseMappingRow(row: unknown): DocumentChunkMappingRow {
  if (
    !isRecord(row) ||
    typeof row['id'] !== 'string' ||
    !isUuid(row['id']) ||
    typeof row['document_id'] !== 'string' ||
    typeof row['doc_ver'] !== 'string' ||
    typeof row['chunk_index'] !== 'number' ||
    !Number.isInteger(row['chunk_index']) ||
    typeof row['vector_id'] !== 'string' ||
    !isUuid(row['vector_id']) ||
    typeof row['chunk_hash'] !== 'string' ||
    !/^[a-f\d]{64}$/i.test(row['chunk_hash']) ||
    !['pending', 'processing', 'indexed', 'failed'].includes(String(row['status'])) ||
    (row['error_message'] !== null && typeof row['error_message'] !== 'string')
  ) {
    throw new Error('INVALID_DOCUMENT_CHUNK_MAPPING_ROW');
  }
  return {
    id: row['id'],
    document_id: row['document_id'],
    doc_ver: row['doc_ver'],
    chunk_index: row['chunk_index'],
    vector_id: row['vector_id'],
    chunk_hash: row['chunk_hash'],
    status: row['status'] as DocumentChunkStatus,
    error_message: row['error_message'],
    created_at: parseDate(row['created_at']),
    updated_at: parseDate(row['updated_at']),
  };
}

async function executeSqlServer(
  statement: string,
  command: DocumentChunkSqlCommand,
): Promise<unknown> {
  const pool = await getPool();
  const request = pool.request();

  switch (command.operation) {
    case 'upsert':
      request
        .input('documentId', sql.NVarChar(255), command.documentId)
        .input('docVer', sql.NVarChar(64), command.docVer)
        .input('mappingsJson', sql.NVarChar(sql.MAX), command.mappingsJson);
      break;
    case 'list':
      request
        .input('documentId', sql.NVarChar(255), command.documentId)
        .input('docVer', sql.NVarChar(64), command.docVer);
      break;
    case 'update-status':
      request
        .input('documentId', sql.NVarChar(255), command.documentId)
        .input('docVer', sql.NVarChar(64), command.docVer)
        .input('chunkIndex', sql.Int, command.chunkIndex)
        .input('status', sql.NVarChar(20), command.status)
        .input('errorMessage', sql.NVarChar(2000), command.errorMessage);
      break;
    case 'delete-version':
      request
        .input('documentId', sql.NVarChar(255), command.documentId)
        .input('docVer', sql.NVarChar(64), command.docVer);
      break;
  }

  const result = await request.query(statement);
  return command.operation === 'list'
    ? result.recordset
    : result.rowsAffected.reduce((total, affected) => total + affected, 0);
}

export class DocumentChunkMappingStore {
  constructor(private readonly execute: DocumentChunkSqlExecutor = executeSqlServer) {}

  async upsert(
    documentId: string,
    docVer: string,
    mappings: readonly DocumentChunkMappingInput[],
  ): Promise<void> {
    validateDocumentKey(documentId, docVer);
    validateMappings(mappings);
    const mappingsJson = JSON.stringify(mappings.map((mapping) => ({
      chunkIndex: mapping.chunkIndex,
      vectorId: mapping.vectorId,
      chunkHash: mapping.chunkHash,
      status: mapping.status,
      errorMessage: mapping.errorMessage ?? null,
    })));
    await this.execute(UPSERT_MAPPINGS_SQL, {
      operation: 'upsert',
      documentId,
      docVer,
      mappingsJson,
    });
  }

  async list(documentId: string, docVer?: string): Promise<DocumentChunkMappingRow[]> {
    if (typeof documentId !== 'string' || !documentId.trim() || documentId.length > 255) {
      throw new Error('INVALID_DOCUMENT_CHUNK_DOCUMENT_ID');
    }
    if (docVer !== undefined && !/^[a-f\d]{64}$/i.test(docVer)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_VERSION');
    }
    const rows = await this.execute(LIST_MAPPINGS_SQL, {
      operation: 'list',
      documentId,
      docVer: docVer ?? null,
    });
    if (!Array.isArray(rows)) throw new Error('INVALID_DOCUMENT_CHUNK_MAPPING_RESULT');
    return rows.map(parseMappingRow);
  }

  async updateStatus(
    documentId: string,
    docVer: string,
    status: DocumentChunkStatus,
    errorMessage: string | null = null,
    chunkIndex?: number,
  ): Promise<number> {
    validateDocumentKey(documentId, docVer);
    if (!['pending', 'processing', 'indexed', 'failed'].includes(status)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_STATUS');
    }
    if (errorMessage !== null && errorMessage.length > 2000) {
      throw new Error('DOCUMENT_CHUNK_ERROR_TOO_LONG');
    }
    if (chunkIndex !== undefined && (!Number.isInteger(chunkIndex) || chunkIndex < 0)) {
      throw new Error('INVALID_DOCUMENT_CHUNK_INDEX');
    }
    const affected = await this.execute(UPDATE_STATUS_SQL, {
      operation: 'update-status',
      documentId,
      docVer,
      chunkIndex: chunkIndex ?? null,
      status,
      errorMessage,
    });
    if (typeof affected !== 'number' || !Number.isInteger(affected) || affected < 0) {
      throw new Error('INVALID_DOCUMENT_CHUNK_UPDATE_RESULT');
    }
    if (affected === 0) throw new Error('DOCUMENT_CHUNK_MAPPING_NOT_FOUND');
    return affected;
  }

  async deleteVersion(documentId: string, docVer: string): Promise<number> {
    validateDocumentKey(documentId, docVer);
    const affected = await this.execute(DELETE_VERSION_SQL, {
      operation: 'delete-version',
      documentId,
      docVer,
    });
    if (typeof affected !== 'number' || !Number.isInteger(affected) || affected < 0) {
      throw new Error('INVALID_DOCUMENT_CHUNK_DELETE_RESULT');
    }
    return affected;
  }
}

export const documentChunkMappings = new DocumentChunkMappingStore();
