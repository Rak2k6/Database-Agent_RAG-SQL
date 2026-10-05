CREATE OR REPLACE FUNCTION list_documents(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id            TEXT,
  name          TEXT,
  file_name     TEXT,
  file_type     TEXT,
  file_size     BIGINT,
  folder        TEXT,
  project_name  TEXT,
  uploader_name TEXT,
  created_at    TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.file_name,
    d.file_type,
    d.file_size,
    d.folder,
    p.name  AS project_name,
    u.name  AS uploader_name,
    d.created_at
  FROM documents d
  LEFT JOIN projects p ON d.project_id  = p.id
  LEFT JOIN users    u ON d.uploaded_by = u.id
  WHERE
    p_search IS NULL
    OR LOWER(d.name)      LIKE '%' || LOWER(p_search) || '%'
    OR LOWER(d.file_name) LIKE '%' || LOWER(p_search) || '%'
  ORDER BY d.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;
