USE Northstar;
GO

CREATE OR ALTER VIEW dbo.v_project_summary
AS
SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name AS creator_name,
    COUNT(t.id) AS total_tasks,
    SUM(CASE WHEN t.status = N'COMPLETED' THEN 1 ELSE 0 END) AS completed_tasks,
    CASE
        WHEN COUNT(t.id) = 0 THEN 0
        ELSE ROUND(
            100.0 *
            SUM(CASE WHEN t.status = N'COMPLETED' THEN 1 ELSE 0 END)
            / COUNT(t.id),
            0
        )
    END AS progress
FROM dbo.projects AS p
INNER JOIN dbo.users AS u
    ON p.created_by = u.id
LEFT JOIN dbo.tasks AS t
    ON t.project_id = p.id
GROUP BY
    p.id,
    p.name,
    p.description,
    p.status,
    p.start_date,
    p.due_date,
    u.name;
GO
