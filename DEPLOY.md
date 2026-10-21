# Deploying Leet Tracker to Render

This guide walks you through deploying Leet Tracker to [Render](https://render.com) using the included Blueprint (`render.yaml`), configured with a persistent 1 GB disk and HTTP Basic Auth password protection.

> **Note on AI Studio / Cloud Run Publishing**:
> Publishing or deploying from Google AI Studio runs the application in production mode (`NODE_ENV=production`). If `APP_PASSWORD` is not configured in the environment settings, the server automatically boots into **LOCKED MODE**: platform health checks (`GET /api/health`) will return 200 `{"ok":true}` so deployments succeed, but all user routes and API requests return HTTP 503 (`AUTH_NOT_CONFIGURED`) to strictly prevent unauthenticated access. Additionally, the container filesystem in Cloud Run is ephemeral and wiped on every rebuild or cold restart. **Render** (with its persistent disk mount and secret environment variable support) is the supported production host.

---

## Prerequisites

1. A **GitHub account** with this repository pushed to your personal or organization account.
2. A **Render account** (free to sign up at https://render.com).
3. A strong password for `APP_PASSWORD` (minimum **12 characters**; e.g., a randomly generated 20-character passphrase).

---

## Step-by-Step Deployment

### 1. Connect GitHub Repository to Render
1. Log in to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** at the top right and select **Blueprint**.
3. Connect your GitHub account if you haven't already.
4. Select the `leet-tracker` repository from your list.

### 2. Configure Service from the Blueprint
1. Render will automatically detect `render.yaml` in the root of the repository.
2. Review the detected service configuration:
   - **Service Name**: `leet-tracker`
   - **Environment**: `Node`
   - **Plan**: `Starter` (required for persistent disk support)
   - **Build Command**: `npm ci --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Disk**: 1 GB mounted at `/var/data`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `NODE_VERSION`: `22`
     - `DATABASE_PATH`: `/var/data/leet-tracker.db`
     - `APP_USERNAME`: `leet` (default, or customize)
     - `APP_PASSWORD`: Marked as a secret (`sync: false`)
3. Under the secret `APP_PASSWORD` prompt, input your secure password (must be **at least 12 characters** long).
4. Click **Apply**.

### 3. First Deployment
1. Render will provision the starter instance, attach the persistent disk at `/var/data`, install dependencies, run the build, and launch `node dist/server.mjs`.
2. Monitor the deployment logs. When the build completes and health checks pass (`/api/health`), the service status changes to **Live**.
3. Note your service URL (e.g., `https://leet-tracker.onrender.com`).

### 4. Logging In
1. Visit your Render URL in your browser.
2. Your browser will present an HTTP Basic Auth dialog:
   - **Username**: `leet` (or whatever you set `APP_USERNAME` to)
   - **Password**: Your `APP_PASSWORD`
3. Enter your credentials. Once verified, the Leet Tracker dashboard loads.

### 5. Import Initial Backup & Test Sync
1. Click the **Settings** gear icon in the top navigation bar.
2. Under **Backup Export & Import**, click **Import Backup**.
3. Choose your exported `leet-tracker-backup-YYYY-MM-DD.json` file.
4. Confirm replacement in the dialog. All your problems, approach notes, and reviews will be restored into the database.
5. In **Settings**, ensure your LeetCode username is configured.
6. Return to the dashboard and click **Sync from LeetCode** to verify that recent accepted submissions fetch properly.

---

## Maintenance & Best Practices

### Regular Backups
Although your SQLite database persists on the Render `/var/data` persistent disk, regular offsite backups are recommended:
1. Open **Settings** in the navbar.
2. Click **Export Backup**.
3. Keep the downloaded JSON file in your personal records or cloud storage.

### Rotating the Password
1. Navigate to your service in the Render Dashboard.
2. Open the **Environment** tab.
3. Edit `APP_PASSWORD` with a new value (minimum 12 characters).
4. Click **Save Changes**. Render will automatically restart your service with the new credentials.
5. In your browser, clear cached HTTP credentials or open a private window to enter the new password.

---

## Troubleshooting

### 1. Server Fails to Start: "APP_PASSWORD environment variable must be set in production mode"
- **Cause**: In production (`NODE_ENV=production`), the application refuses to start if `APP_PASSWORD` is missing.
- **Fix**: Go to the **Environment** tab on Render, ensure `APP_PASSWORD` is defined, and trigger a manual redeploy.

### 2. Server Fails to Start: "APP_PASSWORD must be at least 12 characters long"
- **Cause**: The password provided has fewer than 12 characters.
- **Fix**: Update `APP_PASSWORD` in the Render Environment tab to at least 12 characters and redeploy.

### 3. Continuous 401 Loop or Cannot Log In
- **Cause**: Browser cached invalid Basic Auth credentials, or username/password mismatch.
- **Fix**:
  - Verify `APP_USERNAME` (default is `leet`) and `APP_PASSWORD` in your Render Environment settings.
  - Open an Incognito/Private window to force the browser to prompt for credentials anew.
  - Clear site data and cookies for the domain.

### 4. Database Directory / Disk Not Mounted Error
- **Cause**: `DATABASE_PATH` points to a path where the directory does not exist or lacks write permissions.
- **Fix**:
  - Verify that the disk is attached in Render under **Disks** (`mountPath: /var/data`).
  - Verify `DATABASE_PATH=/var/data/leet-tracker.db`. The server automatically creates the directory if missing and verifies read/write access.

### 5. Blank Page on Initial Load
- **Cause**: The client build assets were not generated or the route is returning an unexpected response.
- **Fix**:
  - Check the deploy logs in Render to confirm that `vite build` and `esbuild` completed with exit code 0.
  - Check browser DevTools console for network errors.
  - Confirm that `/api/health` returns `{"ok": true}`.
