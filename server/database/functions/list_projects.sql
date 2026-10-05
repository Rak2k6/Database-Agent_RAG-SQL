CREATE OR REPLACE FUNCTION list_projects(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id               TEXT,
  name             TEXT,
  description      TEXT,
  status           TEXT,
  start_date       TIMESTAMPTZ,
  due_date         TIMESTAMPTZ,
  creator_name     TEXT,
  total_tasks      BIGINT,
  completed_tasks  BIGINT,
  progress         INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name                                                AS creator_name,
    COUNT(t.id)                                           AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')    AS completed_tasks,
    CASE
      WHEN COUNT(t.id) = 0 THEN 0
      ELSE ROUND(
             100.0
             * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')
             / COUNT(t.id)
           )::INT
    END                                                   AS progress
  FROM projects p
  JOIN users u ON p.created_by = u.id
  LEFT JOIN tasks t ON t.project_id = p.id
  WHERE
    (p_search IS NULL OR LOWER(p.name) LIKE '%' || LOWER(p_search) || '%'
                      OR LOWER(p.description) LIKE '%' || LOWER(p_search) || '%')
    AND (p_status IS NULL OR p.status = p_status)
  GROUP BY p.id, u.name
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;
