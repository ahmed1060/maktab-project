import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Two things about how the database client is wired that are easy to undo and
 * expensive to discover.
 *
 * Both were broken during the Prisma 7 upgrade, which is why they are pinned
 * here. Prisma 7 requires a driver adapter and a connection string up front,
 * where Prisma 5 read the URL lazily when it first connected — so the obvious
 * translation moved two failures from "when you use the database" to "when you
 * so much as import the module", and neither failure looked like what it was.
 */


function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, " "))
        .replace(/\/\/[^\n]*/g, "")
}

describe("importing the client does not need a database", () => {
    const saved = {
        pooled: process.env.POSTGRES_PRISMA_URL,
        direct: process.env.POSTGRES_URL_NON_POOLING,
    }

    beforeEach(() => {
        delete process.env.POSTGRES_PRISMA_URL
        delete process.env.POSTGRES_URL_NON_POOLING
    })

    afterEach(() => {
        if (saved.pooled) process.env.POSTGRES_PRISMA_URL = saved.pooled
        if (saved.direct) process.env.POSTGRES_URL_NON_POOLING = saved.direct
    })

    it("imports with no connection string configured", async () => {
        // Dozens of modules import lib/prisma for a type or a helper that never
        // touches the database, and three unit-test files reach it that way. If
        // the client is built during import, all of them fail at once with an
        // error naming a variable they were never going to use.
        const mod = await import("./prisma")
        expect(mod.prisma).toBeDefined()
    })

    it("complains by name when something actually uses it", async () => {
        const { prisma } = await import("./prisma")
        // Deferred, not discarded: the error still has to arrive, and still has
        // to name the variable that is missing.
        expect(() => (prisma as any).user).toThrow(/POSTGRES_PRISMA_URL/)
    })
})

describe("prisma generate survives an install with no credentials", () => {
    it("does not use the env() helper, which throws on a missing variable", () => {
        // Comments first. The file explains at length why it avoids env(), and
        // a guard that reads its own justification as the offence is no guard.
        const config = stripComments(readFileSync("prisma.config.ts", "utf8"))

        // postinstall runs `prisma generate` on every npm install, and CI
        // installs with no database variables set at all — it only typechecks,
        // lints and runs unit tests. Prisma's env() helper raises
        // PrismaConfigEnvError when the variable is absent, which turns that
        // routine install into a hard failure.
        expect(config).not.toMatch(/\benv\s*\(/)
        expect(config, "the URL still has to be read from somewhere").toMatch(
            /process\.env\.POSTGRES_URL_NON_POOLING/,
        )
    })

    it("keeps the connection string out of the schema file", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        expect(schema).not.toMatch(/^\s*(url|directUrl)\s*=/m)
    })
})
