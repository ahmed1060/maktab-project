import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

/**
 * The face check's models are fetched and published only where the test
 * version is offered (review on #47): a production build downloads nothing
 * and serves none of the non-commercial weights.
 */

const SCRIPT = resolve("scripts/fetch-face-models.mjs")

function run(env: Record<string, string>, dotEnv?: string) {
    const dir = mkdtempSync(join(tmpdir(), "face-models-"))
    if (dotEnv) writeFileSync(join(dir, ".env"), dotEnv)
    // Left from an earlier build with the test version on.
    mkdirSync(join(dir, "public/face-models/v2"), { recursive: true })
    writeFileSync(join(dir, "public/face-models/v2/w600k_r50.onnx.part0"), "weights")
    // Only what the test sets: not this machine's own flags.
    const base = { ...process.env }
    delete base.NEXT_PUBLIC_FACE_PROTOTYPE
    delete base.FACE_MODELS
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: dir, env: { ...base, ...env }, encoding: "utf8", timeout: 15_000 })
    return { dir, out }
}

describe("fetching the face check's models", () => {
    it("downloads nothing and publishes nothing when the test version is off, removing any left", () => {
        const { dir, out } = run({})
        expect(out).toMatch(/is off/)
        expect(existsSync(join(dir, "public/face-models"))).toBe(false)
    })

    it("removes them when the test version is off, even when asked to skip (review on #47)", () => {
        const { dir } = run({ FACE_MODELS: "skip" })
        expect(existsSync(join(dir, "public/face-models"))).toBe(false)
    })

    it("reads the flag from the .env files next reads (review on #47)", () => {
        const { dir, out } = run({ FACE_MODELS: "skip" }, "NEXT_PUBLIC_FACE_PROTOTYPE=1\n")
        expect(out).toMatch(/skipped/)
        expect(existsSync(join(dir, "public/face-models/v2/w600k_r50.onnx.part0"))).toBe(true)
    })

    it("leaves things as they are when asked to skip", () => {
        const { dir } = run({ FACE_MODELS: "skip", NEXT_PUBLIC_FACE_PROTOTYPE: "1" })
        expect(existsSync(join(dir, "public/face-models/v2/w600k_r50.onnx.part0"))).toBe(true)
    })
})
