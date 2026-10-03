import { describe, it, expect } from "vitest"
import { challenges, eyeAspectRatio, frontal, startLiveness, step, turn, LIMITS, type Landmarks, type Observation } from "./liveness"
import { closest, distance, matches, oneFace, scoreOf, MATCH_DISTANCE } from "./match"
import { Vault, type Store } from "./vault"

/** 68 landmarks of a face looking at the camera, nose `turned` from the middle (-0.5..0.5), eyes `open` (EAR). */
function face(turned = 0, open = 0.3): Landmarks {
    const pts = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }))
    // Outer eye corners 36 and 45, 100 apart; the nose tip between them.
    const eye = (start: number, x0: number) => {
        const w = 30, h = open * w
        const e = [{ x: x0, y: 0 }, { x: x0 + 10, y: -h / 2 }, { x: x0 + 20, y: -h / 2 }, { x: x0 + w, y: 0 }, { x: x0 + 20, y: h / 2 }, { x: x0 + 10, y: h / 2 }]
        e.forEach((p, i) => { pts[start + i] = p })
    }
    eye(36, 0)
    eye(42, 70)
    pts[42] = { x: 70, y: 0 }
    pts[45] = { x: 100, y: 0 }
    pts[30] = { x: 50 + turned * 100, y: 40 }
    return pts
}
const seen = (l: Landmarks | null, at: number, faces = l ? 1 : 0): Observation => ({ faces, landmarks: l, at })

describe("prototype liveness", () => {
    it("reads how open the eyes are and where the nose points", () => {
        expect(eyeAspectRatio(face(0, 0.3).slice(36, 42))).toBeCloseTo(0.3, 2)
        expect(eyeAspectRatio(face(0, 0.1).slice(36, 42))).toBeCloseTo(0.1, 2)
        expect(turn(face(0))).toBeCloseTo(0.5)
        expect(turn(face(0.3))).toBeCloseTo(0.8)
        expect(frontal(face(0))).toBe(true)
        expect(frontal(face(0.3))).toBe(false)
        expect(frontal(face(0, 0.1))).toBe(false)
    })

    it("passes a person who turns, comes back and blinks, in the order asked", () => {
        let s = startLiveness(["TURN", "BLINK"], 0)
        const frames: [Landmarks, string][] = [
            [face(0), "TURN_HEAD"], [face(0.3), "LOOK_BACK"], [face(0.02), "FACE_CAMERA"],
            [face(0), "BLINK"], [face(0, 0.1), "BLINK"], [face(0, 0.3), "HOLD_STILL"],
        ]
        frames.forEach(([l, prompt], i) => {
            const r = step(s, seen(l, i * 100))
            expect(r.prompt).toBe(prompt)
            s = r.state
        })
        expect(s).toMatchObject({ done: true, failed: null })
    })

    it("fails a still photo: nothing changes until time runs out", () => {
        let s = startLiveness(["BLINK", "TURN"], 0)
        for (let at = 0; at <= LIMITS.stepMs + 1000; at += 500) s = step(s, seen(face(0), at)).state
        expect(s.failed).toBe("TIMEOUT")
        expect(s.done).toBe(false)
    })

    it("fails when a second face appears at any point", () => {
        const s = step(startLiveness(["TURN", "BLINK"], 0), seen(face(0), 10, 2)).state
        expect(s.failed).toBe("FACES")
    })

    it("chooses the order at random", () => {
        expect(challenges(() => 0.1)).toEqual(["TURN", "BLINK"])
        expect(challenges(() => 0.9)).toEqual(["BLINK", "TURN"])
    })
})

describe("prototype matching", () => {
    const a = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 10)
    const near = a.map((x, i) => x + (i % 2 ? 0.02 : -0.02))
    const far = a.map((x, i) => x + (i % 2 ? 0.1 : -0.1))

    it("matches the same face and not another", () => {
        expect(distance(a, near)).toBeLessThan(MATCH_DISTANCE)
        expect(distance(a, far)).toBeGreaterThan(MATCH_DISTANCE)
        expect(matches([far, a], near)).toMatchObject({ verified: true })
        expect(matches([far], near).verified).toBe(false)
        expect(closest([], a)).toBe(Infinity)
        expect(scoreOf(0)).toBe(1)
        expect(scoreOf(Infinity)).toBe(0)
    })

    it("needs every look in one capture to be the same face", () => {
        expect(oneFace([a, near])).toBe(true)
        expect(oneFace([a, far])).toBe(false)
        expect(oneFace([])).toBe(false)
    })
})

describe("prototype template vault", () => {
    const memory = (): Store & { map: Map<string, unknown> } => {
        const map = new Map<string, unknown>()
        return { map, get: async k => map.get(k), set: async (k, v) => { map.set(k, v) }, delete: async k => { map.delete(k) } }
    }
    const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    const templates = [[0.1, 0.2, 0.3]]

    it("keeps templates encrypted, readable only with the server's key and this device's half", async () => {
        const store = memory()
        const vault = new Vault(store)
        const k = key()
        await vault.save("approved", k, templates)
        expect(JSON.stringify([...(store.map.get("approved") as { data: Uint8Array }).data])).not.toContain("0.1")
        expect(await vault.load("approved", k)).toEqual(templates)
        // The server destroyed its half and handed out a new one: unreadable.
        await expect(vault.load("approved", key())).rejects.toMatchObject({ code: "TEMPLATES_UNREADABLE" })
        // Copied to another device, without its device half: unreadable too.
        const other = new Vault(Object.assign(memory(), {}))
        await (other as unknown as { store: Store }).store.set("approved", store.map.get("approved"))
        await expect(other.load("approved", k)).rejects.toMatchObject({ code: "TEMPLATES_UNREADABLE" })
    })

    it("keeps new templates aside until promoted, or drops them", async () => {
        const vault = new Vault(memory())
        const k = key()
        await vault.save("approved", k, templates)
        await vault.save("pending", k, [[9, 9, 9]])
        expect(await vault.load("approved", k)).toEqual(templates)
        await vault.discardPending()
        expect(await vault.has("pending")).toBe(false)
        await vault.save("pending", k, [[9, 9, 9]])
        await vault.promote()
        expect(await vault.load("approved", k)).toEqual([[9, 9, 9]])
        expect(await vault.has("pending")).toBe(false)
        await vault.deleteAll()
        expect(await vault.load("approved", k)).toBeNull()
    })
})
