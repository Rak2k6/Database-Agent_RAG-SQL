CREATE OR REPLACE VIEW v_project_summary AS
SELECT
  p.id, p.name, p.description, p.status,
  p.start_date, p.due_date,
  u.name AS creator_name,
  COUNT(t.id)                                                    AS total_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')              AS completed_tasks,
  CASE WHEN COUNT(t.id) = 0 THEN 0
    ELSE ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') / COUNT(t.id))
  END AS progress
FROM projects p
JOIN users u ON p.created_by = u.id
LEFT JOIN tasks t ON t.project_id = p.id
GROUP BY p.id, u.name;
