CREATE OR ALTER FUNCTION dbo.list_team_members
(
    @p_search NVARCHAR(MAX) = NULL,
    @p_department NVARCHAR(MAX) = NULL,
    @p_limit INT = 100,
    @p_offset INT = 0
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            u.id,
            u.name,
            u.email,
            u.role,
            u.department,
            u.status,
            u.profile_image,

            (
                SELECT COUNT(*)
                FROM tasks t
                WHERE t.assigned_to = u.id
            ) AS assigned_tasks_count,

            (
                SELECT COUNT(*)
                FROM tasks t
                WHERE t.assigned_to = u.id
                  AND t.status = 'COMPLETED'
            ) AS completed_tasks_count

        FROM users u

        WHERE
            (
                @p_search IS NULL
                OR LOWER(u.name) LIKE N'%' + LOWER(@p_search) + N'%'
                OR LOWER(u.email) LIKE N'%' + LOWER(@p_search) + N'%'
            )
            AND
            (
                @p_department IS NULL
                OR LOWER(u.department) = LOWER(@p_department)
            )

        ORDER BY u.name

        OFFSET @p_offset ROWS
        FETCH NEXT @p_limit ROWS ONLY

        FOR JSON PATH
    );
END;
GO