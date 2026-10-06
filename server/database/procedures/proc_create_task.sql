USE Northstar;
GO

CREATE OR ALTER PROCEDURE dbo.proc_create_task
(
    @p_title        NVARCHAR(255),
    @p_description  NVARCHAR(MAX) = NULL,
    @p_status       NVARCHAR(100) = N'TODO',
    @p_priority     NVARCHAR(100) = N'MEDIUM',
    @p_due_date     DATETIME2(6) = NULL,
    @p_project_id   NVARCHAR(255),
    @p_assigned_to  NVARCHAR(255) = NULL,
    @p_created_by   NVARCHAR(255),
    @p_id           NVARCHAR(255) OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @v_project_name NVARCHAR(255);

    SELECT @v_project_name = name
    FROM dbo.projects
    WHERE id = @p_project_id;

    IF @v_project_name IS NULL
        THROW 50001, 'Project not found.', 1;

    SET @p_id =
        N'task_' +
        LEFT(
            CONVERT(
                VARCHAR(32),
                HASHBYTES(
                    'MD5',
                    CAST(NEWID() AS NVARCHAR(36)) +
                    CONVERT(NVARCHAR(30), SYSDATETIME())
                ),
                2
            ),
            9
        );

    DECLARE @v_completed_at DATETIME2(6) = NULL;

    IF @p_status = N'COMPLETED'
        SET @v_completed_at = SYSDATETIME();

    INSERT INTO dbo.tasks
    (
        id,
        title,
        description,
        status,
        priority,
        due_date,
        project_id,
        assigned_to,
        created_by,
        completed_at
    )
    VALUES
    (
        @p_id,
        @p_title,
        @p_description,
        @p_status,
        @p_priority,
        @p_due_date,
        @p_project_id,
        @p_assigned_to,
        @p_created_by,
        @v_completed_at
    );

    DECLARE @v_activity_id NVARCHAR(255);

    EXEC dbo.proc_log_activity
        @p_user_id     = @p_created_by,
        @p_action      = N'created a new task',
        @p_entity_type = N'task',
        @p_entity_id   = @p_id,
        @p_subject     = @p_title,
        @p_id          = @v_activity_id OUTPUT;

    DECLARE @v_notification_id NVARCHAR(255);
    DECLARE @v_notification_message NVARCHAR(MAX);

    IF @p_assigned_to IS NOT NULL
    BEGIN
        SET @v_notification_message =
            N'You have been assigned the task "' +
            @p_title +
            N'" in project "' +
            @v_project_name +
            N'".';

        EXEC dbo.proc_create_notification
            @p_user_id  = @p_assigned_to,
            @p_title    = N'New Task Assigned',
            @p_message  = @v_notification_message,
            @p_type     = N'task',
            @p_id       = @v_notification_id OUTPUT;
    END;
END;
GO
