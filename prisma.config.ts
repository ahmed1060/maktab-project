import { defineConfig } from "prisma/config"

/**
 * Where the Prisma CLI finds the schema and the database.
 *
 * Prisma 7 removed `url` and `directUrl` from the schema file — a connection
 * string in a checked-in .prisma file was always a hazard, and the schema is
 * now purely a description of the data. The URLs live here instead, still read
 * from the same environment variables Vercel's Supabase integration keeps in
 * sync, so no secret moved and nothing new has to be copied by hand when the
 * database password rotates.
 *
 * This is the direct connection, not the pooled one. Migrations take advisory
 * locks and issue DDL, neither of which survives a transaction-mode pooler in
 * front of them; that is the whole reason POSTGRES_URL_NON_POOLING exists. The
 * running application is the opposite case and goes through the pool — see the
 * adapter in lib/prisma.ts.
 */
const directUrl = process.env.POSTGRES_URL_NON_POOLING

export default defineConfig({
    schema: "prisma/schema.prisma",
    // Deliberately not Prisma's own `env()` helper, which throws when the
    // variable is missing. `prisma generate` runs from postinstall on every
    // `npm install`, and CI installs with no database credentials at all — it
    // only typechecks, lints and runs unit tests, none of which connect to
    // anything. `env()` there turns a routine install into a hard failure over
    // a URL nothing was going to use. Left undefined, generate is happy and
    // only the commands that genuinely need a database complain, which is
    // where the complaint belongs.
    datasource: directUrl ? { url: directUrl } : undefined,
    migrations: {
        path: "prisma/migrations",
        seed: "tsx prisma/seed.ts",
    },
})
