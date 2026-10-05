import { database } from '../db.js';

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  start_date: string;
  due_date: string;
}

export function getActiveProjects(): ProjectSummary[] {
  const statement = database.prepare(`
    SELECT
      id,
      name,
      status,
      start_date,
      due_date
    FROM projects
    WHERE status = 'ACTIVE'
    ORDER BY due_date ASC
  `);

  return statement.all() as ProjectSummary[];
}
export function formatProjectsForAI(projects: ProjectSummary[]): string {
  return projects.map((project) => (
    `- ${project.name} | Status: ${project.status} | ` +
    `Start: ${project.start_date} | Due: ${project.due_date}`
  )).join('\n');
}