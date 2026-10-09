import { Routes } from '@angular/router';
import { ForgotPasswordComponent, ResetPasswordComponent, SignupComponent } from './auth/auth-pages.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { AiChatComponent } from './ai-chat/ai-chat.component';
import { LoginComponent } from './login/login.component';
import { DashboardOverviewComponent } from './pages/dashboard-overview/dashboard-overview.component';
import { CalendarComponent } from './pages/calendar/calendar.component';
import { DocumentsComponent } from './pages/documents/documents.component';
import { MyTasksComponent } from './pages/my-tasks/my-tasks.component';
import { ProjectDetailComponent } from './pages/project-detail/project-detail.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { ReportsComponent } from './pages/reports/reports.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { TeamComponent } from './pages/team/team.component';
import { authGuard, guestGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'workspace', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'sign-up', pathMatch: 'full', redirectTo: 'signup' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard], title: 'Sign in | Northstar AI' },
  { path: 'signup', component: SignupComponent, canActivate: [guestGuard], title: 'Create account | Northstar AI' },
  { path: 'forgot-password', component: ForgotPasswordComponent, canActivate: [guestGuard], title: 'Reset password | Northstar AI' },
  { path: 'reset-password/:token', component: ResetPasswordComponent, canActivate: [guestGuard], title: 'Choose a new password | Northstar AI' },
  {
    path: '',
    component: DashboardComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardOverviewComponent, data: { section: 'Dashboard' }, title: 'Dashboard | Northstar AI' },
      { path: 'projects', component: ProjectsComponent, data: { section: 'Projects' }, title: 'Projects | Northstar AI' },
      { path: 'projects/:id', component: ProjectDetailComponent, data: { section: 'Projects' }, title: 'Project | Northstar AI' },
      { path: 'tasks', component: MyTasksComponent, data: { section: 'My Tasks' }, title: 'My Tasks | Northstar AI' },
      { path: 'team', component: TeamComponent, data: { section: 'Team' }, title: 'Team | Northstar AI' },
      { path: 'calendar', component: CalendarComponent, data: { section: 'Calendar' }, title: 'Calendar | Northstar AI' },
      { path: 'documents', component: DocumentsComponent, data: { section: 'Documents' }, title: 'Documents | Northstar AI' },
      { path: 'ai', component: AiChatComponent, data: { section: 'Northstar AI' }, title: 'Northstar AI | Northstar AI' },
      { path: 'reports', component: ReportsComponent, data: { section: 'Reports' }, title: 'Reports | Northstar AI' },
      { path: 'settings', component: SettingsComponent, data: { section: 'Settings' }, title: 'Settings | Northstar AI' },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
