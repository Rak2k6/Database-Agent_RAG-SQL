import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';

const matchingPasswords: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
};

@Component({
  selector: 'app-signup',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <a class="brand-lockup" routerLink="/login" aria-label="Northstar AI home"><span class="brand-mark">N</span><span class="brand-name">northstar<span>AI</span></span></a>
      <section class="auth-card" aria-labelledby="signup-title">
        <p class="eyebrow">BUILD YOUR WORKSPACE</p>
        <h1 id="signup-title">Create your account</h1>
        <p class="subtitle">A thoughtful place for your team's best work.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label for="full-name">Full name</label>
          <div class="input-wrap"><input id="full-name" formControlName="name" autocomplete="name" placeholder="Enter your full name" /></div>
          @if (form.controls.name.touched && form.controls.name.invalid) { <p class="field-error">Name is required</p> }
          <label for="signup-email">Work email</label>
          <div class="input-wrap"><input id="signup-email" type="email" formControlName="email" autocomplete="email" placeholder="name@northstarai.com" /></div>
          @if (form.controls.email.touched && form.controls.email.hasError('required')) { <p class="field-error">Email is required</p> }
          @else if (form.controls.email.touched && (form.controls.email.hasError('email') || form.controls.email.hasError('pattern'))) { <p class="field-error">Please enter a valid work email (@northstarai.com)</p> }
          <label for="signup-password">Password</label>
          <div class="input-wrap"><input id="signup-password" type="password" formControlName="password" autocomplete="new-password" placeholder="At least 8 characters" /></div>
          @if (form.controls.password.touched && form.controls.password.hasError('required')) { <p class="field-error">Password is required</p> }
          @else if (form.controls.password.touched && form.controls.password.hasError('minlength')) { <p class="field-error">Password must contain at least 8 characters</p> }
          <label for="confirm-password">Confirm password</label>
          <div class="input-wrap"><input id="confirm-password" type="password" formControlName="confirmPassword" autocomplete="new-password" placeholder="Re-enter your password" /></div>
          @if (form.controls.confirmPassword.touched && form.hasError('passwordMismatch')) { <p class="field-error">Passwords do not match</p> }
          <label class="terms"><input type="checkbox" formControlName="terms" /><span>I agree to the Terms &amp; Conditions</span></label>
          @if (form.controls.terms.touched && form.controls.terms.invalid) { <p class="field-error">You must accept the Terms &amp; Conditions</p> }
          @if (errorMessage()) { <p class="auth-error" role="alert">{{ errorMessage() }}</p> }
          <button class="primary-button" type="submit" [disabled]="form.invalid || isSubmitting()">{{ isSubmitting() ? 'Creating account…' : 'Create account' }}</button>
        </form>
        <div class="divider"><span></span><b>OR</b><span></span></div>
        <button class="google-button" type="button" [disabled]="isSubmitting()" (click)="signUpWithGoogle()"><span class="google-g">G</span>Continue with Google</button>
        <p class="footnote">Already have an account? <a routerLink="/login">Sign in</a></p>
      </section>
    </main>
  `,
  styleUrl: './auth-pages.component.scss',
})
export class SignupComponent {
  private readonly builder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly form = this.builder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.pattern(/^[a-zA-Z0-9._%+-]+@northstarai\.com$/i)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', Validators.required],
    terms: [false, Validators.requiredTrue],
  }, { validators: matchingPasswords });

  protected submit(): void {
    if (this.form.invalid || this.isSubmitting()) { this.form.markAllAsTouched(); return; }
    const { name, email, password } = this.form.getRawValue();
    this.isSubmitting.set(true);
    this.auth.signup({ name, email, password }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: (error: unknown) => this.errorMessage.set(AuthService.getErrorMessage(error, 'Registration failed. Please try again.')),
    });
  }

  protected signUpWithGoogle(): void {
    const triggerGoogleSignIn = (clientId: string) => {
      if (!clientId || !window.google?.accounts.id) {
        this.errorMessage.set('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID to the API .env file.');
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          if (!credential) { this.errorMessage.set('Google sign-in could not be verified.'); return; }
          this.isSubmitting.set(true);
          this.auth.signInWithGoogle(credential).pipe(finalize(() => this.isSubmitting.set(false))).subscribe({
            next: () => void this.router.navigateByUrl('/dashboard'),
            error: (error: unknown) => this.errorMessage.set(AuthService.getErrorMessage(error, 'Google sign-in failed. Please try again.')),
          });
        },
      });
      window.google.accounts.id.prompt();
    };

    if (environment.googleClientId) {
      triggerGoogleSignIn(environment.googleClientId);
    } else {
      this.auth.getConfig().subscribe({
        next: (config) => triggerGoogleSignIn(config.googleClientId),
        error: () => this.errorMessage.set('Could not load server configuration.'),
      });
    }
  }
}

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <a class="brand-lockup" routerLink="/login" aria-label="Northstar AI home"><span class="brand-mark">N</span><span class="brand-name">northstar<span>AI</span></span></a>
      <section class="auth-card" aria-labelledby="forgot-title">
        <p class="eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="forgot-title">Forgot password?</h1>
        <p class="subtitle">Enter your account email and we'll help you get back in.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label for="recovery-email">Work email</label>
          <div class="input-wrap"><input id="recovery-email" type="email" formControlName="email" autocomplete="email" placeholder="Enter your email" /></div>
          @if (form.controls.email.touched && form.controls.email.hasError('required')) { <p class="field-error">Email is required</p> }
          @else if (form.controls.email.touched && form.controls.email.hasError('email')) { <p class="field-error">Please enter a valid email address</p> }
          @if (errorMessage()) { <p class="auth-error" role="alert">{{ errorMessage() }}</p> }
          @if (result()) {
            <div class="success-message" role="status">
              <strong>{{ result()?.message }}</strong>
              @if (result()?.delivery === 'mock' && result()?.resetUrl) {
                <p>Demo mode: no email was sent. Use this one-time link (expires in one hour):</p>
                <a class="reset-link" [routerLink]="resetRoute()">Open demo reset link</a>
              }
            </div>
          }
          <button class="primary-button" type="submit" [disabled]="form.invalid || isSubmitting()">{{ isSubmitting() ? 'Sending…' : 'Send reset link' }}</button>
        </form>
        <p class="footnote"><a routerLink="/login">Back to sign in</a></p>
      </section>
    </main>
  `,
  styleUrl: './auth-pages.component.scss',
})
export class ForgotPasswordComponent {
  private readonly builder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly result = signal<{ message: string; delivery?: 'mock'; resetUrl?: string } | null>(null);
  protected readonly form = this.builder.nonNullable.group({ email: ['', [Validators.required, Validators.email]] });

  protected submit(): void {
    if (this.form.invalid || this.isSubmitting()) { this.form.markAllAsTouched(); return; }
    this.errorMessage.set('');
    this.result.set(null);
    this.isSubmitting.set(true);
    this.auth.forgotPassword(this.form.controls.email.value).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe({
      next: (response) => this.result.set(response),
      error: (error: unknown) => this.errorMessage.set(AuthService.getErrorMessage(error, 'Password recovery could not be started. Please try again.')),
    });
  }

  protected resetRoute(): string {
    const resetUrl = this.result()?.resetUrl;
    return resetUrl ? new URL(resetUrl).pathname : '/forgot-password';
  }
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <a class="brand-lockup" routerLink="/login" aria-label="Northstar AI home"><span class="brand-mark">N</span><span class="brand-name">northstar<span>AI</span></span></a>
      <section class="auth-card" aria-labelledby="reset-title">
        <p class="eyebrow">SECURE ACCOUNT ACCESS</p>
        <h1 id="reset-title">Set a new password</h1>
        <p class="subtitle">Choose a strong password you haven't used before.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label for="new-password">New password</label>
          <div class="input-wrap"><input id="new-password" type="password" formControlName="password" autocomplete="new-password" placeholder="At least 8 characters" /></div>
          @if (form.controls.password.touched && form.controls.password.hasError('minlength')) { <p class="field-error">Password must contain at least 8 characters</p> }
          <label for="confirm-new-password">Confirm new password</label>
          <div class="input-wrap"><input id="confirm-new-password" type="password" formControlName="confirmPassword" autocomplete="new-password" placeholder="Re-enter your password" /></div>
          @if (form.controls.confirmPassword.touched && form.hasError('passwordMismatch')) { <p class="field-error">Passwords do not match</p> }
          @if (errorMessage()) { <p class="auth-error" role="alert">{{ errorMessage() }}</p> }
          @if (success()) { <div class="success-message" role="status">Password updated. <a routerLink="/login">Sign in</a> with your new password.</div> }
          <button class="primary-button" type="submit" [disabled]="form.invalid || isSubmitting() || success()">{{ isSubmitting() ? 'Updating…' : 'Update password' }}</button>
        </form>
        <p class="footnote"><a routerLink="/login">Back to sign in</a></p>
      </section>
    </main>
  `,
  styleUrl: './auth-pages.component.scss',
})
export class ResetPasswordComponent {
  private readonly builder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly isSubmitting = signal(false);
  protected readonly success = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly form = this.builder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', Validators.required],
  }, { validators: matchingPasswords });

  protected submit(): void {
    if (this.form.invalid || this.isSubmitting()) { this.form.markAllAsTouched(); return; }
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) { this.errorMessage.set('This reset link is invalid. Request a new one.'); return; }
    this.isSubmitting.set(true);
    this.auth.resetPassword(token, this.form.controls.password.value).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe({
      next: () => this.success.set(true),
      error: (error: unknown) => this.errorMessage.set(AuthService.getErrorMessage(error, 'Password could not be updated. Request a new reset link.')),
    });
  }
}