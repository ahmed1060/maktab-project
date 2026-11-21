import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, existsSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { setupGuide, forShell, inlineCode, type CommandShell } from "./attendance/setup-guide"

/**
 * How to set up a fingerprint terminal on a page of its own (ATTENDANCE_PLAN.md
 * §17.7, the guide on a page of its own, part 1; DESIGN.md §5.5, A guide's
 * page; PR 356), as the owner approved in the Fingerprint terminal setup guide
 * canvas: opened from the round "i" on Fingerprint terminals, with Print, and
 * a choice of Command Prompt or PowerShell that writes every command for the
 * one picked, kept in the browser. All names are made up.
 */

const state = {
    locale: "en" as "en" | "ar",
    session: { user: { role: "ADMIN", companyId: "c1" } } as { user: { role: string; companyId: string | null } },
    devices: undefined as undefined | { brands: unknown[]; directAllowed: boolean; devices: unknown[] },
    error: undefined as undefined | { status: number },
    asked: [] as string[],
}
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.session, status: "authenticated" }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        if (key) state.asked.push(key)
        return { data: state.devices ? { data: state.devices } : undefined, error: state.error, isValidating: false, mutate: async () => {} }
    },
}))

const SERVER = "https://nizmo.example"
const CONVOY = { id: "b1", name: "Convoy", protocol: "ZKTECO" as const, notesEn: "Its comm key is under Comm., PC Connection.", notesAr: null }
const HIK = { id: "b2", name: "Hikvision", protocol: "HIKVISION" as const, notesEn: null, notesAr: null }
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const codes = (steps: ReturnType<typeof setupGuide>) => steps.flatMap(s => s.lines).map(l => l.code).filter((c): c is string => !!c)
const ways = (shell: CommandShell) => ({
    "ZKTeco's, read": setupGuide("ZKTECO", { superAdmin: true, server: SERVER, shell }),
    "ZKTeco's, sending": setupGuide("ZKTECO", { superAdmin: false, server: SERVER, pushes: true, shell }),
    "Hikvision's": setupGuide("HIKVISION", { superAdmin: true, server: SERVER, shell }),
})

beforeEach(() => {
    state.locale = "en"
    state.session = { user: { role: "ADMIN", companyId: "c1" } }
    state.devices = { brands: [CONVOY, HIK], directAllowed: false, devices: [] }
    state.error = undefined
    state.asked = []
})

describe("the commands, written for the program picked", () => {
    it("puts .\\ before each of the agent's own commands in PowerShell, line by line, and nothing else", () => {
        expect(forShell("nizmo-agent.exe enrol CODE", "POWERSHELL")).toBe(".\\nizmo-agent.exe enrol CODE")
        expect(forShell("nizmo-agent-service.exe install\nnizmo-agent-service.exe start", "POWERSHELL")).toBe(".\\nizmo-agent-service.exe install\n.\\nizmo-agent-service.exe start")
        expect(forShell("nizmo-agent-service.exe stop\nnizmo-agent.exe trust TERMINAL-ADDRESS", "POWERSHELL")).toBe(".\\nizmo-agent-service.exe stop\n.\\nizmo-agent.exe trust TERMINAL-ADDRESS")
        // Windows' own commands, a folder, and a file's contents, as they are.
        for (const code of ['cd "C:\\Program Files\\Nizmo Agent"', "netsh advfirewall firewall add rule name=\"Nizmo agent\"", "C:\\Program Files\\Nizmo Agent", '"sendFrom": "YYYY-MM-DD"']) {
            expect(forShell(code, "POWERSHELL"), code).toBe(code)
        }
        // Command Prompt runs them as they are.
        expect(forShell("nizmo-agent-service.exe install\nnizmo-agent-service.exe start", "CMD")).toBe("nizmo-agent-service.exe install\nnizmo-agent-service.exe start")
    })

    it("writes every box in each set of steps for PowerShell, and leaves them as they are for Command Prompt", () => {
        for (const [way, steps] of Object.entries(ways("POWERSHELL"))) {
            const agent = codes(steps).flatMap(c => c.split("\n")).filter(l => /nizmo-agent/.test(l) && !l.includes('"'))
            expect(agent.length, way).toBeGreaterThan(2)
            for (const line of agent) expect(line, way).toMatch(/^\.\\nizmo-agent(-service)?\.exe /)
        }
        for (const [way, steps] of Object.entries(ways("CMD"))) {
            expect(codes(steps).some(c => c.includes(".\\")), way).toBe(false)
        }
        // Command Prompt to start with.
        expect(setupGuide("ZKTECO", { superAdmin: true, server: SERVER })).toEqual(setupGuide("ZKTECO", { superAdmin: true, server: SERVER, shell: "CMD" }))
    })

    it("opens the program picked, once, in the agent's folder, right after unzipping it", () => {
        const folder = 'cd "C:\\Program Files\\Nizmo Agent"'
        for (const [shell, key] of [["CMD", "att_guide_folder"], ["POWERSHELL", "att_guide_folder_ps"]] as const) {
            for (const [way, steps] of Object.entries(ways(shell))) {
                const lines = steps[1].lines
                const at = lines.findIndex(l => l.text === "att_guide_unzip")
                expect(lines[at + 1], `${shell} ${way}`).toEqual({ text: key, code: folder })
                expect(steps.flatMap(s => s.lines).filter(l => l.text === "att_guide_folder" || l.text === "att_guide_folder_ps"), `${shell} ${way}`).toHaveLength(1)
                // The page's choice says how PowerShell differs: no line of its own for it.
                expect(steps.flatMap(s => s.lines).some(l => (l.text as string) === "att_guide_powershell"), `${shell} ${way}`).toBe(false)
            }
        }
    })
})

describe("its words", () => {
    it("say how to open each program, and how its commands are written, in both languages", () => {
        for (const w of [en, ar]) {
            expect(w.att_guide_folder).toContain("`Command Prompt`")
            expect(w.att_guide_folder_ps).toContain("`PowerShell`")
            expect(w.att_guide_folder_ps).toContain("Terminal (Admin)")
            expect(w.att_guide_shell_POWERSHELL_hint).toContain("`.\\`")
            expect(w.att_guide_shell_CMD_hint).not.toContain("`.\\`")
            for (const key of ["att_guide_shell", "att_guide_subtitle", "att_guide_printed"] as const) expect(w[key], key).toBeTruthy()
            expect(w.att_guide_printed).toMatch(/\{model\}.*\{program\}.*\{date\}/)
        }
        expect(en.att_guide_shell).toBe("Commands are typed in")
        expect(ar.att_guide_shell).toBe("تُكتب الأوامر في")
        // What's typed is the same in Arabic.
        for (const key of ["att_guide_folder_ps", "att_guide_shell_POWERSHELL_hint", "att_guide_shell_CMD_hint"] as const) {
            const typed = (text: string) => inlineCode(text).flatMap(p => ("code" in p ? [p.code] : []))
            expect(typed(ar[key]), key).toEqual(typed(en[key]))
        }
        // The line the choice took the place of is gone.
        expect("att_guide_powershell" in en).toBe(false)
        expect("att_guide_powershell" in ar).toBe(false)
    })
})

async function page(props: { companyId?: string } = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { default: TerminalGuidePage } = await import("@/components/TerminalGuidePage")
    return renderToStaticMarkup(h(TerminalGuidePage, props))
}

describe("the guide's page", () => {
    it("has a back link to the Attendance tab, the guide's name, what's in it, and Print", async () => {
        const html = await page()
        expect(html).toContain(`<a class="ui-back-link" href="/dashboard/settings?tab=attendance">`)
        expect(html).toContain(`${en.att_term_title}</a>`)
        expect(html).toContain(`<h1 class="ui-page-title">${en.att_guide_button}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.att_guide_subtitle)}</p>`)
        expect(html).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-secondary"[^>]*>(<svg[^]*?</svg>)?${en.doc_print}</button></div>`))
        // The company's people read their own company's.
        expect(state.asked).toEqual(["/api/attendance/devices"])
    })

    it("for the Super Admin, reads the company's and goes back to its settings", async () => {
        state.session = { user: { role: "SUPER_ADMIN", companyId: null } }
        const html = await page({ companyId: "c 9" })
        expect(html).toContain(`<a class="ui-back-link" href="/dashboard/companies/c%209/settings?tab=attendance">`)
        expect(state.asked).toEqual(["/api/attendance/devices?companyId=c%209"])
    })

    it("asks for the model, says to pick one until it's picked, and asks which program commands are typed in, Command Prompt to start with", async () => {
        for (const locale of ["en", "ar"] as const) {
            const w = locale === "ar" ? ar : en
            const html = await page({}, locale)
            expect(html, locale).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${w.att_guide_model}</label>`))
            expect(html, locale).toContain(`<option value="" selected="">${w.att_guide_model_pick}</option><option value="b1">Convoy</option><option value="b2">Hikvision</option>`)
            expect(html, locale).toContain(`<p class="ui-card-note">${esc(w.att_guide_pick_first)}</p>`)
            expect(html, locale).toContain(`<legend class="ui-label">${w.att_guide_shell}</legend>`)
            expect(html, locale).toMatch(/<input type="radio" class="ui-radio" name="shell" checked="" value="CMD"\/><span translate="no">Command Prompt<\/span>/)
            expect(html, locale).toMatch(/<input type="radio" class="ui-radio" name="shell" value="POWERSHELL"\/><span translate="no">PowerShell<\/span>/)
            expect(html, locale).toContain(esc(w.att_guide_shell_CMD_hint.split("`")[0]))
            expect(html, locale).not.toContain("ui-guide-steps")
        }
    })

    it("says while the models load, if they didn't, and when there are none; and refuses whoever may not set terminals up", async () => {
        state.devices = undefined
        expect(await page()).toMatch(new RegExp(`<select[^>]*disabled=""[^>]*><option value="" selected="">${en.loading}</option></select>`))
        state.error = { status: 500 }
        expect(await page()).toContain(`<p class="ui-card-note" role="status">${esc(en.att_term_load_failed)}</p>`)
        state.error = undefined
        state.devices = { brands: [], directAllowed: false, devices: [] }
        expect(await page()).toContain(esc(en.att_guide_no_models))
        for (const status of [403, 404]) {
            state.devices = undefined
            state.error = { status }
            const refused = await page()
            expect(refused, String(status)).toContain(esc(en.access_denied_title))
            expect(refused, String(status)).not.toContain("<select")
        }
    })
})

async function steps(shell: CommandShell, brand: typeof CONVOY | typeof HIK = CONVOY, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { GuideSteps } = await import("@/components/TerminalGuidePage")
    return renderToStaticMarkup(h(GuideSteps, { brand, superAdmin: false, directAllowed: false, server: SERVER, shell, pushes: false }))
}

describe("the steps on the page", () => {
    it("are only what prints, under a line naming the model, the program and the day, which only paper shows", async () => {
        const html = await steps("POWERSHELL")
        expect(html).toMatch(/^<div class="print-document ui-guide-page">/)
        // The model and the program as they're printed, never machine-translated.
        const printed = esc(en.att_guide_printed).replace("{model}", `<bdi translate="no">Convoy</bdi>`).replace("{program}", `<span translate="no">PowerShell</span>`)
        expect(html).toContain(`<div class="ui-doc-print-only"><p class="ui-guide-print-title">${en.att_guide_button}</p><p>${printed.slice(0, printed.indexOf("{date}"))}`)
        expect(html).toContain(`<ol class="ui-guide-steps" role="list">`)
    })

    it("write the boxes for PowerShell, and the commands in a line too", async () => {
        const ps = await steps("POWERSHELL")
        expect(ps).toContain(`<code>.\\nizmo-agent.exe probe TERMINAL-ADDRESS</code>`)
        expect(ps).toContain(`<code>.\\nizmo-agent.exe enrol CODE</code>`)
        expect(ps).toContain(`<code>.\\nizmo-agent-service.exe install\n.\\nizmo-agent-service.exe start</code>`)
        expect(ps).toContain(esc(en.att_guide_folder_ps.split("`")[0]))
        // A command named in a line, as Hikvision's already installed agent has.
        const hik = await steps("POWERSHELL", HIK)
        expect(hik).toContain(`<code class="ui-guide-inline" dir="ltr" translate="no">.\\nizmo-agent-service.exe stop</code>`)
        const cmd = await steps("CMD", HIK)
        expect(cmd).toContain(`<code class="ui-guide-inline" dir="ltr" translate="no">nizmo-agent-service.exe stop</code>`)
        expect(cmd).not.toContain(".\\nizmo-agent")
    })
})

describe("what's picked, kept in the browser", () => {
    it("reads Command Prompt until PowerShell is kept, and anything else as Command Prompt", async () => {
        const store = new Map<string, string>()
        vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
        vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} })
        try {
            const shell = await import("./attendance/guide-shell")
            expect(shell.readGuideShell()).toBe("CMD")
            shell.writeGuideShell("POWERSHELL")
            expect(shell.readGuideShell()).toBe("POWERSHELL")
            store.set(shell.GUIDE_SHELL_KEY, "bash")
            expect(shell.readGuideShell()).toBe("CMD")
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it("lasts until a reload where the browser keeps nothing, and is read without a flash of the other", async () => {
        vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") } })
        try {
            const shell = await import("./attendance/guide-shell")
            shell.writeGuideShell("POWERSHELL")
            expect(shell.readGuideShell()).toBe("POWERSHELL")
            shell.writeGuideShell("CMD")
        } finally {
            vi.unstubAllGlobals()
        }
        const source = readFileSync("lib/attendance/guide-shell.ts", "utf8")
        // Drawn on the server as Command Prompt, then as kept, with no effect copying it.
        expect(source).toMatch(/useSyncExternalStore<CommandShell>\(subscribeGuideShell, readGuideShell, \(\) => "CMD"\)/)
    })
})

describe("where it opens from, and its addresses", () => {
    it("is a link from the round \"i\", for the company's people and the Super Admin", () => {
        const panel = readFileSync("components/AttendanceTerminalsPanel.tsx", "utf8")
        expect(panel).toContain("<GuideLink label={t('att_guide_button')} href={guidePath(superAdmin ? companyId : null)} />")
        expect(panel).not.toContain("<TerminalSetupGuide")
        const button = readFileSync("components/ui/Button.tsx", "utf8")
        expect(button).toMatch(/export function GuideLink\(\{ label, href \}: \{ label: string; href: string \}\) \{\s*return \(\s*<Link href=\{href\} className="ui-btn ui-btn-quiet ui-btn-sm ui-guide-button" aria-label=\{label\} title=\{label\} prefetch=\{false\}>/)
    })

    it("has a page for the company's people, guarded as attendance is, and one for the Super Admin under the company", async () => {
        const { guidePath } = await import("./attendance/setup-guide")
        expect(guidePath(null)).toBe("/dashboard/settings/terminal-guide")
        expect(guidePath("c 9")).toBe("/dashboard/companies/c%209/settings/terminal-guide")
        expect(existsSync("app/(dashboard)/dashboard/settings/terminal-guide/page.tsx")).toBe(true)
        expect(readFileSync("app/(dashboard)/dashboard/settings/terminal-guide/layout.tsx", "utf8")).toMatch(/const locked = await guardModule\('ATTENDANCE'\)\s*return locked \?\? <>\{children\}<\/>/)
        expect(readFileSync("app/(dashboard)/dashboard/companies/[id]/settings/terminal-guide/page.tsx", "utf8")).toContain("<TerminalGuidePage companyId={id} />")
        const { PAGE_MODULE_ROUTES } = await import("./features/routes")
        expect(PAGE_MODULE_ROUTES).toContainEqual(["/dashboard/settings/terminal-guide", "ATTENDANCE"])
        const { resolveTitleKey } = await import("./page-title")
        expect(resolveTitleKey("/dashboard/settings/terminal-guide")).toBe("att_guide_button")
    })

    it("prints with the browser's print, and lays its steps out as panels, logical and on tokens", () => {
        expect(readFileSync("components/TerminalGuidePage.tsx", "utf8")).toContain("onClick={() => window.print()}")
        const css = readFileSync("components/ui/ui.css", "utf8")
        const block = css.slice(css.indexOf("/* A guide's page (DESIGN.md §5.5"), css.indexOf("/* End of a guide's page */"))
        expect(block.length).toBeGreaterThan(100)
        expect(block).toMatch(/\.ui-guide-page \.ui-guide-step \{[^}]*background: var\(--panel\);[^}]*border-radius: var\(--radius-panel\);[^}]*\}/)
        expect(block).not.toMatch(/\b(left|right)\b/)
        expect(block).not.toMatch(/#[0-9a-f]{3,6}\b/i)
        // On paper, black on white: the steps' numbers drawn in ink, with no tint, and no buttons.
        const paper = block.slice(block.indexOf("@media print"))
        expect(paper).toMatch(/\.ui-guide-page \.ui-guide-number \{\s*background: none;\s*border: 1px solid var\(--ink\);\s*\}/)
        expect(paper).toMatch(/\.ui-guide-page \.ui-guide-code \.ui-btn \{\s*display: none;\s*\}/)
    })
})
