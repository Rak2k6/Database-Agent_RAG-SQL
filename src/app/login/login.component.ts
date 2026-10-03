import { DestroyRef, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthCredentials, AuthUser } from '../models/user.model';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private googleInitialized = false;

  protected readonly passwordVisible = signal(false);
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    rememberMe: [false],
  });

  protected submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const credentials: AuthCredentials = this.form.getRawValue();
    this.authenticate(this.authService.login(credentials));
  }

  protected signInWithGoogle(): void {
    const triggerGoogleSignIn = (clientId: string) => {
      if (!clientId) {
        this.errorMessage.set('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID to the API .env file.');
        return;
      }

      if (!window.google?.accounts.id) {
        this.errorMessage.set('Google sign-in is temporarily unavailable. Please try again later.');
        return;
      }

      if (!this.googleInitialized) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            if (!credential) {
              this.errorMessage.set('Google sign-in did not return a verified account. Please try again.');
              return;
            }
            this.authenticate(this.authService.signInWithGoogle(credential));
          },
        });
        this.googleInitialized = true;
      }

      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          this.errorMessage.set('Google sign-in could not be opened. Check your browser settings and try again.');
        }
      });
    };

    if (environment.googleClientId) {
      triggerGoogleSignIn(environment.googleClientId);
    } else {
      this.authService.getConfig().subscribe({
        next: (config) => triggerGoogleSignIn(config.googleClientId),
        error: () => this.errorMessage.set('Could not load server configuration.'),
      });
    }
  }

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  private authenticate(request: Observable<AuthUser>): void {
    this.errorMessage.set('');
    this.isSubmitting.set(true);

    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe({
        next: () => this.redirectAfterSignIn(),
        error: (error: unknown) => {
          this.errorMessage.set(AuthService.getErrorMessage(error, 'Sign in could not be completed. Please try again.'));
        },
      });
  }

  private redirectAfterSignIn(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const safeReturnUrl = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/dashboard';
    void this.router.navigateByUrl(safeReturnUrl);
  }
}