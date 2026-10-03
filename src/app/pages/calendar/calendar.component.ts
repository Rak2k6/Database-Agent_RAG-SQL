import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkspaceEvent } from '../../models/workspace.model';
import { CalendarService } from '../../services/calendar.service';

@Component({
  selector: 'app-calendar',
  imports: [DatePipe, FormsModule],
  templateUrl: './calendar.component.html',
})
export class CalendarComponent {
  private readonly calendarService = inject(CalendarService);

  protected readonly events = signal<WorkspaceEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly showForm = signal(false);
  protected readonly error = signal('');
  protected newEvent = { title: '', description: '', start_time: '', end_time: '', event_type: 'MEETING' };

  constructor() {
    this.loadEvents();
  }

  protected loadEvents(): void {
    this.loading.set(true);
    this.calendarService.getEvents().subscribe({
      next: ({ events }) => {
        this.events.set(events);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected addEvent(): void {
    this.error.set('');
    const payload = {
      ...this.newEvent,
      start_time: new Date(this.newEvent.start_time).toISOString(),
      end_time: new Date(this.newEvent.end_time).toISOString(),
    };
    this.calendarService.createEvent(payload).subscribe({
      next: () => {
        this.newEvent = { title: '', description: '', start_time: '', end_time: '', event_type: 'MEETING' };
        this.showForm.set(false);
        this.loadEvents();
      },
      error: (err) => this.error.set(err?.error?.error?.message ?? 'Could not create this calendar event.'),
    });
  }

  protected deleteEvent(event: WorkspaceEvent): void {
    if (!event.id || !confirm(`Delete "${event.title}"?`)) return;
    this.calendarService.deleteEvent(event.id).subscribe({ next: () => this.loadEvents() });
  }
}