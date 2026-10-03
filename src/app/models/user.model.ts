export interface AuthUser {
  id: string;
  name: string;
  email: string;
  authProvider: 'local' | 'google';
  profileImage: string | null;
  createdAt: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface SignupDetails {
  name: string;
  email: string;
  password: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}