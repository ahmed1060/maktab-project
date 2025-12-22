# Deployment & Connectivity Guide (Supabase + Vercel)

This guide covers the end-to-end setup and troubleshooting for your production environment.

## 1. Database Setup (Supabase)

### Connection Strings
Supabase requires two distinct connection strings in your environment variables:
1.  **DATABASE_URL (Pooled)**: Used by the application for regular queries.
    - **Port**: 6543
    - **Suffix**: `?pgbouncer=true`
2.  **DIRECT_URL (Direct)**: Used by Prisma for migrations and `db push`.
    - **Port**: 5432

### Critical: Password Encoding
If your database password contains special characters (e.g., `@`, `#`, `$`, `!`), you **MUST** URL-encode them in your connection strings:
- `@` becomes `%40`
- `$` becomes `%24`
- `#` becomes `%23`

## 2. Vercel Configuration

### Environment Variables
Ensure the following are set in your Vercel Project Settings:
- `DATABASE_URL`: The pooled connection string.
- `DIRECT_URL`: The direct connection string.
- `NEXTAUTH_SECRET`: A secure random string.
- `NEXTAUTH_URL`: Your production domain (e.g., `https://your-app.vercel.app`).

### Build Optimization
The project is configured to automatically generate the Prisma Client using a `postinstall` script in `package.json`. If builds fail, ensure `prisma generate` is running successfully in the Vercel build logs.

## 3. Database Maintenance

### Syncing Changes
- **Local to Cloud**: After modifying `schema.prisma`, run `npx prisma db push` (it uses `DIRECT_URL`).
- **Seeding**: To initialize or reset system users, run `npx tsx prisma/seed.ts`. Use `upsert` in your seed logic to prevent duplicates.
- **Visualizing Data**: Run `npx prisma db studio` to open a local browser interface for your cloud database.

## 4. Common Troubleshooting

### "Invalid `prisma.superAdmin.findUnique()` invocation"
- **Cause**: Usually means `DATABASE_URL` is missing from Vercel environment variables or is misformatted.
- **Fix**: Check Vercel Settings -> Environment Variables and ensure the key is exactly `DATABASE_URL`.

### Connection Timeouts (Serverless)
- **Cause**: Too many open connections.
- **Fix**: Ensure `DATABASE_URL` includes `?pgbouncer=true` and points to port `6543`.

### Authentication Errors (500 or "Invalid Secret")
- **Cause**: `NEXTAUTH_SECRET` is missing in production.
- **Fix**: Add a unique secret string to Vercel and redeploy.

---
**Reference**: This guide is based on the [Gemini Deployment Workflow](https://gemini.google.com/share/bb8335a7271d).
