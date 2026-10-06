import { describe, it, expect, vi } from "vitest"
import type { CheckInDevice } from "./native"
import type { FaceVerifier } from "./face"

/**
 * The order of a check-in (lib/mobile/check-in-flow.ts). In production the
 * fix, the number and its attestation came one after another once the
 * camera had closed: seven more seconds. They now run while the face check
 * does, and are taken again when it ran long.
 */

const face = vi.hoisted(() => ({ check: null as null | (() => Promise<unknown>) }))
vi.mock("./face", () => ({ faceCheck: () => face.check!() }))

const { checkIn, FIX_FRESH_MS } = await import("./check-in-flow")

/** A phone and a server that write down what happened, in order. */
function world() {
    const log: string[] = []
    const device = {
        publicKey: async () => "AAAA",
        sign: async () => { log.push("sign"); return "c2ln" },
        location: async () => { log.push("location"); return { latitude: 30, longitude: 31, accuracyMeters: 10, mocked: false } },
        attestation: async () => { log.push("attest"); return "token" },
    } as unknown as CheckInDevice
    let n = 0
    const post = async (url: string, body: any) => {
        log.push(url.replace("/api/attendance/", ""))
        if (url.endsWith("/challenge")) return { nonce: `nonce-${++n}-xxxxxxxxxxxxxxxxxxxx` }
        return { outcome: "ACCEPTED", sent: body }
    }
    return { device, post, log }
}

describe("checking in", () => {
    it("takes the fix, the number and its attestation while the face check runs", async () => {
        const w = world()
        face.check = async () => {
            // While the camera is open, all three are already under way.
            await new Promise(r => setTimeout(r, 5))
            w.log.push("face done")
            return { face: { verified: true }, frame: null }
        }
        const answer = await checkIn(w.device, w.post, "IN", {} as FaceVerifier)
        const done = w.log.indexOf("face done")
        expect(w.log.indexOf("location")).toBeLessThan(done)
        expect(w.log.indexOf("phone/challenge")).toBeLessThan(done)
        expect(w.log.indexOf("attest")).toBeLessThan(done)
        // After the camera: only the signature and the check-in.
        expect(w.log.slice(done + 1)).toEqual(["sign", "check-in"])
        expect((answer as unknown as { sent: unknown }).sent).toMatchObject({ nonce: "nonce-1-xxxxxxxxxxxxxxxxxxxx", attestation: "token", face: { verified: true } })
    })

    it("takes the fix and the number again when the face check ran long", async () => {
        const w = world()
        let t = 0
        face.check = async () => { t += FIX_FRESH_MS * 5; return null }
        const answer = await checkIn(w.device, w.post, "IN", {} as FaceVerifier, () => t)
        expect(w.log.filter(x => x === "location")).toHaveLength(2)
        expect(w.log.filter(x => x === "phone/challenge")).toHaveLength(2)
        expect((answer as unknown as { sent: { nonce: string } }).sent.nonce).toBe("nonce-2-xxxxxxxxxxxxxxxxxxxx")
    })

    it("still sends nothing when the person closes the camera", async () => {
        const w = world()
        face.check = async () => { throw Object.assign(new Error("FACE_CANCELLED"), { code: "FACE_CANCELLED" }) }
        await expect(checkIn(w.device, w.post, "IN", {} as FaceVerifier)).rejects.toMatchObject({ code: "FACE_CANCELLED" })
        expect(w.log).not.toContain("check-in")
    })
})
