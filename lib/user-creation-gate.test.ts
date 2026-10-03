import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Creating an account was open to anyone signed in.
 *
 * POST /api/users carried no options object, so withStandardHandler had no
 * allowedRoles to check, and UserService.create's only role rule blocked a
 * non-Super-Admin from making an ADMIN. Nothing covered the rest. An employee
 * could create a TEAM_LEADER in their own company, choose its password, and
 * sign in to an account with management access across the company — a
 * privilege escalation costing one request, from any account.
 *
 * These tests drive the real exported handler rather than asserting on source,
 * so they fail if the gate stops working for any reason, not only if this
 * particular line is deleted. The session is the only thing mocked; the role
 * check runs before the handler body, so nothing here reaches a database.
 */

const session = { value: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

function as(role: string) {
    session.value = { user: withGrants({ id: `${role}-1`, role, companyId: "co-1" }) }
}

/** A body that fails validation, so a request getting past the role gate stops
 *  at 400 without touching the database. The gap between 403 and 400 is the
 *  whole signal: 403 means refused for who you are, 400 means allowed through
 *  and refused for what you sent. */
function post(body: unknown = {}) {
    return new Request("https://nizmo.test/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
}

describe("only an Admin can create an account", () => {
    beforeEach(() => { session.value = null })

    it("refuses an employee", async () => {
        const { POST } = await import("@/app/api/users/route")
        as("EMPLOYEE")
        expect((await POST(post())).status).toBe(403)
    })

    it("refuses a Team Leader", async () => {
        // They cannot edit an account either — PUT has always been admin-or-self
        // — so creating one was the odd exception, not a capability in use.
        const { POST } = await import("@/app/api/users/route")
        as("TEAM_LEADER")
        expect((await POST(post())).status).toBe(403)
    })

    it("refuses an unauthenticated request", async () => {
        const { POST } = await import("@/app/api/users/route")
        session.value = null
        expect((await POST(post())).status).toBe(401)
    })

    it("lets an Admin through to validation", async () => {
        // The other half of the guard. Without this, a gate that refused
        // everybody would pass every test above and nobody could hire anyone.
        const { POST } = await import("@/app/api/users/route")
        as("ADMIN")
        expect((await POST(post())).status).toBe(400)
    })

    it("lets a Super Admin through to validation", async () => {
        const { POST } = await import("@/app/api/users/route")
        as("SUPER_ADMIN")
        expect((await POST(post())).status).toBe(400)
    })
})

describe("the service refuses too, not only the route", () => {
    /**
     * Two gates on purpose. The route's protects the HTTP entry point; this one
     * protects the operation, so a second caller — a script, a future endpoint,
     * an import — cannot reopen the hole by forgetting an options object. The
     * check is the first thing create() does, so this needs no database.
     */
    it("throws for an employee session before it writes anything", async () => {
        const { UserService } = await import("@/lib/services/user.service")
        await expect(
            UserService.create({ email: "x@y.test" } as any, { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "co-1" }) })
        ).rejects.toThrow("ONLY_ADMIN_CAN_CREATE_USERS")
    })

    it("throws for a Team Leader session", async () => {
        const { UserService } = await import("@/lib/services/user.service")
        await expect(
            UserService.create({ email: "x@y.test" } as any, { user: withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "co-1" }) })
        ).rejects.toThrow("ONLY_ADMIN_CAN_CREATE_USERS")
    })

    it("still blocks an Admin from minting another Admin", async () => {
        // The rule that already existed must survive the one added above it.
        const { UserService } = await import("@/lib/services/user.service")
        await expect(
            UserService.create({ email: "x@y.test", role: "ADMIN" } as any, { user: withGrants({ id: "a1", role: "ADMIN", companyId: "co-1" }) })
        ).rejects.toThrow("ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN")
    })
})

describe("the route declares the gate rather than relying on the service alone", () => {
    it("names ADMIN and SUPER_ADMIN, and nobody else", async () => {
        // The gate is a permission now (ROLES_PLAN.md, Part A). The route must
        // declare it, and among the built-in roles only the Admin may hold it;
        // the Super Admin holds every permission.
        const source = stripComments(readFileSync("app/api/users/route.ts", "utf8"))
        expect(source, "POST /api/users must declare its permission").toMatch(/permission:\s*"employees\.create"/)
        const { BUILT_IN_GRANTS } = await import("@/lib/permissions/built-in")
        const holders = Object.entries(BUILT_IN_GRANTS).filter(([, grants]) => "employees.create" in grants).map(([role]) => role)
        expect(holders).toEqual(["ADMIN"])
    })
})
