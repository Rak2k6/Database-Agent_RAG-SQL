CREATE OR ALTER FUNCTION dbo.list_projects
(
    @p_search NVARCHAR(MAX) = NULL,
    @p_status NVARCHAR(MAX) = NULL,
    @p_limit INT = 100,
    @p_offset INT = 0
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            p.id,
            p.name,
            p.description,
            p.status,
            p.start_date,
            p.due_date,
            u.name AS creator_name,
            COUNT(t.id) AS total_tasks,
            SUM(
                CASE
                    WHEN t.status = 'COMPLETED' THEN 1
                    ELSE 0
                END
            ) AS completed_tasks,
            CASE
                WHEN COUNT(t.id) = 0 THEN 0
                ELSE CAST(
                    ROUND(
                        100.0 *
                        SUM(
                            CASE
                                WHEN t.status = 'COMPLETED' THEN 1
                                ELSE 0
                            END
                        ) / COUNT(t.id),
                        0
                    ) AS INT
                )
            END AS progress
        FROM projects p
        INNER JOIN users u
            ON p.created_by = u.id
        LEFT JOIN tasks t
            ON t.project_id = p.id
        WHERE
            (
                @p_search IS NULL
                OR LOWER(p.name) LIKE N'%' + LOWER(@p_search) + N'%'
                OR LOWER(p.description) LIKE N'%' + LOWER(@p_search) + N'%'
            )
            AND
            (
                @p_status IS NULL
                OR p.status = @p_status
            )
        GROUP BY
            p.id,
            p.name,
            p.description,
            p.status,
            p.start_date,
            p.due_date,
            u.name,
            p.created_at
        ORDER BY p.created_at DESC
        OFFSET @p_offset ROWS
        FETCH NEXT @p_limit ROWS ONLY
        FOR JSON PATH
    );
END;
GO