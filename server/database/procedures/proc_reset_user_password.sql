USE Northstar;
GO

CREATE OR ALTER PROCEDURE dbo.proc_reset_user_password
    @p_token_hash        NVARCHAR(MAX),
    @p_new_password_hash NVARCHAR(MAX),
    @p_now_ms            BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @v_user_id NVARCHAR(MAX);

    UPDATE dbo.password_reset_tokens
    SET used_at = @p_now_ms
    WHERE token_hash = @p_token_hash
      AND used_at IS NULL
      AND expires_at > @p_now_ms;

    IF @@ROWCOUNT = 0
    BEGIN
        THROW 50002, 'RESET_TOKEN_INVALID', 1;
    END;

    SELECT @v_user_id = user_id
    FROM dbo.password_reset_tokens
    WHERE token_hash = @p_token_hash;

    UPDATE dbo.users
    SET
        password_hash = @p_new_password_hash,
        auth_provider = N'local',
        updated_at = SYSDATETIME()
    WHERE id = @v_user_id;

    DELETE FROM dbo.password_reset_tokens
    WHERE user_id = @v_user_id
      AND token_hash <> @p_token_hash;

    DELETE FROM dbo.sessions
    WHERE user_id = @v_user_id;
END;
GO
