import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { companyLinkToFollow, addressWithCompanyInView, companyNameStep } from "./company-link"

/**
 * A link that names the company it's about (`?companyId=`), as a company's
 * attendance settings and a face check's notice do, puts that company in view
 * in the top bar for the Super Admin (DESIGN.md §5.3; Attendance part 2).
 */
const known = ["delta", "nile"]
const ATTENDANCE = "/dashboard/attendance"
const follow = (fields: Partial<Parameters<typeof companyLinkToFollow>[0]>) =>
    companyLinkToFollow({ pathname: ATTENDANCE, linked: "delta", known, leftBehind: null, ...fields })

describe("the link to follow", () => {
    it("is the company the link names", () => {
        expect(follow({})).toBe("delta")
    })

    it("is followed even when its company is in view already, so it leaves the address (review on PR 148)", () => {
        // Left in the address, the page went on preferring it, and put that
        // company back after another tab picked a different one. Which company
        // is in view isn't asked: following it is the same either way.
        expect(companyLinkToFollow.length).toBe(1)
        expect(follow({ linked: "nile" })).toBe("nile")
    })

    it("is none when the link names none, or a company the top bar doesn't know, or before it knows any", () => {
        expect(follow({ linked: null })).toBeNull()
        expect(follow({ linked: "gone" })).toBeNull()
        expect(follow({ known: [] })).toBeNull()
    })

    it("is none for the company a pick in the top bar has just left in the address", () => {
        // For a moment after picking Nile the address still names Delta:
        // taking that for a link would undo the pick.
        expect(follow({ leftBehind: "delta" })).toBeNull()
    })

    it("is none but on the pages links open: a page that keeps the company in view in its own address isn't one (review on PR 148)", () => {
        // Requests keeps companyId in step with the company in view. When
        // another tab picks Nile, this tab's Requests still names Delta, and
        // taking that for a link wrote Delta back over the other tab's pick.
        expect(follow({ pathname: "/dashboard/requests" })).toBeNull()
        expect(follow({ pathname: "/dashboard/payroll" })).toBeNull()
    })
})

describe("the address once the link is followed", () => {
    it("names the company as the top bar does, with no companyId left to put it back in view", () => {
        // Left in, the link would undo a pick made in another tab: that tab's
        // pick reaches this one, and this address would put its company back.
        expect(addressWithCompanyInView("tab=face&companyId=delta&review=r1", "Delta Sites")).toBe("tab=face&review=r1&company=Delta+Sites")
        expect(addressWithCompanyInView("companyId=delta&company=Nile+Works", "Delta Sites")).toBe("company=Delta+Sites")
    })

    it("names none when All companies is in view", () => {
        expect(addressWithCompanyInView("tab=face&company=Gone&companyId=gone", null)).toBe("tab=face")
    })
})

/**
 * The company the address names by name (`?company=`), as the top bar keeps it
 * there for the company in view, and as a pasted link or a reload brings it.
 */
const COMPANIES = [{ id: "delta", name: "Delta Sites" }, { id: "nile", name: "Nile Works" }]
const step = (fields: Partial<Parameters<typeof companyNameStep>[0]>) =>
    companyNameStep({ named: "Delta Sites", known: COMPANIES, inView: "nile", ...fields })

describe("what the top bar does with the company the address names", () => {
    it("waits while the top bar doesn't know its companies yet", () => {
        // They arrive after the page loads. Deciding before then took the name
        // for handled, so a reload kept the stored company in view under
        // another company's name (seen in the browser while checking PR 148).
        expect(step({ known: [] })).toEqual({ kind: "wait" })
        expect(step({ known: [], named: null })).toEqual({ kind: "wait" })
    })

    it("puts a company the top bar knows in view, and does nothing when it's in view already", () => {
        expect(step({})).toEqual({ kind: "put-in-view", id: "delta" })
        expect(step({ inView: null })).toEqual({ kind: "put-in-view", id: "delta" })
        expect(step({ inView: "delta" })).toEqual({ kind: "none" })
    })

    it("rewrites a name the top bar doesn't know to the company in view, or takes it out for All companies", () => {
        expect(step({ named: "Gone" })).toEqual({ kind: "rewrite", name: "Nile Works" })
        expect(step({ named: "Gone", inView: null })).toEqual({ kind: "rewrite", name: null })
        // A company in view that the top bar doesn't know is shown as All companies.
        expect(step({ named: "Gone", inView: "gone" })).toEqual({ kind: "rewrite", name: null })
    })

    it("names the company in view when the address names none, and leaves it be for All companies", () => {
        expect(step({ named: null })).toEqual({ kind: "rewrite", name: "Nile Works" })
        expect(step({ named: null, inView: null })).toEqual({ kind: "none" })
        expect(step({ named: null, inView: "gone" })).toEqual({ kind: "none" })
    })
})

describe("the top bar follows such a link", () => {
    const HEADER = readFileSync("components/DashboardHeader.tsx", "utf8")

    it("before it matches the company named in the address, and remembers what a pick leaves behind", () => {
        const sync = HEADER.slice(HEADER.indexOf("// Sync URL <-> Context"), HEADER.indexOf("lastProcessedCompany.current = companyNameFromUrl"))
        expect(sync).toContain("const follow = companyLinkToFollow({ pathname, linked: searchParams.get('companyId'),")
        expect(sync.indexOf("companyLinkToFollow(")).toBeLessThan(sync.indexOf("if (companyNameFromUrl === lastProcessedCompany.current) return"))
        // Puts it in view only when it isn't, and takes it out of the address either way.
        expect(sync).toMatch(/if \(follow\) \{\s*const moving = follow !== selectedCompanyId\s*if \(moving\) setSelectedCompanyId\(follow\)/)
        expect(sync).toContain("router.replace(`${pathname}?${addressWithCompanyInView(searchParams.toString(), name)}`)")
        const pick = HEADER.slice(HEADER.indexOf("const handleSelectCompany"), HEADER.indexOf("router.push(`${pathname}?${params.toString()}`)"))
        expect(pick).toContain("companyLeftBehind.current = searchParams.get('companyId')")
    })
})

describe("the top bar applies the company the address names", () => {
    const HEADER = readFileSync("components/DashboardHeader.tsx", "utf8")
    const start = HEADER.indexOf("const companyNameFromUrl = searchParams.get('company')")
    const RECORDED = "lastProcessedCompany.current = companyNameFromUrl"
    const sync = HEADER.slice(start, HEADER.indexOf(RECORDED, start) + RECORDED.length)

    it("only once it knows its companies, so a fresh tab, a reload or a pasted link still puts it in view", () => {
        // Before, the name was recorded as handled while the companies were
        // still on their way, and when they came the guard turned it away.
        expect(sync).toContain("const step = companyNameStep({ named: companyNameFromUrl, known: companies, inView: selectedCompanyId })")
        expect(sync).toMatch(/if \(step\.kind === 'wait'\) return\n/)
        expect(sync.indexOf("if (companyNameFromUrl === lastProcessedCompany.current) return")).toBeLessThan(sync.indexOf("companyNameStep("))
        expect(sync.indexOf("if (step.kind === 'wait') return")).toBeLessThan(sync.indexOf("lastProcessedCompany.current = companyNameFromUrl"))
    })

    it("puts it in view and has the server render again, or makes the address name the company in view", () => {
        expect(sync).toMatch(/if \(step\.kind === 'put-in-view'\) \{\s*setSelectedCompanyId\(step\.id\)\s*(\/\/.*\n\s*)*router\.refresh\(\)/)
        expect(sync).toMatch(/else if \(step\.kind === 'rewrite'\) \{\s*router\.replace\(`\$\{pathname\}\?\$\{addressWithCompanyInView\(searchParams\.toString\(\), step\.name\)\}`\)/)
    })
})
