CREATE OR REPLACE FUNCTION list_team_members(
  p_search     TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_limit      INT  DEFAULT 100,
  p_offset     INT  DEFAULT 0
)
RETURNS TABLE (
  id                    TEXT,
  name                  TEXT,
  email                 TEXT,
  role                  TEXT,
  department            TEXT,
  status                TEXT,
  profile_image         TEXT,
  assigned_tasks_count  BIGINT,
  completed_tasks_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.email,
    u.role,
    u.department,
    u.status,
    u.profile_image,
    (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id)                             AS assigned_tasks_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.status = 'COMPLETED')  AS completed_tasks_count
  FROM users u
  WHERE
    (p_search IS NULL
       OR LOWER(u.name)  LIKE '%' || LOWER(p_search) || '%'
       OR LOWER(u.email) LIKE '%' || LOWER(p_search) || '%')
    AND (p_department IS NULL OR LOWER(u.department) = LOWER(p_department))
  ORDER BY u.name
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;
