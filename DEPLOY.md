# Deploying Leet Tracker to Render

This guide walks through deploying Leet Tracker to [Render](https://render.com) with the included Blueprint (`render.yaml`), a persistent 1 GB disk for SQLite storage, multi-user LeetCode authentication, and reverse proxy trust.

---

## Authentication Architecture Overview

Leet Tracker features a secure multi-user authentication model:
- **Profile Ownership Verification**: New users verify ownership of their public LeetCode profile by generating a temporary 6-digit challenge code and pasting it into their LeetCode profile's "About Me" bio.
- **Server-Side Keyed Hashes**: 6-digit verification codes are hashed using **HMAC-SHA256** keyed with a high-entropy server secret (`VERIFICATION_SECRET`). This protects against precomputation and rainbow-table attacks against the small 6-digit keyspace in case of database leakage.
- **Password Security**: Passwords (minimum 12 characters) are salted and hashed using Node.js native `crypto.scrypt` (N=16384, r=8, p=1).
- **Session Tokens & Cookies**: Session tokens are generated with 32 bytes of cryptographic randomness, hashed with SHA-256 in the database, and stored exclusively in **HttpOnly, SameSite=Lax** cookies (`leet_session`) with `Secure` enabled in production (`NODE_ENV=production`) and a 7-day lifetime (`Max-Age=604800`). `SameSite=Lax` allows safe top-level navigations while strictly blocking cross-site request forgery when combined with custom header CSRF protection. Tokens are never exposed in client-side JavaScript or API response bodies.
- **Multi-User Isolation**: Every database record, review, note, and query is scoped strictly to the authenticated `user_id`.
- **Anti-DoS Rate Limiting**: In-memory sliding-window rate limiters defend against IP and account brute-force without enabling username lockout DoS for legitimate users. Memory is strictly bounded, and active security records are never evicted under key churn.
- **Reverse Proxy Trust**: The application uses Express `trust proxy` configuration to extract `req.ip` securely based on deployment topology.

---

## Prerequisites

1. A **GitHub account** with this repository pushed to your personal or organization account.
2. A **Render account** (sign up at https://render.com).
3. A persistent disk (included in Render's Starter plan) to preserve your SQLite database across restarts.

---

## Step-by-Step Deployment

### 1. Connect GitHub Repository to Render
1. Log in to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** at the top right and select **Blueprint**.
3. Connect your GitHub account and select your `leet-tracker` repository.

### 2. Configure Service from the Blueprint
1. Render automatically detects `render.yaml` in the root of the repository:
   - **Service Name**: `leet-tracker`
   - **Environment**: `Node`
   - **Plan**: `Starter` (required for persistent disk support)
   - **Build Command**: `npm ci --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Disk**: 1 GB mounted at `/var/data`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `NODE_VERSION`: `22.22.2`
     - `DATABASE_PATH`: `/var/data/leet-tracker.db`
     - `VERIFICATION_SECRET`: Automatically generated 32-character random string (`generateValue: true`)
     - `TRUST_PROXY`: `1` (ensures `req.ip` trust for Render's single-hop reverse proxy)
2. Click **Apply**.

Keep `VERIFICATION_SECRET` stable after deployment. Changing it affects outstanding profile verification challenges. Configure it as a deployment secret and do not commit a real value to the repository.

### Hosting limits

Run one application instance with the included SQLite database. SQLite and the in-memory rate limiters are local to an instance, so adding replicas requires moving persistence and rate limiting to shared services first. Keep offsite backup exports in a separate secure location; the attached disk protects against routine restarts, not every storage or account failure.

### 3. First Deployment & Health Check
1. Render will provision the starter instance, attach the persistent disk at `/var/data`, install dependencies cleanly using `package-lock.json`, compile the frontend and backend bundles, and start `node dist/server.mjs`.
2. The platform health check endpoint `GET /api/health` returns `200 {"ok":true}`. The server exits during startup if production is missing a `VERIFICATION_SECRET` of at least 16 characters.
3. When the service status changes to **Live**, open your service URL (e.g. `https://leet-tracker.onrender.com`).

### 4. Creating Your Account
1. On your first visit, click **Create Account**.
2. Enter your public LeetCode username.
3. Copy the generated 6-digit verification code.
4. Open your LeetCode profile settings and paste the code into your **About Me** section, then save your profile.
5. In Leet Tracker, click **Verify Profile**.
6. Set a strong password (minimum 12 characters) to complete registration and log in.

---

## Environment Variables & Proxy Trust Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Set to `production` in live deployments. |
| `NODE_VERSION` | Yes | `22.22.2` | Node.js runtime version (>= 22.22.2). |
| `PORT` | No | `3000` | Port for the HTTP server to listen on. |
| `HOST` | No | `0.0.0.0` | Host interface to bind to. |
| `DATABASE_PATH` | Yes | `./data/leet-tracker.db` | Absolute path to the SQLite database on persistent disk (`/var/data/leet-tracker.db`). |
| `VERIFICATION_SECRET` | Yes in production | Development fallback | At least 16 characters. Secret key used for HMAC-SHA256 verification code hashing. |
| `TRUST_PROXY` | No | `1` in prod | Reverse proxy hop count or configuration (see Proxy Trust section below). |
| `AUTH_LOGIN_MAX_ATTEMPTS` | No | `5` | Max failed login attempts per account+IP before 15m delay. |
| `AUTH_LOGIN_IP_MAX_ATTEMPTS` | No | `20` | Max login attempts per IP before 15m delay. |
| `AUTH_VERIFY_MAX_ATTEMPTS` | No | `15` | Max verification code attempts per IP before 15m delay. |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limiter window in ms (15 minutes). |

### Proxy Trust Architecture Assumptions
Express `req.ip` relies on the `trust proxy` setting to identify the client's true IP from the `X-Forwarded-For` header:
- **Render / Cloud Run / Single-Hop Reverse Proxies**: Set `TRUST_PROXY=1`. The application trusts the single reverse proxy immediately in front of it.
- **Direct Internet Exposure**: When running a node server directly accessible from the public internet without an upstream reverse proxy, set `TRUST_PROXY=false` (the default in non-production). Setting `TRUST_PROXY=1` on a directly exposed server would allow clients to spoof `X-Forwarded-For` headers.
- **Multi-Hop / CDN Deployments (e.g. Cloudflare -> Reverse Proxy -> Node)**: Set `TRUST_PROXY` to the exact hop count (e.g. `2`) or an array/CIDR string of trusted proxy IP ranges so untrusted client headers are ignored.

---

## Maintenance & Backups

### Offsite Backups
Although your SQLite database persists on the Render `/var/data` disk across deploys, periodic offsite backups are recommended:
1. Log in and open **Settings** in the top navigation bar.
2. Under **Backup Export & Import**, click **Export Backup**.
3. Store the downloaded JSON backup file in a secure location.
4. Backups can be restored at any time; all problems, approach notes, and review intervals are preserved.
