# Product Requirements Document (PRD)
## Northstar AI Workplace — Full-Stack Workplace Management Application

---

## 1. Executive Summary
**Northstar AI Workplace** is an enterprise-grade, data-driven workplace and project management application designed to empower teams with unified project tracking, task execution, team collaboration, document sharing, scheduling, and analytics. 

This document outlines the product requirements for extending the existing Northstar AI full-stack starter (Angular 19+ standalone components, Express.js backend, TypeScript, and SQLite database) into a fully interactive, production-ready workplace management platform.

---

## 2. Goals & Product Vision

### 2.1 Strategic Goals
- **100% Data-Driven Architecture:** Replace all hardcoded/static dashboard and sidebar demo metrics with dynamic computations powered by SQLite queries.
- **End-to-End Persistence:** Ensure all project creations, task assignments, status updates, calendar bookings, document uploads, and settings persist across page reloads.
- **Security-First Session Architecture:** Preserve existing HttpOnly session cookie authentication, bcrypt password hashing, Zod schema validation, and Google OAuth support without regressions.
- **Unified Enterprise Visual Identity:** Maintain the clean, responsive, light-themed Northstar AI visual design system with rich micro-interactions and high contrast UI tokens.

---

## 3. Tech Stack & Architecture Overview

| Layer | Technologies |
| :--- | :--- |
| **Frontend Framework** | Angular 19+ (Standalone Components, Signals/RxJS, SCSS, Router Guards) |
| **Backend Framework** | Node.js + Express.js (TypeScript, ES2022) |
| **Database** | SQLite3 via `better-sqlite3` (WAL mode enabled, FK constraints) |
| **Session & Auth Security** | HttpOnly / SameSite=Lax Session Cookies, SHA-256 session hashing, `bcryptjs` (Cost factor 12), Google Identity Services GIS token validation |
| **Input Validation** | Zod schemas for request validation |
| **Testing Suite** | Built-in Node test runner (`node:test`) for backend API testing, Angular Jasmine/Karma runner for UI testing |

---

## 4. System Architecture & Routing Structure

### 4.1 Route Map
All routes are protected by Angular `authGuard` (redirecting unauthenticated users to `/login`).

```
/
├── /login                (Guest Guard: Sign in page)
├── /signup               (Guest Guard: Account registration)
├── /forgot-password      (Guest Guard: Password reset link request)
├── /reset-password/:token(Guest Guard: Set new password)
└── / (Shell Layout)      (Auth Guard)
    ├── /dashboard        (Dynamic Workspace Summary & Metrics)
    ├── /tasks            (Task Management Hub with "My Tasks" view)
    ├── /projects         (Projects List & Cards view)
    ├── /projects/:id     (Project Detail & Milestones)
    ├── /team             (Team Directory & Workload)
    ├── /calendar         (Shared Event & Deadline Calendar)
    ├── /documents        (Document Repository & Files)
    ├── /reports          (Analytics & Database Statistics)
    └── /settings         (User Profile & Preferences)
```

---

## 5. Functional Requirements & Feature Specifications

### 5.1 Authentication & Session Security
- **Local Account Signup (`/signup`):** Corporate email validation (`@northstarai.com`), name, password complexity, bcrypt hashing.
- **Local Login (`/login`):** Email + password credential verification issuing HttpOnly `northstar_session` cookie.
- **Google OAuth Login:** Verify Google ID token signature, audience, and verified email server-side.
- **Password Reset Flow:** 1-hour expiration SHA-256 token hashing with single-use consumption.
- **Session Revocation (`/logout`):** Destroys session row in SQLite and clears client cookie.

---

### 5.2 Dynamic Workspace Dashboard (`/dashboard`)
- **Dynamic KPI Summary Cards:**
  - `Active Projects`: Calculated count of projects where `status = 'ACTIVE'`.
  - `Pending Tasks`: Calculated count of tasks where `status IN ('TODO', 'IN_PROGRESS')`.
  - `Completed Tasks`: Count of tasks where `status = 'COMPLETED'`.
  - `Team Members`: Count of registered team users.
  - `Upcoming Meetings`: Count of upcoming calendar events of type `MEETING`.
- **My Tasks Widget:** Top prioritized tasks for current user with fast inline completion toggles.
- **Upcoming Schedule Widget:** Real-time feed of today's calendar events & deadlines.
- **Active Projects Widget:** Dynamic progress bar (`completed_tasks / total_tasks * 100`), member stack initials, due date.
- **Recent Activity Stream:** Audit log of team actions formatted with humanized relative timestamps.

---

### 5.3 Projects Management (`/projects` & `/projects/:id`)
- **Projects Grid / Cards View:** Displays project title, description, status badge (`PLANNED`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `ARCHIVED`), progress percentage, task count, and member avatars.
- **Dynamic Progress Calculation:** Progress percentage calculated automatically on backend:
  $$\text{Progress \%} = \left( \frac{\text{Completed Tasks}}{\text{Total Tasks}} \right) \times 100$$
- **Create Project Dialog:** Modal form allowing creation of projects with start date, due date, description, and initial status.
- **Project Detail View (`/projects/:id`):** Tabbed interface with Overview, Task Breakdown, Project Members, Timeline, and Activity stream.

---

### 5.4 Task Management (`/tasks`)
- **Filtering & Search Controls:** Filter by status (`All`, `To Do`, `In Progress`, `Completed`, `Overdue`), priority (`High`, `Medium`, `Low`), assigned project, and text search.
- **"My Tasks" Security Boundary:** When viewing user-assigned tasks, filtering is enforced on the server via authenticated session ID (not client-supplied user ID).
- **Task Lifecycle:**
  - Create task with title, project association, assignee, priority, due date.
  - Mark task complete (updates `completed_at` timestamp and recalculates project progress).
  - Edit or delete tasks.
  - Overdue indicator for incomplete tasks past their due date.

---

### 5.5 Team Directory (`/team`)
- **Team Roster Grid:** Displays user avatar/initials, full name, corporate email, role, department (`Engineering`, `Design`, `Product`, `Marketing`, `Quality`), status, assigned tasks count, and completed tasks count.
- **Search & Department Filter:** Instant frontend/backend filtering by name, role, or department.
- **Add Team Member Flow:** Quick-add modal for demoing new member onboarding.

---

### 5.6 Shared Calendar (`/calendar`)
- **Calendar Event Types:** `MEETING`, `EVENT`, `DEADLINE`, `REMINDER`.
- **Shared Data Layer:** Events created in Calendar immediately update the Dashboard's "Upcoming Schedule" widget.
- **Create / Delete Events:** Modal for creating events with start/end time, description, and optional project association.

---

### 5.7 Document Repository (`/documents`)
- **Document Metadata:** File name, folder category (`Architecture`, `Research`, `Design Systems`, `Compliance`), file size, uploader, associated project, upload timestamp.
- **Upload / Download Flow:** Form for adding documents to repository with local storage support and file type badges.

---

### 5.8 Reports & Database Analytics (`/reports`)
- **Task Analytics:** Total tasks count, completion rate, status distribution, high-priority backlog count.
- **Project Analytics:** Total projects, active projects count, completed projects count, average project progress percentage.
- **Team Workload Matrix:** Distribution of assigned tasks vs completed tasks per team member.

---

### 5.9 Settings & User Profile (`/settings`)
- **Profile Management:** Edit display name, department, role, and avatar.
- **Appearance & Preferences:** Light/Dark theme selection (Light theme default).
- **Notification Toggles:** Task assignments, project updates, upcoming meetings, deadline reminders.
- **Account Security:** Existing password change flow integration.

---

### 5.10 Audit Log & Activity System
- Centralized `activities` table logging meaningful workspace events (e.g., project creation, task completion, document upload, meeting scheduled).
- Feed displayed on Dashboard and activity widgets.

---

### 5.11 Notification System
- Notification bell dropdown in topbar with unread badge counter.
- Automatic notifications generated when tasks are assigned to users or projects are updated.
- "Mark as read" and "Mark all as read" actions.

---

## 6. Database Schema Specifications

```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'google')),
  google_id TEXT UNIQUE,
  profile_image TEXT,
  role TEXT NOT NULL DEFAULT 'Member',
  department TEXT NOT NULL DEFAULT 'Engineering',
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Project Members
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Member',
  PRIMARY KEY (project_id, user_id)
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority TEXT NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  status TEXT NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

-- Calendar Events
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('MEETING', 'EVENT', 'DEADLINE', 'REMINDER')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  folder TEXT NOT NULL DEFAULT 'General',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Activities
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- User Settings
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'light',
  notify_task_assignments INTEGER NOT NULL DEFAULT 1,
  notify_project_updates INTEGER NOT NULL DEFAULT 1,
  notify_upcoming_meetings INTEGER NOT NULL DEFAULT 1,
  notify_deadline_reminders INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
```

---

## 7. Database Seeding Specification (`server/src/seed.ts`)
Automatic seed runs on application start if `projects` table is empty:
- **8 Team Users:** Rakesh (Product Lead), Jordan Lee (Design Lead), Sam Kim (Senior Engineer), Morgan Reed (PM), Alex Morgan (Brand Strategist), Taylor Swift (Frontend Dev), Chris Evans (QA Lead), Maya Lin (UX Researcher).
- **6 Realistic Projects:** Platform Refresh, Customer Intelligence, Brand Evolution, AI Assistant Integration, Mobile App v2.0, Security Compliance Audit.
- **10 Tasks, 5 Calendar Events, 4 Documents, 5 Activity Logs, 3 Notifications.**

---

## 8. Verification & Execution Commands

### Run API & App
```bash
# Start backend API (Terminal 1)
npm run api:dev

# Start Angular app (Terminal 2)
npm start
```

### Type Checking & Test Commands
```bash
# Backend TypeScript check
npm run api:check

# Backend unit & integration tests
npm run api:test

# Frontend test suite
npm test -- --watch=false

# Production build test
npm run build
```

---

## 9. Non-Functional Requirements & Security Checklist
1. **Password Security:** Mandatory bcrypt hashing (12 salt rounds); no plain text passwords stored.
2. **Session Security:** Cookie credentials flagged `HttpOnly`, `SameSite=Lax`, `path=/`.
3. **Authorization Isolation:** "My Tasks" and user settings retrieve data filtered strictly by authenticated Express session token.
4. **Parameterized SQL:** All queries executed via `better-sqlite3` prepared statements to protect against SQL injection.
