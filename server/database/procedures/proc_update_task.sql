CREATE OR REPLACE PROCEDURE proc_update_task(
  p_task_id     TEXT,
  p_user_id     TEXT,
  p_title       TEXT        DEFAULT NULL,
  p_description TEXT        DEFAULT NULL,
  p_project_id  TEXT        DEFAULT NULL,
  p_assigned_to TEXT        DEFAULT NULL,
  p_priority    TEXT        DEFAULT NULL,
  p_status      TEXT        DEFAULT NULL,
  p_due_date    TIMESTAMPTZ DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing       tasks%ROWTYPE;
  v_effective_status TEXT;
  v_completed_at   TIMESTAMPTZ;
  v_action_text    TEXT;
  v_effective_title TEXT;
BEGIN
  -- 1. Fetch existing task
  SELECT * INTO v_existing FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: task %', p_task_id;
  END IF;

  -- 2. Determine effective new status
  v_effective_status := COALESCE(p_status, v_existing.status);

  -- 3. Compute completed_at:
  --    transitioning TO completed  → use existing completed_at if set, else NOW()
  --    transitioning AWAY from completed → clear it
  IF v_effective_status = 'COMPLETED' THEN
    v_completed_at := COALESCE(v_existing.completed_at, NOW());
  ELSE
    v_completed_at := NULL;
  END IF;

  -- 4. Update task with COALESCE — NULL params leave existing values unchanged
  UPDATE tasks
  SET
    title       = COALESCE(p_title,       title),
    description = COALESCE(p_description, description),
    project_id  = COALESCE(p_project_id,  project_id),
    assigned_to = COALESCE(p_assigned_to, assigned_to),
    priority    = COALESCE(p_priority,    priority),
    status      = v_effective_status,
    due_date    = COALESCE(p_due_date,    due_date),
    completed_at = v_completed_at,
    updated_at  = NOW()
  WHERE id = p_task_id;

  -- 5. Determine activity message
  IF v_effective_status = 'COMPLETED' AND v_existing.status <> 'COMPLETED' THEN
    v_action_text := 'completed a task in';
  ELSE
    v_action_text := 'updated task';
  END IF;

  -- 6. Log activity
  v_effective_title := COALESCE(p_title, v_existing.title);
  PERFORM fn_log_activity(
    p_user_id,
    v_action_text,
    'task',
    p_task_id,
    v_effective_title
  );
END;
$$;
