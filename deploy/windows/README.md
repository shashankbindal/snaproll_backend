# SnapRoll backend on Windows Server 2019

This deployment keeps the existing PostgreSQL service and database untouched. SnapRoll uses its own PostgreSQL cluster on `127.0.0.1:5440`, its own database/user, and a Node process bound to `127.0.0.1:8443`. IIS terminates public HTTPS and reverse-proxies to Node.

## Required components

- Node.js 20 LTS or newer
- PostgreSQL 15+ in a separate cluster on port `5440`
- IIS with URL Rewrite and Application Request Routing (ARR)
- A DNS name pointing to the VM, for example `snaproll-api.sntrgipt.com`
- An HTTPS certificate bound to that IIS site

## Backend installation

From an elevated PowerShell window:

```powershell
cd F:\snaproll\snaproll_backend
copy .env.example .env
notepad .env
npm ci --omit=dev
node src\migrate.js
```

Set at least these values in `.env`:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=8443
PUBLIC_BASE_URL=https://snaproll-api.sntrgipt.com
GOOGLE_REDIRECT_URI=https://snaproll-api.sntrgipt.com/auth/google/callback
DATABASE_URL=postgres://snaproll:URL_ENCODED_PASSWORD@127.0.0.1:5440/snaproll
```

Do not commit `.env`. If the database password contains `@`, `:`, `/`, `?`, or `#`, URL-encode it.

## Run Node as a Windows service

NSSM is a practical service wrapper for Node on Windows. After installing NSSM:

```powershell
nssm install SnaprollApi "C:\Program Files\nodejs\node.exe" "F:\snaproll\snaproll_backend\src\server.js"
nssm set SnaprollApi AppDirectory "F:\snaproll\snaproll_backend"
nssm set SnaprollApi Start SERVICE_AUTO_START
nssm set SnaprollApi AppExit Default Restart
nssm start SnaprollApi
```

Check the local service before configuring IIS:

```powershell
Invoke-WebRequest http://127.0.0.1:8443/healthz
```

## Configure IIS

Install IIS URL Rewrite and ARR, enable proxy mode, create an IIS site for the API hostname, bind the HTTPS certificate, and copy this directory's `web.config` into the IIS site root. Enable ARR proxy:

```powershell
Import-Module WebAdministration
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter 'system.webServer/proxy' -name enabled -value True
```

The public callback must be reachable at:

```text
https://snaproll-api.sntrgipt.com/auth/google/callback
```

Register that exact URI in the Google OAuth Web application client. The Android app's `snaproll://oauth/callback` URI is only the final app handoff and is not registered in Google Cloud.

## Firewall and verification

Expose only HTTPS (normally TCP 443) to the campus/approved network. Keep TCP 5433, 5440, and 8443 local to the VM. Verify:

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 443,5433,5440,8443
Invoke-WebRequest https://snaproll-api.sntrgipt.com/healthz
```

The PRD requires consent, biometric-template version checks, class authorization, audit records, retention/deletion jobs, and manual attendance fallback before a real classroom pilot. This repository currently provides the authentication foundation and deployment shell; those biometric workflow endpoints must be implemented and reviewed before enabling them in production.
