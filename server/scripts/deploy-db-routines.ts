import pg from 'pg';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

const { Client } = pg;

// ── Deployment order matters: helpers → views → read functions → procedures ──
const FILES: string[] = [
  // Helper functions (building blocks used by procedures)
  'functions/fn_log_activity.sql',
  'functions/fn_create_notification.sql',

  // Views (v_recent_activities is used by get_dashboard_data)
  'views/v_task_stats.sql',
  'views/v_project_stats.sql',
  'views/v_project_summary.sql',
  'views/v_recent_activities.sql',

  // Read functions
  'functions/get_project_detail.sql',
  'functions/get_project_members.sql',
  'functions/list_projects.sql',
  'functions/list_tasks.sql',
  'functions/list_calendar_events.sql',
  'functions/list_documents.sql',
  'functions/list_team_members.sql',
  'functions/get_team_workload.sql',
  'functions/get_dashboard_data.sql',

  // Procedures
  'procedures/proc_reset_user_password.sql',
  'procedures/proc_create_project.sql',
  'procedures/proc_update_project.sql',
  'procedures/proc_create_task.sql',
  'procedures/proc_update_task.sql',
];

const DB_DIR = path.resolve(__dirname, '../database');

async function deploy(): Promise<void> {
  if (!process.env.PG_URI) {
    console.error('❌  PG_URI environment variable is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.PG_URI });
  await client.connect();
  console.log('✅  Connected to PostgreSQL.\n');

  let passed = 0;
  let failed = 0;

  for (const relPath of FILES) {
    const fullPath = path.join(DB_DIR, relPath);
    const label = relPath;

    if (!fs.existsSync(fullPath)) {
      console.error(`❌  FILE NOT FOUND: ${label}`);
      failed++;
      continue;
    }

    const sql = fs.readFileSync(fullPath, 'utf-8');

    try {
      await client.query(sql);
      console.log(`✅  ${label}`);
      passed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌  ${label}`);
      console.error(`    ${message}\n`);
      failed++;
    }
  }

  await client.end();

  console.log(`\n──────────────────────────────────`);
  console.log(`Deployed:  ${passed} / ${FILES.length} succeeded`);
  if (failed > 0) {
    console.log(`Failed:    ${failed}`);
    process.exit(1);
  } else {
    console.log('All routines deployed successfully. ✅');
  }
}

deploy().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
