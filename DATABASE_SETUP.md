# Database Setup Guide (Supabase)

This project uses **Supabase** as its PostgreSQL database provider.

## 1. Supabase Configuration

1. Create a new project on [Supabase](https://supabase.com/).
2. Go to **Project Settings** > **Database**.
3. Under **Connection string**, select **URI**.
4. copy both strings for your `.env` file:
   - **Transaction Mode (Pooler)**: Use this for `DATABASE_URL` (port 6543).
   - **Session/Direct Connection**: Use this for `DIRECT_URL` (port 5432).

## 2. Environment Variables

Update your `.env` file with these keys.

> [!IMPORTANT]
> Always include `?pgbouncer=true` at the end of your `DATABASE_URL` to prevent connection limit issues on Vercel.

```env
# Port 6543
DATABASE_URL="postgresql://postgres.[ID]:[PWD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Port 5432
DIRECT_URL="postgresql://postgres.[ID]:[PWD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

## 3. Apply Schema and Seed

Set `SEED_ADMIN_EMAIL_1` and `SEED_ADMIN_PASSWORD_1` (and optionally `_2` for a
second account) in your `.env` — the seed script refuses to run without them.
Then, in the `app` directory:

```bash
# 1. Push schema to Supabase (uses DIRECT_URL automatically via Prisma)
npx prisma db push

# 2. Seed the Super Admin(s) from SEED_ADMIN_EMAIL_1 / SEED_ADMIN_PASSWORD_1
npx tsx prisma/seed.ts
```

## 4. Key Deployment Notes

- **Network Restrictions**: If deployments fail, ensure your IP is added to the Supabase **Network Restrictions** (or set to "Allow All" for debugging).
- **Vercel IP**: Vercel IPs are dynamic. It is recommended to keep Supabase open to all connections (IPv4/IPv6) for seamless deployment.
