# Project Technology Stack

## Frontend & Backend (Unified)
- **Framework:** Next.js 14.2.15 (App Router structure)
- **Language:** TypeScript
- **Styling:** CSS Modules & Global CSS (Custom glassmorphism design, no Tailwind)
- **State Management:** React Hooks (`useState`, `useEffect`)

## Database & Data
- **Database:** PostgreSQL
- **ORM:** Prisma 5.22.0
- **Seeding:** Custom TypeScript seed script (`prisma/seed.ts`)

## Authentication
- **Library:** NextAuth.js v4
- **Method:** Credentials (Email/Password with BCrypt hashing)

## Hosting Requirements
- **Environment:** Node.js (Server-side rendering required)
- **Database Hosting:** Compatible with PostgreSQL (e.g., Neon, Supabase, Railway)

## Key Libraries
- `next-auth`: Authentication
- `@prisma/client`: Database client
- `bcryptjs`: Password hashing
- `react` / `react-dom`: UI rendering
