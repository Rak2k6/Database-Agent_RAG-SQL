USE Northstar;
GO

CREATE OR ALTER VIEW dbo.v_recent_activities
AS
SELECT
    a.id,
    a.user_id,
    u.name AS person_name,
    u.profile_image,
    a.action,
    a.entity_type,
    a.entity_id,
    a.subject,
    a.created_at
FROM dbo.activities AS a
INNER JOIN dbo.users AS u
    ON a.user_id = u.id;
GO
