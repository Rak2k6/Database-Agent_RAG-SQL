import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, Observable, of, shareReplay, tap } from 'rxjs';
import { ApiErrorBody, AuthCredentials, AuthUser, SignupDetails } from '../models/user.model';
import { ApiService } from './api.service';

interface AuthResponse {
  user: AuthUser;
}

export interface ForgotPasswordResponse {
  message: string;
  delivery?: 'mock';
  resetUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private sessionRequest?: Observable<AuthUser | null>;
  private readonly initialized = signal(false);

  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  restoreSession(): Observable<AuthUser | null> {
    if (this.initialized()) return of(this.currentUser());
    if (this.sessionRequest) return this.sessionRequest;

    this.sessionRequest = this.api.get<AuthResponse>('/auth/me').pipe(
      map((response) => response.user),
      catchError(() => of(null)),
      tap((user) => {
        this.currentUser.set(user);
        this.initialized.set(true);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.sessionRequest;
  }

  login(credentials: AuthCredentials): Observable<AuthUser> {
    return this.api.post<AuthResponse>('/auth/login', credentials).pipe(map((response) => this.acceptUser(response)));
  }

  signup(details: SignupDetails): Observable<AuthUser> {
    return this.api.post<AuthResponse>('/auth/signup', details).pipe(map((response) => this.acceptUser(response)));
  }

  getConfig(): Observable<{ googleClientId: string }> {
    return this.api.get<{ googleClientId: string }>('/config').pipe(shareReplay(1));
  }

  signInWithGoogle(credential: string): Observable<AuthUser> {
    return this.api.post<AuthResponse>('/auth/google', { credential }).pipe(map((response) => this.acceptUser(response)));
  }

  forgotPassword(email: string): Observable<ForgotPasswordResponse> {
    return this.api.post<ForgotPasswordResponse>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('/auth/reset-password', { token, password });
  }

  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout', {}).pipe(
      tap(() => {
        this.currentUser.set(null);
        this.initialized.set(true);
        this.sessionRequest = undefined;
        void this.router.navigateByUrl('/login');
      }),
      catchError(() => {
        this.currentUser.set(null);
        this.initialized.set(true);
        this.sessionRequest = undefined;
        void this.router.navigateByUrl('/login');
        return of(undefined);
      }),
    );
  }

  static getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as ApiErrorBody | null;
      return body?.error?.message ?? fallback;
    }
    return fallback;
  }

  private acceptUser(response: AuthResponse): AuthUser {
    this.currentUser.set(response.user);
    this.initialized.set(true);
    this.sessionRequest = undefined;
    return response.user;
  }
}