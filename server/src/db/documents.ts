/**
 * db/documents.ts — Document operations
 * Read  → SQL Server list_documents function
 * Write → simple INSERT + proc_log_activity, simple DELETE
 */
import sql from 'mssql';
import { getPool } from './pool.js';

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

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createDocument(
  id: string,
  name: string,
  fileName: string,
  fileType: string,
  fileSize: number,
  uploadedBy: string,
  projectId: string | null,
  folder: string,
): Promise<void> {
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar(255), id)
    .input('name', sql.NVarChar(255), name)
    .input('file_name', sql.NVarChar(255), fileName)
    .input('file_path', sql.NVarChar(500), `/uploads/${fileName}`)
    .input('file_type', sql.NVarChar(100), fileType)
    .input('file_size', sql.BigInt, fileSize)
    .input('uploaded_by', sql.NVarChar(255), uploadedBy)
    .input('project_id', sql.NVarChar(255), projectId)
    .input('folder', sql.NVarChar(255), folder)
    .query(`
      INSERT INTO dbo.documents
        (
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
        )
      VALUES
        (
          @id,
          @name,
          @file_name,
          @file_path,
          @file_type,
          @file_size,
          @uploaded_by,
          @project_id,
          @folder,
          SYSUTCDATETIME(),
          SYSUTCDATETIME()
        )
    `);

  // Log activity using the SQL Server stored procedure.
  await pool
    .request()
    .input('p_user_id', sql.NVarChar(255), uploadedBy)
    .input('p_action', sql.NVarChar(255), 'uploaded a document to')
    .input('p_entity_type', sql.NVarChar(100), 'document')
    .input('p_entity_id', sql.NVarChar(255), id)
    .input('p_subject', sql.NVarChar(255), name)
    .execute('dbo.proc_log_activity');
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