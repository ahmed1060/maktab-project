import { describe, it, expect, beforeEach } from "vitest"
import { generateKeyPairSync, createHash } from "node:crypto"
import { enablePush, onPushTapped, type PushPlugin } from "./push"
import type { CheckInDevice } from "./native"

/**
 * Turning pushes on in the app (lib/mobile/push.ts), with a stand-in for
 * Capacitor's push plugin: what is asked, what reaches the server, and what
 * a tap opens.
 */

const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
const der = publicKey.export({ format: "der", type: "spki" })
const fingerprint = createHash("sha256").update(der).digest("hex")
const device = (key: string | null) => ({ publicKey: async () => key }) as unknown as CheckInDevice

function fakePush(opts: { permission?: string; afterAsking?: string; token?: string; error?: string } = {}) {
    const handlers: Record<string, (x: any) => void> = {}
    const calls: string[] = []
    const removed: string[] = []
    const plugin = {
        checkPermissions: async () => { calls.push("check"); return { receive: opts.permission ?? "granted" } },
        requestPermissions: async () => { calls.push("ask"); return { receive: opts.afterAsking ?? "granted" } },
        register: async () => {
            calls.push("register")
            setTimeout(() => (opts.error ? handlers.registrationError({ error: opts.error }) : handlers.registration({ value: opts.token ?? "push-token" })), 0)
        },
        addListener: async (event: string, cb: (x: any) => void) => { handlers[event] = cb; return { remove: async () => { removed.push(event) } } },
    } as unknown as PushPlugin
    return { plugin, calls, handlers, removed }
}

describe("turning pushes on", () => {
    let posted: { url: string; body: any }[]
    const post = async (url: string, body: unknown) => { posted.push({ url, body }); return { saved: true } }
    beforeEach(() => { posted = [] })

    it("asks once when the phone hasn't been asked, then tells the server the token for this phone's key", async () => {
        const push = fakePush({ permission: "prompt", token: "fcm-123" })
        expect(await enablePush(device(der.toString("base64")), push.plugin, post)).toBe("REGISTERED")
        expect(push.calls).toEqual(["check", "ask", "register"])
        expect(posted).toEqual([{ url: "/api/attendance/phone/push-token", body: { keyFingerprint: fingerprint, token: "fcm-123" } }])
        // Its listeners are taken away again.
        expect(push.removed.sort()).toEqual(["registration", "registrationError"])
    })

    it("listens before asking, so a token the phone already has, given at once, isn't missed", async () => {
        // The plugin takes a moment to add each listener, and a phone that already has a token answers register() straight away.
        const handlers: Record<string, (x: any) => void> = {}
        const plugin = {
            checkPermissions: async () => ({ receive: "granted" }),
            requestPermissions: async () => ({ receive: "granted" }),
            addListener: async (event: string, cb: (x: any) => void) => {
                await new Promise(r => setTimeout(r, 10))
                handlers[event] = cb
                return { remove: async () => {} }
            },
            register: async () => { handlers.registration?.({ value: "cached-token" }) },
        } as unknown as PushPlugin
        expect(await enablePush(device(der.toString("base64")), plugin, post, 500)).toBe("REGISTERED")
        expect(posted.map(p => p.body.token)).toEqual(["cached-token"])
    })

    it("doesn't ask again when the answer is already yes, and sends nothing when it is no", async () => {
        const yes = fakePush({ permission: "granted" })
        await enablePush(device(der.toString("base64")), yes.plugin, post)
        expect(yes.calls).toEqual(["check", "register"])
        const no = fakePush({ permission: "prompt", afterAsking: "denied" })
        expect(await enablePush(device(der.toString("base64")), no.plugin, post)).toBe("DENIED")
        expect(no.calls).not.toContain("register")
        expect(posted).toHaveLength(1)
    })

    it("does nothing without the plugin or a phone key, and carries on when the phone can't register", async () => {
        expect(await enablePush(device(der.toString("base64")), null, post)).toBe("UNAVAILABLE")
        expect(await enablePush(device(null), fakePush().plugin, post)).toBe("UNAVAILABLE")
        // An Android build without Firebase set up: registration fails, check-in goes on.
        expect(await enablePush(device(der.toString("base64")), fakePush({ error: "Default FirebaseApp is not initialized" }).plugin, post)).toBe("UNAVAILABLE")
        expect(posted).toEqual([])
    })
})

describe("tapping a notice", () => {
    it("opens the page it is about, only on this site", async () => {
        const push = fakePush()
        const opened: string[] = []
        await onPushTapped(push.plugin, path => opened.push(path))
        const tap = (data: Record<string, unknown>) => push.handlers.pushNotificationActionPerformed({ notification: { data } })
        tap({ link: "/dashboard/check-in" })
        tap({ link: "https://elsewhere.example" })
        tap({ link: "//elsewhere.example/x" })
        tap({})
        expect(opened).toEqual(["/dashboard/check-in"])
    })
})
