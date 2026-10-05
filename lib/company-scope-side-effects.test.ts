import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The global company scope changes when a person uses the switcher, and at no
 * other time.
 *
 * The Settings gear on the companies list used to set it on the way to the
 * settings page, so that Vendors and Tasks — which read only the switcher —
 * would follow you into the company you had just opened. The cost was out of
 * all proportion to that: setSelectedCompanyId writes a cookie with a one-year
 * max-age and mirrors it to localStorage, so a single click re-scoped the
 * whole product across sessions, silently, with nothing to put it back. It was
 * also the only one of five row actions that did it — Payments History is
 * reached by company id in exactly the same way and never touched the scope.
 *
 * Comments stripped: the prose above and at the call site names the very thing
 * these guards forbid.
 */
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const LIST = read("app/(dashboard)/dashboard/companies/page.tsx")
const SETTINGS = read("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx")

describe("only the switcher moves the switcher", () => {
    it("does not set the global scope from the companies list", () => {
        expect(LIST).not.toContain("setSelectedCompanyId")
    })

    it("does not pull the setter out of the context under another name either", () => {
        // The call site read setGlobalSelectedCompanyId, an alias created in
        // the destructure — so a check for the context method's own name would
        // have missed it.
        expect(LIST).not.toMatch(/setSelectedCompanyId\s*:\s*\w+/)
        expect(LIST).toContain("const { triggerRefresh } = useCompany()")
    })

    it("still reaches settings by company id", () => {
        // Dropping the side effect must not drop the navigation with it.
        // A link now (lib/navigation-progress.test.ts), with nothing else on the click.
        expect(LIST).toMatch(/<Link href=\{`\/dashboard\/companies\/\$\{company\.id\}\/settings`\}/)
    })
})

describe("the settings page says whose settings these are", () => {
    it("puts the company name in the heading", () => {
        // With the switcher no longer following you in, the page is the only
        // thing that answers this.
        expect(SETTINGS).toMatch(/<h1[^>]*>\{company\?\.name/)
    })
})
