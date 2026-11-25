# Deploying Leet Tracker on Netlify

This project uses Netlify to host the React frontend and Express server, and Netlify Database for persistent PostgreSQL storage. Local development continues to use SQLite.

## Cost controls

- Choose Netlify's **Free** plan and leave auto-recharge disabled. Free has a hard monthly usage limit; the site can pause when its credits run out.
- Netlify Server is currently in Early Access and sleeps after a few idle minutes, so the first request after inactivity may take longer.
- Netlify Database compute and bandwidth use plan credits. Free accounts have per-database usage caps; when the account reaches its monthly hard limit, service pauses rather than charging extra.
- Use the included `*.netlify.app` address. A custom domain requires owning a domain name.

Plan limits and prices can change; review Netlify's [Free plan details](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) before publishing.

## One-time setup

1. Push the reviewed `development` branch to GitHub, then import `Lokesh-0209/Leet-Tracker` in Netlify.
2. In the Netlify project, create a database under **Data & Storage → Database**. Confirm the project remains on the Free plan.
3. Set `VERIFICATION_SECRET` in the Netlify environment variables to a private random value of at least 16 characters. Do not commit this value.
4. Set `NODE_ENV` to `production`. Netlify provides the managed database connection at runtime through `@netlify/database`.
5. Deploy the `development` branch. Netlify uses Node.js 24 (required by Netlify Server), runs `npm run build`, publishes `dist`, and starts the Express app from `netlify/server/index.mjs`.

The first server start creates the PostgreSQL schema using the versioned schema migration in `src/db/postgresSchema.ts`. API and website requests share the same domain, so the existing session-cookie and CSRF protections continue to apply.

## Copy existing local SQLite data (optional)

The local database is ignored by Git and is not uploaded with a deployment. To copy it into the Netlify Postgres database:

1. Create the Netlify Database and complete at least one deploy so it is provisioned.
2. In a local PowerShell window, set `DATABASE_URL` to the database connection string from the Netlify database dashboard. Keep this value private.
3. Stop the local app, and make sure `data/leet-tracker.db` is the copy you intend to migrate. The script makes a temporary working copy and leaves the original SQLite file untouched.
4. Run `npm run migrate:sqlite-to-postgres -- --confirm`.

The migration is additive: matching rows already in Postgres are kept. Review the reported per-table row counts and the app before relying on the deployed database. Do not run the import a second time to overwrite or roll back data; restore from a backup if needed.

## Local checks

```sh
npm ci
npm run typecheck
npm run build
```

`npm start` runs the built Node server locally. Without `DATABASE_URL`, it uses the local SQLite database. With `DATABASE_URL`, it uses PostgreSQL and applies the Postgres schema migration at startup.

## Other included deployment file

`render.yaml` describes a paid Render Starter service with a persistent disk. It is not used by Netlify; do not deploy through that Blueprint if you want to stay on a no-cost plan.
