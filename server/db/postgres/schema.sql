CREATE DATABASE Northstar;
GO

USE Northstar;
GO

CREATE TABLE users (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NOT NULL,
    password_hash NVARCHAR(MAX),
    auth_provider NVARCHAR(50) NOT NULL,
    google_id NVARCHAR(255) UNIQUE,
    profile_image NVARCHAR(MAX),
    role NVARCHAR(100) NOT NULL DEFAULT N'Member',
    department NVARCHAR(100) NOT NULL DEFAULT N'Engineering',
    status NVARCHAR(50) NOT NULL DEFAULT N'Active',
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL,

    CONSTRAINT users_auth_provider_chk
        CHECK (auth_provider IN (N'local', N'google'))
);
GO

CREATE UNIQUE INDEX users_email_lower_idx
ON users (email);
GO


CREATE TABLE password_reset_tokens (
    token_hash NVARCHAR(255) PRIMARY KEY,
    user_id NVARCHAR(255) NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT,

    CONSTRAINT password_reset_tokens_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE sessions (
    token_hash NVARCHAR(255) PRIMARY KEY,
    user_id NVARCHAR(255) NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,

    CONSTRAINT sessions_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE projects (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NOT NULL DEFAULT N'',
    status NVARCHAR(50) NOT NULL,
    start_date DATETIME2 NOT NULL,
    due_date DATETIME2 NOT NULL,
    created_by NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL,

    CONSTRAINT projects_status_chk
        CHECK (
            status IN (
                N'PLANNED',
                N'ACTIVE',
                N'ON_HOLD',
                N'COMPLETED',
                N'ARCHIVED'
            )
        ),

    CONSTRAINT projects_created_by_fk
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE project_members (
    project_id NVARCHAR(255) NOT NULL,
    user_id NVARCHAR(255) NOT NULL,
    role NVARCHAR(100) NOT NULL DEFAULT N'Member',

    CONSTRAINT project_members_pk
        PRIMARY KEY (project_id, user_id),

    CONSTRAINT project_members_project_fk
        FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT project_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE tasks (
    id NVARCHAR(255) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NOT NULL DEFAULT N'',
    project_id NVARCHAR(255) NOT NULL,
    assigned_to NVARCHAR(255),
    created_by NVARCHAR(255) NOT NULL,
    priority NVARCHAR(50) NOT NULL,
    status NVARCHAR(50) NOT NULL,
    due_date DATETIME2 NOT NULL,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL,
    completed_at DATETIME2,

    CONSTRAINT tasks_priority_chk
        CHECK (
            priority IN (
                N'HIGH',
                N'MEDIUM',
                N'LOW'
            )
        ),

    CONSTRAINT tasks_status_chk
        CHECK (
            status IN (
                N'TODO',
                N'IN_PROGRESS',
                N'COMPLETED',
                N'CANCELLED'
            )
        ),

    CONSTRAINT tasks_project_fk
        FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT tasks_assigned_to_fk
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT tasks_created_by_fk
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE calendar_events (
    id NVARCHAR(255) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NOT NULL DEFAULT N'',
    start_time DATETIME2 NOT NULL,
    end_time DATETIME2 NOT NULL,
    event_type NVARCHAR(50) NOT NULL,
    created_by NVARCHAR(255) NOT NULL,
    project_id NVARCHAR(255),
    created_at DATETIME2 NOT NULL,

    CONSTRAINT calendar_events_type_chk
        CHECK (
            event_type IN (
                N'MEETING',
                N'EVENT',
                N'DEADLINE',
                N'REMINDER'
            )
        ),

    CONSTRAINT calendar_events_created_by_fk
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT calendar_events_project_fk
        FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE SET NULL
);
GO


CREATE TABLE documents (
    id NVARCHAR(255) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(MAX) NOT NULL,
    file_type NVARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_by NVARCHAR(255) NOT NULL,
    project_id NVARCHAR(255),
    folder NVARCHAR(255) NOT NULL DEFAULT N'General',
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL,

    CONSTRAINT documents_uploaded_by_fk
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT documents_project_fk
        FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE SET NULL
);
GO


CREATE TABLE activities (
    id NVARCHAR(255) PRIMARY KEY,
    user_id NVARCHAR(255) NOT NULL,
    action NVARCHAR(255) NOT NULL,
    entity_type NVARCHAR(100) NOT NULL,
    entity_id NVARCHAR(255),
    subject NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL,

    CONSTRAINT activities_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE notifications (
    id NVARCHAR(255) PRIMARY KEY,
    user_id NVARCHAR(255) NOT NULL,
    title NVARCHAR(255) NOT NULL,
    message NVARCHAR(MAX) NOT NULL,
    type NVARCHAR(100) NOT NULL DEFAULT N'info',
    is_read BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL,

    CONSTRAINT notifications_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO


CREATE TABLE user_settings (
    user_id NVARCHAR(255) PRIMARY KEY,
    theme NVARCHAR(50) NOT NULL DEFAULT N'light',
    notify_task_assignments BIT NOT NULL DEFAULT 1,
    notify_project_updates BIT NOT NULL DEFAULT 1,
    notify_upcoming_meetings BIT NOT NULL DEFAULT 1,
    notify_deadline_reminders BIT NOT NULL DEFAULT 1,
    updated_at DATETIME2 NOT NULL,

    CONSTRAINT user_settings_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
GO

create table dbo.document_chunks(
id UNIQUEIDENTIFIER NOT NULL
CONSTRAINT DF_dchunk_id DEFAULT NEWID(),
document_id nvarchar(255) not null,
doc_ver nvarchar(64) not null,
chunk_index int not null,
vector_id uniqueidentifier not null,
chunk_hash char(64) not null,
status nvarchar(20) not null constraint df_dchunks_status default 'pending',
error_message nvarchar(2000) null,
created_at datetime2 not null constraint df_dchunks_created_at default sysdatetime(),
updated_at datetime2 not null constraint df_dchunks_updated_at default sysdatetime(),
constraint doc_chunk primary key(id),
constraint fk_documents foreign key(document_id) references dbo.documents(id),
constraint dchunks_vector_id unique(vector_id),
constraint dchunks_document_version_index unique(document_id,doc_ver,chunk_index),
constraint dchunks_chunk_index check (chunk_index >=0),
constraint document_chunk_status check(status in('pending','processing','indexed','failed'))
);

go

create index IX_document_chunks_document_status on dbo.document_chunks(document_id,status);
go


CREATE INDEX password_reset_user_idx
ON password_reset_tokens(user_id);
GO

CREATE INDEX session_user_idx
ON sessions(user_id);
GO

CREATE INDEX tasks_project_idx
ON tasks(project_id);
GO

CREATE INDEX tasks_assigned_idx
ON tasks(assigned_to);
GO

CREATE INDEX project_members_user_idx
ON project_members(user_id);
GO

CREATE INDEX activities_user_idx
ON activities(user_id);
GO

CREATE INDEX notifications_user_idx
ON notifications(user_id);
GO


SELECT
    TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_CATALOG = 'Northstar'
  AND TABLE_SCHEMA = 'dbo'
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
GO


SELECT
    t.name AS table_name,
    SUM(p.rows) AS row_count
FROM sys.tables t
INNER JOIN sys.partitions p
    ON t.object_id = p.object_id
WHERE p.index_id IN (0, 1)
GROUP BY t.name
ORDER BY t.name;
GO