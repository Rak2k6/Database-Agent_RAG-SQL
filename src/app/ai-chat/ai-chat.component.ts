import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AiChatService, AiChatSource } from './ai-chat.service';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: AiChatSource | AiChatSource[];
  sources?: AiChatSource[];
  timestamp: Date;
}

@Component({
  selector: 'app-ai-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-chat.component.html',
  styleUrl: './ai-chat.component.scss',
})
export class AiChatComponent {
  private readonly chat = inject(AiChatService);

  @ViewChild('composer') private composer?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('messageList') private messageList?: ElementRef<HTMLDivElement>;
  @ViewChild('launcher') private launcher?: ElementRef<HTMLButtonElement>;

  protected readonly isOpen = signal(false);
  protected readonly sending = signal(false);
  protected readonly draft = signal('');
  protected readonly messages = signal<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: "Hello! I'm Northstar AI. Ask me about projects, tasks, people, or events in your workspace.",
      timestamp: new Date(),
    },
  ]);

  protected readonly suggestions = [
    'How many active projects are there?',
    'List all active projects.',
    'Which projects are overdue?',
    'Which projects are due soon?',
    'How many pending tasks are there?',
    'Show high-priority tasks.',
    'Which tasks are overdue?',
    'Who has the most assigned tasks?',
    'Who is working on this project?',
    'How many users are in each department?',
    'What meetings are scheduled today?',
    'What are the upcoming events?',
  ];

  protected togglePanel(): void {
    if (this.isOpen()) {
      this.closePanel();
      return;
    }

    this.isOpen.set(true);
    setTimeout(() => this.composer?.nativeElement.focus());
    this.scrollToLatest();
  }

  protected closePanel(): void {
    this.isOpen.set(false);
    this.launcher?.nativeElement.focus();
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected sendMessage(suggestedMessage?: string): void {
    const content = (suggestedMessage ?? this.draft()).trim();
    if (!content || this.sending()) return;

    this.messages.update((messages) => [...messages, this.createMessage('user', content)]);
    this.draft.set('');
    this.sending.set(true);
    this.scrollToLatest();

    this.chat.sendMessage(content).subscribe({
      next: (response) => {
        this.messages.update((messages) => [
          ...messages,
          this.createMessage('assistant', response.answer || 'I could not find an answer for that request.', response.source, response.sources),
        ]);
        this.sending.set(false);
        this.scrollToLatest();
      },
      error: () => {
        this.messages.update((messages) => [
          ...messages,
          this.createMessage('assistant', "I couldn't process that request right now. Please try again."),
        ]);
        this.sending.set(false);
        this.scrollToLatest();
      },
    });
  }

  protected sourceItems(message: ChatMessage): AiChatSource[] {
    if (message.sources?.length) return message.sources;
    if (Array.isArray(message.source)) return message.source;
    return message.source ? [message.source] : [];
  }

  protected sourceLabel(source: AiChatSource): string {
    const label = typeof source === 'string'
      ? source
      : source.label ?? source.title ?? source.name ?? source.type ?? 'Source';
    return label.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.isOpen()) this.closePanel();
  }

  private createMessage(
    role: ChatMessage['role'],
    content: string,
    source?: AiChatSource | AiChatSource[],
    sources?: AiChatSource[],
  ): ChatMessage {
    return { id: crypto.randomUUID(), role, content, source, sources, timestamp: new Date() };
  }

  private scrollToLatest(): void {
    requestAnimationFrame(() => {
      const element = this.messageList?.nativeElement;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }
}