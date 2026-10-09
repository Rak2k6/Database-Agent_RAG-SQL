/**
 * db/documents.ts — Document operations
 * Read  → SQL Server list_documents function
 * Write → proc_create_document, simple DELETE
 */
import sql from 'mssql';
import { getPool } from './pool.js';

export interface CreatedDocumentRow {
  id: string;
  name: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  project_id: string | null;
  folder: string;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentListRow {
  id: string;
  name: string;
  file_name: string;
  file_type: string;
  file_size: number;
  folder: string;
  project_name: string | null;
  uploader_name: string;
  created_at: Date;
}

export interface DocumentProcessingRow {
  id: string;
  name: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string;
  project_id: string | null;
  folder: string;
  created_at: Date;
  updated_at: Date;
}

export interface AccessibleDocumentChunkRow {
  document_id: string;
  document_name: string;
  file_name: string;
  project_id: string | null;
  doc_ver: string;
  chunk_index: number;
  vector_id: string;
  chunk_hash: string;
}

// ── Reads ────────────────────────────────────────────────────────────────────

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export async function listDocuments(
  search?: string,
): Promise<DocumentListRow[]> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_search', sql.NVarChar(sql.MAX), search ?? null)
    .input('p_limit', sql.Int, 100)
    .input('p_offset', sql.Int, 0)
    .query<{ result: string | null }>(`
      SELECT dbo.list_documents(
        @p_search,
        @p_limit,
        @p_offset
      ) AS result
    `);

  const parsed = parseJsonResult<DocumentListRow[]>(r.recordset[0]?.result);

  return (parsed ?? []).map((document) => ({
    ...document,
    file_size: Number(document.file_size ?? 0),
  }));
}

export async function getDocumentForProcessing(
  documentId: string,
): Promise<DocumentProcessingRow | undefined> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('documentId', sql.NVarChar(255), documentId)
    .query<DocumentProcessingRow>(`
      SELECT
        id,
        name,
        file_name,
        file_path,
        file_type,
        file_size,
        uploaded_by,
        project_id,
        folder,
        created_at,
        updated_at
      FROM dbo.documents
      WHERE id = @documentId
    `);

  const document = result.recordset[0];
  return document
    ? { ...document, file_size: document.file_size == null ? null : Number(document.file_size) }
    : undefined;
}

export async function findDocumentWithContentVersion(
  projectId: string,
  uploadedBy: string,
  docVer: string,
): Promise<DocumentProcessingRow | undefined> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('projectId', sql.NVarChar(255), projectId)
    .input('uploadedBy', sql.NVarChar(255), uploadedBy)
    .input('docVer', sql.NVarChar(64), docVer)
    .query<DocumentProcessingRow>(`
      SELECT TOP (1)
        d.id,
        d.name,
        d.file_name,
        d.file_path,
        d.file_type,
        d.file_size,
        d.uploaded_by,
        d.project_id,
        d.folder,
        d.created_at,
        d.updated_at
      FROM dbo.documents AS d
      WHERE d.project_id = @projectId
        AND d.uploaded_by = @uploadedBy
        AND d.file_path IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM dbo.document_chunks AS dc
          WHERE dc.document_id = d.id
            AND dc.doc_ver = @docVer
        )
      ORDER BY d.created_at, d.id
    `);

  const document = result.recordset[0];
  return document
    ? { ...document, file_size: document.file_size == null ? null : Number(document.file_size) }
    : undefined;
}

export async function listAccessibleIndexedChunks(
  userId: string,
  projectId?: string,
): Promise<AccessibleDocumentChunkRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.NVarChar(255), userId)
    .input('projectId', sql.NVarChar(255), projectId ?? null)
    .query<AccessibleDocumentChunkRow>(`
      SELECT
        d.id AS document_id,
        d.name AS document_name,
        d.file_name,
        d.project_id,
        dc.doc_ver,
        dc.chunk_index,
        dc.vector_id,
        dc.chunk_hash
      FROM dbo.documents AS d
      INNER JOIN dbo.document_chunks AS dc
        ON dc.document_id = d.id
       AND dc.status = N'indexed'
      LEFT JOIN dbo.project_members AS pm
        ON pm.project_id = d.project_id
       AND pm.user_id = @userId
      WHERE
        (
          @projectId IS NOT NULL
          AND d.project_id = @projectId
          AND pm.user_id IS NOT NULL
        )
        OR
        (
          @projectId IS NULL
          AND
          (
            (d.project_id IS NOT NULL AND pm.user_id IS NOT NULL)
            OR
            (d.project_id IS NULL AND d.uploaded_by = @userId)
          )
        )
      ORDER BY d.id, dc.doc_ver, dc.chunk_index
    `);

  return result.recordset;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createDocument(
  id: string,
  name: string,
  fileName: string,
  filePath: string,
  fileType: string,
  fileSize: number,
  uploadedBy: string,
  projectId: string | null,
  folder: string,
): Promise<CreatedDocumentRow> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('id', sql.NVarChar(100), id)
    .input('name', sql.NVarChar(255), name)
    .input('file_name', sql.NVarChar(255), fileName)
    .input('file_path', sql.NVarChar(255), filePath)
    .input('file_type', sql.NVarChar(100), fileType)
    .input('file_size', sql.BigInt, fileSize)
    .input('uploaded_by', sql.NVarChar(100), uploadedBy)
    .input('project_id', sql.NVarChar(100), projectId)
    .input('folder', sql.NVarChar(100), folder)
    .execute('dbo.proc_create_document');

  const document = result.recordset?.[0] as CreatedDocumentRow | undefined;
  if (!document) {
    throw new Error('DOCUMENT_RESULT_NOT_RETURNED');
  }
  return { ...document, file_size: Number(document.file_size) };
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteDocument(documentId: string): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('documentId', sql.NVarChar(255), documentId)
    .query(`
      DELETE FROM dbo.documents
      WHERE id = @documentId
    `);
}