CREATE OR ALTER PROCEDURE dbo.proc_create_notification
(
    @p_user_id  NVARCHAR(255),
    @p_title    NVARCHAR(255),
    @p_message  NVARCHAR(MAX),
    @p_type     NVARCHAR(100) = N'info',
    @p_id       NVARCHAR(255) OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;

    SET @p_id =
        N'notif_' +
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

    INSERT INTO dbo.notifications
    (
        id,
        user_id,
        title,
        message,
        type,
        is_read,
        created_at
    )
    VALUES
    (
        @p_id,
        @p_user_id,
        @p_title,
        @p_message,
        @p_type,
        0,
        SYSDATETIME()
    );
END;
GO
