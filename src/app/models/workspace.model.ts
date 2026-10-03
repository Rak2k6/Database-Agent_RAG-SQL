export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'To Do' | 'In Progress' | 'Completed';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'High' | 'Medium' | 'Low';

export interface WorkspaceMetrics {
  activeProjects: number;
  pendingTasks: number;
  completedTasks: number;
  teamMembers: number;
  upcomingMeetings: number;
}

export interface WorkspaceTask {
  id?: string;
  title: string;
  description?: string;
  projectId?: string;
  project: string;
  assignedToId?: string | null;
  assignedTo?: string;
  createdBy?: string;
  priority: TaskPriority;
  dueDate: string;
  status: TaskStatus;
  completedAt?: string | null;
  isOverdue?: boolean;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string;
  progress: number;
  startDate?: string;
  deadline?: string;
  dueDate?: string;
  status: string;
  createdBy?: string;
  totalTasks?: number;
  completedTasks?: number;
  initials?: string[];
  tone?: string;
  members?: Array<{ id: string; name: string; email: string; role: string }>;
  tasks?: WorkspaceTask[];
}

export interface WorkspaceEvent {
  id?: string;
  time?: string;
  title: string;
  description?: string;
  detail?: string;
  startTime?: string;
  endTime?: string;
  eventType?: string;
  projectId?: string | null;
  project?: string;
  createdBy?: string;
  kind?: string;
}

export interface WorkspaceActivity {
  id?: string;
  initials: string;
  person: string;
  action: string;
  subject: string;
  time: string;
  tone: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: number;
  created_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  profileImage: string | null;
  assignedTasksCount?: number;
  completedTasksCount?: number;
}

export interface DocumentItem {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  folder: string;
  project: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ReportAnalytics {
  taskStats: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
    highPriority: number;
  };
  projectStats: {
    total: number;
    active: number;
    completed: number;
    planned: number;
  };
  teamWorkload: Array<{
    id: string;
    name: string;
    role: string;
    department: string;
    assigned_tasks: number;
    completed_tasks: number;
  }>;
}

export interface WorkspaceData {
  user?: any;
  metrics?: WorkspaceMetrics;
  tasks: WorkspaceTask[];
  projects: WorkspaceProject[];
  schedule: WorkspaceEvent[];
  activity: WorkspaceActivity[];
  notifications?: NotificationItem[];
}