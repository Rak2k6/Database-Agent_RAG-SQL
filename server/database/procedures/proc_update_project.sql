CREATE OR REPLACE PROCEDURE proc_update_project(
  p_project_id  TEXT,
  p_user_id     TEXT,
  p_name        TEXT        DEFAULT NULL,
  p_description TEXT        DEFAULT NULL,
  p_status      TEXT        DEFAULT NULL,
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_due_date    TIMESTAMPTZ DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_name TEXT;
  v_effective_name TEXT;
BEGIN
  -- 1. Fetch the existing project (error if not found)
  SELECT name
  INTO   v_existing_name
  FROM   projects
  WHERE  id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: project %', p_project_id;
  END IF;

  -- 2. Update with COALESCE — NULL means "leave unchanged"
  UPDATE projects
  SET
    name        = COALESCE(p_name,        name),
    description = COALESCE(p_description, description),
    status      = COALESCE(p_status,      status),
    start_date  = COALESCE(p_start_date,  start_date),
    due_date    = COALESCE(p_due_date,    due_date),
    updated_at  = NOW()
  WHERE id = p_project_id;

  -- 3. Resolve effective name for activity log
  v_effective_name := COALESCE(p_name, v_existing_name);

  -- 4. Log activity
  PERFORM fn_log_activity(
    p_user_id,
    'updated project',
    'project',
    p_project_id,
    v_effective_name
  );
END;
$$;
