CREATE OR REPLACE FUNCTION fn_log_activity(
  p_user_id     TEXT,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   TEXT,
  p_subject     TEXT
) RETURNS TEXT AS $$
DECLARE
  v_id TEXT;
BEGIN
  v_id := 'act_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 9);
  
  INSERT INTO activities (
    id, user_id, action, entity_type, entity_id, subject, created_at
  ) VALUES (
    v_id, p_user_id, p_action, p_entity_type, p_entity_id, p_subject, NOW()
  );
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
