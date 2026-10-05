CREATE OR REPLACE FUNCTION fn_create_notification(
  p_user_id TEXT,
  p_title   TEXT,
  p_message TEXT,
  p_type    TEXT DEFAULT 'info'
) RETURNS TEXT AS $$
DECLARE
  v_id TEXT;
BEGIN
  v_id := 'notif_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 9);
  
  INSERT INTO notifications (
    id, user_id, title, message, type, is_read, created_at
  ) VALUES (
    v_id, p_user_id, p_title, p_message, p_type, false, NOW()
  );
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
