CREATE OR REPLACE FUNCTION list_calendar_events(
  p_limit  INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id           TEXT,
  title        TEXT,
  description  TEXT,
  start_time   TIMESTAMPTZ,
  end_time     TIMESTAMPTZ,
  event_type   TEXT,
  project_id   TEXT,
  project_name TEXT,
  creator_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    e.start_time,
    e.end_time,
    e.event_type,
    e.project_id,
    p.name  AS project_name,
    u.name  AS creator_name
  FROM calendar_events e
  LEFT JOIN projects p ON e.project_id = p.id
  LEFT JOIN users    u ON e.created_by = u.id
  ORDER BY e.start_time ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;
