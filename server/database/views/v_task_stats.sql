USE Northstar;
GO

CREATE OR ALTER VIEW dbo.v_task_stats
AS
SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = N'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status = N'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
    SUM(CASE WHEN status = N'TODO' THEN 1 ELSE 0 END) AS todo,
    SUM(CASE WHEN priority = N'HIGH' THEN 1 ELSE 0 END) AS high_priority
FROM dbo.tasks;
GO
