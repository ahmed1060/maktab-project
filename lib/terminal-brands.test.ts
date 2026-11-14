import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync } from "node:fs"
import { FingerprintIcon } from "@phosphor-icons/react/ssr"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { PAGES, SUPER_ADMIN_GROUPS } from "./side-bar"
import { ITEM_ICONS } from "./side-bar-icons"
import { KNOWN_REFUSALS } from "./api-errors"
import { stripComments } from "./strip-comments"

/**
 * Terminal brands (ATTENDANCE_PLAN.md §17.9, Phase 4 part 3, PR 279): the
 * Super Admin's page under Templates, a row for each brand, its protocol,
 * how many terminals have it and its notes, with Add a brand, Edit, and
 * Delete or Retire (DESIGN.md §5.5, Row menu).
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "SUPER_ADMIN",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "sa", role: state.role } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...(key ? state.swr[key] : {}) }
    },
}))
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus.push(props as never)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const ok = (data: unknown) => ({ data: { data } })
const failed = { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) }
const BRANDS = "/api/terminal-brands"
const brand = (b: Record<string, unknown> = {}) => ({ id: "b1", name: "Convoy", protocol: "ZKTECO", notesEn: null, notesAr: null, retiredAt: null, terminalCount: 0, ...b })

async function page(swr: Record<string, Loaded>, { locale = "en", role = "SUPER_ADMIN" }: { locale?: "en" | "ar"; role?: string } = {}) {
    const { default: TerminalBrandsPage } = await import("@/app/(dashboard)/dashboard/terminal-brands/page")
    Object.assign(state, { swr, locale, role, keys: [], menus: [] })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(TerminalBrandsPage))
    } finally {
        vi.unstubAllGlobals()
    }
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))

describe("the migration and the schema", () => {
    const name = readdirSync("prisma/migrations").find(m => m.endsWith("_terminal_brands"))
    const migration = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
    const schema = readFileSync("prisma/schema.prisma", "utf8")

    it("comes after the setup switch's, and only adds", () => {
        expect(name! > "20261221000000_terminals_granted").toBe(true)
        expect(migration).not.toMatch(/\b(DROP|TRUNCATE)\b|DELETE FROM/)
        expect(migration).not.toMatch(/ALTER TABLE[^;]*\b(ALTER|DROP) COLUMN/)
    })

    it("knows the two protocols Nizmo speaks, as code", () => {
        expect(migration).toContain(`CREATE TYPE "TerminalProtocol" AS ENUM ('ZKTECO', 'HIKVISION')`)
        expect(schema).toMatch(/enum TerminalProtocol \{\s*ZKTECO\s*HIKVISION\s*\}/)
    })

    it("keeps the brands, names unique capitals aside, and starts with ZKTeco, Hikvision and Convoy", () => {
        expect(migration).toMatch(/CREATE TABLE "TerminalBrand"/)
        expect(migration).toMatch(/CREATE UNIQUE INDEX "TerminalBrand_name_lower_key" ON "TerminalBrand" \(lower\("name"\)\)/)
        for (const [brand, protocol] of [["ZKTeco", "ZKTECO"], ["Hikvision", "HIKVISION"], ["Convoy", "ZKTECO"]]) {
            expect(migration).toContain(`'${brand}', '${protocol}'`)
        }
    })

    it("gives every terminal a protocol, ZKTeco's to start, and a brand that can't be deleted while it holds it", () => {
        expect(migration).toContain(`ADD COLUMN "protocol" "TerminalProtocol" NOT NULL DEFAULT 'ZKTECO'`)
        expect(migration).toContain(`ADD COLUMN "brandId" TEXT`)
        expect(migration).toMatch(/FOREIGN KEY \("brandId"\) REFERENCES "TerminalBrand"\("id"\) ON DELETE RESTRICT/)
        expect(schema).toMatch(/protocol\s+TerminalProtocol\s+@default\(ZKTECO\)/)
        expect(schema).toMatch(/brand\s+TerminalBrand\?\s+@relation\(fields: \[brandId\], references: \[id\], onDelete: Restrict\)/)
    })
})

describe("in the side bar", () => {
    it("joins Templates, after Public holidays, with a fingerprint", () => {
        expect(SUPER_ADMIN_GROUPS.find(g => g.key === "templates")!.items).toEqual(["roleTemplates", "policyTemplates", "publicHolidays", "terminalBrands"])
        expect(PAGES.terminalBrands).toEqual({ href: "/dashboard/terminal-brands", labelKey: "tbrand_title" })
        expect(ITEM_ICONS.terminalBrands).toBe(FingerprintIcon)
    })
})

describe("its routes", () => {
    const ROUTES = ["app/api/terminal-brands/route.ts", "app/api/terminal-brands/[id]/route.ts", "app/api/terminal-brands/[id]/retire/route.ts", "app/api/terminal-brands/[id]/restore/route.ts"]

    it("are the Super Admin's alone: every handler refuses anyone else first", () => {
        for (const path of ROUTES) {
            const source = stripComments(readFileSync(path, "utf8"))
            const handlers = source.match(/export const (GET|POST|PUT|PATCH|DELETE)/g) ?? []
            expect(handlers.length, path).toBeGreaterThan(0)
            const guards = source.match(/if \(session\.user\.role !== "SUPER_ADMIN"\) return ApiResponse\.forbidden\(\)/g) ?? []
            expect(guards.length, path).toBe(handlers.length)
        }
    })

    it("answer each refusal with what to do", () => {
        for (const code of ["BRAND_NOT_FOUND", "BRAND_NAME_REQUIRED", "BRAND_NAME_TAKEN", "BRAND_PROTOCOL_UNKNOWN", "BRAND_PROTOCOL_IN_USE", "BRAND_IN_USE", "BRAND_RETIRED", "BRAND_NOT_RETIRED"]) {
            expect(KNOWN_REFUSALS[code], code).toBeDefined()
        }
        expect(KNOWN_REFUSALS.BRAND_NAME_TAKEN.status).toBe(409)
        expect(KNOWN_REFUSALS.BRAND_IN_USE.message).toContain("Retire")
    })
})

describe("the page", () => {
    it("has a header that names it, says what it's for, and holds Add a brand", async () => {
        const top = header(await page({ [BRANDS]: ok({ brands: [] }) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.tbrand_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.tbrand_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*${en.tbrand_add}</button></div>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await page({ [BRANDS]: ok({ brands: [brand()] }) }, { role: "ADMIN" })
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says while the brands load, and when they didn't, with Try again", async () => {
        expect(await page({})).toContain(`<div class="ui-panel" role="status">`)
        const html = await page({ [BRANDS]: failed })
        expect(html).toContain(esc(en.tbrand_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("lists each brand: its name, its protocol, how many terminals have it, and its notes", async () => {
        const html = await page({ [BRANDS]: ok({ brands: [
            brand({ terminalCount: 2, notesEn: "Settings under Comm.", notesAr: "الإعدادات في قائمة الاتصال" }),
            brand({ id: "b2", name: "Hikvision", protocol: "HIKVISION" }),
        ] }) })
        expect(html).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.tbrand_title}">`)
        expect(html).toContain('<span class="ui-item-title"><bdi>Convoy</bdi></span>')
        expect(html).toContain(`<bdi>${esc(en.tbrand_protocol_ZKTECO)}</bdi>${en.list_separator}<bdi>2 terminals</bdi>`)
        expect(html).toContain(`<bdi>${esc(en.tbrand_protocol_HIKVISION)}</bdi>${en.list_separator}<bdi>${esc(en.tbrand_used_none)}</bdi>`)
        // Its notes in the page's language.
        expect(html).toContain("<bdi>Settings under Comm.</bdi>")
        expect(html).not.toContain("الإعدادات في قائمة الاتصال")
    })

    it("offers Delete for a brand no terminal has had, Retire for one a terminal has, and Put back for a retired one", async () => {
        await page({ [BRANDS]: ok({ brands: [
            brand({ id: "unused", name: "Anviz" }),
            brand({ id: "used", terminalCount: 3 }),
            brand({ id: "retired", name: "Old", retiredAt: "2026-11-14T10:00:00.000Z", terminalCount: 1 }),
        ] }) })
        const items = state.menus.map(m => m.items.map(i => `${i.key}${i.danger ? "!" : ""}`))
        expect(items).toEqual([["edit", "delete!"], ["edit", "retire"], ["edit", "restore"]])
    })

    it("marks a retired brand with a badge and keeps it on the list, last", async () => {
        const html = await page({ [BRANDS]: ok({ brands: [
            brand({ id: "retired", name: "Old", retiredAt: "2026-11-14T10:00:00.000Z" }),
            brand({ id: "b2", name: "Hikvision", protocol: "HIKVISION" }),
        ] }) })
        expect(html).toContain(`>${en.tbrand_retired_badge}</span>`)
        expect(html.indexOf("<bdi>Hikvision</bdi>")).toBeLessThan(html.indexOf("<bdi>Old</bdi>"))
    })

    it("in Arabic, counts in Arabic and shows the Arabic notes, falling back to the English ones", async () => {
        const html = await page({ [BRANDS]: ok({ brands: [
            brand({ terminalCount: 2, notesEn: "Settings under Comm.", notesAr: "الإعدادات في قائمة الاتصال" }),
            brand({ id: "b2", name: "Hikvision", protocol: "HIKVISION", terminalCount: 1, notesEn: "Port 80" }),
        ] }) }, { locale: "ar" })
        expect(html).toContain(`<h1 class="ui-page-title">${ar.tbrand_title}</h1>`)
        expect(html).toContain(`<bdi>${ar.count_terminals_two}</bdi>`)
        expect(html).toContain(`<bdi>${ar.count_terminals_one}</bdi>`)
        expect(html).toContain("<bdi>الإعدادات في قائمة الاتصال</bdi>")
        expect(html).toContain('<bdi lang="en">Port 80</bdi>')
    })
})

describe("its words", () => {
    const KEYS = Object.keys(en).filter(k => k.startsWith("tbrand_") || k.startsWith("count_terminals_") || k.includes("TERMINAL_BRAND"))

    it("are there in both languages", () => {
        expect(KEYS.length).toBeGreaterThan(30)
        for (const key of KEYS) expect((ar as Record<string, string>)[key], key).toBeTruthy()
        for (const action of ["CREATE", "UPDATE", "RETIRE", "RESTORE", "DELETE"]) {
            expect(KEYS, action).toContain(`audit_action_${action}_TERMINAL_BRAND`)
        }
        expect(KEYS).toContain("audit_entity_TERMINAL_BRAND")
    })

    it("name each protocol as Nizmo speaks it", () => {
        expect(en.tbrand_protocol_ZKTECO).toBe("ZKTeco's protocol")
        expect(en.tbrand_protocol_HIKVISION).toBe("Hikvision's ISAPI")
    })
})
