import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The four React Compiler rules eslint-plugin-react-hooks 6 introduced were
 * warnings while their findings were worked through. Each reached zero and was
 * made an error, so a new instance fails CI. A quiet step back to "warn"
 * would let them pile up again unnoticed; this is where that shows.
 */
const CONFIG = stripComments(readFileSync("eslint.config.mjs", "utf8"))

describe("React Compiler rules stay errors", () => {
    for (const rule of ["set-state-in-effect", "error-boundaries", "purity", "immutability"]) {
        it(rule, () => {
            expect(CONFIG).toContain(`"react-hooks/${rule}": "error"`)
            expect(CONFIG.match(new RegExp(`react-hooks/${rule}`, "g")) ?? []).toHaveLength(1)
        })
    }
})
