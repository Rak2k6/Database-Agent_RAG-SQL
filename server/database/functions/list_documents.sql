CREATE OR ALTER FUNCTION dbo.list_documents
(
    @p_search NVARCHAR(MAX) = NULL,
    @p_limit INT = 100,
    @p_offset INT = 0
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    RETURN
    (
        SELECT
            d.id,
            d.name,
            d.file_name,
            d.file_type,
            d.file_size,
            d.folder,
            p.name AS project_name,
            u.name AS uploader_name,
            d.created_at
        FROM documents d
        LEFT JOIN projects p
            ON d.project_id = p.id
        LEFT JOIN users u
            ON d.uploaded_by = u.id
        WHERE
            @p_search IS NULL
            OR LOWER(d.name) LIKE N'%' + LOWER(@p_search) + N'%'
            OR LOWER(d.file_name) LIKE N'%' + LOWER(@p_search) + N'%'
        ORDER BY d.created_at DESC
        OFFSET @p_offset ROWS
        FETCH NEXT @p_limit ROWS ONLY
        FOR JSON PATH
    );
END;
GO