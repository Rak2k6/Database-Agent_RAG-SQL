CREATE OR REPLACE VIEW v_recent_activities AS
SELECT
  a.id,
  a.user_id,
  u.name         AS person_name,
  u.profile_image,
  a.action,
  a.entity_type,
  a.entity_id,
  a.subject,
  a.created_at
FROM activities a
JOIN users u ON a.user_id = u.id
ORDER BY a.created_at DESC;
