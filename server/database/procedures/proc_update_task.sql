USE Northstar;
GO

CREATE OR ALTER PROCEDURE dbo.proc_update_task
    @p_task_id     NVARCHAR(MAX),
    @p_user_id     NVARCHAR(MAX),
    @p_title       NVARCHAR(MAX) = NULL,
    @p_description NVARCHAR(MAX) = NULL,
    @p_project_id  NVARCHAR(MAX) = NULL,
    @p_assigned_to NVARCHAR(MAX) = NULL,
    @p_priority    NVARCHAR(MAX) = NULL,
    @p_status      NVARCHAR(MAX) = NULL,
    @p_due_date    DATETIME2 = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @v_existing_status NVARCHAR(MAX);
    DECLARE @v_existing_title NVARCHAR(MAX);
    DECLARE @v_existing_completed_at DATETIME2;
    DECLARE @v_effective_status NVARCHAR(MAX);
    DECLARE @v_completed_at DATETIME2;
    DECLARE @v_action_text NVARCHAR(MAX);
    DECLARE @v_effective_title NVARCHAR(MAX);
    DECLARE @v_task_exists INT;

    SELECT
        @v_existing_status = status,
        @v_existing_title = title,
        @v_existing_completed_at = completed_at
    FROM dbo.tasks
    WHERE id = @p_task_id;

    SET @v_task_exists = @@ROWCOUNT;

    IF @v_task_exists = 0
    BEGIN
        THROW 50004, 'NOT_FOUND: task does not exist', 1;
    END;

    SET @v_effective_status =
        COALESCE(@p_status, @v_existing_status);

    IF @v_effective_status = N'COMPLETED'
    BEGIN
        SET @v_completed_at =
            COALESCE(@v_existing_completed_at, SYSDATETIME());
    END
    ELSE
    BEGIN
        SET @v_completed_at = NULL;
    END;

    UPDATE dbo.tasks
    SET
        title = COALESCE(@p_title, title),
        description = COALESCE(@p_description, description),
        project_id = COALESCE(@p_project_id, project_id),
        assigned_to = COALESCE(@p_assigned_to, assigned_to),
        priority = COALESCE(@p_priority, priority),
        status = @v_effective_status,
        due_date = COALESCE(@p_due_date, due_date),
        completed_at = @v_completed_at,
        updated_at = SYSDATETIME()
    WHERE id = @p_task_id;

    IF @v_effective_status = N'COMPLETED'
       AND @v_existing_status <> N'COMPLETED'
    BEGIN
        SET @v_action_text = N'completed a task in';
    END
    ELSE
    BEGIN
        SET @v_action_text = N'updated task';
    END;

    SET @v_effective_title =
        COALESCE(@p_title, @v_existing_title);

    DECLARE @v_activity_id NVARCHAR(MAX);

    EXEC dbo.proc_log_activity
        @p_user_id     = @p_user_id,
        @p_action      = @v_action_text,
        @p_entity_type = N'task',
        @p_entity_id   = @p_task_id,
        @p_subject     = @v_effective_title,
        @p_id          = @v_activity_id OUTPUT;
END;
GO
