CREATE OR REPLACE FUNCTION list_tasks(
  p_assigned_to TEXT        DEFAULT NULL,
  p_project_id  TEXT        DEFAULT NULL,
  p_status      TEXT        DEFAULT NULL,
  p_priority    TEXT        DEFAULT NULL,
  p_search      TEXT        DEFAULT NULL,
  p_limit       INT         DEFAULT 100,
  p_offset      INT         DEFAULT 0
)
RETURNS TABLE (
  id               TEXT,
  title            TEXT,
  description      TEXT,
  project_id       TEXT,
  project_name     TEXT,
  assigned_to_id   TEXT,
  assigned_to_name TEXT,
  creator_name     TEXT,
  priority         TEXT,
  status           TEXT,
  due_date         TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  is_overdue       BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.title,
    t.description,
    t.project_id,
    p.name                                                          AS project_name,
    t.assigned_to                                                   AS assigned_to_id,
    assignee.name                                                   AS assigned_to_name,
    creator.name                                                    AS creator_name,
    t.priority,
    t.status,
    t.due_date,
    t.completed_at,
    (t.status <> 'COMPLETED' AND t.due_date IS NOT NULL AND t.due_date < NOW()) AS is_overdue
  FROM tasks t
  JOIN projects p        ON t.project_id  = p.id
  LEFT JOIN users assignee ON t.assigned_to = assignee.id
  LEFT JOIN users creator  ON t.created_by  = creator.id
  WHERE
    (p_assigned_to IS NULL OR t.assigned_to = p_assigned_to)
    AND (p_project_id  IS NULL OR t.project_id  = p_project_id)
    AND (p_status      IS NULL OR t.status      = p_status)
    AND (p_priority    IS NULL OR t.priority    = p_priority)
    AND (p_search      IS NULL OR LOWER(t.title) LIKE '%' || LOWER(p_search) || '%')
  ORDER BY
    CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
    t.due_date ASC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;
