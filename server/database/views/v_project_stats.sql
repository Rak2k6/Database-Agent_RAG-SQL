CREATE OR REPLACE VIEW v_project_stats AS
SELECT
  COUNT(*)                                      AS total,
  COUNT(*) FILTER (WHERE status = 'ACTIVE')     AS active,
  COUNT(*) FILTER (WHERE status = 'COMPLETED')  AS completed,
  COUNT(*) FILTER (WHERE status = 'PLANNED')    AS planned
FROM projects;
