# Northstar AI Workplace

Existing Angular login design is preserved and now connects to a local Express authentication API. The API stores account and workplace data in PostgreSQL, hashes local passwords with bcrypt, verifies Google Identity tokens on the server, and issues revocable HttpOnly session cookies backed by hashed opaque session IDs. AI database questions use the same PostgreSQL database through a read-only query path. Dashboard content is demo data isolated from UI components in `WorkspaceService`.

## Run the demo

Use a supported even-numbered Node LTS release (Node 22.22.3+ or 24.15.0+ for the current Angular CLI). Install dependencies with `npm install`. Start the API and Angular app in separate terminals:

```bash
npm run api:dev
npm start
```

Open `http://localhost:4200/login`. Angular proxies `/api` to `http://localhost:3000`. Set `PG_URI` for the PostgreSQL connection. The existing `server/data/northstar.sqlite` file is retained as a rollback/reference backup and is excluded from Git.

The demo no longer contains hardcoded frontend credentials. Create an account at `/signup`, or use forgot password to exercise the documented mock reset flow. Dashboard access is protected; successful signup/login redirects to `/dashboard`.

## Pages and API

- `/login` preserves the original login layout and behavior, now backed by the API.
- `/signup` creates a bcrypt-hashed account and starts a session.
- `/forgot-password` and `/reset-password/:token` use one-hour, single-use, SHA-256-hashed tokens.
- `/dashboard`, `/projects`, `/tasks`, `/team`, `/calendar`, `/documents`, `/reports`, and `/settings` require an active session.
- `/api/auth/login`, `/signup`, `/google`, `/forgot-password`, `/reset-password`, `/logout`, and `/me` provide the auth API. `/api/health` is a health check.

Run frontend tests/build and backend typecheck:

```bash
npm test -- --watch=false
npm run build
npm run api:check
npm run api:test
```

## Google Identity setup

Google sign-in is implemented with Google Identity Services. Set the OAuth **Web client ID** in `src/environments/environment.ts` as `googleClientId` for development and `src/environments/environment.production.ts` for production. Set the same client ID as `GOOGLE_CLIENT_ID` in the API environment. The API verifies the returned ID token's signature, audience, and verified email before creating or authenticating a user. A client ID is public configuration; do not put a client secret in Angular. Google Cloud must allow the app's origins. The button shows a clear configuration message until a client ID is supplied.

## Environment and production notes

Copy `.env.example` to `.env` for local API configuration. `PG_URI` configures PostgreSQL and `WEB_ORIGIN` configures allowed browser origins. `DB_PATH` is retained only for the standalone legacy SQLite compatibility code; the API and AI query path use PostgreSQL. Set `NODE_ENV=production` behind HTTPS so session cookies are Secure. `API_URL` in the Angular environment should be the same-origin API path or deployment API base URL.

Password hashes, reset-token hashes, Google IDs, and database rows stay in the server. API responses only include the public user profile. Session credentials are HttpOnly, SameSite=Lax cookies; the server stores only session hashes and revokes sessions at logout and password reset. Angular sends cookies through a credentialed interceptor. Deploy with HTTPS, a managed database/backups, CSRF/origin policy appropriate to the domain, monitoring, and secrets management before production use.

## Password reset demo mode

`RESET_EMAIL_MODE=mock` is explicit and is the default for this demo. For an existing account, the recovery API returns a demo reset URL and states that no email was sent. The token is random, stored only as a SHA-256 hash, expires after one hour, and is consumed once. Unknown addresses receive a generic response. Set up a real email provider and deliver links server-side before changing the email mode; the endpoint will fail closed rather than claim an email was sent when delivery is unavailable.
