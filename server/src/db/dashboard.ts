/**
 * db/dashboard.ts — Dashboard data (app-only, never AI-exposed)
 *
 * Reads:
 *   - dbo.get_dashboard_data(@p_user_id)
 *   - dbo.v_task_stats
 *   - dbo.v_project_stats
 *   - dbo.get_team_workload()
 */
import sql from 'mssql';
import { getPool } from './pool.js';

export interface DashboardData {
  metrics: Record<string, number>;
  topTasks: unknown[];
  activeProjects: unknown[];
  schedule: unknown[];
  activity: unknown[];
  notifications: unknown[];
}

function parseJsonResult<T>(value: string | null | undefined): T | undefined {
  if (value == null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

const EMPTY_DASHBOARD: DashboardData = {
  metrics: {},
  topTasks: [],
  activeProjects: [],
  schedule: [],
  activity: [],
  notifications: [],
};

export async function getDashboardData(
  userId: string,
): Promise<DashboardData> {
  const pool = await getPool();

  const r = await pool
    .request()
    .input('p_user_id', sql.NVarChar(sql.MAX), userId)
    .query<{ result: string | null }>(`
      SELECT dbo.get_dashboard_data(
        @p_user_id
      ) AS result
    `);

  return parseJsonResult<DashboardData>(
    r.recordset[0]?.result,
  ) ?? EMPTY_DASHBOARD;
}

export interface ReportData {
  taskStats: Record<string, number>;
  projectStats: Record<string, number>;
  teamWorkload: unknown[];
}

export async function getReportData(): Promise<ReportData> {
  const pool = await getPool();

  const [taskStatsR, projectStatsR, teamWorkloadR] =
    await Promise.all([
      pool
        .request()
        .query<Record<string, unknown>>(`
          SELECT *
          FROM dbo.v_task_stats
        `),

      pool
        .request()
        .query<Record<string, unknown>>(`
          SELECT *
          FROM dbo.v_project_stats
        `),

      pool
        .request()
        .query<{ result: string | null }>(`
          SELECT dbo.get_team_workload() AS result
        `),
    ]);

  const ts = taskStatsR.recordset[0] ?? {};
  const ps = projectStatsR.recordset[0] ?? {};

  const teamWorkload =
    parseJsonResult<unknown[]>(
      teamWorkloadR.recordset[0]?.result,
    ) ?? [];

  return {
    taskStats: {
      total: Number(ts['total'] ?? 0),
      completed: Number(ts['completed'] ?? 0),
      inProgress: Number(ts['in_progress'] ?? 0),
      todo: Number(ts['todo'] ?? 0),
      highPriority: Number(ts['high_priority'] ?? 0),
    },

    projectStats: {
      total: Number(ps['total'] ?? 0),
      active: Number(ps['active'] ?? 0),
      completed: Number(ps['completed'] ?? 0),
      planned: Number(ps['planned'] ?? 0),
    },

    teamWorkload,
  };
}