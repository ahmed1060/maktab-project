import { describe, it, expect } from "vitest"
import { wrappingKey, type FaceVerifier } from "./face"
import type { CheckInDevice } from "./native"

/**
 * Fetching the wrapping key before a face check. In production the first
 * try after the app came back was refused (a spent number or a refused
 * signature), and the check-in went on without its face check.
 */

const device = { publicKey: async () => "AAAA", sign: async () => "c2ln" } as unknown as CheckInDevice
const face = {} as FaceVerifier
const refused = (code: string) => Object.assign(new Error("That request has expired or was already used. Try again."), { code })

/** A server whose first key request is refused with `code`, then answers; it records the calls. */
function server(code: string | null) {
    const calls: string[] = []
    let keys = 0
    const post = async (url: string) => {
        calls.push(url)
        if (url.endsWith("/challenge")) return { nonce: `n${calls.length}` }
        if (keys++ === 0 && code) throw refused(code)
        return { key: "a2V5", deleteTemplates: false }
    }
    return { post, calls }
}

describe("the wrapping key", () => {
    it("asks once more, with a new number, when the first is refused as spent or unsigned", async () => {
        for (const code of ["PHONE_CHALLENGE_INVALID", "PHONE_SIGNATURE_INVALID"]) {
            const s = server(code)
            expect(await wrappingKey(device, face, s.post)).toBe("a2V5")
            expect(s.calls.filter(u => u.endsWith("/challenge"))).toHaveLength(2)
        }
    })

    it("doesn't ask again for anything else", async () => {
        const s = server("FACE_PHONE_NOT_ACTIVE")
        await expect(wrappingKey(device, face, s.post)).rejects.toMatchObject({ code: "FACE_PHONE_NOT_ACTIVE" })
        expect(s.calls.filter(u => u.endsWith("/challenge"))).toHaveLength(1)
    })
})
