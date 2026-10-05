# Northstar AI — PostgreSQL Database Routines

This directory contains all PostgreSQL functions, procedures, and views for the Northstar AI Workplace application.

## Directory Structure

```
database/
├── functions/              # PostgreSQL functions (RETURNS value, called with SELECT)
│   ├── fn_log_activity.sql         ← Helper: insert activity row, return ID
│   ├── fn_create_notification.sql  ← Helper: insert notification row, return ID
│   ├── get_project_detail.sql      ← Read: project + task stats
│   ├── get_project_members.sql     ← Read: project member list
│   ├── get_team_workload.sql       ← Read: per-user task counts
│   ├── get_dashboard_data.sql      ← Read: full dashboard JSON (app-only)
│   ├── list_projects.sql           ← Read: filterable project list
│   ├── list_tasks.sql              ← Read: filterable task list
│   ├── list_calendar_events.sql    ← Read: ordered event list
│   ├── list_documents.sql          ← Read: searchable document list
│   └── list_team_members.sql       ← Read: filterable team list (with task counts)
│
├── procedures/             # PostgreSQL procedures (no return, called with CALL)
│   ├── proc_reset_user_password.sql  ← Atomic: token + password + sessions
│   ├── proc_create_project.sql       ← Atomic: project + member + activity + notification
│   ├── proc_update_project.sql       ← Atomic: project update + activity
│   ├── proc_create_task.sql          ← Atomic: task + activity + conditional notification
│   └── proc_update_task.sql          ← Atomic: task update + activity (handles completion)
│
└── views/                  # PostgreSQL views (AI-readable read models)
    ├── v_task_stats.sql        ← Aggregate task counts by status/priority
    ├── v_project_stats.sql     ← Aggregate project counts by status
    ├── v_project_summary.sql   ← Per-project progress with creator name
    └── v_recent_activities.sql ← Activity feed with user name/avatar (used by dashboard)
```

## Deployment

Run the deploy script to create/replace all routines in the correct dependency order:

```bash
npx ts-node server/scripts/deploy-db-routines.ts
```

All routines use `CREATE OR REPLACE`, so the script is safe to re-run after any change.

## Design Notes

### Transaction Semantics

- **Procedures** do not contain `COMMIT` or `ROLLBACK`. They participate in the caller's transaction.
- Called via `pool.query('CALL proc_...')` → PostgreSQL wraps in an implicit auto-commit transaction.
- Called inside an explicit `BEGIN`/`COMMIT` block → they participate in that transaction.
- Procedures signal failure via `RAISE EXCEPTION`. The caller handles rollback.

### NULL Convention (Update Procedures)

`NULL` parameters mean **"leave unchanged"**:

```sql
UPDATE tasks SET title = COALESCE(p_title, title), ...
```

Pass `null` from Node.js for any field the caller did not explicitly change.

### Helper Functions vs. Direct SQL

- `fn_log_activity` and `fn_create_notification` are **PostgreSQL functions** (not procedures).
- Inside a procedure: called with `PERFORM fn_log_activity(...)` — auto-participates in the procedure's transaction.
- Standalone from Node.js: called with `SELECT fn_log_activity(...)` — auto-commits.

### AI-Accessible Operations

The following are safe to expose to the future Northstar AI chatbot:

| View / Function | Use |
|-----------------|-----|
| `v_task_stats` | Task counts |
| `v_project_stats` | Project counts |
| `v_project_summary` | Per-project progress |
| `v_recent_activities` | Activity feed |
| `get_project_detail` | Single project detail |
| `get_project_members` | Project member list (no email) |
| `get_team_workload` | Per-user workload |
| `list_projects` | Filterable project list |
| `list_tasks` | Filterable task list |
| `list_calendar_events` | Event list |
| `list_documents` | Document list |
| `list_team_members` | Team list |

**Never AI-accessible:** `get_dashboard_data`, all procedures, all auth queries, `users.password_hash`, `sessions`, `password_reset_tokens`.
