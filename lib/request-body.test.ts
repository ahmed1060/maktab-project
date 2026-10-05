import { describe, it, expect, vi } from "vitest"
import { withGrants } from "./permissions/test-actors"

/**
 * What withStandardHandler hands a route as its body, and what it refuses.
 *
 * Found by calling every API route with junk: a body that wasn't JSON reached
 * the route as null, and every route that reads a field from its body failed
 * with a 500 — nineteen of them. And a JSON body sent to a file upload was read
 * as JSON first, so the route's own read of the form threw: another 500.
 */

const state = { session: null as any, got: undefined as any }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { withStandardHandler, readForm } = await import("@/lib/api-utils")
const { ApiResponse } = await import("@/lib/api-response")

const route = withStandardHandler(async (_req, _s, body) => { state.got = body; return ApiResponse.success({}) })

async function send(body: string | undefined, method = "POST") {
    state.session = { user: withGrants({ id: "u", role: "ADMIN", companyId: "c1" }) }
    state.got = "not called"
    const res = await route(new Request("https://nizmo.test/api/anything", { method, headers: { "Content-Type": "application/json" }, body }))
    return { status: res.status, got: state.got, error: res.status >= 400 ? (await res.json()).error : undefined }
}

describe("a JSON body", () => {
    it("an object or a list reaches the route", async () => {
        expect(await send('{"a":1}')).toMatchObject({ status: 200, got: { a: 1 } })
        expect(await send('[1,2]')).toMatchObject({ status: 200, got: [1, 2] })
    })

    it("an empty one reaches it as null, as before", async () => {
        expect(await send(undefined)).toMatchObject({ status: 200, got: null })
        expect(await send("", "DELETE")).toMatchObject({ status: 200, got: null })
    })

    it("one that isn't JSON is refused with a 400, before the route runs", async () => {
        expect(await send("{")).toEqual({ status: 400, got: "not called", error: "The request body isn't valid JSON." })
    })

    it("JSON that isn't an object or a list is refused too", async () => {
        for (const b of ["null", '"x"', "5", "true"]) {
            expect(await send(b)).toEqual({ status: 400, got: "not called", error: "The request body must be a JSON object." })
        }
    })
})

describe("a file upload", () => {
    it("readForm gives the form, or null when the body isn't one", async () => {
        const form = new FormData(); form.set("folder", "x")
        expect((await readForm(new Request("https://nizmo.test/u", { method: "POST", body: form })))?.get("folder")).toBe("x")
        expect(await readForm(new Request("https://nizmo.test/u", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).toBeNull()
    })

    it("each upload route reads its form that way and answers 400 without one", async () => {
        const { readFileSync } = await import("node:fs")
        for (const f of ["app/api/upload/route.ts", "app/api/companies/logo/route.ts", "app/api/templates/upload/route.ts"]) {
            const src = readFileSync(f, "utf8")
            expect(src, f).not.toContain("req.formData()")
            expect(src, f).toMatch(/= await readForm\(req\)\n\s+if \(!\w+\) return ApiResponse\.badRequest\("Send the file as a form upload\."\)/)
        }
    })
})
