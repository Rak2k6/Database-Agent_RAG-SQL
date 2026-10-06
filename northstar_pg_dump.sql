--
-- PostgreSQL database dump
--

\restrict KjgtHo7WmzvnHRnddpEblad2xxevezGzblXYdbMpAN5tQ5bX7GQFlPPZfkUfDr8

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: fn_create_notification(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_notification(p_user_id text, p_title text, p_message text, p_type text DEFAULT 'info'::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: fn_log_activity(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_log_activity(p_user_id text, p_action text, p_entity_type text, p_entity_id text, p_subject text) RETURNS text
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_dashboard_data(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dashboard_data(p_user_id text) RETURNS json
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_metrics         JSON;
  v_top_tasks       JSON;
  v_active_projects JSON;
  v_schedule        JSON;
  v_activity        JSON;
  v_notifications   JSON;
BEGIN
  -- ── 1. Aggregate metrics ──────────────────────────────────────────────────
  SELECT json_build_object(
    'totalTasks',      COUNT(*),
    'completedTasks',  COUNT(*) FILTER (WHERE status = 'COMPLETED'),
    'inProgressTasks', COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'),
    'totalProjects',   (SELECT COUNT(*) FROM projects),
    'activeProjects',  (SELECT COUNT(*) FROM projects WHERE status = 'ACTIVE'),
    'teamMembers',     (SELECT COUNT(*) FROM users),
    'upcomingEvents',  (
      SELECT COUNT(*)
      FROM   calendar_events
      WHERE  start_time >= NOW() AND start_time <= NOW() + INTERVAL '7 days'
    )
  )
  INTO v_metrics
  FROM tasks;

  -- ── 2. Top tasks (high-priority, not completed, due soonest) ─────────────
  SELECT json_agg(row_to_json(tq))
  INTO   v_top_tasks
  FROM (
    SELECT
      t.id,
      t.title,
      t.status,
      t.priority,
      t.due_date,
      p.name  AS project_name,
      u.name  AS assigned_to_name,
      u.profile_image AS assigned_to_image,
      (t.status <> 'COMPLETED' AND t.due_date IS NOT NULL AND t.due_date < NOW()) AS is_overdue
    FROM tasks t
    JOIN projects p       ON t.project_id  = p.id
    LEFT JOIN users u     ON t.assigned_to  = u.id
    WHERE t.status <> 'COMPLETED'
    ORDER BY
      CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      t.due_date ASC NULLS LAST
    LIMIT 5
  ) tq;

  -- ── 3. Active projects with member avatars ────────────────────────────────
  SELECT json_agg(row_to_json(pq))
  INTO   v_active_projects
  FROM (
    SELECT
      p.id,
      p.name,
      p.status,
      p.due_date,
      CASE WHEN COUNT(t.id) = 0 THEN 0
        ELSE ROUND(
               100.0
               * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')
               / COUNT(t.id)
             )::INT
      END AS progress,
      COUNT(t.id)                                         AS total_tasks,
      COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')  AS completed_tasks,
      -- member avatar array (up to 4)
      (
        SELECT json_agg(mem_q)
        FROM (
          SELECT u2.id, u2.name, u2.profile_image
          FROM project_members pm2
          JOIN users u2 ON pm2.user_id = u2.id
          WHERE pm2.project_id = p.id
          LIMIT 4
        ) mem_q
      ) AS members
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.status = 'ACTIVE'
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 6
  ) pq;

  -- ── 4. Upcoming schedule (next 7 days) ───────────────────────────────────
  SELECT json_agg(row_to_json(eq))
  INTO   v_schedule
  FROM (
    SELECT
      e.id,
      e.title,
      e.start_time,
      e.end_time,
      e.event_type,
      p.name AS project_name
    FROM calendar_events e
    LEFT JOIN projects p ON e.project_id = p.id
    WHERE e.start_time >= NOW() AND e.start_time <= NOW() + INTERVAL '7 days'
    ORDER BY e.start_time ASC
    LIMIT 10
  ) eq;

  -- ── 5. Recent activity feed (10 items) ───────────────────────────────────
  SELECT json_agg(row_to_json(aq))
  INTO   v_activity
  FROM (
    SELECT *
    FROM v_recent_activities
    LIMIT 10
  ) aq;

  -- ── 6. Notifications for the requesting user ─────────────────────────────
  SELECT json_agg(row_to_json(nq))
  INTO   v_notifications
  FROM (
    SELECT id, title, message, type, is_read, created_at
    FROM notifications
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 20
  ) nq;

  RETURN json_build_object(
    'metrics',       COALESCE(v_metrics,         '{}'),
    'topTasks',      COALESCE(v_top_tasks,        '[]'),
    'activeProjects',COALESCE(v_active_projects,  '[]'),
    'schedule',      COALESCE(v_schedule,          '[]'),
    'activity',      COALESCE(v_activity,          '[]'),
    'notifications', COALESCE(v_notifications,     '[]')
  );
END;
$$;


--
-- Name: get_project_detail(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_detail(p_project_id text) RETURNS TABLE(id text, name text, description text, status text, start_date timestamp with time zone, due_date timestamp with time zone, creator_name text, created_at timestamp with time zone, updated_at timestamp with time zone, total_tasks bigint, completed_tasks bigint, progress integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name                                               AS creator_name,
    p.created_at,
    p.updated_at,
    COUNT(t.id)                                          AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')   AS completed_tasks,
    CASE
      WHEN COUNT(t.id) = 0 THEN 0
      ELSE ROUND(
             100.0
             * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')
             / COUNT(t.id)
           )::INT
    END                                                  AS progress
  FROM projects p
  JOIN users u ON p.created_by = u.id
  LEFT JOIN tasks t ON t.project_id = p.id
  WHERE p.id = p_project_id
  GROUP BY p.id, u.name;
END;
$$;


--
-- Name: get_project_members(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_members(p_project_id text) RETURNS TABLE(user_id text, user_name text, profile_image text, member_role text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id            AS user_id,
    u.name          AS user_name,
    u.profile_image,
    pm.role         AS member_role
  FROM project_members pm
  JOIN users u ON pm.user_id = u.id
  WHERE pm.project_id = p_project_id
  ORDER BY
    CASE pm.role WHEN 'Owner' THEN 1 WHEN 'Manager' THEN 2 ELSE 3 END,
    u.name;
END;
$$;


--
-- Name: get_team_workload(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_workload() RETURNS TABLE(id text, name text, role text, department text, assigned_tasks bigint, completed_tasks bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.role,
    u.department,
    COUNT(t.id)                                        AS assigned_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') AS completed_tasks
  FROM users u
  LEFT JOIN tasks t ON t.assigned_to = u.id
  GROUP BY u.id
  ORDER BY assigned_tasks DESC;
END;
$$;


--
-- Name: list_calendar_events(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_calendar_events(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id text, title text, description text, start_time timestamp with time zone, end_time timestamp with time zone, event_type text, project_id text, project_name text, creator_name text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    e.start_time,
    e.end_time,
    e.event_type,
    e.project_id,
    p.name  AS project_name,
    u.name  AS creator_name
  FROM calendar_events e
  LEFT JOIN projects p ON e.project_id = p.id
  LEFT JOIN users    u ON e.created_by = u.id
  ORDER BY e.start_time ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: list_documents(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_documents(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id text, name text, file_name text, file_type text, file_size bigint, folder text, project_name text, uploader_name text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.file_name,
    d.file_type,
    d.file_size,
    d.folder,
    p.name  AS project_name,
    u.name  AS uploader_name,
    d.created_at
  FROM documents d
  LEFT JOIN projects p ON d.project_id  = p.id
  LEFT JOIN users    u ON d.uploaded_by = u.id
  WHERE
    p_search IS NULL
    OR LOWER(d.name)      LIKE '%' || LOWER(p_search) || '%'
    OR LOWER(d.file_name) LIKE '%' || LOWER(p_search) || '%'
  ORDER BY d.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: list_projects(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_projects(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id text, name text, description text, status text, start_date timestamp with time zone, due_date timestamp with time zone, creator_name text, total_tasks bigint, completed_tasks bigint, progress integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name                                                AS creator_name,
    COUNT(t.id)                                           AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')    AS completed_tasks,
    CASE
      WHEN COUNT(t.id) = 0 THEN 0
      ELSE ROUND(
             100.0
             * COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')
             / COUNT(t.id)
           )::INT
    END                                                   AS progress
  FROM projects p
  JOIN users u ON p.created_by = u.id
  LEFT JOIN tasks t ON t.project_id = p.id
  WHERE
    (p_search IS NULL OR LOWER(p.name) LIKE '%' || LOWER(p_search) || '%'
                      OR LOWER(p.description) LIKE '%' || LOWER(p_search) || '%')
    AND (p_status IS NULL OR p.status = p_status)
  GROUP BY p.id, u.name
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: list_tasks(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_tasks(p_assigned_to text DEFAULT NULL::text, p_project_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id text, title text, description text, project_id text, project_name text, assigned_to_id text, assigned_to_name text, creator_name text, priority text, status text, due_date timestamp with time zone, completed_at timestamp with time zone, is_overdue boolean)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.title,
    t.description,
    t.project_id,
    p.name                                                          AS project_name,
    t.assigned_to                                                   AS assigned_to_id,
    assignee.name                                                   AS assigned_to_name,
    creator.name                                                    AS creator_name,
    t.priority,
    t.status,
    t.due_date,
    t.completed_at,
    (t.status <> 'COMPLETED' AND t.due_date IS NOT NULL AND t.due_date < NOW()) AS is_overdue
  FROM tasks t
  JOIN projects p        ON t.project_id  = p.id
  LEFT JOIN users assignee ON t.assigned_to = assignee.id
  LEFT JOIN users creator  ON t.created_by  = creator.id
  WHERE
    (p_assigned_to IS NULL OR t.assigned_to = p_assigned_to)
    AND (p_project_id  IS NULL OR t.project_id  = p_project_id)
    AND (p_status      IS NULL OR t.status      = p_status)
    AND (p_priority    IS NULL OR t.priority    = p_priority)
    AND (p_search      IS NULL OR LOWER(t.title) LIKE '%' || LOWER(p_search) || '%')
  ORDER BY
    CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
    t.due_date ASC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: list_team_members(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_team_members(p_search text DEFAULT NULL::text, p_department text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id text, name text, email text, role text, department text, status text, profile_image text, assigned_tasks_count bigint, completed_tasks_count bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.email,
    u.role,
    u.department,
    u.status,
    u.profile_image,
    (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id)                             AS assigned_tasks_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.status = 'COMPLETED')  AS completed_tasks_count
  FROM users u
  WHERE
    (p_search IS NULL
       OR LOWER(u.name)  LIKE '%' || LOWER(p_search) || '%'
       OR LOWER(u.email) LIKE '%' || LOWER(p_search) || '%')
    AND (p_department IS NULL OR LOWER(u.department) = LOWER(p_department))
  ORDER BY u.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: proc_create_project(text, text, text, text, timestamp with time zone, timestamp with time zone, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.proc_create_project(IN p_id text, IN p_name text, IN p_creator_id text, IN p_status text, IN p_start_date timestamp with time zone, IN p_due_date timestamp with time zone, IN p_description text DEFAULT ''::text)
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


--
-- Name: proc_create_task(text, text, text, text, text, text, timestamp with time zone, text, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.proc_create_task(IN p_id text, IN p_title text, IN p_project_id text, IN p_creator_id text, IN p_priority text, IN p_status text, IN p_due_date timestamp with time zone, IN p_description text DEFAULT ''::text, IN p_assigned_to text DEFAULT NULL::text)
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


--
-- Name: proc_reset_user_password(text, text, bigint); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.proc_reset_user_password(IN p_token_hash text, IN p_new_password_hash text, IN p_now_ms bigint)
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


--
-- Name: proc_update_project(text, text, text, text, text, timestamp with time zone, timestamp with time zone); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.proc_update_project(IN p_project_id text, IN p_user_id text, IN p_name text DEFAULT NULL::text, IN p_description text DEFAULT NULL::text, IN p_status text DEFAULT NULL::text, IN p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, IN p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
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


--
-- Name: proc_update_task(text, text, text, text, text, text, text, text, timestamp with time zone); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.proc_update_task(IN p_task_id text, IN p_user_id text, IN p_title text DEFAULT NULL::text, IN p_description text DEFAULT NULL::text, IN p_project_id text DEFAULT NULL::text, IN p_assigned_to text DEFAULT NULL::text, IN p_priority text DEFAULT NULL::text, IN p_status text DEFAULT NULL::text, IN p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id text NOT NULL,
    user_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    subject text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    event_type text NOT NULL,
    created_by text NOT NULL,
    project_id text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT calendar_events_event_type_check CHECK ((event_type = ANY (ARRAY['MEETING'::text, 'EVENT'::text, 'DEADLINE'::text, 'REMINDER'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id text NOT NULL,
    name text NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_type text NOT NULL,
    file_size bigint NOT NULL,
    uploaded_by text NOT NULL,
    project_id text,
    folder text DEFAULT 'General'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    expires_at bigint NOT NULL,
    used_at bigint
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    project_id text NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'Member'::text NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    start_date timestamp with time zone NOT NULL,
    due_date timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['PLANNED'::text, 'ACTIVE'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'ARCHIVED'::text])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    expires_at bigint NOT NULL,
    created_at bigint NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    project_id text NOT NULL,
    assigned_to text,
    created_by text NOT NULL,
    priority text NOT NULL,
    status text NOT NULL,
    due_date timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text]))),
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['TODO'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    user_id text NOT NULL,
    theme text DEFAULT 'light'::text NOT NULL,
    notify_task_assignments boolean DEFAULT true NOT NULL,
    notify_project_updates boolean DEFAULT true NOT NULL,
    notify_upcoming_meetings boolean DEFAULT true NOT NULL,
    notify_deadline_reminders boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text,
    auth_provider text NOT NULL,
    google_id text,
    profile_image text,
    role text DEFAULT 'Member'::text NOT NULL,
    department text DEFAULT 'Engineering'::text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT users_auth_provider_check CHECK ((auth_provider = ANY (ARRAY['local'::text, 'google'::text])))
);


--
-- Name: v_project_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_project_stats AS
 SELECT count(*) AS total,
    count(*) FILTER (WHERE (status = 'ACTIVE'::text)) AS active,
    count(*) FILTER (WHERE (status = 'COMPLETED'::text)) AS completed,
    count(*) FILTER (WHERE (status = 'PLANNED'::text)) AS planned
   FROM public.projects;


--
-- Name: v_project_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_project_summary AS
SELECT
    NULL::text AS id,
    NULL::text AS name,
    NULL::text AS description,
    NULL::text AS status,
    NULL::timestamp with time zone AS start_date,
    NULL::timestamp with time zone AS due_date,
    NULL::text AS creator_name,
    NULL::bigint AS total_tasks,
    NULL::bigint AS completed_tasks,
    NULL::numeric AS progress;


--
-- Name: v_recent_activities; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_recent_activities AS
 SELECT a.id,
    a.user_id,
    u.name AS person_name,
    u.profile_image,
    a.action,
    a.entity_type,
    a.entity_id,
    a.subject,
    a.created_at
   FROM (public.activities a
     JOIN public.users u ON ((a.user_id = u.id)))
  ORDER BY a.created_at DESC;


--
-- Name: v_task_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_task_stats AS
 SELECT count(*) AS total,
    count(*) FILTER (WHERE (status = 'COMPLETED'::text)) AS completed,
    count(*) FILTER (WHERE (status = 'IN_PROGRESS'::text)) AS in_progress,
    count(*) FILTER (WHERE (status = 'TODO'::text)) AS todo,
    count(*) FILTER (WHERE (priority = 'HIGH'::text)) AS high_priority
   FROM public.tasks;


--
-- Data for Name: activities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activities (id, user_id, action, entity_type, entity_id, subject, created_at) FROM stdin;
act_1	usr_jordan	completed a task in	task	task_3	Brand Evolution	2026-10-01 15:20:55.675+05:30
act_2	usr_sam	uploaded a document to	document	doc_2	Customer Intelligence	2026-10-01 14:44:55.675+05:30
act_3	usr_morgan	scheduled a meeting for	event	evt_1	Platform Refresh	2026-10-01 13:32:55.675+05:30
act_4	usr_alex	created a new project	project	proj_brand	Brand Evolution	2026-09-30 15:32:55.675+05:30
act_5	usr_rakesh	assigned a task to	task	task_1	Platform Refresh	2026-09-30 03:32:55.675+05:30
act_16xeh6v4m	388e5b99-06f1-4605-a88e-998d2f90d317	scheduled a meeting for	event	evt_f260c1d4	Meeting	2026-10-01 16:22:09.303+05:30
act_mrbmwcm8g	388e5b99-06f1-4605-a88e-998d2f90d317	updated task	task	task_1	Review Q3 product roadmap	2026-10-01 16:38:03.328+05:30
act_khzbddxct	388e5b99-06f1-4605-a88e-998d2f90d317	completed a task in	task	task_1	Review Q3 product roadmap	2026-10-01 16:38:06.128+05:30
act_4xbf05phz	388e5b99-06f1-4605-a88e-998d2f90d317	completed a task in	task	task_4	Finalize launch checklist	2026-10-01 16:49:18.179+05:30
act_ujhtnb77w	388e5b99-06f1-4605-a88e-998d2f90d317	updated task	task	task_4	Finalize launch checklist	2026-10-01 16:49:26.253+05:30
act_el48avrs2	388e5b99-06f1-4605-a88e-998d2f90d317	updated task	task	task_1	Review Q3 product roadmap	2026-10-01 16:49:31.141+05:30
act_wgrfojicz	b10ffeab-840f-430a-88e9-50743c48ef13	created task	task	task_7878592f	Review (Customer Intelligence)	2026-10-01 16:51:40.139+05:30
act_2pgt4002j	b10ffeab-840f-430a-88e9-50743c48ef13	created task	task	task_a08515ba	Review - Test (Customer Intelligence)	2026-10-01 16:52:07.778+05:30
act_7niadi431	usr_rakesh	uploaded a document to	document	doc_849119d3	Intern Document	2026-10-01 17:00:59.128+05:30
act_7	usr_rakesh	updated a document to	document	doc_849119d3	Intern Document	2026-10-03 05:30:00+05:30
seed_act_001	usr_rakesh	created a task	task	seed_task_001	Define project requirements — Customer Intelligence Platform	2026-09-01 13:30:00+05:30
seed_act_002	usr_jordan	updated task	task	seed_task_002	Finalize technical architecture — Customer Intelligence Platform	2026-09-02 14:37:00+05:30
seed_act_003	usr_sam	completed a task in	task	seed_task_003	Set up development environment — Customer Intelligence Platform	2026-09-03 15:44:00+05:30
seed_act_004	usr_morgan	uploaded a document to	document	seed_doc_004	Risk Assessment — Customer Intelligence Platform	2026-09-04 16:51:00+05:30
seed_act_005	usr_alex	scheduled a meeting for	event	seed_evt_005	Sprint demo — Internal Knowledge Assistant	2026-09-05 17:58:00+05:30
seed_act_006	usr_rakesh	created a new project	project	seed_proj_06	Document Processing Pipeline	2026-09-06 19:05:00+05:30
seed_act_007	usr_jordan	created a task	task	seed_task_007	Define project requirements — Internal Knowledge Assistant	2026-09-07 20:12:00+05:30
seed_act_008	usr_sam	updated task	task	seed_task_008	Finalize technical architecture — Internal Knowledge Assistant	2026-09-08 21:19:00+05:30
seed_act_009	usr_morgan	completed a task in	task	seed_task_009	Set up development environment — Internal Knowledge Assistant	2026-09-09 22:26:00+05:30
seed_act_010	usr_alex	uploaded a document to	document	seed_doc_010	Architecture Design — Cloud Infrastructure Migration	2026-09-10 22:33:00+05:30
seed_act_011	usr_rakesh	scheduled a meeting for	event	seed_evt_011	Team retrospective — Payment Reconciliation System	2026-09-11 13:40:00+05:30
seed_act_012	usr_jordan	created a new project	project	seed_proj_02	Internal Knowledge Assistant	2026-09-12 14:47:00+05:30
seed_act_013	usr_sam	created a task	task	seed_task_013	Perform integration testing — Internal Knowledge Assistant	2026-09-13 15:54:00+05:30
seed_act_014	usr_morgan	updated task	task	seed_task_014	Define project requirements — Cloud Infrastructure Migration	2026-09-14 17:01:00+05:30
seed_act_015	usr_alex	completed a task in	task	seed_task_015	Finalize technical architecture — Cloud Infrastructure Migration	2026-09-15 18:08:00+05:30
seed_act_016	usr_rakesh	uploaded a document to	document	seed_doc_016	Risk Assessment — Payment Reconciliation System	2026-09-16 19:15:00+05:30
seed_act_017	usr_jordan	scheduled a meeting for	event	seed_evt_017	Project planning meeting — Document Processing Pipeline	2026-09-17 20:22:00+05:30
seed_act_018	usr_sam	created a new project	project	seed_proj_08	Security Compliance Upgrade	2026-09-18 21:29:00+05:30
seed_act_019	usr_morgan	created a task	task	seed_task_019	Create automated test suite — Cloud Infrastructure Migration	2026-09-19 21:36:00+05:30
seed_act_020	usr_alex	updated task	task	seed_task_020	Perform integration testing — Cloud Infrastructure Migration	2026-09-20 22:43:00+05:30
seed_act_021	usr_rakesh	completed a task in	task	seed_task_021	Prepare deployment runbook — Cloud Infrastructure Migration	2026-09-21 13:50:00+05:30
seed_act_022	usr_jordan	uploaded a document to	document	seed_doc_022	Architecture Design — Document Processing Pipeline	2026-09-22 14:57:00+05:30
seed_act_023	usr_sam	scheduled a meeting for	event	seed_evt_023	Sprint demo — Security Compliance Upgrade	2026-09-23 16:04:00+05:30
seed_act_024	usr_morgan	created a new project	project	seed_proj_04	Payment Reconciliation System	2026-09-24 17:11:00+05:30
seed_act_025	usr_alex	created a task	task	seed_task_025	Implement backend API — Payment Reconciliation System	2026-09-25 18:18:00+05:30
seed_act_026	usr_rakesh	updated task	task	seed_task_026	Build frontend workflow — Payment Reconciliation System	2026-09-26 19:25:00+05:30
seed_act_027	usr_jordan	completed a task in	task	seed_task_027	Create automated test suite — Payment Reconciliation System	2026-09-27 19:32:00+05:30
seed_act_028	usr_sam	uploaded a document to	document	seed_doc_028	Risk Assessment — Customer Support Automation	2026-09-28 20:39:00+05:30
seed_act_029	usr_morgan	scheduled a meeting for	event	seed_evt_029	Team retrospective — Mobile Workforce Application	2026-09-29 21:46:00+05:30
seed_act_030	usr_alex	created a new project	project	seed_proj_10	Mobile Workforce Application	2026-09-30 22:53:00+05:30
seed_act_031	usr_rakesh	created a task	task	seed_task_031	Implement backend API — Employee Analytics Portal	2026-09-01 14:00:00+05:30
seed_act_032	usr_jordan	updated task	task	seed_task_032	Build frontend workflow — Employee Analytics Portal	2026-09-02 15:07:00+05:30
seed_act_033	usr_sam	completed a task in	task	seed_task_033	Create automated test suite — Employee Analytics Portal	2026-09-03 16:14:00+05:30
seed_act_034	usr_morgan	uploaded a document to	document	seed_doc_034	Architecture Design — Data Warehouse Modernization	2026-09-04 17:21:00+05:30
seed_act_035	usr_alex	scheduled a meeting for	event	seed_evt_005	Sprint demo — Internal Knowledge Assistant	2026-09-05 18:28:00+05:30
seed_act_036	usr_rakesh	created a new project	project	seed_proj_06	Document Processing Pipeline	2026-09-06 18:35:00+05:30
seed_act_037	usr_jordan	created a task	task	seed_task_037	Set up development environment — Document Processing Pipeline	2026-09-07 19:42:00+05:30
seed_act_038	usr_sam	updated task	task	seed_task_038	Implement backend API — Document Processing Pipeline	2026-09-08 20:49:00+05:30
seed_act_039	usr_morgan	completed a task in	task	seed_task_039	Build frontend workflow — Document Processing Pipeline	2026-09-09 21:56:00+05:30
seed_act_040	usr_alex	uploaded a document to	document	seed_doc_040	Risk Assessment — Mobile Workforce Application	2026-09-10 23:03:00+05:30
seed_act_041	usr_rakesh	scheduled a meeting for	event	seed_evt_011	Team retrospective — Payment Reconciliation System	2026-09-11 14:10:00+05:30
seed_act_042	usr_jordan	created a new project	project	seed_proj_02	Internal Knowledge Assistant	2026-09-12 15:17:00+05:30
seed_act_043	usr_sam	created a task	task	seed_task_043	Define project requirements — Customer Support Automation	2026-09-13 16:24:00+05:30
seed_act_044	usr_morgan	updated task	task	seed_task_044	Finalize technical architecture — Customer Support Automation	2026-09-14 16:31:00+05:30
seed_act_045	usr_alex	completed a task in	task	seed_task_045	Set up development environment — Customer Support Automation	2026-09-15 17:38:00+05:30
seed_act_046	usr_rakesh	uploaded a document to	document	seed_doc_006	Architecture Design — Internal Knowledge Assistant	2026-09-16 18:45:00+05:30
seed_act_047	usr_jordan	scheduled a meeting for	event	seed_evt_017	Project planning meeting — Document Processing Pipeline	2026-09-17 19:52:00+05:30
seed_act_048	usr_sam	created a new project	project	seed_proj_08	Security Compliance Upgrade	2026-09-18 20:59:00+05:30
seed_act_049	usr_morgan	created a task	task	seed_task_049	Define project requirements — Security Compliance Upgrade	2026-09-19 22:06:00+05:30
seed_act_050	usr_alex	updated task	task	seed_task_050	Finalize technical architecture — Security Compliance Upgrade	2026-09-20 23:13:00+05:30
seed_act_051	usr_rakesh	completed a task in	task	seed_task_051	Set up development environment — Security Compliance Upgrade	2026-09-21 14:20:00+05:30
seed_act_052	usr_jordan	uploaded a document to	document	seed_doc_012	Risk Assessment — Cloud Infrastructure Migration	2026-09-22 15:27:00+05:30
seed_act_053	usr_sam	scheduled a meeting for	event	seed_evt_023	Sprint demo — Security Compliance Upgrade	2026-09-23 15:34:00+05:30
seed_act_054	usr_morgan	created a new project	project	seed_proj_04	Payment Reconciliation System	2026-09-24 16:41:00+05:30
seed_act_055	usr_alex	created a task	task	seed_task_055	Perform integration testing — Security Compliance Upgrade	2026-09-25 17:48:00+05:30
seed_act_056	usr_rakesh	updated task	task	seed_task_056	Define project requirements — Data Warehouse Modernization	2026-09-26 18:55:00+05:30
seed_act_057	usr_jordan	completed a task in	task	seed_task_057	Finalize technical architecture — Data Warehouse Modernization	2026-09-27 20:02:00+05:30
seed_act_058	usr_sam	uploaded a document to	document	seed_doc_018	Architecture Design — Employee Analytics Portal	2026-09-28 21:09:00+05:30
seed_act_059	usr_morgan	scheduled a meeting for	event	seed_evt_029	Team retrospective — Mobile Workforce Application	2026-09-29 22:16:00+05:30
seed_act_060	usr_alex	created a new project	project	seed_proj_10	Mobile Workforce Application	2026-09-30 23:23:00+05:30
seed_act_061	usr_rakesh	created a task	task	seed_task_061	Create automated test suite — Data Warehouse Modernization	2026-09-01 13:30:00+05:30
seed_act_062	usr_jordan	updated task	task	seed_task_062	Perform integration testing — Data Warehouse Modernization	2026-09-02 14:37:00+05:30
seed_act_063	usr_sam	completed a task in	task	seed_task_063	Prepare deployment runbook — Data Warehouse Modernization	2026-09-03 15:44:00+05:30
seed_act_064	usr_morgan	uploaded a document to	document	seed_doc_024	Risk Assessment — Document Processing Pipeline	2026-09-04 16:51:00+05:30
seed_act_065	usr_alex	scheduled a meeting for	event	seed_evt_005	Sprint demo — Internal Knowledge Assistant	2026-09-05 17:58:00+05:30
seed_act_066	usr_rakesh	created a new project	project	seed_proj_06	Document Processing Pipeline	2026-09-06 19:05:00+05:30
seed_act_067	usr_jordan	created a task	task	seed_task_067	Implement backend API — Mobile Workforce Application	2026-09-07 20:12:00+05:30
seed_act_068	usr_sam	updated task	task	seed_task_068	Build frontend workflow — Mobile Workforce Application	2026-09-08 21:19:00+05:30
seed_act_069	usr_morgan	completed a task in	task	seed_task_069	Create automated test suite — Mobile Workforce Application	2026-09-09 22:26:00+05:30
seed_act_070	usr_alex	uploaded a document to	document	seed_doc_030	Architecture Design — Security Compliance Upgrade	2026-09-10 22:33:00+05:30
seed_act_071	usr_rakesh	scheduled a meeting for	event	seed_evt_011	Team retrospective — Payment Reconciliation System	2026-09-11 13:40:00+05:30
seed_act_072	usr_jordan	created a new project	project	seed_proj_02	Internal Knowledge Assistant	2026-09-12 14:47:00+05:30
seed_act_073	usr_sam	created a task	task	seed_task_004	Implement backend API — Customer Intelligence Platform	2026-09-13 15:54:00+05:30
seed_act_074	usr_morgan	updated task	task	seed_task_005	Build frontend workflow — Customer Intelligence Platform	2026-09-14 17:01:00+05:30
seed_act_075	usr_alex	completed a task in	task	seed_task_006	Create automated test suite — Customer Intelligence Platform	2026-09-15 18:08:00+05:30
seed_act_076	usr_rakesh	uploaded a document to	document	seed_doc_036	Risk Assessment — Data Warehouse Modernization	2026-09-16 19:15:00+05:30
seed_act_077	usr_jordan	scheduled a meeting for	event	seed_evt_017	Project planning meeting — Document Processing Pipeline	2026-09-17 20:22:00+05:30
seed_act_078	usr_sam	created a new project	project	seed_proj_08	Security Compliance Upgrade	2026-09-18 21:29:00+05:30
seed_act_079	usr_morgan	created a task	task	seed_task_010	Implement backend API — Internal Knowledge Assistant	2026-09-19 21:36:00+05:30
seed_act_080	usr_alex	updated task	task	seed_task_011	Build frontend workflow — Internal Knowledge Assistant	2026-09-20 22:43:00+05:30
act_77d038785	388e5b99-06f1-4605-a88e-998d2f90d317	created task	task	task_117cb414	Review the project (Platform Refresh)	2026-10-05 15:44:00.960108+05:30
act_c1522fdf6	388e5b99-06f1-4605-a88e-998d2f90d317	created a new project	project	proj_8b8eb0fb	Turf Management	2026-10-05 15:45:04.480846+05:30
act_2f2af2f67	388e5b99-06f1-4605-a88e-998d2f90d317	scheduled a meeting for	event	evt_dcda6415	Meeting	2026-10-05 15:45:52.125661+05:30
act_ae471a94a	388e5b99-06f1-4605-a88e-998d2f90d317	completed a task in	task	seed_task_001	Define project requirements — Customer Intelligence Platform	2026-10-05 15:46:24.686546+05:30
\.


--
-- Data for Name: calendar_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.calendar_events (id, title, description, start_time, end_time, event_type, created_by, project_id, created_at) FROM stdin;
evt_1	Product weekly sync	Align engineering and design teams on current sprint progress.	2026-10-01 16:00:00+05:30	2026-10-01 17:00:00+05:30	MEETING	usr_rakesh	proj_platform	2026-10-01 15:32:55.535+05:30
evt_2	Research readout	Customer Intelligence interview insights presentation.	2026-10-01 18:30:00+05:30	2026-10-01 19:30:00+05:30	EVENT	usr_morgan	proj_intelligence	2026-10-01 15:32:55.535+05:30
evt_3	Roadmap review due	Final submission deadline for Q4 roadmap proposals.	2026-10-01 21:00:00+05:30	2026-10-01 22:00:00+05:30	DEADLINE	usr_rakesh	proj_platform	2026-10-01 15:32:55.535+05:30
evt_4	Brand Evolution Design Critique	Review brand refresh guidelines with marketing and product leads.	2026-10-02 16:30:00+05:30	2026-10-02 17:30:00+05:30	MEETING	usr_jordan	proj_brand	2026-10-01 15:32:55.535+05:30
evt_5	Architecture Review: AI Copilot	Technical spike review for LLM integration pipeline.	2026-10-05 19:30:00+05:30	2026-10-05 21:00:00+05:30	MEETING	usr_sam	\N	2026-10-01 15:32:55.535+05:30
evt_f260c1d4	Meeting		2026-10-01 16:22:00+05:30	2026-10-01 18:22:00+05:30	MEETING	388e5b99-06f1-4605-a88e-998d2f90d317	\N	2026-10-01 16:22:09.302+05:30
seed_evt_001	Project planning meeting — Customer Intelligence Platform	Scheduled activity for Customer Intelligence Platform	2026-10-06 15:30:00+05:30	2026-10-06 16:30:00+05:30	MEETING	usr_rakesh	seed_proj_01	2026-09-01 14:30:00+05:30
seed_evt_002	Architecture review — Customer Intelligence Platform	Scheduled activity for Customer Intelligence Platform	2026-11-13 16:30:00+05:30	2026-11-13 17:30:00+05:30	MEETING	usr_jordan	seed_proj_01	2026-09-01 14:30:00+05:30
seed_evt_003	Sprint demo — Customer Intelligence Platform	Scheduled activity for Customer Intelligence Platform	2026-12-20 17:30:00+05:30	2026-12-20 18:30:00+05:30	EVENT	usr_sam	seed_proj_01	2026-09-01 14:30:00+05:30
seed_evt_004	Architecture review — Internal Knowledge Assistant	Scheduled activity for Internal Knowledge Assistant	2026-11-10 15:30:00+05:30	2026-11-10 16:30:00+05:30	MEETING	usr_jordan	seed_proj_02	2026-09-01 14:30:00+05:30
seed_evt_005	Sprint demo — Internal Knowledge Assistant	Scheduled activity for Internal Knowledge Assistant	2026-12-17 16:30:00+05:30	2026-12-17 17:30:00+05:30	EVENT	usr_sam	seed_proj_02	2026-09-01 14:30:00+05:30
seed_evt_006	Release deadline — Internal Knowledge Assistant	Scheduled activity for Internal Knowledge Assistant	2026-10-24 17:30:00+05:30	2026-10-24 18:30:00+05:30	DEADLINE	usr_morgan	seed_proj_02	2026-09-01 14:30:00+05:30
seed_evt_007	Sprint demo — Cloud Infrastructure Migration	Scheduled activity for Cloud Infrastructure Migration	2026-12-14 15:30:00+05:30	2026-12-14 16:30:00+05:30	EVENT	usr_sam	seed_proj_03	2026-09-01 14:30:00+05:30
seed_evt_008	Release deadline — Cloud Infrastructure Migration	Scheduled activity for Cloud Infrastructure Migration	2026-10-21 16:30:00+05:30	2026-10-21 17:30:00+05:30	DEADLINE	usr_morgan	seed_proj_03	2026-09-01 14:30:00+05:30
seed_evt_009	Team retrospective — Cloud Infrastructure Migration	Scheduled activity for Cloud Infrastructure Migration	2026-11-08 17:30:00+05:30	2026-11-08 18:30:00+05:30	MEETING	usr_alex	seed_proj_03	2026-09-01 14:30:00+05:30
seed_evt_010	Release deadline — Payment Reconciliation System	Scheduled activity for Payment Reconciliation System	2026-10-18 15:30:00+05:30	2026-10-18 16:30:00+05:30	DEADLINE	usr_morgan	seed_proj_04	2026-09-01 14:30:00+05:30
seed_evt_011	Team retrospective — Payment Reconciliation System	Scheduled activity for Payment Reconciliation System	2026-11-25 16:30:00+05:30	2026-11-25 17:30:00+05:30	MEETING	usr_alex	seed_proj_04	2026-09-01 14:30:00+05:30
seed_evt_012	Security review — Payment Reconciliation System	Scheduled activity for Payment Reconciliation System	2026-12-12 17:30:00+05:30	2026-12-12 18:30:00+05:30	MEETING	usr_rakesh	seed_proj_04	2026-09-01 14:30:00+05:30
seed_evt_013	Team retrospective — Employee Analytics Portal	Scheduled activity for Employee Analytics Portal	2026-11-22 15:30:00+05:30	2026-11-22 16:30:00+05:30	MEETING	usr_alex	seed_proj_05	2026-09-01 14:30:00+05:30
seed_evt_014	Security review — Employee Analytics Portal	Scheduled activity for Employee Analytics Portal	2026-12-09 16:30:00+05:30	2026-12-09 17:30:00+05:30	MEETING	usr_rakesh	seed_proj_05	2026-09-01 14:30:00+05:30
seed_evt_015	Project planning meeting — Employee Analytics Portal	Scheduled activity for Employee Analytics Portal	2026-10-16 17:30:00+05:30	2026-10-16 18:30:00+05:30	MEETING	usr_jordan	seed_proj_05	2026-09-01 14:30:00+05:30
seed_evt_016	Security review — Document Processing Pipeline	Scheduled activity for Document Processing Pipeline	2026-12-06 15:30:00+05:30	2026-12-06 16:30:00+05:30	MEETING	usr_rakesh	seed_proj_06	2026-09-01 14:30:00+05:30
seed_evt_017	Project planning meeting — Document Processing Pipeline	Scheduled activity for Document Processing Pipeline	2026-10-13 16:30:00+05:30	2026-10-13 17:30:00+05:30	MEETING	usr_jordan	seed_proj_06	2026-09-01 14:30:00+05:30
seed_evt_018	Architecture review — Document Processing Pipeline	Scheduled activity for Document Processing Pipeline	2026-11-20 17:30:00+05:30	2026-11-20 18:30:00+05:30	MEETING	usr_sam	seed_proj_06	2026-09-01 14:30:00+05:30
seed_evt_019	Project planning meeting — Customer Support Automation	Scheduled activity for Customer Support Automation	2026-10-10 15:30:00+05:30	2026-10-10 16:30:00+05:30	MEETING	usr_jordan	seed_proj_07	2026-09-01 14:30:00+05:30
seed_evt_020	Architecture review — Customer Support Automation	Scheduled activity for Customer Support Automation	2026-11-17 16:30:00+05:30	2026-11-17 17:30:00+05:30	MEETING	usr_sam	seed_proj_07	2026-09-01 14:30:00+05:30
seed_evt_021	Sprint demo — Customer Support Automation	Scheduled activity for Customer Support Automation	2026-12-24 17:30:00+05:30	2026-12-24 18:30:00+05:30	EVENT	usr_morgan	seed_proj_07	2026-09-01 14:30:00+05:30
seed_evt_022	Architecture review — Security Compliance Upgrade	Scheduled activity for Security Compliance Upgrade	2026-11-14 15:30:00+05:30	2026-11-14 16:30:00+05:30	MEETING	usr_sam	seed_proj_08	2026-09-01 14:30:00+05:30
seed_evt_023	Sprint demo — Security Compliance Upgrade	Scheduled activity for Security Compliance Upgrade	2026-12-21 16:30:00+05:30	2026-12-21 17:30:00+05:30	EVENT	usr_morgan	seed_proj_08	2026-09-01 14:30:00+05:30
seed_evt_024	Release deadline — Security Compliance Upgrade	Scheduled activity for Security Compliance Upgrade	2026-10-08 17:30:00+05:30	2026-10-08 18:30:00+05:30	DEADLINE	usr_alex	seed_proj_08	2026-09-01 14:30:00+05:30
seed_evt_025	Sprint demo — Data Warehouse Modernization	Scheduled activity for Data Warehouse Modernization	2026-12-18 15:30:00+05:30	2026-12-18 16:30:00+05:30	EVENT	usr_morgan	seed_proj_09	2026-09-01 14:30:00+05:30
seed_evt_026	Release deadline — Data Warehouse Modernization	Scheduled activity for Data Warehouse Modernization	2026-10-25 16:30:00+05:30	2026-10-25 17:30:00+05:30	DEADLINE	usr_alex	seed_proj_09	2026-09-01 14:30:00+05:30
seed_evt_027	Team retrospective — Data Warehouse Modernization	Scheduled activity for Data Warehouse Modernization	2026-11-12 17:30:00+05:30	2026-11-12 18:30:00+05:30	MEETING	usr_rakesh	seed_proj_09	2026-09-01 14:30:00+05:30
seed_evt_028	Release deadline — Mobile Workforce Application	Scheduled activity for Mobile Workforce Application	2026-10-22 15:30:00+05:30	2026-10-22 16:30:00+05:30	DEADLINE	usr_alex	seed_proj_10	2026-09-01 14:30:00+05:30
seed_evt_029	Team retrospective — Mobile Workforce Application	Scheduled activity for Mobile Workforce Application	2026-11-09 16:30:00+05:30	2026-11-09 17:30:00+05:30	MEETING	usr_rakesh	seed_proj_10	2026-09-01 14:30:00+05:30
seed_evt_030	Security review — Mobile Workforce Application	Scheduled activity for Mobile Workforce Application	2026-12-16 17:30:00+05:30	2026-12-16 18:30:00+05:30	MEETING	usr_jordan	seed_proj_10	2026-09-01 14:30:00+05:30
evt_dcda6415	Meeting		2026-10-05 15:45:00+05:30	2026-10-05 15:50:00+05:30	MEETING	388e5b99-06f1-4605-a88e-998d2f90d317	\N	2026-10-05 15:45:52.113522+05:30
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, name, file_name, file_path, file_type, file_size, uploaded_by, project_id, folder, created_at, updated_at) FROM stdin;
doc_1	Product Architecture Spec 2026	Product_Architecture_Spec.pdf	/uploads/Product_Architecture_Spec.pdf	application/pdf	2450000	usr_rakesh	proj_platform	Architecture	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
doc_2	Customer Intelligence Insights	Customer_Research_Summary.docx	/uploads/Customer_Research_Summary.docx	application/vnd.openxmlformats-officedocument.wordprocessingml.document	1120000	usr_maya	proj_intelligence	Research	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
doc_3	Brand Evolution Style Guide	Brand_Guide_v2.pdf	/uploads/Brand_Guide_v2.pdf	application/pdf	5800000	usr_jordan	proj_brand	Design Systems	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
doc_4	SOC2 Type II Security Report	SOC2_Audit_Report.pdf	/uploads/SOC2_Audit_Report.pdf	application/pdf	3400000	usr_chris	proj_security	Compliance	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
doc_849119d3	Intern Document	Internship Document	/uploads/Internship Document	application/pdf	1024	usr_rakesh	\N	General	2026-10-01 17:00:59.128+05:30	2026-10-01 17:00:59.128+05:30
seed_doc_001	Requirements Specification — Customer Intelligence Platform	seed_seed_proj_01_requirements.pdf	/documents/seed_proj_01/requirements.pdf	application/pdf	120000	usr_rakesh	seed_proj_01	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_002	Architecture Design — Customer Intelligence Platform	seed_seed_proj_01_architecture.pdf	/documents/seed_proj_01/architecture.pdf	application/pdf	137500	usr_jordan	seed_proj_01	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_003	Meeting Minutes — Customer Intelligence Platform	seed_seed_proj_01_meeting-notes.pdf	/documents/seed_proj_01/meeting-notes.pdf	application/pdf	155000	usr_sam	seed_proj_01	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_004	Risk Assessment — Customer Intelligence Platform	seed_seed_proj_01_risk.pdf	/documents/seed_proj_01/risk.pdf	application/pdf	172500	usr_morgan	seed_proj_01	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_005	Requirements Specification — Internal Knowledge Assistant	seed_seed_proj_02_requirements.pdf	/documents/seed_proj_02/requirements.pdf	application/pdf	129000	usr_jordan	seed_proj_02	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_006	Architecture Design — Internal Knowledge Assistant	seed_seed_proj_02_architecture.pdf	/documents/seed_proj_02/architecture.pdf	application/pdf	146500	usr_sam	seed_proj_02	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_007	Meeting Minutes — Internal Knowledge Assistant	seed_seed_proj_02_meeting-notes.pdf	/documents/seed_proj_02/meeting-notes.pdf	application/pdf	164000	usr_morgan	seed_proj_02	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_008	Risk Assessment — Internal Knowledge Assistant	seed_seed_proj_02_risk.pdf	/documents/seed_proj_02/risk.pdf	application/pdf	181500	usr_alex	seed_proj_02	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_009	Requirements Specification — Cloud Infrastructure Migration	seed_seed_proj_03_requirements.pdf	/documents/seed_proj_03/requirements.pdf	application/pdf	138000	usr_sam	seed_proj_03	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_010	Architecture Design — Cloud Infrastructure Migration	seed_seed_proj_03_architecture.pdf	/documents/seed_proj_03/architecture.pdf	application/pdf	155500	usr_morgan	seed_proj_03	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_011	Meeting Minutes — Cloud Infrastructure Migration	seed_seed_proj_03_meeting-notes.pdf	/documents/seed_proj_03/meeting-notes.pdf	application/pdf	173000	usr_alex	seed_proj_03	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_012	Risk Assessment — Cloud Infrastructure Migration	seed_seed_proj_03_risk.pdf	/documents/seed_proj_03/risk.pdf	application/pdf	190500	usr_rakesh	seed_proj_03	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_013	Requirements Specification — Payment Reconciliation System	seed_seed_proj_04_requirements.pdf	/documents/seed_proj_04/requirements.pdf	application/pdf	147000	usr_morgan	seed_proj_04	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_014	Architecture Design — Payment Reconciliation System	seed_seed_proj_04_architecture.pdf	/documents/seed_proj_04/architecture.pdf	application/pdf	164500	usr_alex	seed_proj_04	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_015	Meeting Minutes — Payment Reconciliation System	seed_seed_proj_04_meeting-notes.pdf	/documents/seed_proj_04/meeting-notes.pdf	application/pdf	182000	usr_rakesh	seed_proj_04	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_016	Risk Assessment — Payment Reconciliation System	seed_seed_proj_04_risk.pdf	/documents/seed_proj_04/risk.pdf	application/pdf	199500	usr_jordan	seed_proj_04	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_017	Requirements Specification — Employee Analytics Portal	seed_seed_proj_05_requirements.pdf	/documents/seed_proj_05/requirements.pdf	application/pdf	156000	usr_alex	seed_proj_05	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_018	Architecture Design — Employee Analytics Portal	seed_seed_proj_05_architecture.pdf	/documents/seed_proj_05/architecture.pdf	application/pdf	173500	usr_rakesh	seed_proj_05	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_019	Meeting Minutes — Employee Analytics Portal	seed_seed_proj_05_meeting-notes.pdf	/documents/seed_proj_05/meeting-notes.pdf	application/pdf	191000	usr_jordan	seed_proj_05	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_020	Risk Assessment — Employee Analytics Portal	seed_seed_proj_05_risk.pdf	/documents/seed_proj_05/risk.pdf	application/pdf	208500	usr_sam	seed_proj_05	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_021	Requirements Specification — Document Processing Pipeline	seed_seed_proj_06_requirements.pdf	/documents/seed_proj_06/requirements.pdf	application/pdf	165000	usr_rakesh	seed_proj_06	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_022	Architecture Design — Document Processing Pipeline	seed_seed_proj_06_architecture.pdf	/documents/seed_proj_06/architecture.pdf	application/pdf	182500	usr_jordan	seed_proj_06	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_023	Meeting Minutes — Document Processing Pipeline	seed_seed_proj_06_meeting-notes.pdf	/documents/seed_proj_06/meeting-notes.pdf	application/pdf	200000	usr_sam	seed_proj_06	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_024	Risk Assessment — Document Processing Pipeline	seed_seed_proj_06_risk.pdf	/documents/seed_proj_06/risk.pdf	application/pdf	217500	usr_morgan	seed_proj_06	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_025	Requirements Specification — Customer Support Automation	seed_seed_proj_07_requirements.pdf	/documents/seed_proj_07/requirements.pdf	application/pdf	174000	usr_jordan	seed_proj_07	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_026	Architecture Design — Customer Support Automation	seed_seed_proj_07_architecture.pdf	/documents/seed_proj_07/architecture.pdf	application/pdf	191500	usr_sam	seed_proj_07	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_027	Meeting Minutes — Customer Support Automation	seed_seed_proj_07_meeting-notes.pdf	/documents/seed_proj_07/meeting-notes.pdf	application/pdf	209000	usr_morgan	seed_proj_07	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_028	Risk Assessment — Customer Support Automation	seed_seed_proj_07_risk.pdf	/documents/seed_proj_07/risk.pdf	application/pdf	226500	usr_alex	seed_proj_07	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_029	Requirements Specification — Security Compliance Upgrade	seed_seed_proj_08_requirements.pdf	/documents/seed_proj_08/requirements.pdf	application/pdf	183000	usr_sam	seed_proj_08	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_030	Architecture Design — Security Compliance Upgrade	seed_seed_proj_08_architecture.pdf	/documents/seed_proj_08/architecture.pdf	application/pdf	200500	usr_morgan	seed_proj_08	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_031	Meeting Minutes — Security Compliance Upgrade	seed_seed_proj_08_meeting-notes.pdf	/documents/seed_proj_08/meeting-notes.pdf	application/pdf	218000	usr_alex	seed_proj_08	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_032	Risk Assessment — Security Compliance Upgrade	seed_seed_proj_08_risk.pdf	/documents/seed_proj_08/risk.pdf	application/pdf	235500	usr_rakesh	seed_proj_08	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_033	Requirements Specification — Data Warehouse Modernization	seed_seed_proj_09_requirements.pdf	/documents/seed_proj_09/requirements.pdf	application/pdf	192000	usr_morgan	seed_proj_09	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_034	Architecture Design — Data Warehouse Modernization	seed_seed_proj_09_architecture.pdf	/documents/seed_proj_09/architecture.pdf	application/pdf	209500	usr_alex	seed_proj_09	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_035	Meeting Minutes — Data Warehouse Modernization	seed_seed_proj_09_meeting-notes.pdf	/documents/seed_proj_09/meeting-notes.pdf	application/pdf	227000	usr_rakesh	seed_proj_09	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_036	Risk Assessment — Data Warehouse Modernization	seed_seed_proj_09_risk.pdf	/documents/seed_proj_09/risk.pdf	application/pdf	244500	usr_jordan	seed_proj_09	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_037	Requirements Specification — Mobile Workforce Application	seed_seed_proj_10_requirements.pdf	/documents/seed_proj_10/requirements.pdf	application/pdf	201000	usr_alex	seed_proj_10	Requirements	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_038	Architecture Design — Mobile Workforce Application	seed_seed_proj_10_architecture.pdf	/documents/seed_proj_10/architecture.pdf	application/pdf	218500	usr_rakesh	seed_proj_10	Architecture	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_039	Meeting Minutes — Mobile Workforce Application	seed_seed_proj_10_meeting-notes.pdf	/documents/seed_proj_10/meeting-notes.pdf	application/pdf	236000	usr_jordan	seed_proj_10	Meeting-Notes	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_doc_040	Risk Assessment — Mobile Workforce Application	seed_seed_proj_10_risk.pdf	/documents/seed_proj_10/risk.pdf	application/pdf	253500	usr_sam	seed_proj_10	Risk	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, title, message, type, is_read, created_at) FROM stdin;
notif_r9r5ib016	aed656d9-97c3-44ef-8d18-58106df9ad95	New Task Assigned	John assigned you "Review"	task	f	2026-10-01 16:51:40.139+05:30
notif_f72zfokcs	aed656d9-97c3-44ef-8d18-58106df9ad95	New Task Assigned	John assigned you "Review - Test"	task	f	2026-10-01 16:52:07.778+05:30
seed_notif_001	usr_rakesh	Task assignment	You have been assigned a new task.	info	t	2026-09-01 14:45:00+05:30
seed_notif_002	usr_jordan	Project update	A project you follow has been updated.	success	f	2026-09-02 15:45:00+05:30
seed_notif_003	usr_sam	Upcoming meeting	You have an upcoming project meeting.	warning	f	2026-09-03 16:45:00+05:30
seed_notif_004	usr_morgan	Document uploaded	A new project document is available.	info	f	2026-09-04 17:45:00+05:30
seed_notif_005	usr_alex	Deadline reminder	A project deadline is approaching.	success	t	2026-09-05 18:45:00+05:30
seed_notif_006	usr_rakesh	Task assignment	You have been assigned a new task.	warning	f	2026-09-06 19:45:00+05:30
seed_notif_007	usr_jordan	Project update	A project you follow has been updated.	info	f	2026-09-07 20:45:00+05:30
seed_notif_008	usr_sam	Upcoming meeting	You have an upcoming project meeting.	success	f	2026-09-08 21:45:00+05:30
seed_notif_009	usr_morgan	Document uploaded	A new project document is available.	warning	t	2026-09-09 14:45:00+05:30
seed_notif_010	usr_alex	Deadline reminder	A project deadline is approaching.	info	f	2026-09-10 15:45:00+05:30
seed_notif_011	usr_rakesh	Task assignment	You have been assigned a new task.	success	f	2026-09-11 16:45:00+05:30
seed_notif_012	usr_jordan	Project update	A project you follow has been updated.	warning	f	2026-09-12 17:45:00+05:30
seed_notif_013	usr_sam	Upcoming meeting	You have an upcoming project meeting.	info	t	2026-09-13 18:45:00+05:30
seed_notif_014	usr_morgan	Document uploaded	A new project document is available.	success	f	2026-09-14 19:45:00+05:30
seed_notif_015	usr_alex	Deadline reminder	A project deadline is approaching.	warning	f	2026-09-15 20:45:00+05:30
seed_notif_016	usr_rakesh	Task assignment	You have been assigned a new task.	info	f	2026-09-16 21:45:00+05:30
seed_notif_017	usr_jordan	Project update	A project you follow has been updated.	success	t	2026-09-17 14:45:00+05:30
seed_notif_018	usr_sam	Upcoming meeting	You have an upcoming project meeting.	warning	f	2026-09-18 15:45:00+05:30
seed_notif_019	usr_morgan	Document uploaded	A new project document is available.	info	f	2026-09-19 16:45:00+05:30
seed_notif_020	usr_alex	Deadline reminder	A project deadline is approaching.	success	f	2026-09-20 17:45:00+05:30
seed_notif_021	usr_rakesh	Task assignment	You have been assigned a new task.	warning	t	2026-09-21 18:45:00+05:30
seed_notif_022	usr_jordan	Project update	A project you follow has been updated.	info	f	2026-09-22 19:45:00+05:30
seed_notif_023	usr_sam	Upcoming meeting	You have an upcoming project meeting.	success	f	2026-09-23 20:45:00+05:30
seed_notif_024	usr_morgan	Document uploaded	A new project document is available.	warning	f	2026-09-24 21:45:00+05:30
seed_notif_025	usr_alex	Deadline reminder	A project deadline is approaching.	info	t	2026-09-25 14:45:00+05:30
seed_notif_026	usr_rakesh	Task assignment	You have been assigned a new task.	success	f	2026-09-26 15:45:00+05:30
seed_notif_027	usr_jordan	Project update	A project you follow has been updated.	warning	f	2026-09-27 16:45:00+05:30
seed_notif_028	usr_sam	Upcoming meeting	You have an upcoming project meeting.	info	f	2026-09-28 17:45:00+05:30
seed_notif_029	usr_morgan	Document uploaded	A new project document is available.	success	t	2026-09-29 18:45:00+05:30
seed_notif_030	usr_alex	Deadline reminder	A project deadline is approaching.	warning	f	2026-09-30 19:45:00+05:30
seed_notif_031	usr_rakesh	Task assignment	You have been assigned a new task.	info	f	2026-09-01 20:45:00+05:30
seed_notif_032	usr_jordan	Project update	A project you follow has been updated.	success	f	2026-09-02 21:45:00+05:30
seed_notif_033	usr_sam	Upcoming meeting	You have an upcoming project meeting.	warning	t	2026-09-03 14:45:00+05:30
seed_notif_034	usr_morgan	Document uploaded	A new project document is available.	info	f	2026-09-04 15:45:00+05:30
seed_notif_035	usr_alex	Deadline reminder	A project deadline is approaching.	success	f	2026-09-05 16:45:00+05:30
seed_notif_036	usr_rakesh	Task assignment	You have been assigned a new task.	warning	f	2026-09-06 17:45:00+05:30
seed_notif_037	usr_jordan	Project update	A project you follow has been updated.	info	t	2026-09-07 18:45:00+05:30
seed_notif_038	usr_sam	Upcoming meeting	You have an upcoming project meeting.	success	f	2026-09-08 19:45:00+05:30
seed_notif_039	usr_morgan	Document uploaded	A new project document is available.	warning	f	2026-09-09 20:45:00+05:30
seed_notif_040	usr_alex	Deadline reminder	A project deadline is approaching.	info	f	2026-09-10 21:45:00+05:30
seed_notif_041	usr_rakesh	Task assignment	You have been assigned a new task.	success	t	2026-09-11 14:45:00+05:30
seed_notif_042	usr_jordan	Project update	A project you follow has been updated.	warning	f	2026-09-12 15:45:00+05:30
seed_notif_043	usr_sam	Upcoming meeting	You have an upcoming project meeting.	info	f	2026-09-13 16:45:00+05:30
seed_notif_044	usr_morgan	Document uploaded	A new project document is available.	success	f	2026-09-14 17:45:00+05:30
seed_notif_045	usr_alex	Deadline reminder	A project deadline is approaching.	warning	t	2026-09-15 18:45:00+05:30
seed_notif_046	usr_rakesh	Task assignment	You have been assigned a new task.	info	f	2026-09-16 19:45:00+05:30
seed_notif_047	usr_jordan	Project update	A project you follow has been updated.	success	f	2026-09-17 20:45:00+05:30
seed_notif_048	usr_sam	Upcoming meeting	You have an upcoming project meeting.	warning	f	2026-09-18 21:45:00+05:30
seed_notif_049	usr_morgan	Document uploaded	A new project document is available.	info	t	2026-09-19 14:45:00+05:30
seed_notif_050	usr_alex	Deadline reminder	A project deadline is approaching.	success	f	2026-09-20 15:45:00+05:30
notif_2775f5f83	43598547-fe65-4ccd-a93f-a44345331a45	New Task Assigned	Rakesh assigned you "Review the project"	task	f	2026-10-05 15:44:00.960108+05:30
notif_ce432010c	388e5b99-06f1-4605-a88e-998d2f90d317	Project Created	Project "Turf Management" has been created successfully.	project	f	2026-10-05 15:45:04.480846+05:30
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_reset_tokens (token_hash, user_id, expires_at, used_at) FROM stdin;
108798cc46e2895bbe25f6c9a59fc8d6369984399e3111122f27479e449a481b	de29f529-4b51-4ee3-ac5d-cb8b73d46538	1790835709518	1790832110017
5222592ee13b705273253241e9fff26717d80d4ff03580e78c67a4ff86f23fd4	57fd27ab-5170-4fe8-8853-4741ea78f886	1790836354806	1790832755339
c530cba65310a78e8cd375d6e63d5ba4fb67d78d870248faa3541411f35e5bc5	fc35d9a2-824b-4572-af2b-0809d4299415	1790836501743	1790832908237
72e0d1156a9337bfcc612557831811b7d768f32aa502889dd7270e3c19c0feb5	aed656d9-97c3-44ef-8d18-58106df9ad95	1790837427961	1790833840299
5ea9e78f16115149089e0fe4e595cdf5ee3571be2f2122dbe800ac677251eac5	usr_rakesh	1790857454772	1790853869005
\.


--
-- Data for Name: project_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_members (project_id, user_id, role) FROM stdin;
proj_platform	usr_rakesh	Owner
proj_platform	usr_jordan	Lead Designer
proj_platform	usr_sam	Lead Engineer
proj_platform	usr_taylor	Developer
proj_intelligence	usr_morgan	Owner
proj_intelligence	usr_sam	Engineer
proj_intelligence	usr_maya	Researcher
proj_brand	usr_alex	Owner
proj_brand	usr_jordan	Designer
proj_brand	usr_morgan	Reviewer
proj_security	usr_chris	Owner
proj_brand	usr_rakesh	Owner
seed_proj_01	usr_rakesh	Manager
seed_proj_01	usr_jordan	Lead
seed_proj_01	usr_sam	Member
seed_proj_01	usr_morgan	Member
seed_proj_02	usr_jordan	Manager
seed_proj_02	usr_sam	Lead
seed_proj_02	usr_morgan	Member
seed_proj_02	usr_alex	Member
seed_proj_03	usr_sam	Manager
seed_proj_03	usr_morgan	Lead
seed_proj_03	usr_alex	Member
seed_proj_03	usr_rakesh	Member
seed_proj_04	usr_morgan	Manager
seed_proj_04	usr_alex	Lead
seed_proj_04	usr_rakesh	Member
seed_proj_04	usr_jordan	Member
seed_proj_05	usr_alex	Manager
seed_proj_05	usr_rakesh	Lead
seed_proj_05	usr_jordan	Member
seed_proj_05	usr_sam	Member
seed_proj_06	usr_rakesh	Manager
seed_proj_06	usr_jordan	Lead
seed_proj_06	usr_sam	Member
seed_proj_06	usr_morgan	Member
seed_proj_07	usr_jordan	Manager
seed_proj_07	usr_sam	Lead
seed_proj_07	usr_morgan	Member
seed_proj_07	usr_alex	Member
seed_proj_08	usr_sam	Manager
seed_proj_08	usr_morgan	Lead
seed_proj_08	usr_alex	Member
seed_proj_08	usr_rakesh	Member
seed_proj_09	usr_morgan	Manager
seed_proj_09	usr_alex	Lead
seed_proj_09	usr_rakesh	Member
seed_proj_09	usr_jordan	Member
seed_proj_10	usr_alex	Manager
seed_proj_10	usr_rakesh	Lead
seed_proj_10	usr_jordan	Member
seed_proj_10	usr_sam	Member
proj_8b8eb0fb	388e5b99-06f1-4605-a88e-998d2f90d317	Owner
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, name, description, status, start_date, due_date, created_by, created_at, updated_at) FROM stdin;
proj_platform	Platform Refresh	A clearer, faster product foundation with modular UI architecture.	ACTIVE	2026-09-01 05:30:00+05:30	2026-10-18 05:30:00+05:30	usr_rakesh	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
proj_intelligence	Customer Intelligence	Turn customer feedback signals into actionable roadmap decisions.	ACTIVE	2026-09-15 05:30:00+05:30	2026-11-02 05:30:00+05:30	usr_morgan	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
proj_brand	Brand Evolution	An identity for the next chapter of Northstar AI Workplace.	ACTIVE	2026-08-20 05:30:00+05:30	2026-10-12 05:30:00+05:30	usr_alex	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
proj_security	Security Compliance Audit	SOC2 Type II compliance and infrastructure security hardening.	COMPLETED	2026-06-01 05:30:00+05:30	2026-09-25 05:30:00+05:30	usr_chris	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
seed_proj_01	Customer Intelligence Platform	Customer analytics and intelligence platform	ACTIVE	2026-07-15 05:30:00+05:30	2026-12-20 05:30:00+05:30	usr_jordan	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_02	Internal Knowledge Assistant	AI-powered internal knowledge and document assistant	ACTIVE	2026-08-01 05:30:00+05:30	2026-12-15 05:30:00+05:30	usr_rakesh	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_03	Cloud Infrastructure Migration	Migration of internal services to a modern cloud platform	ACTIVE	2026-06-10 05:30:00+05:30	2026-11-30 05:30:00+05:30	usr_alex	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_04	Payment Reconciliation System	Automated payment reconciliation and exception handling	ACTIVE	2026-08-20 05:30:00+05:30	2027-01-15 05:30:00+05:30	usr_sam	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_05	Employee Analytics Portal	Workforce analytics and management reporting portal	PLANNED	2026-10-15 05:30:00+05:30	2027-02-28 05:30:00+05:30	usr_jordan	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_06	Document Processing Pipeline	OCR and document classification pipeline	ACTIVE	2026-07-01 05:30:00+05:30	2026-12-05 05:30:00+05:30	usr_sam	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_07	Customer Support Automation	Automation for support triage and response workflows	ON_HOLD	2026-05-20 05:30:00+05:30	2026-10-31 05:30:00+05:30	usr_jordan	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_08	Security Compliance Upgrade	Security controls, audit readiness, and compliance improvements	ACTIVE	2026-08-15 05:30:00+05:30	2026-12-31 05:30:00+05:30	usr_alex	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_09	Data Warehouse Modernization	Modernization of analytics storage and reporting pipelines	COMPLETED	2026-03-01 05:30:00+05:30	2026-08-30 05:30:00+05:30	usr_rakesh	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
seed_proj_10	Mobile Workforce Application	Mobile application for field workforce operations	ACTIVE	2026-09-01 05:30:00+05:30	2027-01-30 05:30:00+05:30	usr_morgan	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30
proj_8b8eb0fb	Turf Management	This is a software to manage sports turf and payment modules etc.	ACTIVE	2026-10-05 00:00:00+05:30	2026-11-04 00:00:00+05:30	388e5b99-06f1-4605-a88e-998d2f90d317	2026-10-05 15:45:04.480846+05:30	2026-10-05 15:45:04.480846+05:30
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (token_hash, user_id, expires_at, created_at) FROM stdin;
b1d7ca6011e4e830e11d8488e3ef2144044c32f3ac8a3622001d3db46f3eb8bb	fc35d9a2-824b-4572-af2b-0809d4299415	1790876109168	1790832909168
073722ed69e44263e18387af4ddd4e754139d3fc54904080f1154fca6ae2830b	388e5b99-06f1-4605-a88e-998d2f90d317	1790898187962	1790854987962
1daa1be2851ff542651a4516c79f707799887dc00956c30b176aca59c763a686	388e5b99-06f1-4605-a88e-998d2f90d317	1791046721993	1791003521993
cd12cc8a6de4dc0c49592a0d9743d4a1cfaa28ad1f18922ef299b0b56efd42f4	388e5b99-06f1-4605-a88e-998d2f90d317	1791238384246	1791195184246
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tasks (id, title, description, project_id, assigned_to, created_by, priority, status, due_date, created_at, updated_at, completed_at) FROM stdin;
task_1	Review Q3 product roadmap		proj_platform	usr_rakesh	usr_morgan	MEDIUM	TODO	2026-10-01 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 16:49:31.141+05:30	\N
task_3	Share customer research notes	Compile interview transcripts from enterprise accounts into summary deck.	proj_intelligence	usr_maya	usr_morgan	LOW	COMPLETED	2026-10-06 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
task_4	Finalize launch checklist		proj_platform	usr_rakesh	usr_chris	MEDIUM	IN_PROGRESS	2026-10-08 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 16:49:26.253+05:30	\N
task_5	Refactor database indexing strategy	Add composite indexes to speed up multi-filter queries for tasks and projects.	proj_platform	usr_sam	usr_rakesh	HIGH	COMPLETED	2026-09-28 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
task_6	Build dark theme color palette	Define semantic CSS variables for dark mode support across components.	proj_brand	usr_taylor	usr_jordan	MEDIUM	IN_PROGRESS	2026-10-10 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	\N
task_7	Setup automated API regression test suite	Ensure 100% endpoint coverage with synthetic test fixtures.	proj_security	usr_chris	usr_chris	HIGH	COMPLETED	2026-09-24 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
task_8	Customer sentiment chart component	Develop responsive chart component rendering positive vs negative feedback trends.	proj_intelligence	usr_sam	usr_morgan	MEDIUM	TODO	2026-10-15 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	\N
task_9	Implement Google Identity GIS token validation	Verify OAuth JWT token signatures server-side and create local session.	proj_platform	usr_rakesh	usr_rakesh	HIGH	COMPLETED	2026-09-26 05:30:00+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
task_7878592f	Review		proj_intelligence	aed656d9-97c3-44ef-8d18-58106df9ad95	b10ffeab-840f-430a-88e9-50743c48ef13	MEDIUM	TODO	2026-10-01 05:30:00+05:30	2026-10-01 16:51:40.138+05:30	2026-10-01 16:51:40.138+05:30	\N
task_a08515ba	Review - Test		proj_intelligence	aed656d9-97c3-44ef-8d18-58106df9ad95	b10ffeab-840f-430a-88e9-50743c48ef13	MEDIUM	TODO	2026-10-01 05:30:00+05:30	2026-10-01 16:52:07.777+05:30	2026-10-01 16:52:07.777+05:30	\N
seed_task_002	Finalize technical architecture — Customer Intelligence Platform	Work item for Customer Intelligence Platform	seed_proj_01	usr_sam	usr_rakesh	HIGH	IN_PROGRESS	2026-09-09 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_003	Set up development environment — Customer Intelligence Platform	Work item for Customer Intelligence Platform	seed_proj_01	usr_morgan	usr_rakesh	MEDIUM	COMPLETED	2026-10-13 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-10-11 20:00:00+05:30
seed_task_004	Implement backend API — Customer Intelligence Platform	Work item for Customer Intelligence Platform	seed_proj_01	usr_alex	usr_rakesh	HIGH	IN_PROGRESS	2026-10-17 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_005	Build frontend workflow — Customer Intelligence Platform	Work item for Customer Intelligence Platform	seed_proj_01	usr_rakesh	usr_rakesh	MEDIUM	TODO	2026-11-21 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_006	Create automated test suite — Customer Intelligence Platform	Work item for Customer Intelligence Platform	seed_proj_01	usr_jordan	usr_rakesh	MEDIUM	TODO	2026-11-25 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_007	Define project requirements — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_sam	usr_jordan	HIGH	TODO	2026-09-08 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_008	Finalize technical architecture — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_morgan	usr_jordan	HIGH	IN_PROGRESS	2026-10-12 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_009	Set up development environment — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_alex	usr_jordan	MEDIUM	COMPLETED	2026-10-16 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-10-14 20:00:00+05:30
seed_task_010	Implement backend API — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_rakesh	usr_jordan	HIGH	IN_PROGRESS	2026-11-20 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_011	Build frontend workflow — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_jordan	usr_jordan	MEDIUM	TODO	2026-11-24 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_012	Create automated test suite — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_sam	usr_jordan	MEDIUM	TODO	2026-12-06 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_013	Perform integration testing — Internal Knowledge Assistant	Work item for Internal Knowledge Assistant	seed_proj_02	usr_morgan	usr_jordan	HIGH	TODO	2026-12-10 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_014	Define project requirements — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_morgan	usr_sam	HIGH	TODO	2026-10-11 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_015	Finalize technical architecture — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_alex	usr_sam	HIGH	IN_PROGRESS	2026-10-15 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_016	Set up development environment — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_rakesh	usr_sam	MEDIUM	COMPLETED	2026-11-19 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-11-17 20:00:00+05:30
seed_task_017	Implement backend API — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_jordan	usr_sam	HIGH	IN_PROGRESS	2026-11-23 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_018	Build frontend workflow — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_sam	usr_sam	MEDIUM	TODO	2026-12-05 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_019	Create automated test suite — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_morgan	usr_sam	MEDIUM	TODO	2026-12-09 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_020	Perform integration testing — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_alex	usr_sam	HIGH	TODO	2026-12-13 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_021	Prepare deployment runbook — Cloud Infrastructure Migration	Work item for Cloud Infrastructure Migration	seed_proj_03	usr_rakesh	usr_sam	LOW	TODO	2026-12-17 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_022	Define project requirements — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_alex	usr_morgan	HIGH	TODO	2026-10-14 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_023	Finalize technical architecture — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_rakesh	usr_morgan	HIGH	IN_PROGRESS	2026-11-18 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_024	Set up development environment — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_jordan	usr_morgan	MEDIUM	COMPLETED	2026-11-22 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-11-20 20:00:00+05:30
seed_task_025	Implement backend API — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_sam	usr_morgan	HIGH	IN_PROGRESS	2026-12-26 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_026	Build frontend workflow — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_morgan	usr_morgan	MEDIUM	TODO	2026-12-08 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_027	Create automated test suite — Payment Reconciliation System	Work item for Payment Reconciliation System	seed_proj_04	usr_alex	usr_morgan	MEDIUM	TODO	2026-12-12 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_028	Define project requirements — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_rakesh	usr_alex	HIGH	TODO	2026-11-17 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_029	Finalize technical architecture — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_jordan	usr_alex	HIGH	IN_PROGRESS	2026-11-21 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_030	Set up development environment — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_sam	usr_alex	MEDIUM	COMPLETED	2026-12-25 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-23 20:00:00+05:30
seed_task_031	Implement backend API — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_morgan	usr_alex	HIGH	IN_PROGRESS	2026-12-07 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_032	Build frontend workflow — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_alex	usr_alex	MEDIUM	TODO	2026-12-11 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_033	Create automated test suite — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_rakesh	usr_alex	MEDIUM	TODO	2026-12-15 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_034	Perform integration testing — Employee Analytics Portal	Work item for Employee Analytics Portal	seed_proj_05	usr_jordan	usr_alex	HIGH	TODO	2026-12-19 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_035	Define project requirements — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_jordan	usr_rakesh	HIGH	TODO	2026-11-20 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_036	Finalize technical architecture — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_sam	usr_rakesh	HIGH	IN_PROGRESS	2026-12-24 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_037	Set up development environment — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_morgan	usr_rakesh	MEDIUM	COMPLETED	2026-12-06 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-04 20:00:00+05:30
seed_task_038	Implement backend API — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_alex	usr_rakesh	HIGH	IN_PROGRESS	2026-12-10 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_039	Build frontend workflow — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_rakesh	usr_rakesh	MEDIUM	TODO	2026-12-14 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_040	Create automated test suite — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_jordan	usr_rakesh	MEDIUM	TODO	2026-12-18 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_041	Perform integration testing — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_sam	usr_rakesh	HIGH	TODO	2026-12-22 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_042	Prepare deployment runbook — Document Processing Pipeline	Work item for Document Processing Pipeline	seed_proj_06	usr_morgan	usr_rakesh	LOW	TODO	2026-12-26 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_043	Define project requirements — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_sam	usr_jordan	HIGH	TODO	2026-12-23 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_044	Finalize technical architecture — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_morgan	usr_jordan	HIGH	IN_PROGRESS	2026-12-05 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_045	Set up development environment — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_alex	usr_jordan	MEDIUM	COMPLETED	2026-12-09 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-07 20:00:00+05:30
seed_task_046	Implement backend API — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_rakesh	usr_jordan	HIGH	IN_PROGRESS	2026-12-13 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_047	Build frontend workflow — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_jordan	usr_jordan	MEDIUM	TODO	2026-12-17 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_048	Create automated test suite — Customer Support Automation	Work item for Customer Support Automation	seed_proj_07	usr_sam	usr_jordan	MEDIUM	TODO	2026-12-21 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_049	Define project requirements — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_morgan	usr_sam	HIGH	TODO	2026-12-26 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_050	Finalize technical architecture — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_alex	usr_sam	HIGH	IN_PROGRESS	2026-12-08 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_051	Set up development environment — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_rakesh	usr_sam	MEDIUM	COMPLETED	2026-12-12 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-10 20:00:00+05:30
seed_task_052	Implement backend API — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_jordan	usr_sam	HIGH	IN_PROGRESS	2026-12-16 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_053	Build frontend workflow — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_sam	usr_sam	MEDIUM	TODO	2026-12-20 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_054	Create automated test suite — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_morgan	usr_sam	MEDIUM	TODO	2026-12-24 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_055	Perform integration testing — Security Compliance Upgrade	Work item for Security Compliance Upgrade	seed_proj_08	usr_alex	usr_sam	HIGH	TODO	2026-12-06 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_056	Define project requirements — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_alex	usr_morgan	HIGH	TODO	2026-12-07 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_057	Finalize technical architecture — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_rakesh	usr_morgan	HIGH	IN_PROGRESS	2026-12-11 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_058	Set up development environment — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_jordan	usr_morgan	MEDIUM	COMPLETED	2026-12-15 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-13 20:00:00+05:30
seed_task_059	Implement backend API — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_sam	usr_morgan	HIGH	IN_PROGRESS	2026-12-19 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_060	Build frontend workflow — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_morgan	usr_morgan	MEDIUM	TODO	2026-12-23 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_061	Create automated test suite — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_alex	usr_morgan	MEDIUM	TODO	2026-12-05 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_062	Perform integration testing — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_rakesh	usr_morgan	HIGH	TODO	2026-12-09 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_063	Prepare deployment runbook — Data Warehouse Modernization	Work item for Data Warehouse Modernization	seed_proj_09	usr_jordan	usr_morgan	LOW	TODO	2026-12-13 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_064	Define project requirements — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_rakesh	usr_alex	HIGH	TODO	2026-12-10 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_065	Finalize technical architecture — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_jordan	usr_alex	HIGH	IN_PROGRESS	2026-12-14 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_066	Set up development environment — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_sam	usr_alex	MEDIUM	COMPLETED	2026-12-18 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	2026-12-16 20:00:00+05:30
seed_task_067	Implement backend API — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_morgan	usr_alex	HIGH	IN_PROGRESS	2026-12-22 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_068	Build frontend workflow — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_alex	usr_alex	MEDIUM	TODO	2026-12-26 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
seed_task_069	Create automated test suite — Mobile Workforce Application	Work item for Mobile Workforce Application	seed_proj_10	usr_rakesh	usr_alex	MEDIUM	TODO	2026-12-08 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-03 14:30:00+05:30	\N
task_117cb414	Review the project		proj_platform	43598547-fe65-4ccd-a93f-a44345331a45	388e5b99-06f1-4605-a88e-998d2f90d317	MEDIUM	TODO	2026-10-05 00:00:00+05:30	2026-10-05 15:44:00.960108+05:30	2026-10-05 15:44:00.960108+05:30	\N
seed_task_001	Define project requirements — Customer Intelligence Platform		seed_proj_01	usr_jordan	usr_rakesh	MEDIUM	COMPLETED	2026-09-05 05:30:00+05:30	2026-09-01 14:30:00+05:30	2026-10-05 15:46:24.686546+05:30	2026-10-05 15:46:24.686546+05:30
\.


--
-- Data for Name: user_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_settings (user_id, theme, notify_task_assignments, notify_project_updates, notify_upcoming_meetings, notify_deadline_reminders, updated_at) FROM stdin;
usr_rakesh	light	t	t	t	t	2026-10-01 17:10:19.659+05:30
388e5b99-06f1-4605-a88e-998d2f90d317	light	t	t	t	t	2026-10-05 15:47:17.432361+05:30
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, email, password_hash, auth_provider, google_id, profile_image, role, department, status, created_at, updated_at) FROM stdin;
de29f529-4b51-4ee3-ac5d-cb8b73d46538	API Check User	api-check-5391121556b74dd0a42a5b103274603a@example.test	$2b$12$WH1VXfv.CizEI3nE6l3vq.2RL8Kc9j0KNJQixj6S6zrbpKX8.N0nK	local	\N	\N	Member	Engineering	Active	2026-10-01 10:51:49.016+05:30	2026-10-01 10:51:50.016+05:30
7121465f-c11c-4da2-a03b-394b17635ed2	Taylor Enterprise	taylor-1790832647078@example.test	$2b$12$n8Pl16nkzogyaccMzNeOVuWETO9ulUMDzNUydIRLKmpHoh0o9W.bm	local	\N	\N	Member	Engineering	Active	2026-10-01 11:00:47.306+05:30	2026-10-01 11:00:47.306+05:30
57fd27ab-5170-4fe8-8853-4741ea78f886	Session Test	session-check-af03dc3054dd4578bb54515b90cbb489@example.test	$2b$12$9qGsJkXzhK4oT8RVkGzQOOThqCbj5P4SifaF70VgNmamPV3zvZM6G	local	\N	\N	Member	Engineering	Active	2026-10-01 11:02:33.738+05:30	2026-10-01 11:02:35.338+05:30
fc35d9a2-824b-4572-af2b-0809d4299415	Recovery Flow User	flow-1790832766751@example.test	$2b$12$VzguzZVGGxcPLwge4Wybz.fQFfcv..Tr6twEPckiXHnk06Y3zZ4Jm	local	\N	\N	Member	Engineering	Active	2026-10-01 11:04:32.041+05:30	2026-10-01 11:05:08.237+05:30
aed656d9-97c3-44ef-8d18-58106df9ad95	Rakesh	rakesh.b@mce.edu.in	$2b$12$lfGEixLpYODlhI0KdPEJvuQNn3m0Via.OxF95qCoEHg3dfBdF9NGa	local	\N	\N	Member	Engineering	Active	2026-10-01 11:18:46.006+05:30	2026-10-01 11:20:40.299+05:30
43598547-fe65-4ccd-a93f-a44345331a45	rak rakesh	rakgamer2k6@gmail.com	\N	google	110498704330814826909	https://lh3.googleusercontent.com/a/ACg8ocKNRYfou7Qb3GiFK_Jf-4VTd8Ve_ukIISjC5CKfzn8EQjN7HHs=s96-c	Member	Engineering	Active	2026-10-01 11:58:58.467+05:30	2026-10-01 11:58:58.467+05:30
388e5b99-06f1-4605-a88e-998d2f90d317	Rakesh	rakesh.b@northstarai.com	$2b$12$SO9CXUr9OHrPUbr1c87Kg.HGaiw5h5N8PIkXHe3idqrqHvrL6S37u	local	\N	\N	Member	Engineering	Active	2026-10-01 12:17:35.407+05:30	2026-10-01 12:17:35.407+05:30
usr_rakesh	Rak	rakesh@northstarai.com	$2b$12$6FfE8pHUxvzNffpiwOj7nO3/lWPtiGZddDDj/xNPX6G48jYVLp.G2	local	\N	\N	Product Lead	Development	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 17:10:19.659+05:30
usr_jordan	Jordan Lee	jordan.lee@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	Design Lead	Design	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_sam	Sam Kim	sam.kim@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	Senior Engineer	Engineering	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_morgan	Morgan Reed	morgan.reed@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	Product Manager	Product	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_alex	Alex Morgan	alex.morgan@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	Brand Strategist	Marketing	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_taylor	Taylor Swift	taylor.swift@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	Frontend Dev	Engineering	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_chris	Chris Evans	chris.evans@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	QA Lead	Quality	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_maya	Maya Lin	maya.lin@northstarai.com	$2b$10$38YStKkRiUOtbMEvk1xiC.XBLC97HgPysQ.zZVQXBOg1TtH.2jeR6	local	\N	\N	UX Researcher	Design	Active	2026-10-01 15:32:55.535+05:30	2026-10-01 15:32:55.535+05:30
usr_2aef322a	rak	rakesh.c@northstarai.com	$2b$10$GuKOV094gsNogi7BgloOyeskgWdkCQ8zO4vsf54VBEmA7Ot8EuaVq	local	\N	\N	Member	Engineering	Active	2026-10-01 16:21:34.121+05:30	2026-10-01 16:21:34.121+05:30
b10ffeab-840f-430a-88e9-50743c48ef13	John	john@northstarai.com	$2b$12$dg9LItmkF1bJXn.EPSNhguxKMdYT2h/WO26pkYO7hvzdSuGFMec86	local	\N	\N	Member	Engineering	Active	2026-10-01 16:50:38.274+05:30	2026-10-01 16:50:38.274+05:30
\.


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, user_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activities_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_user_idx ON public.activities USING btree (user_id);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id);


--
-- Name: password_reset_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_user_idx ON public.password_reset_tokens USING btree (user_id);


--
-- Name: project_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_members_user_idx ON public.project_members USING btree (user_id);


--
-- Name: session_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_user_idx ON public.sessions USING btree (user_id);


--
-- Name: tasks_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assigned_idx ON public.tasks USING btree (assigned_to);


--
-- Name: tasks_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_project_idx ON public.tasks USING btree (project_id);


--
-- Name: users_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_lower_idx ON public.users USING btree (lower(email));


--
-- Name: v_project_summary _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_project_summary AS
 SELECT p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name AS creator_name,
    count(t.id) AS total_tasks,
    count(t.id) FILTER (WHERE (t.status = 'COMPLETED'::text)) AS completed_tasks,
        CASE
            WHEN (count(t.id) = 0) THEN (0)::numeric
            ELSE round(((100.0 * (count(t.id) FILTER (WHERE (t.status = 'COMPLETED'::text)))::numeric) / (count(t.id))::numeric))
        END AS progress
   FROM ((public.projects p
     JOIN public.users u ON ((p.created_by = u.id)))
     LEFT JOIN public.tasks t ON ((t.project_id = p.id)))
  GROUP BY p.id, u.name;


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: documents documents_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict KjgtHo7WmzvnHRnddpEblad2xxevezGzblXYdbMpAN5tQ5bX7GQFlPPZfkUfDr8

