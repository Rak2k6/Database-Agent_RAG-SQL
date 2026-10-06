USE Northstar;
GO

CREATE OR ALTER PROCEDURE dbo.proc_update_project
    @p_project_id  NVARCHAR(MAX),
    @p_user_id     NVARCHAR(MAX),
    @p_name        NVARCHAR(MAX) = NULL,
    @p_description NVARCHAR(MAX) = NULL,
    @p_status      NVARCHAR(MAX) = NULL,
    @p_start_date  DATETIME2 = NULL,
    @p_due_date    DATETIME2 = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @v_existing_name NVARCHAR(MAX);
    DECLARE @v_effective_name NVARCHAR(MAX);

    SELECT @v_existing_name = name
    FROM dbo.projects
    WHERE id = @p_project_id;

    IF @v_existing_name IS NULL
    BEGIN
        THROW 50003, 'NOT_FOUND: project does not exist', 1;
    END;

    UPDATE dbo.projects
    SET
        name = COALESCE(@p_name, name),
        description = COALESCE(@p_description, description),
        status = COALESCE(@p_status, status),
        start_date = COALESCE(@p_start_date, start_date),
        due_date = COALESCE(@p_due_date, due_date),
        updated_at = SYSDATETIME()
    WHERE id = @p_project_id;

    SET @v_effective_name = COALESCE(@p_name, @v_existing_name);

    DECLARE @v_activity_id NVARCHAR(MAX);

    EXEC dbo.proc_log_activity
        @p_user_id     = @p_user_id,
        @p_action      = N'updated project',
        @p_entity_type = N'project',
        @p_entity_id   = @p_project_id,
        @p_subject     = @v_effective_name,
        @p_id          = @v_activity_id OUTPUT;
END;
GO
