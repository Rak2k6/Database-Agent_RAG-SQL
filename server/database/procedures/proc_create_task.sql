CREATE OR REPLACE PROCEDURE proc_create_task(
  p_id          TEXT,
  p_title       TEXT,
  p_project_id  TEXT,
  p_creator_id  TEXT,
  p_priority    TEXT,
  p_status      TEXT,
  p_due_date    TIMESTAMPTZ,
  p_description TEXT DEFAULT '',
  p_assigned_to TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_name TEXT;
  v_creator_name TEXT;
  v_completed_at TIMESTAMPTZ;
BEGIN
  -- 1. Resolve project name for activity subject
  SELECT name INTO v_project_name FROM projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: project %', p_project_id;
  END IF;

  -- 2. Compute completed_at
  v_completed_at := CASE WHEN p_status = 'COMPLETED' THEN NOW() ELSE NULL END;

  -- 3. Insert the task
  INSERT INTO tasks (
    id, title, description, project_id, assigned_to,
    created_by, priority, status, due_date,
    created_at, updated_at, completed_at
  ) VALUES (
    p_id, p_title, p_description, p_project_id, p_assigned_to,
    p_creator_id, p_priority, p_status, p_due_date,
    NOW(), NOW(), v_completed_at
  );

  -- 4. Log activity
  PERFORM fn_log_activity(
    p_creator_id,
    'created task',
    'task',
    p_id,
    p_title || ' (' || COALESCE(v_project_name, 'Project') || ')'
  );

  -- 5. Notify assignee if different from creator
  IF p_assigned_to IS NOT NULL AND p_assigned_to <> p_creator_id THEN
    SELECT name INTO v_creator_name FROM users WHERE id = p_creator_id;
    PERFORM fn_create_notification(
      p_assigned_to,
      'New Task Assigned',
      COALESCE(v_creator_name, 'Someone') || ' assigned you "' || p_title || '"',
      'task'
    );
  END IF;
END;
$$;
