import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TeamMember } from '../../models/workspace.model';
import { TeamService } from '../../services/team.service';

@Component({
  selector: 'app-team',
  imports: [FormsModule],
  templateUrl: './team.component.html',
})
export class TeamComponent {
  private readonly teamService = inject(TeamService);

  protected readonly members = signal<TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly department = signal('');
  protected readonly showForm = signal(false);
  protected readonly error = signal('');
  protected newMember = { name: '', email: '', role: 'Member', department: 'Engineering' };

  constructor() {
    this.loadMembers();
  }

  protected loadMembers(): void {
    this.loading.set(true);
    this.teamService.getTeam(this.search(), this.department()).subscribe({
      next: ({ users }) => {
        this.members.set(users);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected addMember(): void {
    this.error.set('');
    this.teamService.addMember(this.newMember).subscribe({
      next: () => {
        this.newMember = { name: '', email: '', role: 'Member', department: 'Engineering' };
        this.showForm.set(false);
        this.loadMembers();
      },
      error: (err) => this.error.set(err?.error?.error?.message ?? 'Could not add team member.'),
    });
  }
}