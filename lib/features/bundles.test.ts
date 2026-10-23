import { describe, it, expect } from "vitest"
import {
    MODULE_BUNDLE, ALL_MODULES, isModule, resolveBundles, hasModule, hasBundle, bundlesFor,
    serializeAccess, deserializeAccess, UNRESTRICTED, ATTENDANCE_BUNDLES, BUNDLE_LABEL_KEYS, BUNDLE_NAMES,
    type Bundle, type PackageFacts,
} from "./bundles"
import { requireFeature, accessFromSession, sessionHasModule } from "./require"

const sessionFor = (pkg: PackageFacts, role = 'ADMIN') => ({
    user: { role, featureAccess: serializeAccess(resolveBundles(pkg)) },
})

const CM = { hasCompanyManagement: true, hasHR: false }
const HR = { hasCompanyManagement: false, hasHR: true }
const BOTH = { hasCompanyManagement: true, hasHR: true }
const CORE_ONLY = { hasCompanyManagement: false, hasHR: false }

describe("the module table", () => {
    it("assigns every module deliberately, with none left to fall through", () => {
        for (const mod of ALL_MODULES) {
            expect(MODULE_BUNDLE[mod], mod).not.toBeUndefined()
        }
        expect(ALL_MODULES.length).toBe(Object.keys(MODULE_BUNDLE).length)
    })

    it("keeps the employee directory in Core, not HR", () => {
        // The line that makes the split sellable at all: you cannot assign a
        // task to somebody who does not exist, so a Company-Management-only
        // buyer with no employee records would have no product.
        expect(bundlesFor('EMPLOYEES')).toEqual([])
        // What you do with an employee is where HR starts.
        expect(bundlesFor('DAY_OFF')).toEqual(['HR'])
        expect(bundlesFor('PAYROLL')).toEqual(['HR'])
        expect(bundlesFor('SALARY_ADJUSTMENTS')).toEqual(['HR'])
    })

    it("puts operations in Company Management", () => {
        for (const m of ['TASKS', 'OBLIGATIONS', 'RECORDS', 'CLIENTS', 'COSTS'] as const) {
            expect(bundlesFor(m), m).toEqual(['COMPANY_MANAGEMENT'])
        }
    })

    it("leaves the always-on modules ungated", () => {
        for (const m of ['DASHBOARD', 'EMPLOYEES', 'USERNAMES', 'PROFILE_REQUESTS', 'REQUESTS'] as const) {
            expect(bundlesFor(m), m).toEqual([])
        }
    })

    it("rejects a name that is not a module", () => {
        expect(isModule('TASKS')).toBe(true)
        expect(isModule('PAYROLL_REPORTS')).toBe(false)
        expect(isModule('')).toBe(false)
        expect(isModule('constructor')).toBe(false) // prototype keys are not modules
    })
})

describe("resolving a package into access", () => {
    it("no package means grandfathered — everything on", () => {
        // Every company that existed before packages shipped.
        expect(resolveBundles(null).unrestricted).toBe(true)
        expect(resolveBundles(undefined).unrestricted).toBe(true)
        for (const mod of ALL_MODULES) {
            expect(hasModule(resolveBundles(null), mod), mod).toBe(true)
        }
    })

    it("a Super Admin is never gated, whatever the package says", () => {
        const access = resolveBundles(CORE_ONLY, { isSuperAdmin: true })
        expect(access.unrestricted).toBe(true)
        for (const mod of ALL_MODULES) {
            expect(hasModule(access, mod), mod).toBe(true)
        }
    })

    it("holding every bundle is not the same fact as being grandfathered", () => {
        // Same permissions, very different things to show on a screen: one
        // customer bought everything, the other was never packaged.
        const bought = resolveBundles({ ...BOTH, hasAttendanceTerminals: true, hasAttendanceMobile: true })
        expect(bought.unrestricted).toBe(false)
        expect(resolveBundles(null).unrestricted).toBe(true)
        for (const mod of ALL_MODULES) {
            expect(hasModule(bought, mod), mod).toBe(hasModule(resolveBundles(null), mod))
        }
    })

    it("Company Management alone opens operations and closes HR", () => {
        const access = resolveBundles(CM)
        expect(hasModule(access, 'TASKS')).toBe(true)
        expect(hasModule(access, 'CLIENTS')).toBe(true)
        expect(hasModule(access, 'DAY_OFF')).toBe(false)
        expect(hasModule(access, 'PAYROLL')).toBe(false)
    })

    it("HR alone opens people and closes operations", () => {
        const access = resolveBundles(HR)
        expect(hasModule(access, 'DAY_OFF')).toBe(true)
        expect(hasModule(access, 'PAYROLL')).toBe(true)
        expect(hasModule(access, 'TASKS')).toBe(false)
        expect(hasModule(access, 'COSTS')).toBe(false)
    })

    it("a Core-only package still gets every Core module", () => {
        const access = resolveBundles(CORE_ONLY)
        expect(access.unrestricted).toBe(false)
        for (const m of ['DASHBOARD', 'EMPLOYEES', 'USERNAMES', 'PROFILE_REQUESTS', 'REQUESTS'] as const) {
            expect(hasModule(access, m), m).toBe(true)
        }
        expect(hasModule(access, 'TASKS')).toBe(false)
        expect(hasModule(access, 'DAY_OFF')).toBe(false)
    })

    it("hasBundle agrees with hasModule", () => {
        expect(hasBundle(resolveBundles(CM), 'COMPANY_MANAGEMENT')).toBe(true)
        expect(hasBundle(resolveBundles(CM), 'HR')).toBe(false)
        expect(hasBundle(resolveBundles(null), 'HR')).toBe(true)
    })
})

describe("surviving the session token's JSON round trip", () => {
    it("a Set does not survive JSON, so access is serialized and restored", () => {
        const original = resolveBundles(CM)
        const roundTripped = deserializeAccess(JSON.parse(JSON.stringify(serializeAccess(original))))
        expect(roundTripped.unrestricted).toBe(false)
        expect(hasModule(roundTripped, 'TASKS')).toBe(true)
        expect(hasModule(roundTripped, 'PAYROLL')).toBe(false)
    })

    it("a token minted before this shipped falls back to unrestricted, not to locked", () => {
        // Otherwise everybody signed in at deploy time abruptly loses every
        // gated module until their token next refreshes.
        expect(deserializeAccess(null).unrestricted).toBe(true)
        expect(deserializeAccess(undefined).unrestricted).toBe(true)
        for (const mod of ALL_MODULES) {
            expect(hasModule(deserializeAccess(undefined), mod), mod).toBe(true)
        }
    })

    it("UNRESTRICTED is not mutated by a caller", () => {
        const before = [...UNRESTRICTED.bundles]
        deserializeAccess(null).bundles.add('HR')
        expect([...UNRESTRICTED.bundles]).toEqual(before)
    })
})

describe("requireFeature", () => {
    it("allows a module the company holds", () => {
        expect(requireFeature(sessionFor(CM), 'TASKS', { onDeny: 'lock' })).toEqual({ allowed: true })
    })

    it("denies a module it does not, naming the bundle to buy", () => {
        const decision = requireFeature(sessionFor(CM), 'PAYROLL', { onDeny: 'lock' })
        expect(decision.allowed).toBe(false)
        if (decision.allowed) return
        expect(decision.module).toBe('PAYROLL')
        expect(decision.bundles).toEqual(['HR'])
        expect(decision.treatment).toBe('lock')
    })

    it("carries the treatment the caller chose, not a default", () => {
        // The standing risk is somebody picking the wrong treatment by
        // accident, which is why onDeny has no default and omitting it does
        // not compile. This asserts it is passed through, not inferred.
        const hidden = requireFeature(sessionFor(CM), 'PAYROLL', { onDeny: 'hide' })
        expect(hidden.allowed).toBe(false)
        if (!hidden.allowed) expect(hidden.treatment).toBe('hide')
    })

    it("never denies a Super Admin, even on a session with no featureAccess", () => {
        const superAdmin = { user: { role: 'SUPER_ADMIN' } }
        for (const mod of ALL_MODULES) {
            expect(requireFeature(superAdmin, mod, { onDeny: 'lock' }).allowed, mod).toBe(true)
        }
    })

    it("never denies a grandfathered company", () => {
        for (const mod of ALL_MODULES) {
            expect(requireFeature(sessionFor(null), mod, { onDeny: 'lock' }).allowed, mod).toBe(true)
        }
    })

    it("treats a missing or malformed session as unrestricted rather than locked", () => {
        // A gate that fails closed on a session it cannot read would lock out
        // real users during any auth hiccup. Authentication is withStandardHandler's
        // job and happens before this; this decides packaging, not identity.
        expect(accessFromSession(undefined).unrestricted).toBe(true)
        expect(accessFromSession({}).unrestricted).toBe(true)
        expect(sessionHasModule(null, 'PAYROLL')).toBe(true)
    })
})

describe("the attendance add-ons (ATTENDANCE_PLAN.md §16)", () => {
    const TERMINALS = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
    const MOBILE = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }

    it("opens the attendance core with either add-on, or both", () => {
        // How punches arrive differs; schedules, policy, the engine and import
        // are needed either way, so either add-on is enough for the core.
        expect(hasModule(resolveBundles(TERMINALS), 'ATTENDANCE')).toBe(true)
        expect(hasModule(resolveBundles(MOBILE), 'ATTENDANCE')).toBe(true)
        expect(hasModule(resolveBundles({ ...TERMINALS, hasAttendanceMobile: true }), 'ATTENDANCE')).toBe(true)
    })

    it("keeps each add-on its own bundle, so a later screen can need one of them", () => {
        expect(hasBundle(resolveBundles(TERMINALS), 'ATTENDANCE_TERMINALS')).toBe(true)
        expect(hasBundle(resolveBundles(TERMINALS), 'ATTENDANCE_MOBILE')).toBe(false)
        expect(hasBundle(resolveBundles(MOBILE), 'ATTENDANCE_MOBILE')).toBe(true)
        expect(hasBundle(resolveBundles(MOBILE), 'ATTENDANCE_TERMINALS')).toBe(false)
    })

    it("does not come with HR alone", () => {
        expect(hasModule(resolveBundles(HR), 'ATTENDANCE')).toBe(false)
        expect(hasModule(resolveBundles(BOTH), 'ATTENDANCE')).toBe(false)
    })

    it("opens nothing without HR, even when the row says it was bought", () => {
        // The form refuses this; a row edited by hand must still not open
        // attendance with no payroll under it.
        const noHR = { hasCompanyManagement: true, hasHR: false, hasAttendanceTerminals: true, hasAttendanceMobile: true }
        const access = resolveBundles(noHR)
        expect(hasModule(access, 'ATTENDANCE')).toBe(false)
        for (const b of ATTENDANCE_BUNDLES) expect(hasBundle(access, b), b).toBe(false)
    })

    it("is on for grandfathered companies and the Super Admin", () => {
        // Round 4, decision 11: grandfathered companies receive attendance on
        // release, like every other module.
        expect(hasModule(resolveBundles(null), 'ATTENDANCE')).toBe(true)
        expect(hasModule(resolveBundles(CORE_ONLY, { isSuperAdmin: true }), 'ATTENDANCE')).toBe(true)
        for (const b of ATTENDANCE_BUNDLES) expect(UNRESTRICTED.bundles.has(b), b).toBe(true)
    })

    it("survives the session token's JSON round trip", () => {
        const roundTripped = deserializeAccess(JSON.parse(JSON.stringify(serializeAccess(resolveBundles(MOBILE)))))
        expect(hasModule(roundTripped, 'ATTENDANCE')).toBe(true)
        expect(hasBundle(roundTripped, 'ATTENDANCE_TERMINALS')).toBe(false)
    })

    it("names both add-ons when attendance is locked", () => {
        expect(bundlesFor('ATTENDANCE')).toEqual(['ATTENDANCE_TERMINALS', 'ATTENDANCE_MOBILE'])
        const decision = requireFeature(sessionFor(HR), 'ATTENDANCE', { onDeny: 'lock' })
        expect(decision.allowed).toBe(false)
        if (decision.allowed) return
        expect(decision.bundles).toEqual(['ATTENDANCE_TERMINALS', 'ATTENDANCE_MOBILE'])
    })

    it("gives every bundle a name on screen and in API messages", () => {
        const all: Bundle[] = ['COMPANY_MANAGEMENT', 'HR', ...ATTENDANCE_BUNDLES]
        for (const b of all) {
            expect(BUNDLE_LABEL_KEYS[b], b).toMatch(/^bundle_/)
            expect(BUNDLE_NAMES[b], b).toBeTruthy()
        }
    })
})
