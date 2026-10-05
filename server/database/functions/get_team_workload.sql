CREATE OR REPLACE FUNCTION get_team_workload()
RETURNS TABLE (
  id               TEXT,
  name             TEXT,
  role             TEXT,
  department       TEXT,
  assigned_tasks   BIGINT,
  completed_tasks  BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.role,
    u.department,
    COUNT(t.id)                                        AS assigned_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') AS completed_tasks
  FROM users u
  LEFT JOIN tasks t ON t.assigned_to = u.id
  GROUP BY u.id
  ORDER BY assigned_tasks DESC;
END;
$$ LANGUAGE plpgsql STABLE;
