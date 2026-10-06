USE Northstar;
GO

CREATE OR ALTER VIEW dbo.v_project_stats
AS
SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = N'ACTIVE' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status = N'COMPLETED' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status = N'PLANNED' THEN 1 ELSE 0 END) AS planned
FROM dbo.projects;
GO
