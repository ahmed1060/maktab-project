# Deployment & Connectivity Guide (Supabase + Vercel)

This guide covers the end-to-end setup and troubleshooting for your production environment.

## 1. Database Setup (Supabase)

### Connection Strings
Supabase requires two distinct connection strings in your environment variables:
1.  **POSTGRES_PRISMA_URL (Pooled)**: Used by the running application.
    - **Port**: 6543
    - **Suffix**: `?pgbouncer=true`
2.  **POSTGRES_URL_NON_POOLING (Direct)**: Used by migrations and the
    command-line scripts, via `prisma.config.ts`.
    - **Port**: 5432

These are the names Vercel's Supabase integration keeps in sync automatically,
which is why they are not Prisma's older default connection-variable names.

### Critical: Password Encoding
If your database password contains special characters (e.g., `@`, `#`, `$`, `!`), you **MUST** URL-encode them in your connection strings:
- `@` becomes `%40`
- `$` becomes `%24`
- `#` becomes `%23`

## 2. Vercel Configuration

### Environment Variables
Ensure the following are set in your Vercel Project Settings:
- `POSTGRES_PRISMA_URL`: The pooled connection string.
- `POSTGRES_URL_NON_POOLING`: The direct connection string.
- `NEXTAUTH_SECRET`: A secure random string.
- `NEXTAUTH_URL`: Your production domain (e.g., `https://your-app.vercel.app`).

### Build Optimization
The project is configured to automatically generate the Prisma Client using a `postinstall` script in `package.json`. If builds fail, ensure `prisma generate` is running successfully in the Vercel build logs.

## 3. Database Maintenance

### Syncing Changes
- **Local to Cloud**: After modifying `schema.prisma`, create a migration with
  `npx prisma migrate dev --name <what-changed>` and deploy it with
  `npx prisma migrate deploy`.

> [!WARNING]
> Do not use `prisma db push` on a shared database. It applies schema changes
> without recording a migration, so the history stops describing the database.
> This guide used to recommend it, and the result was six objects living in
> production that no migration created — `Task.companyId`,
> `Obligation.companyId`, both `sessionVersion` columns, and the `RateLimit` and
> `_ObligationAssignees` tables. `migrate deploy` could no longer rebuild the
> database at all, and the history had to be squashed into a single baseline to
> recover.
- **Seeding**: To initialize or reset system users, run `npx tsx prisma/seed.ts`. Use `upsert` in your seed logic to prevent duplicates.
- **Visualizing Data**: Run `npx prisma db studio` to open a local browser interface for your cloud database.

## 4. Common Troubleshooting

### "Invalid `prisma.superAdmin.findUnique()` invocation"
- **Cause**: Usually means `POSTGRES_PRISMA_URL` is missing from Vercel environment variables or is misformatted.
- **Fix**: Check Vercel Settings -> Environment Variables and ensure the key is exactly `POSTGRES_PRISMA_URL`.

### Connection Timeouts (Serverless)
- **Cause**: Too many open connections.
- **Fix**: Ensure `POSTGRES_PRISMA_URL` includes `?pgbouncer=true` and points to port `6543`.

### "Error opening a TLS connection: self-signed certificate in certificate chain" (P1011)
- **Cause**: Supabase presents a certificate signed by their own root, which is
  in no default trust store. Prisma 5's engine read `sslmode=require` as
  "encrypt, do not verify" and connected anyway; node-postgres, which Prisma 7
  uses, reads the same value as `verify-full` and refuses.
- **Fix**: Already handled in `lib/postgres-ssl.ts`, which pins Supabase's root
  alongside Node's own and hands pg an explicit `ssl` option. If this reappears,
  check that the connection string is still being routed through
  `poolConfigFrom()` — passing a raw `connectionString` to the adapter lets pg
  resolve `sslmode` from the URL and silently ignore any `ssl` option given
  beside it.
- **Do not** "fix" this with `rejectUnauthorized: false`. That restores the old
  behaviour by switching verification off entirely.

### "(EAUTHTIMEOUT) timeout while waiting for message" (code 08006)
- **Cause**: Supabase's pooler logs it as "ClientHandler: Timeout while
  waiting for message in state SCRAM final": it sent its half of the
  password handshake, and the function never answered. Vercel freezes a
  function once its response is sent, and nothing still running then is
  finished unless Next.js handed it to `waitUntil`. A connection opened at
  that moment stops mid-handshake, and its error is logged later, by the
  next request that wakes the same function, on whatever page that was.
- **Where it came from (#268)**: the Super Admin's overview on the dashboard
  home was cached for 30 seconds (`unstable_cache`). Stale, it served the old
  counts and refreshed them in the background. The home page sits behind
  `loading.tsx`, so Next.js had already sent the page's first part, and
  handed what was pending to `waitUntil`, before the overview was read: the
  refresh it started then was never waited for.
- **Fix**: the overview is read fresh, in one batch transaction, which is one
  connection and one snapshot. Don't cache a read on a page behind a loading
  boundary with `unstable_cache`, nor start any work a response doesn't wait
  for.

### "Calling client.query() when the client is already executing a query"
- **Cause**: a query sent on a connection while another is still on its
  way. A transaction is one connection, and node-postgres queues such a query
  itself, with a warning that pg 9 will refuse it. Prisma 7 does this on its
  own: a read that includes several relations fetches them at once, and inside
  a transaction they all go to its one connection. So did our own
  `Promise.all` over a transaction's queries. Submitting a task with a cost
  paid from a cash advance warned in production (#268).
- **Fix**: every connection Prisma's pool opens is a `OneAtATimeClient`
  (`lib/one-at-a-time-client.ts`): it sends its queries one after another,
  as node-postgres's own queue did, so pg is never handed one while another
  is on its way. Nothing else changes: on one connection they were one at a
  time anyway.

### Authentication Errors (500 or "Invalid Secret")
- **Cause**: `NEXTAUTH_SECRET` is missing in production.
- **Fix**: Add a unique secret string to Vercel and redeploy.

---
**Reference**: This guide is based on the [Gemini Deployment Workflow](https://gemini.google.com/share/bb8335a7271d).
