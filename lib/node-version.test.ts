import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * One Node version everywhere it is written down.
 *
 * Production runs whatever Vercel's project setting says (24.x). The code was
 * type-checked against Node 22's types and CI ran on 22, so a Node 24 API —
 * or one 24 removed — could pass every check here and behave differently in
 * production. These say the same thing now; this keeps them saying it.
 */
const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const major = (v: string) => v.match(/(\d+)/)?.[1]

describe("Node version", () => {
    const engine = major(pkg.engines?.node ?? "")

    it("is declared in package.json, which Vercel honours", () => {
        expect(engine).toBe("24")
    })

    it(".nvmrc agrees, for local development", () => {
        expect(major(readFileSync(".nvmrc", "utf8"))).toBe(engine)
    })

    it("CI runs the same version", () => {
        const ci = readFileSync(".github/workflows/ci.yml", "utf8")
        expect(major(ci.match(/node-version:\s*(\S+)/)?.[1] ?? "")).toBe(engine)
    })

    it("the type definitions describe the same Node", () => {
        expect(major(pkg.devDependencies["@types/node"])).toBe(engine)
    })
})
