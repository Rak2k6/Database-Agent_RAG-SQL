export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  auth_provider: 'local' | 'google';
  google_id: string | null;
  profile_image: string | null;
  role: string;
  department: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  status: 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  start_date: string;
  due_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  project_id: string;
  assigned_to: string | null;
  created_by: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  due_date: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  event_type: 'MEETING' | 'EVENT' | 'DEADLINE' | 'REMINDER';
  created_by: string;
  project_id: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  project_id: string | null;
  folder: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  subject: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  theme: string;
  notify_task_assignments: boolean;
  notify_project_updates: boolean;
  notify_upcoming_meetings: boolean;
  notify_deadline_reminders: boolean;
  updated_at: string;
}
