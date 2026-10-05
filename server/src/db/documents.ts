/**
 * db/documents.ts — Document operations
 * Read  → list_documents PostgreSQL function
 * Write → simple INSERT + standalone fn_log_activity call, simple DELETE
 */
import { pool } from './pool.js';

export interface DocumentListRow {
  id: string;
  name: string;
  file_name: string;
  file_type: string;
  file_size: string;  // BIGINT → string
  folder: string;
  project_name: string | null;
  uploader_name: string;
  created_at: Date;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listDocuments(search?: string): Promise<DocumentListRow[]> {
  const r = await pool.query<DocumentListRow>(
    'SELECT * FROM list_documents($1)',
    [search ?? null],
  );
  return r.rows;
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
  await pool.query(
    `INSERT INTO documents (id, name, file_name, file_path, file_type, file_size, uploaded_by, project_id, folder, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [id, name, fileName, `/uploads/${fileName}`, fileType, fileSize, uploadedBy, projectId, folder],
  );
  // Log activity standalone
  await pool.query(
    `SELECT fn_log_activity($1, 'uploaded a document to', 'document', $2, $3)`,
    [uploadedBy, id, name],
  );
}

export async function deleteDocument(documentId: string): Promise<void> {
  await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
}
