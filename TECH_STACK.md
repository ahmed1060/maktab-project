# Project Technology Stack

## Frontend & Backend (Unified)
- **Framework:** Next.js 14.2 (App Router)
- **Language:** TypeScript
- **Styling:** CSS Modules & Global CSS (Premium glassmorphism design)
- **Icons:** Emoji-based custom iconography

## Database & Infrastructure
- **Provider:** Supabase (Cloud PostgreSQL)
- **ORM:** Prisma 5.22.0
- **Storage:** Supabase Storage (if used)
- **Seeding:** Custom TypeScript seed script (`prisma/seed.ts`)

## Authentication
- **Library:** NextAuth.js v4
- **Method:** Credentials Provider (Email/Password)
- **Encryption:** BCrypt hashing (via `bcryptjs`)

## Hosting & Deployment
- **Platform:** Vercel (Optimized for Next.js)
- **CI/CD:** Automatic deployment via GitHub

## Key Libraries
- `next-auth`: Authentication flow
- `@prisma/client`: Database interaction
- `bcryptjs`: Secure password management
- `tsx`: TypeScript execution for scripts
