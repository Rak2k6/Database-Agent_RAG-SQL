CREATE OR REPLACE FUNCTION get_project_detail(p_project_id TEXT)
RETURNS TABLE (
  id               TEXT,
  name             TEXT,
  description      TEXT,
  status           TEXT,
  start_date       TIMESTAMPTZ,
  due_date         TIMESTAMPTZ,
  creator_name     TEXT,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
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
    u.name                                               AS creator_name,
    p.created_at,
    p.updated_at,
    COUNT(t.id)                                          AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')   AS completed_tasks,
    CASE
      WHEN COUNT(t.id) = 0 THEN 0
      ELSE ROUND(
             100.0
             * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')
             / COUNT(t.id)
           )::INT
    END                                                  AS progress
  FROM projects p
  JOIN users u ON p.created_by = u.id
  LEFT JOIN tasks t ON t.project_id = p.id
  WHERE p.id = p_project_id
  GROUP BY p.id, u.name;
END;
$$ LANGUAGE plpgsql STABLE;
