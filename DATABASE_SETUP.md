# Database Setup Guide (Supabase)

This project uses Supabase as its PostgreSQL database provider. Local Docker setup is deprecated in favor of this cloud-based approach.

## 1. Supabase Configuration

1. Create a new project on [Supabase](https://supabase.com/).
2. Go to **Project Settings** > **Database**.
3. Under **Connection string**, select **URI**.
4. You will need two strings for your `.env` file:
   - **Transaction Mode (Pooler)**: Use this for `DATABASE_URL` (port 6543).
   - **Direct Connection**: Use this for `DIRECT_URL` (port 5432).

## 2. Environment Variables

Update your [app/.env](file:///d:/maktab%20project/app/.env) with the following:

```env
DATABASE_URL="postgresql://postgres.[YOUR-ID]:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[YOUR-ID]:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

## 3. Apply Schema and Seed

Run these commands in the `app` directory:

```powershell
# 1. Sync the Prisma schema with Supabase
npx prisma db push

# 2. Create the default Super Admin user
npx tsx prisma/seed.ts
```

## 4. Troubleshooting

- **Connection Error**: Ensure your IP is added to the Supabase **Network Restrictions** (or Allow All IPs for testing).
- **Migration Issues**: Always use `DIRECT_URL` for running migrations or `prisma db push` if you experience timeout issues with the pooler.
- **Seeding Fails**: Ensure your database is empty or the user doesn't already exist before running the seed script.

---

**Note:** The default login credentials after seeding are:
- **Email**: `ahmed.hossam1060@gmail.com`
- **Password**: `12345678`
