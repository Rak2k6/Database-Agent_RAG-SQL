import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected profile = { name: '', department: '', role: '' };
  protected preferences = {
    theme: 'light',
    notify_task_assignments: true,
    notify_project_updates: true,
    notify_upcoming_meetings: true,
    notify_deadline_reminders: true,
  };

  constructor() {
    this.settingsService.getSettings().subscribe({
      next: ({ profile, settings }) => {
        this.profile = { name: profile.name, department: profile.department ?? '', role: profile.role ?? '' };
        this.preferences = {
          theme: settings.theme,
          notify_task_assignments: Boolean(settings.notify_task_assignments),
          notify_project_updates: Boolean(settings.notify_project_updates),
          notify_upcoming_meetings: Boolean(settings.notify_upcoming_meetings),
          notify_deadline_reminders: Boolean(settings.notify_deadline_reminders),
        };
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Settings could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected saveSettings(): void {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set('');
    const update = {
      ...this.profile,
      ...this.preferences,
      notify_task_assignments: Number(this.preferences.notify_task_assignments),
      notify_project_updates: Number(this.preferences.notify_project_updates),
      notify_upcoming_meetings: Number(this.preferences.notify_upcoming_meetings),
      notify_deadline_reminders: Number(this.preferences.notify_deadline_reminders),
    };
    this.settingsService.updateSettings(update).subscribe({
      next: () => {
        this.authService.currentUser.update((user) => user ? { ...user, name: this.profile.name } : user);
        this.saved.set(true);
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error?.message ?? 'Settings could not be saved.');
        this.saving.set(false);
      },
    });
  }
}