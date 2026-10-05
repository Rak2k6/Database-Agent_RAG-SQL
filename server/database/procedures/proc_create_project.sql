CREATE OR REPLACE PROCEDURE proc_create_project(
  p_id          TEXT,
  p_name        TEXT,
  p_creator_id  TEXT,
  p_status      TEXT,
  p_start_date  TIMESTAMPTZ,
  p_due_date    TIMESTAMPTZ,
  p_description TEXT DEFAULT ''
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Insert the project
  INSERT INTO projects (
    id, name, description, status,
    start_date, due_date,
    created_by, created_at, updated_at
  ) VALUES (
    p_id, p_name, p_description, p_status,
    p_start_date, p_due_date,
    p_creator_id, NOW(), NOW()
  );

  -- 2. Add creator as Owner
  INSERT INTO project_members (project_id, user_id, role)
  VALUES (p_id, p_creator_id, 'Owner');

  -- 3. Log activity
  PERFORM fn_log_activity(
    p_creator_id,
    'created a new project',
    'project',
    p_id,
    p_name
  );

  -- 4. Notify creator
  PERFORM fn_create_notification(
    p_creator_id,
    'Project Created',
    'Project "' || p_name || '" has been created successfully.',
    'project'
  );
END;
$$;
