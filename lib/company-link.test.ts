import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { companyToPutInView, addressWithCompanyInView } from "./company-link"

/**
 * A link that names the company it's about (`?companyId=`), as a company's
 * attendance settings and a face check's notice do, puts that company in view
 * in the top bar for the Super Admin (DESIGN.md §5.3; Attendance part 2).
 */
const known = ["delta", "nile"]

describe("the company a link puts in view", () => {
    it("is the one the link names, when another, or none, is in view", () => {
        expect(companyToPutInView({ linked: "delta", inView: "nile", known, leftBehind: null })).toBe("delta")
        expect(companyToPutInView({ linked: "delta", inView: null, known, leftBehind: null })).toBe("delta")
    })

    it("is none when the link names none, or the one in view already", () => {
        expect(companyToPutInView({ linked: null, inView: "nile", known, leftBehind: null })).toBeNull()
        expect(companyToPutInView({ linked: "nile", inView: "nile", known, leftBehind: null })).toBeNull()
    })

    it("is none for a company the top bar doesn't know, or before it knows any", () => {
        expect(companyToPutInView({ linked: "gone", inView: "nile", known, leftBehind: null })).toBeNull()
        expect(companyToPutInView({ linked: "delta", inView: "nile", known: [], leftBehind: null })).toBeNull()
    })

    it("is none for the company a pick in the top bar has just left in the address", () => {
        // The Requests page keeps the company in view in its own address, so
        // for a moment after picking Nile it still names Delta: taking that
        // for a link would undo the pick.
        expect(companyToPutInView({ linked: "delta", inView: "nile", known, leftBehind: "delta" })).toBeNull()
    })
})

describe("the address once the link is followed", () => {
    it("names the company as the top bar does, with no companyId left to put it back in view", () => {
        // Left in, the link would undo a pick made in another tab: that tab's
        // pick reaches this one, and this address would put its company back.
        expect(addressWithCompanyInView("tab=face&companyId=delta&review=r1", "Delta Sites")).toBe("tab=face&review=r1&company=Delta+Sites")
        expect(addressWithCompanyInView("companyId=delta&company=Nile+Works", "Delta Sites")).toBe("company=Delta+Sites")
    })
})

describe("the top bar follows such a link", () => {
    const HEADER = readFileSync("components/DashboardHeader.tsx", "utf8")

    it("before it matches the company named in the address, and remembers what a pick leaves behind", () => {
        const sync = HEADER.slice(HEADER.indexOf("// Sync URL <-> Context"), HEADER.indexOf("lastProcessedCompany.current = companyNameFromUrl"))
        expect(sync.indexOf("companyToPutInView(")).toBeGreaterThan(-1)
        expect(sync.indexOf("companyToPutInView(")).toBeLessThan(sync.indexOf("if (companyNameFromUrl === lastProcessedCompany.current) return"))
        expect(sync).toMatch(/if \(putInView\) \{\s*setSelectedCompanyId\(putInView\)/)
        expect(sync).toContain("router.replace(`${pathname}?${addressWithCompanyInView(searchParams.toString(), name)}`)")
        const pick = HEADER.slice(HEADER.indexOf("const handleSelectCompany"), HEADER.indexOf("router.push(`${pathname}?${params.toString()}`)"))
        expect(pick).toContain("companyLeftBehind.current = searchParams.get('companyId')")
    })
})
