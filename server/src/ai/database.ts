import { getPool } from '../db/pool.js';

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  start_date: string;
  due_date: string;
}

export async function getActiveProjects(): Promise<ProjectSummary[]> {
  const pool = await getPool();

  const result = await pool.request().query<ProjectSummary>(`
    SELECT
      id,
      name,
      status,
      CONVERT(varchar(10), start_date, 23) AS start_date,
      CONVERT(varchar(10), due_date, 23) AS due_date
    FROM dbo.projects
    WHERE status = 'ACTIVE'
    ORDER BY due_date ASC
  `);

  return result.recordset;
}

export function formatProjectsForAI(
  projects: ProjectSummary[],
): string {
  return projects.map((project) => (
    `- ${project.name} | Status: ${project.status} | ` +
    `Start: ${project.start_date} | Due: ${project.due_date}`
  )).join('\n');
}