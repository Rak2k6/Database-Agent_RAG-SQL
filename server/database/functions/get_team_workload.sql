CREATE OR ALTER FUNCTION dbo.get_team_workload()
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            u.id,
            u.name,
            u.role,
            u.department,
            COUNT(t.id) AS assigned_tasks,
            SUM(
                CASE
                    WHEN t.status = 'COMPLETED' THEN 1
                    ELSE 0
                END
            ) AS completed_tasks
        FROM users u
        LEFT JOIN tasks t
            ON t.assigned_to = u.id
        GROUP BY
            u.id,
            u.name,
            u.role,
            u.department
        ORDER BY
            COUNT(t.id) DESC
        FOR JSON PATH
    );
END;
GO