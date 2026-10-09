import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { leftAfterPress, photosLeft } from "./face-rekey-progress"

/**
 * The count of photos still on the old key, on the face photo key rotation
 * (components/FaceSystemSwitch.tsx), while it goes on press by press.
 */

describe("the photos still on the old key, between presses", () => {
    it("counts each press off what showed, until the status is read at the end", () => {
        let own: number | null = null
        const status = 1000
        own = leftAfterPress(photosLeft(own, status), 200)
        expect(photosLeft(own, status)).toBe(800)
        own = leftAfterPress(photosLeft(own, status), 200)
        expect(photosLeft(own, status)).toBe(600)
        expect(photosLeft(leftAfterPress(50, 200), status)).toBe(0)
    })

    it("doesn't take the presses' moves off a status read again meanwhile (Codex review on #49)", () => {
        // Read again after a reconnect, the status already had them: 1,000 less two presses of 200 showed 400 left of 600.
        let own: number | null = leftAfterPress(photosLeft(null, 1000), 200)
        own = leftAfterPress(photosLeft(own, 1000), 200)
        expect(photosLeft(own, 600)).toBe(600)
        // Read during a press, with some of its moves: what showed as it began is what the press counts from.
        own = leftAfterPress(600, 200)
        expect(photosLeft(own, 500)).toBe(400)
        // Another Super Admin moving photos too: the status, lower, shows.
        expect(photosLeft(own, 250)).toBe(250)
    })

    it("is what the rotation screen shows", () => {
        const card = readFileSync("components/FaceSystemSwitch.tsx", "utf8")
        expect(card).toContain("photosLeft(rekeyLeft, rotation.previous)")
        expect(card).toContain("setRekeyLeft(leftAfterPress(shown, run.moved))")
        expect(card).toContain(".replace('{previous}', String(left))")
        expect(card).not.toContain("rotation.previous - rekeyMoved")
    })
})
