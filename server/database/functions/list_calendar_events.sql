CREATE OR ALTER FUNCTION dbo.list_calendar_events
(
    @p_limit INT = 100,
    @p_offset INT = 0
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            e.id,
            e.title,
            e.description,
            e.start_time,
            e.end_time,
            e.event_type,
            e.project_id,
            p.name AS project_name,
            u.name AS creator_name
        FROM calendar_events e
        LEFT JOIN projects p
            ON e.project_id = p.id
        LEFT JOIN users u
            ON e.created_by = u.id
        ORDER BY e.start_time ASC
        OFFSET @p_offset ROWS
        FETCH NEXT @p_limit ROWS ONLY
        FOR JSON PATH
    );
END;
GO