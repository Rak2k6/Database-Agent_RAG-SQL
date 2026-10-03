import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('requires an email and a password of at least eight characters', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    expect(component['form'].controls.email.hasError('required')).toBe(true);
    expect(component['form'].controls.password.hasError('required')).toBe(true);
    expect(component['form'].controls.password.hasError('minlength')).toBe(false);

    component['form'].controls.password.setValue('short');
    expect(component['form'].controls.password.hasError('minlength')).toBe(true);
  });

  it('keeps sign in disabled until all required values are valid', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    const submitButton = fixture.nativeElement.querySelector('.primary-button') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    fixture.componentInstance['form'].setValue({
      email: 'person@example.com',
      password: 'password123',
      rememberMe: false,
    });
    fixture.detectChanges();
    expect(submitButton.disabled).toBe(false);
  });

  it('toggles password visibility', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component['togglePasswordVisibility']();
    fixture.detectChanges();

    const passwordInput = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    expect(passwordInput.type).toBe('text');
  });
});