# Maktab Project

## Prerequisites
Before you start, make sure you have installed:
- **Node.js** (v18 or newer) - [Download](https://nodejs.org/)
- **Docker Desktop** (Required for the database) - [Download](https://www.docker.com/products/docker-desktop/)
- **Git** - [Download](https://git-scm.com/)
- **VS Code** (Recommended)

## getting Started

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/maktab-project.git
cd maktab-project
npm install
```

### 2. Configure Environment
Create a file named `.env` in the root folder and add this content:
```env
# Database (connects to local Docker container)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/maktab"

# Auth Secret (can be any random string for dev)
NEXTAUTH_SECRET="development-secret-key"
```

### 3. Start Database
Make sure Docker Desktop is running, then run:

```bash
# Start Postgres Container
docker run --name maktab-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=maktab -p 5432:5432 -d postgres:14

# Give it a moment, then push schema and seed data
npx prisma db push
npx tsx prisma/seed.ts
```

### 4. Run App
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
Login with: `admin@example.com` / `admin123`
