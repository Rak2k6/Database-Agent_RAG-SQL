CREATE OR REPLACE FUNCTION get_project_members(p_project_id TEXT)
RETURNS TABLE (
  user_id       TEXT,
  user_name     TEXT,
  profile_image TEXT,
  member_role   TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id            AS user_id,
    u.name          AS user_name,
    u.profile_image,
    pm.role         AS member_role
  FROM project_members pm
  JOIN users u ON pm.user_id = u.id
  WHERE pm.project_id = p_project_id
  ORDER BY
    CASE pm.role WHEN 'Owner' THEN 1 WHEN 'Manager' THEN 2 ELSE 3 END,
    u.name;
END;
$$ LANGUAGE plpgsql STABLE;
