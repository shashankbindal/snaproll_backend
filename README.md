# SnapRoll API

This service is the institution-hosted authentication boundary for the Kotlin app. It uses Google OAuth 2.0 Authorization Code + PKCE, then issues a short-lived one-time exchange code and an opaque session token. The server—not the Android client—enforces that the verified Google email is exactly in the `@rgipt.ac.in` domain.

## Windows Server 2019 VM

Install Node.js 20+ and PostgreSQL 15+, copy `.env.example` to `.env`, and replace `snaproll-api.rgipt.ac.in` with the real DNS name if different. The Node process binds to `127.0.0.1` by default; IIS or another reverse proxy should terminate HTTPS on the VM. Register a Google OAuth **Web application** client with `GOOGLE_REDIRECT_URI` as an authorized redirect URI. The Android custom scheme is only the final handoff and is not a Google redirect URI.

```powershell
npm install
node src/migrate.js
npm start
```

For a persistent Windows service, run the Node command through NSSM or Task Scheduler. Put IIS/reverse proxy or the campus gateway in front of the Node process for TLS and forward `/auth/*`, `/v1/*`, and `/healthz` to `http://127.0.0.1:8443`. Restrict PostgreSQL to localhost/private VM networking, back up the database encrypted, and keep `.env` out of source control. Run `GET /healthz` for readiness. Change `API_BASE_URL` in the Android `AuthConfig.kt` to the same HTTPS hostname before building the phone APK.

The schema intentionally stores OAuth transactions, one-time codes, and opaque session hashes only. It does not store Google access tokens or face images. Add the PRD's consent, roster, enrollment-template, attendance-job, audit, and retention tables before enabling biometric API endpoints.

## Google restriction

The callback requires `email_verified=true` and an exact lower-case suffix of `@rgipt.ac.in`; accounts from every other domain are rejected before a local user or session is created. Google OAuth Console should also be configured with the RGIPT organization policy where available, but the server check remains authoritative.
