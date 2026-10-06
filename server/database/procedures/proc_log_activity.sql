CREATE OR ALTER PROCEDURE dbo.proc_log_activity
(
    @p_user_id     NVARCHAR(255),
    @p_action      NVARCHAR(255),
    @p_entity_type NVARCHAR(100),
    @p_entity_id   NVARCHAR(255),
    @p_subject     NVARCHAR(255),
    @p_id          NVARCHAR(255) OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;

    SET @p_id =
        N'act_' +
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

    INSERT INTO dbo.activities
    (
        id,
        user_id,
        action,
        entity_type,
        entity_id,
        subject,
        created_at
    )
    VALUES
    (
        @p_id,
        @p_user_id,
        @p_action,
        @p_entity_type,
        @p_entity_id,
        @p_subject,
        SYSDATETIME()
    );
END;
GO
