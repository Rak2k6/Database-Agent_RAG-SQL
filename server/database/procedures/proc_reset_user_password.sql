CREATE OR REPLACE PROCEDURE proc_reset_user_password(
  p_token_hash        TEXT,
  p_new_password_hash TEXT,
  p_now_ms            BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id TEXT;
BEGIN
  -- 1. Consume the token (must be unused and not expired)
  UPDATE password_reset_tokens
  SET    used_at = p_now_ms
  WHERE  token_hash = p_token_hash
    AND  used_at IS NULL
    AND  expires_at > p_now_ms;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESET_TOKEN_INVALID';
  END IF;

  -- 2. Retrieve the user_id from the consumed token
  SELECT user_id
  INTO   v_user_id
  FROM   password_reset_tokens
  WHERE  token_hash = p_token_hash;

  -- 3. Update the user's password
  UPDATE users
  SET    password_hash  = p_new_password_hash,
         auth_provider  = 'local',
         updated_at     = NOW()
  WHERE  id = v_user_id;

  -- 4. Delete all other reset tokens for this user
  DELETE FROM password_reset_tokens
  WHERE  user_id = v_user_id
    AND  token_hash <> p_token_hash;

  -- 5. Invalidate all active sessions for this user
  DELETE FROM sessions
  WHERE  user_id = v_user_id;
END;
$$;
