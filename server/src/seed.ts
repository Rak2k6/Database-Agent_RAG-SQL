import bcrypt from 'bcryptjs';
import { database } from './db.js';

export async function seedDatabase() {
  const projectCount = (database.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
  if (projectCount > 0) {
    return; // Already seeded
  }

  const now = new Date().toISOString();
  const defaultPasswordHash = await bcrypt.hash('Northstar123!', 10);

  const usersData = [
    { id: 'usr_rakesh', name: 'Rakesh', email: 'rakesh@northstarai.com', role: 'Product Lead', department: 'Engineering', status: 'Active' },
    { id: 'usr_jordan', name: 'Jordan Lee', email: 'jordan.lee@northstarai.com', role: 'Design Lead', department: 'Design', status: 'Active' },
    { id: 'usr_sam', name: 'Sam Kim', email: 'sam.kim@northstarai.com', role: 'Senior Engineer', department: 'Engineering', status: 'Active' },
    { id: 'usr_morgan', name: 'Morgan Reed', email: 'morgan.reed@northstarai.com', role: 'Product Manager', department: 'Product', status: 'Active' },
    { id: 'usr_alex', name: 'Alex Morgan', email: 'alex.morgan@northstarai.com', role: 'Brand Strategist', department: 'Marketing', status: 'Active' },
    { id: 'usr_taylor', name: 'Taylor Swift', email: 'taylor.swift@northstarai.com', role: 'Frontend Dev', department: 'Engineering', status: 'Active' },
    { id: 'usr_chris', name: 'Chris Evans', role: 'QA Lead', email: 'chris.evans@northstarai.com', department: 'Quality', status: 'Active' },
    { id: 'usr_maya', name: 'Maya Lin', email: 'maya.lin@northstarai.com', role: 'UX Researcher', department: 'Design', status: 'Active' },
  ];

  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, auth_provider, role, department, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?, ?)
  `);

  for (const u of usersData) {
    insertUser.run(u.id, u.name, u.email, defaultPasswordHash, u.role, u.department, u.status, now, now);
  }

  // Projects
  const projectsData = [
    {
      id: 'proj_platform',
      name: 'Platform Refresh',
      description: 'A clearer, faster product foundation with modular UI architecture.',
      status: 'ACTIVE',
      start_date: '2026-09-01',
      due_date: '2026-10-18',
      created_by: 'usr_rakesh',
    },
    {
      id: 'proj_intelligence',
      name: 'Customer Intelligence',
      description: 'Turn customer feedback signals into actionable roadmap decisions.',
      status: 'ACTIVE',
      start_date: '2026-09-15',
      due_date: '2026-11-02',
      created_by: 'usr_morgan',
    },
    {
      id: 'proj_brand',
      name: 'Brand Evolution',
      description: 'An identity for the next chapter of Northstar AI Workplace.',
      status: 'ACTIVE',
      start_date: '2026-08-20',
      due_date: '2026-10-12',
      created_by: 'usr_alex',
    },
    {
      id: 'proj_ai_assistant',
      name: 'AI Assistant Integration',
      description: 'Embedded Copilot features for workflow automation & smart task summary.',
      status: 'PLANNED',
      start_date: '2026-10-15',
      due_date: '2026-12-15',
      created_by: 'usr_rakesh',
    },
    {
      id: 'proj_mobile',
      name: 'Mobile App v2.0',
      description: 'Native iOS & Android apps rebuild with real-time push sync.',
      status: 'ON_HOLD',
      start_date: '2026-07-10',
      due_date: '2026-11-30',
      created_by: 'usr_sam',
    },
    {
      id: 'proj_security',
      name: 'Security Compliance Audit',
      description: 'SOC2 Type II compliance and infrastructure security hardening.',
      status: 'COMPLETED',
      start_date: '2026-06-01',
      due_date: '2026-09-25',
      created_by: 'usr_chris',
    },
  ];

  const insertProject = database.prepare(`
    INSERT INTO projects (id, name, description, status, start_date, due_date, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of projectsData) {
    insertProject.run(p.id, p.name, p.description, p.status, p.start_date, p.due_date, p.created_by, now, now);
  }

  // Project Members
  const membersData = [
    { project_id: 'proj_platform', user_id: 'usr_rakesh', role: 'Owner' },
    { project_id: 'proj_platform', user_id: 'usr_jordan', role: 'Lead Designer' },
    { project_id: 'proj_platform', user_id: 'usr_sam', role: 'Lead Engineer' },
    { project_id: 'proj_platform', user_id: 'usr_taylor', role: 'Developer' },
    { project_id: 'proj_intelligence', user_id: 'usr_morgan', role: 'Owner' },
    { project_id: 'proj_intelligence', user_id: 'usr_sam', role: 'Engineer' },
    { project_id: 'proj_intelligence', user_id: 'usr_maya', role: 'Researcher' },
    { project_id: 'proj_brand', user_id: 'usr_alex', role: 'Owner' },
    { project_id: 'proj_brand', user_id: 'usr_jordan', role: 'Designer' },
    { project_id: 'proj_brand', user_id: 'usr_morgan', role: 'Reviewer' },
    { project_id: 'proj_ai_assistant', user_id: 'usr_rakesh', role: 'Owner' },
    { project_id: 'proj_ai_assistant', user_id: 'usr_sam', role: 'Engineer' },
    { project_id: 'proj_mobile', user_id: 'usr_taylor', role: 'Owner' },
    { project_id: 'proj_security', user_id: 'usr_chris', role: 'Owner' },
  ];

  const insertMember = database.prepare(`
    INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
  `);
  for (const m of membersData) {
    insertMember.run(m.project_id, m.user_id, m.role);
  }

  // Tasks
  const tasksData = [
    {
      id: 'task_1',
      title: 'Review Q3 product roadmap',
      description: 'Align quarterly deliverables with executive team and update milestone dates.',
      project_id: 'proj_platform',
      assigned_to: 'usr_rakesh',
      created_by: 'usr_morgan',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      due_date: '2026-10-01',
    },
    {
      id: 'task_2',
      title: 'Approve updated brand system',
      description: 'Final design sign-off on colors, typography hierarchy, and UI icon set.',
      project_id: 'proj_brand',
      assigned_to: 'usr_jordan',
      created_by: 'usr_alex',
      priority: 'MEDIUM',
      status: 'TODO',
      due_date: '2026-10-04',
    },
    {
      id: 'task_3',
      title: 'Share customer research notes',
      description: 'Compile interview transcripts from enterprise accounts into summary deck.',
      project_id: 'proj_intelligence',
      assigned_to: 'usr_maya',
      created_by: 'usr_morgan',
      priority: 'LOW',
      status: 'COMPLETED',
      due_date: '2026-10-06',
    },
    {
      id: 'task_4',
      title: 'Finalize launch checklist',
      description: 'Ensure pre-launch verification scripts pass and rollback plan is documented.',
      project_id: 'proj_platform',
      assigned_to: 'usr_rakesh',
      created_by: 'usr_chris',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      due_date: '2026-10-08',
    },
    {
      id: 'task_5',
      title: 'Refactor database indexing strategy',
      description: 'Add composite indexes to speed up multi-filter queries for tasks and projects.',
      project_id: 'proj_platform',
      assigned_to: 'usr_sam',
      created_by: 'usr_rakesh',
      priority: 'HIGH',
      status: 'COMPLETED',
      due_date: '2026-09-28',
    },
    {
      id: 'task_6',
      title: 'Build dark theme color palette',
      description: 'Define semantic CSS variables for dark mode support across components.',
      project_id: 'proj_brand',
      assigned_to: 'usr_taylor',
      created_by: 'usr_jordan',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      due_date: '2026-10-10',
    },
    {
      id: 'task_7',
      title: 'Setup automated API regression test suite',
      description: 'Ensure 100% endpoint coverage with synthetic test fixtures.',
      project_id: 'proj_security',
      assigned_to: 'usr_chris',
      created_by: 'usr_chris',
      priority: 'HIGH',
      status: 'COMPLETED',
      due_date: '2026-09-24',
    },
    {
      id: 'task_8',
      title: 'Customer sentiment chart component',
      description: 'Develop responsive chart component rendering positive vs negative feedback trends.',
      project_id: 'proj_intelligence',
      assigned_to: 'usr_sam',
      created_by: 'usr_morgan',
      priority: 'MEDIUM',
      status: 'TODO',
      due_date: '2026-10-15',
    },
    {
      id: 'task_9',
      title: 'Implement Google Identity GIS token validation',
      description: 'Verify OAuth JWT token signatures server-side and create local session.',
      project_id: 'proj_platform',
      assigned_to: 'usr_rakesh',
      created_by: 'usr_rakesh',
      priority: 'HIGH',
      status: 'COMPLETED',
      due_date: '2026-09-26',
    },
    {
      id: 'task_10',
      title: 'Design mobile navigation drawer',
      description: 'Create mobile drawer navigation wireframes with gesture support.',
      project_id: 'proj_mobile',
      assigned_to: 'usr_jordan',
      created_by: 'usr_taylor',
      priority: 'LOW',
      status: 'TODO',
      due_date: '2026-11-12',
    }
  ];

  const insertTask = database.prepare(`
    INSERT INTO tasks (id, title, description, project_id, assigned_to, created_by, priority, status, due_date, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of tasksData) {
    const completedAt = t.status === 'COMPLETED' ? now : null;
    insertTask.run(t.id, t.title, t.description, t.project_id, t.assigned_to, t.created_by, t.priority, t.status, t.due_date, now, now, completedAt);
  }

  // Calendar Events
  const calendarData = [
    {
      id: 'evt_1',
      title: 'Product weekly sync',
      description: 'Align engineering and design teams on current sprint progress.',
      start_time: '2026-10-01T10:30:00Z',
      end_time: '2026-10-01T11:30:00Z',
      event_type: 'MEETING',
      created_by: 'usr_rakesh',
      project_id: 'proj_platform',
    },
    {
      id: 'evt_2',
      title: 'Research readout',
      description: 'Customer Intelligence interview insights presentation.',
      start_time: '2026-10-01T13:00:00Z',
      end_time: '2026-10-01T14:00:00Z',
      event_type: 'EVENT',
      created_by: 'usr_morgan',
      project_id: 'proj_intelligence',
    },
    {
      id: 'evt_3',
      title: 'Roadmap review due',
      description: 'Final submission deadline for Q4 roadmap proposals.',
      start_time: '2026-10-01T15:30:00Z',
      end_time: '2026-10-01T16:30:00Z',
      event_type: 'DEADLINE',
      created_by: 'usr_rakesh',
      project_id: 'proj_platform',
    },
    {
      id: 'evt_4',
      title: 'Brand Evolution Design Critique',
      description: 'Review brand refresh guidelines with marketing and product leads.',
      start_time: '2026-10-02T11:00:00Z',
      end_time: '2026-10-02T12:00:00Z',
      event_type: 'MEETING',
      created_by: 'usr_jordan',
      project_id: 'proj_brand',
    },
    {
      id: 'evt_5',
      title: 'Architecture Review: AI Copilot',
      description: 'Technical spike review for LLM integration pipeline.',
      start_time: '2026-10-05T14:00:00Z',
      end_time: '2026-10-05T15:30:00Z',
      event_type: 'MEETING',
      created_by: 'usr_sam',
      project_id: 'proj_ai_assistant',
    }
  ];

  const insertEvent = database.prepare(`
    INSERT INTO calendar_events (id, title, description, start_time, end_time, event_type, created_by, project_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const e of calendarData) {
    insertEvent.run(e.id, e.title, e.description, e.start_time, e.end_time, e.event_type, e.created_by, e.project_id, now);
  }

  // Documents
  const documentsData = [
    {
      id: 'doc_1',
      name: 'Product Architecture Spec 2026',
      file_name: 'Product_Architecture_Spec.pdf',
      file_path: '/uploads/Product_Architecture_Spec.pdf',
      file_type: 'application/pdf',
      file_size: 2450000,
      uploaded_by: 'usr_rakesh',
      project_id: 'proj_platform',
      folder: 'Architecture',
    },
    {
      id: 'doc_2',
      name: 'Customer Intelligence Insights',
      file_name: 'Customer_Research_Summary.docx',
      file_path: '/uploads/Customer_Research_Summary.docx',
      file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 1120000,
      uploaded_by: 'usr_maya',
      project_id: 'proj_intelligence',
      folder: 'Research',
    },
    {
      id: 'doc_3',
      name: 'Brand Evolution Style Guide',
      file_name: 'Brand_Guide_v2.pdf',
      file_path: '/uploads/Brand_Guide_v2.pdf',
      file_type: 'application/pdf',
      file_size: 5800000,
      uploaded_by: 'usr_jordan',
      project_id: 'proj_brand',
      folder: 'Design Systems',
    },
    {
      id: 'doc_4',
      name: 'SOC2 Type II Security Report',
      file_name: 'SOC2_Audit_Report.pdf',
      file_path: '/uploads/SOC2_Audit_Report.pdf',
      file_type: 'application/pdf',
      file_size: 3400000,
      uploaded_by: 'usr_chris',
      project_id: 'proj_security',
      folder: 'Compliance',
    }
  ];

  const insertDoc = database.prepare(`
    INSERT INTO documents (id, name, file_name, file_path, file_type, file_size, uploaded_by, project_id, folder, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const d of documentsData) {
    insertDoc.run(d.id, d.name, d.file_name, d.file_path, d.file_type, d.file_size, d.uploaded_by, d.project_id, d.folder, now, now);
  }

  // Activities
  const activitiesData = [
    { id: 'act_1', user_id: 'usr_jordan', action: 'completed a task in', entity_type: 'task', entity_id: 'task_3', subject: 'Brand Evolution', created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
    { id: 'act_2', user_id: 'usr_sam', action: 'uploaded a document to', entity_type: 'document', entity_id: 'doc_2', subject: 'Customer Intelligence', created_at: new Date(Date.now() - 48 * 60 * 1000).toISOString() },
    { id: 'act_3', user_id: 'usr_morgan', action: 'scheduled a meeting for', entity_type: 'event', entity_id: 'evt_1', subject: 'Platform Refresh', created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() },
    { id: 'act_4', user_id: 'usr_alex', action: 'created a new project', entity_type: 'project', entity_id: 'proj_brand', subject: 'Brand Evolution', created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
    { id: 'act_5', user_id: 'usr_rakesh', action: 'assigned a task to', entity_type: 'task', entity_id: 'task_1', subject: 'Platform Refresh', created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString() },
  ];

  const insertAct = database.prepare(`
    INSERT INTO activities (id, user_id, action, entity_type, entity_id, subject, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const a of activitiesData) {
    insertAct.run(a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.subject, a.created_at);
  }

  // Notifications for users
  const notificationsData = [
    { id: 'notif_1', user_id: 'usr_rakesh', title: 'Task assigned', message: 'Morgan Reed assigned you "Review Q3 product roadmap"', type: 'task', is_read: 0, created_at: now },
    { id: 'notif_2', user_id: 'usr_rakesh', title: 'Meeting reminder', message: 'Product weekly sync starts in 30 minutes', type: 'meeting', is_read: 0, created_at: now },
    { id: 'notif_3', user_id: 'usr_jordan', title: 'Project update', message: 'Alex Morgan updated Brand Evolution status', type: 'project', is_read: 0, created_at: now },
  ];

  const insertNotif = database.prepare(`
    INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const n of notificationsData) {
    insertNotif.run(n.id, n.user_id, n.title, n.message, n.type, n.is_read, n.created_at);
  }
}
