import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../services/api.service';

export type AiChatSource = string | {
  type?: string;
  label?: string;
  title?: string;
  name?: string;
};

export interface AiChatTable {
  columns: string[];
  rows: unknown[][];
}

export interface AiChatResponse {
  answer: string;
  source?: AiChatSource | AiChatSource[];
  sources?: AiChatSource[];
  table?: AiChatTable;
}

@Injectable({ providedIn: 'root' })
export class AiChatService {
  private readonly api = inject(ApiService);

  sendMessage(message: string): Observable<AiChatResponse> {
    return this.api.post<AiChatResponse>('/api/ai/chat', { message: message.trim() });
  }
}