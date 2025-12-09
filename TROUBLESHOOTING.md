# Troubleshooting Guide - Database Connection Issues

## Problem
After restarting your laptop, you're getting "invalid email or password" when trying to login.

## Root Cause
The database connection is failing with error: `Error validating datasource ... url = env("DATABASE_URL")`

This happens because:
1. PostgreSQL service may not have started automatically after restart
2. The DATABASE_URL in `.env` may be invalid or pointing to a non-existent database

## Solution Steps

### Step 1: Start PostgreSQL Service

**Windows (if using local PostgreSQL):**
```powershell
# Check if PostgreSQL is running
Get-Service -Name postgresql*

# Start PostgreSQL service (replace with your version)
Start-Service -Name postgresql-x64-14
```

**Alternative: Check Services App**
1. Press `Win + R`
2. Type `services.msc`
3. Find "PostgreSQL" in the list
4. Right-click → Start

### Step 2: Verify DATABASE_URL in `.env`

Your `.env` file should contain:
```
DATABASE_URL="postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME"
NEXTAUTH_SECRET="your-secret-key-here"
```

**Example with default PostgreSQL:**
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/maktab"
NEXTAUTH_SECRET="supersecretkey123"
```

### Step 3: Apply Database Schema

Once your database is running:
```powershell
cd "d:\maktab project\app"
npx prisma db push
```

This will create all the tables (User, Task, Obligation, Notification, AuditLog).

### Step 4: Create Default Users

Run the seed script:
```powershell
npx tsx prisma/seed.ts
```

This creates:
- **Admin**: `admin@example.com` / `admin123`
- **Employee**: `employee@example.com` / `123456`

### Step 5: Test Login

1. Go to `http://localhost:3000`
2. Click "Login"
3. Use admin credentials: `admin@example.com` / `admin123`

## Quick Check Commands

```powershell
# 1. Check if database is accessible
npx prisma db pull

# 2. Check existing users
npx tsx check-users.ts

# 3. View server logs for errors
# (Check your npm run dev terminal)
```

## Common Issues

### "Connection refused" or "cannot connect"
- PostgreSQL is not running
- Wrong port (default is 5432)
- Firewall blocking connection

### "database does not exist"
Create it manually:
```sql
-- Connect to PostgreSQL as admin
psql -U postgres
CREATE DATABASE maktab;
\q
```

### Still can't login after seeding
Clear browser cache or try incognito mode
