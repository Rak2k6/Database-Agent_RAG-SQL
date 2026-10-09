import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { AiChatComponent } from './ai-chat.component';

describe('AiChatComponent', () => {
  const chatService = {
    sendMessage: vi.fn(() => of({
      answer: 'Here are the results.',
      table: {
        columns: Array.from({ length: 18 }, (_, index) => `column_${index}`),
        rows: Array.from({ length: 100 }, (_, row) => Array.from({ length: 18 }, (_, column) => `${row}-${column}-${'long content '.repeat(20)}`)),
      },
    })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AiChatComponent],
      providers: [provideRouter([]), { provide: AiChatService, useValue: chatService }],
    }).compileComponents();
  });

  it('shows the welcome suggestions, sends their actual query, and New Chat resets to welcome', () => {
    const fixture = TestBed.createComponent(AiChatComponent);
    fixture.detectChanges();

    const suggestions = [...fixture.nativeElement.querySelectorAll('.welcome-suggestion')] as HTMLButtonElement[];
    expect(suggestions.map((button) => button.textContent?.replace('↗', '').trim())).toEqual([
      'How many active projects are there?',
      'Show my tasks',
      'What are the latest project updates?',
      'Who has the most tasks?',
      'Show upcoming events',
    ]);
    suggestions[1].click();
    fixture.detectChanges();
    expect(chatService.sendMessage).toHaveBeenCalledWith('Show my tasks');
    expect(fixture.nativeElement.textContent).toContain('Here are the results.');
    expect(fixture.nativeElement.textContent).toContain('Show my tasks');
    expect(fixture.nativeElement.querySelectorAll('.conversation-list .message')).toHaveLength(2);

    (fixture.nativeElement.querySelector('.new-chat-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.welcome-screen')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.conversation-list')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Here are the results.');
  });

  it('keeps wide and long result tables scrollable inside the table while the composer stays available', () => {
    const fixture = TestBed.createComponent(AiChatComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();

    fixture.componentInstance['sendMessage']('show a large result');
    fixture.detectChanges();

    const tableContainer = fixture.nativeElement.querySelector('.result-table-wrap') as HTMLElement;
    const messageList = fixture.nativeElement.querySelector('.message-list') as HTMLElement;
    const panel = fixture.nativeElement.querySelector('.chat-panel') as HTMLElement;
    const composer = fixture.nativeElement.querySelector('#northstar-chat-input') as HTMLTextAreaElement;

    expect(fixture.nativeElement.querySelectorAll('.result-table thead th')).toHaveLength(18);
    expect(fixture.nativeElement.querySelectorAll('.result-table tbody tr')).toHaveLength(100);
    expect(tableContainer.getAttribute('role')).toBe('region');
    expect(tableContainer.getAttribute('tabindex')).toBe('0');
    expect(messageList).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(composer).toBeTruthy();
  });
});
