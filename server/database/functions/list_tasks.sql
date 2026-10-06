CREATE OR ALTER FUNCTION dbo.list_tasks
(
    @p_assigned_to NVARCHAR(MAX) = NULL,
    @p_project_id  NVARCHAR(MAX) = NULL,
    @p_status      NVARCHAR(MAX) = NULL,
    @p_priority    NVARCHAR(MAX) = NULL,
    @p_search      NVARCHAR(MAX) = NULL,
    @p_limit       INT = 100,
    @p_offset      INT = 0
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            t.id,
            t.title,
            t.description,
            t.project_id,
            p.name AS project_name,
            t.assigned_to AS assigned_to_id,
            assignee.name AS assigned_to_name,
            creator.name AS creator_name,
            t.priority,
            t.status,
            t.due_date,
            t.completed_at,
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
        LEFT JOIN users assignee
            ON t.assigned_to = assignee.id
        LEFT JOIN users creator
            ON t.created_by = creator.id
        WHERE
            (@p_assigned_to IS NULL OR t.assigned_to = @p_assigned_to)
            AND (@p_project_id IS NULL OR t.project_id = @p_project_id)
            AND (@p_status IS NULL OR t.status = @p_status)
            AND (@p_priority IS NULL OR t.priority = @p_priority)
            AND (
                @p_search IS NULL
                OR LOWER(t.title) LIKE N'%' + LOWER(@p_search) + N'%'
            )
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
        OFFSET @p_offset ROWS
        FETCH NEXT @p_limit ROWS ONLY
        FOR JSON PATH
    );
END;
GO