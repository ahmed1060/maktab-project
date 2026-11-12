# Project Technology Stack

## Backend & Validation

- **Framework:** Next.js 14.2 (App Router)
- **Language:** TypeScript
- **Validation:** **Zod** (Schema-based validation for all API inputs)
- **API Pattern:** Standardized `withStandardHandler` with `ApiResponse` utility
- **Security:** Layered Role-Based Access Control (RBAC) & Company Isolation

## Database & Infrastructure

- **Provider:** Supabase (Cloud PostgreSQL)
- **ORM:** Prisma 5.22.0
- **Storage:** Supabase Storage
- **Region:** Ireland (Supabase `eu-west-1`), for the database, its storage and live updates alike.
- **Seeding:** Custom TypeScript seed script (`prisma/seed.ts`)

## Authentication

- **Library:** NextAuth.js v4
- **Method:** Credentials Provider (Email/Password)
- **Encryption:** BCrypt hashing (via `bcryptjs`)
- **Persistence:** Dynamic session duration (24h default / 30 days if "Stay Signed In" is checked)

## Hosting & Deployment

- **Platform:** Vercel (Optimized for Next.js)
- **Function region:** Dublin (`dub1`), next to the database, set by `regions` in `vercel.json` (#261). Until then they ran in Frankfurt (`fra1`), so every database query, and a page makes several one after another, crossed from Germany to Ireland and back. The Hobby plan runs functions in one region; the database's is the one to pick.
- **CI/CD:** Automatic deployment via GitHub

## Key Libraries

- `zod`: Type-safe validation
- `next-auth`: Authentication flow
- `@prisma/client`: Database interaction
- `bcryptjs`: Secure password management
- `tsx`: TypeScript execution for scripts
