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
- **Seeding:** Custom TypeScript seed script (`prisma/seed.ts`)

## Authentication

- **Library:** NextAuth.js v4
- **Method:** Credentials Provider (Email/Password)
- **Encryption:** BCrypt hashing (via `bcryptjs`)
- **Persistence:** Dynamic session duration (24h default / 30 days if "Stay Signed In" is checked)

## Hosting & Deployment

- **Platform:** Vercel (Optimized for Next.js)
- **CI/CD:** Automatic deployment via GitHub

## Key Libraries

- `zod`: Type-safe validation
- `next-auth`: Authentication flow
- `@prisma/client`: Database interaction
- `bcryptjs`: Secure password management
- `tsx`: TypeScript execution for scripts
