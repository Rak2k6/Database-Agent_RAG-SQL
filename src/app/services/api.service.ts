import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.API_URL.replace(/\/$/, '');

  get<T>(path: string) {
    return this.http.get<T>(this.endpoint(path));
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(this.endpoint(path), body);
  }

  put<T>(path: string, body: unknown) {
    return this.http.put<T>(this.endpoint(path), body);
  }

  patch<T>(path: string, body?: unknown) {
    return this.http.patch<T>(this.endpoint(path), body);
  }

  delete<T>(path: string) {
    return this.http.delete<T>(this.endpoint(path));
  }

  private endpoint(path: string): string {
    const route = this.baseUrl.endsWith('/api') && path.startsWith('/api/') ? path.slice(4) : path;
    return `${this.baseUrl}${route}`;
  }
}
