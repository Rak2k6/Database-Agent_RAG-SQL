USE Northstar;
GO

CREATE OR ALTER PROCEDURE dbo.proc_create_project
    @p_id          NVARCHAR(MAX),
    @p_name        NVARCHAR(MAX),
    @p_creator_id  NVARCHAR(MAX),
    @p_status      NVARCHAR(MAX),
    @p_start_date  DATETIME2,
    @p_due_date    DATETIME2,
    @p_description NVARCHAR(MAX) = N''
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.projects
    (
        id,
        name,
        description,
        status,
        start_date,
        due_date,
        created_by,
        created_at,
        updated_at
    )
    VALUES
    (
        @p_id,
        @p_name,
        @p_description,
        @p_status,
        @p_start_date,
        @p_due_date,
        @p_creator_id,
        SYSDATETIME(),
        SYSDATETIME()
    );

    INSERT INTO dbo.project_members
    (
        project_id,
        user_id,
        role
    )
    VALUES
    (
        @p_id,
        @p_creator_id,
        N'Owner'
    );

    DECLARE @v_activity_id NVARCHAR(MAX);
    DECLARE @v_notification_id NVARCHAR(MAX);
    DECLARE @v_notification_message NVARCHAR(MAX);

    EXEC dbo.proc_log_activity
        @p_user_id     = @p_creator_id,
        @p_action      = N'created a new project',
        @p_entity_type = N'project',
        @p_entity_id   = @p_id,
        @p_subject     = @p_name,
        @p_id          = @v_activity_id OUTPUT;

    SET @v_notification_message =
        N'Project "' + @p_name + N'" has been created successfully.';

    EXEC dbo.proc_create_notification
        @p_user_id  = @p_creator_id,
        @p_title    = N'Project Created',
        @p_message  = @v_notification_message,
        @p_type     = N'project',
        @p_id       = @v_notification_id OUTPUT;
END;
GO
