# Nizmo

## Prerequisites
Before you start, make sure you have installed:
- **Node.js** (v18 or newer) - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)
- **VS Code** (Recommended)

## Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/maktab-project.git
cd maktab-project
npm install
```

### 2. Configure Environment
Create a file named `.env` in the root folder and add your Supabase credentials:
```env
# Database connection (Get these from Supabase Settings)
# These are the names Vercel's Supabase integration keeps in sync, so they do
# not have to be copied by hand when the database password rotates.
POSTGRES_PRISMA_URL="postgresql://postgres.[YOUR-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
POSTGRES_URL_NON_POOLING="postgresql://postgres.[YOUR-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

# Auth Secret (Use a secure random string, e.g. `openssl rand -base64 32`)
NEXTAUTH_SECRET="your-generated-secret"
NEXTAUTH_URL="http://localhost:3000"

# Seed Super Admin (required to run prisma/seed.ts — see step 3)
SEED_ADMIN_EMAIL_1="you@example.com"
SEED_ADMIN_PASSWORD_1="choose-a-strong-password-12+chars"
```

### 3. Initialize Database
Apply the migrations and seed the initial Super Admin:
```bash
# Apply the migration history
npx prisma migrate deploy

# Create the Super Admin from SEED_ADMIN_EMAIL_1 / SEED_ADMIN_PASSWORD_1 in your .env
npx tsx prisma/seed.ts
```

> [!WARNING]
> Never use `prisma db push` against a database anyone else uses. It changes the
> schema without recording a migration, so the migration history silently stops
> describing the database. That is not hypothetical here: it is how six objects
> — including `Task.companyId` and the `RateLimit` table — came to exist in
> production while no migration created them, which left `migrate deploy` unable
> to rebuild the database from scratch at all. `db push` is for a scratch
> database you own and are about to throw away.

### 4. Run App
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the `SEED_ADMIN_EMAIL_1` / `SEED_ADMIN_PASSWORD_1` you set above.
