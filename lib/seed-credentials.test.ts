import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The seed script names no account and holds no password: its Super Admins
 * come from the environment (SEED_ADMIN_EMAIL_1 and the rest). A comment in
 * it named the two accounts and the password they once had, readable by
 * anyone once the repository was public.
 */
describe("the seed script", () => {
    const seed = readFileSync("prisma/seed.ts", "utf8")

    it("names no account", () => {
        expect(seed.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g) ?? []).toEqual([])
    })

    it("holds no password, reading them from the environment", () => {
        expect(seed).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/i)
        expect(seed).not.toContain("12345678")
        expect(seed).toContain("process.env[`SEED_ADMIN_PASSWORD_${n}`]")
    })
})
