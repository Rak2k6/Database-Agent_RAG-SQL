CREATE OR ALTER FUNCTION dbo.get_dashboard_data
(
    @p_user_id NVARCHAR(MAX)
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @v_metrics NVARCHAR(MAX);
    DECLARE @v_top_tasks NVARCHAR(MAX);
    DECLARE @v_active_projects NVARCHAR(MAX);
    DECLARE @v_schedule NVARCHAR(MAX);
    DECLARE @v_activity NVARCHAR(MAX);
    DECLARE @v_notifications NVARCHAR(MAX);

    -- 1. Aggregate metrics
    SELECT @v_metrics = (
        SELECT
            COUNT(*) AS totalTasks,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedTasks,
            SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS inProgressTasks,
            (SELECT COUNT(*) FROM projects) AS totalProjects,
            (SELECT COUNT(*) FROM projects WHERE status = 'ACTIVE') AS activeProjects,
            (SELECT COUNT(*) FROM users) AS teamMembers,
            (
                SELECT COUNT(*)
                FROM calendar_events
                WHERE start_time >= GETDATE()
                  AND start_time <= DATEADD(DAY, 7, GETDATE())
            ) AS upcomingEvents
        FROM tasks
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    );

    -- 2. Top tasks
    SELECT @v_top_tasks = (
        SELECT TOP 5
            t.id,
            t.title,
            t.status,
            t.priority,
            t.due_date,
            p.name AS project_name,
            u.name AS assigned_to_name,
            u.profile_image AS assigned_to_image,
            CAST(
                CASE
                    WHEN t.status <> 'COMPLETED'
                         AND t.due_date IS NOT NULL
                         AND t.due_date < GETDATE()
                    THEN 1
                    ELSE 0
                END AS BIT
            ) AS is_overdue
        FROM tasks t
        INNER JOIN projects p
            ON t.project_id = p.id
        LEFT JOIN users u
            ON t.assigned_to = u.id
        WHERE t.status <> 'COMPLETED'
        ORDER BY
            CASE t.priority
                WHEN 'HIGH' THEN 1
                WHEN 'MEDIUM' THEN 2
                ELSE 3
            END,
            CASE
                WHEN t.due_date IS NULL THEN 1
                ELSE 0
            END,
            t.due_date ASC
        FOR JSON PATH
    );

    -- 3. Active projects with member avatars
    SELECT @v_active_projects = (
        SELECT TOP 6
            p.id,
            p.name,
            p.status,
            p.due_date,
            CASE
                WHEN COUNT(t.id) = 0 THEN 0
                ELSE CAST(
                    ROUND(
                        100.0 *
                        SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END)
                        / COUNT(t.id),
                        0
                    ) AS INT
                )
            END AS progress,
            COUNT(t.id) AS total_tasks,
            SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_tasks,

            JSON_QUERY(
                (
                    SELECT TOP 4
                        u2.id,
                        u2.name,
                        u2.profile_image
                    FROM project_members pm2
                    INNER JOIN users u2
                        ON pm2.user_id = u2.id
                    WHERE pm2.project_id = p.id
                    FOR JSON PATH
                )
            ) AS members

        FROM projects p
        LEFT JOIN tasks t
            ON t.project_id = p.id
        WHERE p.status = 'ACTIVE'
        GROUP BY
            p.id,
            p.name,
            p.status,
            p.due_date,
            p.created_at
        ORDER BY p.created_at DESC
        FOR JSON PATH
    );

    -- 4. Upcoming schedule
    SELECT @v_schedule = (
        SELECT TOP 10
            e.id,
            e.title,
            e.start_time,
            e.end_time,
            e.event_type,
            p.name AS project_name
        FROM calendar_events e
        LEFT JOIN projects p
            ON e.project_id = p.id
        WHERE e.start_time >= GETDATE()
          AND e.start_time <= DATEADD(DAY, 7, GETDATE())
        ORDER BY e.start_time ASC
        FOR JSON PATH
    );

    -- 5. Recent activity
    SELECT @v_activity = (
        SELECT TOP 10
            *
        FROM v_recent_activities
        ORDER BY created_at DESC
        FOR JSON PATH
    );

    -- 6. Notifications
    SELECT @v_notifications = (
        SELECT TOP 20
            id,
            title,
            message,
            type,
            is_read,
            created_at
        FROM notifications
        WHERE user_id = @p_user_id
        ORDER BY created_at DESC
        FOR JSON PATH
    );

    -- Return complete dashboard JSON
    RETURN (
        SELECT
            JSON_QUERY(COALESCE(@v_metrics, N'{}')) AS metrics,
            JSON_QUERY(COALESCE(@v_top_tasks, N'[]')) AS topTasks,
            JSON_QUERY(COALESCE(@v_active_projects, N'[]')) AS activeProjects,
            JSON_QUERY(COALESCE(@v_schedule, N'[]')) AS schedule,
            JSON_QUERY(COALESCE(@v_activity, N'[]')) AS activity,
            JSON_QUERY(COALESCE(@v_notifications, N'[]')) AS notifications
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    );
END;
GO