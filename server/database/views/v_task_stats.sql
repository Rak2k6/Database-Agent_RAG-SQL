CREATE OR REPLACE VIEW v_task_stats AS
SELECT
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE status = 'COMPLETED')   AS completed,
  COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress,
  COUNT(*) FILTER (WHERE status = 'TODO')        AS todo,
  COUNT(*) FILTER (WHERE priority = 'HIGH')      AS high_priority
FROM tasks;
