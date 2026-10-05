/**
 * db/dashboard.ts — Dashboard data (app-only, never AI-exposed)
 * Calls the get_dashboard_data(user_id) PostgreSQL function which returns
 * a single assembled JSON object, eliminating 12+ round trips.
 */
import { pool } from './pool.js';

export interface DashboardData {
  metrics: Record<string, number>;
  topTasks: unknown[];
  activeProjects: unknown[];
  schedule: unknown[];
  activity: unknown[];
  notifications: unknown[];
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const r = await pool.query<{ get_dashboard_data: DashboardData }>(
    'SELECT get_dashboard_data($1)',
    [userId],
  );
  return r.rows[0]?.get_dashboard_data ?? {
    metrics: {},
    topTasks: [],
    activeProjects: [],
    schedule: [],
    activity: [],
    notifications: [],
  };
}

export interface ReportData {
  taskStats: Record<string, number>;
  projectStats: Record<string, number>;
  teamWorkload: unknown[];
}

export async function getReportData(): Promise<ReportData> {
  const [taskStatsR, projectStatsR, teamWorkloadR] = await Promise.all([
    pool.query<Record<string, string>>('SELECT * FROM v_task_stats'),
    pool.query<Record<string, string>>('SELECT * FROM v_project_stats'),
    pool.query('SELECT * FROM get_team_workload()'),
  ]);

  const ts = taskStatsR.rows[0] ?? {};
  const ps = projectStatsR.rows[0] ?? {};

  return {
    taskStats: {
      total:       parseInt(ts['total']       ?? '0', 10),
      completed:   parseInt(ts['completed']   ?? '0', 10),
      inProgress:  parseInt(ts['in_progress'] ?? '0', 10),
      todo:        parseInt(ts['todo']        ?? '0', 10),
      highPriority: parseInt(ts['high_priority'] ?? '0', 10),
    },
    projectStats: {
      total:     parseInt(ps['total']     ?? '0', 10),
      active:    parseInt(ps['active']    ?? '0', 10),
      completed: parseInt(ps['completed'] ?? '0', 10),
      planned:   parseInt(ps['planned']   ?? '0', 10),
    },
    teamWorkload: teamWorkloadR.rows,
  };
}
