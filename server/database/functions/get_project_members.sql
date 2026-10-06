CREATE OR ALTER FUNCTION dbo.get_project_members
(
    @p_project_id NVARCHAR(MAX)
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            u.id AS user_id,
            u.name AS user_name,
            u.profile_image,
            pm.role AS member_role
        FROM project_members pm
        INNER JOIN users u
            ON pm.user_id = u.id
        WHERE pm.project_id = @p_project_id
        ORDER BY
            CASE pm.role
                WHEN 'Owner' THEN 1
                WHEN 'Manager' THEN 2
                ELSE 3
            END,
            u.name
        FOR JSON PATH
    );
END;
GO