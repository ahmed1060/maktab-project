# Quick Fix Script for Database Issues

## Option 1: Using Docker (Recommended for Development)

If you have Docker installed, run this to start PostgreSQL:

```powershell
# Start PostgreSQL in Docker
docker run --name maktab-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=maktab -p 5432:5432 -d postgres:14

# Wait 5 seconds for it to start
Start-Sleep -Seconds 5
```

Then add to your `.env` file:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/maktab"
NEXTAUTH_SECRET="your-secret-key-change-this-in-production"
```

## Option 2: Using Local PostgreSQL Installation

If you have PostgreSQL installed locally:

1. Start the service:
```powershell
# Find your PostgreSQL service
Get-Service | Where-Object {$_.Name -like "*postgres*"}

# Start it (replace with your actual service name)
Start-Service postgresql-x64-14
```

2. Create database (if needed):
```powershell
# Connect to PostgreSQL
psql -U postgres

# Inside psql:
CREATE DATABASE maktab;
\q
```

3. Update `.env`:
```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/maktab"
NEXTAUTH_SECRET="your-secret-key-change-this-in-production"
```

## After Setting Up Database

Run these commands in order:

```powershell
cd "d:\maktab project\app"

# 1. Apply schema to database
npx prisma db push

# 2. Create default users
npx tsx prisma/seed.ts

# 3. Verify users were created
npx tsx check-users.ts
```

## Test Login

Go to http://localhost:3000 and login with:
- Email: `admin@example.com`
- Password: `admin123`

---

**Note:** If you're using a different database setup (remote server, different credentials, etc.), please update the `DATABASE_URL` accordingly.
