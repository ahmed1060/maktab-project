# Maktab Project

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
DATABASE_URL="postgresql://postgres.[YOUR-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[YOUR-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

# Auth Secret (Use a secure random string)
NEXTAUTH_SECRET="your-generated-secret"
NEXTAUTH_URL="http://localhost:3000"
```

### 3. Initialize Database
Apply the schema and seed the initial Super Admin:
```bash
# Push schema to Supabase
npx prisma db push

# Create default Super Admin
npx tsx prisma/seed.ts
```

### 4. Run App
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
Initial Login: `ahmed.hossam1060@gmail.com` / `12345678` (configured in `seed.ts`)
