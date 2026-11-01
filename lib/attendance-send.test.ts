import { describe, it, expect, vi, afterEach } from "vitest"
import { send, json } from "@/app/(dashboard)/dashboard/attendance/send"

/**
 * Attendance's writes (app/(dashboard)/dashboard/attendance/send.ts): a
 * connection that fails, or drops before the answer is read, comes back as
 * a refusal with the fallback to show, like any other. Thrown, the busy
 * button reset and nothing was said, so whoever decided a face photo couldn't
 * tell whether it was saved (found by Codex on PR 153).
 */

afterEach(() => { vi.unstubAllGlobals() })

describe("a write to the attendance API", () => {
    it("says what failed when the connection does, rather than throwing", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
        await expect(send("/api/attendance/face/people", json("PUT", { userId: "u2", required: true }), "Something went wrong")).resolves.toEqual({ ok: false, error: "Something went wrong" })
    })

    it("says so too when the answer is cut off before it's read", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.reject(new TypeError("network error")) }))
        await expect(send("/api/attendance/face/reverify", json("POST", { userId: "u2" }), "Something went wrong")).resolves.toEqual({ ok: false, error: "Something went wrong" })
    })

    it("still gives the server's refusal, and the body's data when it's done", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => JSON.stringify({ error: "Not yet set up", code: "FACE_NOT_ENROLLED" }) }))
        await expect(send("/x", { method: "POST" }, "Fallback")).resolves.toMatchObject({ ok: false, code: "FACE_NOT_ENROLLED" })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: { filled: 2 } }) }))
        await expect(send("/x", { method: "POST" }, "Fallback")).resolves.toEqual({ ok: true, body: { filled: 2 } })
    })
})
