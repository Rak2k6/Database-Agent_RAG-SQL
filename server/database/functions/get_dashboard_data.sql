CREATE OR REPLACE FUNCTION get_dashboard_data(p_user_id TEXT)
RETURNS JSON AS $$
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
$$ LANGUAGE plpgsql STABLE;
