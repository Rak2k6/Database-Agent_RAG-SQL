use Northstar
go

create or alter procedure dbo.proc_create_document
(
	@id nvarchar(100),
	@name nvarchar(255),
	@file_name nvarchar(255),
	@file_path nvarchar (255),
	@file_type nvarchar(100),
	@file_size bigint,
	@uploaded_by nvarchar(100),
	@project_id  nvarchar(100),
	@folder nvarchar(100)
	)
as
begin
set nocount on;
	if exists (select 1 from documents where id = @id)
		begin 
		throw 50001,'Document already exists',1;
		end;
	
	if @project_id is not null
	and not exists(
	select 1 from projects where id= @project_id)
	begin 
	throw 50002,'Project does not exist.',1;
	end;

	if not exists(
	select 1 from users where id = @uploaded_by)
	begin
		throw 50003,'Uploader does not exist.',1;
	end;

	insert into documents(
	id,name,file_name,file_path,file_type,file_size,
	uploaded_by,project_id,folder,created_at,updated_at)
	values(
	@id,@name,@file_name,@file_path,@file_type,@file_size,
	@uploaded_by,@project_id,@folder,sysutcdatetime(),sysutcdatetime()
	);

	DECLARE @v_activity_id NVARCHAR(255);

	EXEC dbo.proc_log_activity
		@p_user_id = @uploaded_by,
		@p_action = N'uploaded a document to',
		@p_entity_type = N'document',
		@p_entity_id = @id,
		@p_subject = @name,
		@p_id = @v_activity_id OUTPUT;

	select  id,
    name,
    file_name,
    file_path,
    file_type,
    file_size,
    uploaded_by,
    project_id,
    folder,
    created_at,
    updated_at
    from documents where id=@id;
end;
go


