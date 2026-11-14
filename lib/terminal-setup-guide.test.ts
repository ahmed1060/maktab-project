import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { setupGuide, inlineCode, type GuideLine } from "./attendance/setup-guide"

/**
 * The setup guide behind the round "i" on Fingerprint terminals
 * (ATTENDANCE_PLAN.md §17.7, PR 282; DESIGN.md §5.2, §5.5 Dialog), as the
 * product owner asked: How to set up a fingerprint terminal, its steps
 * following the model picked.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const SERVER = "https://nizmo.vercel.app"
const CONVOY = { id: "b1", name: "Convoy", protocol: "ZKTECO" as const, notesEn: "Its address is under Menu, Network.", notesAr: null }
const HIK = { id: "b2", name: "Hikvision", protocol: "HIKVISION" as const, notesEn: null, notesAr: null }
const ZK = { id: "b3", name: "ZKTeco", protocol: "ZKTECO" as const, notesEn: null, notesAr: "العنوان في قائمة الاتصال." }

const keysOf = (lines: GuideLine[]) => lines.map(l => l.text)
const codes = (steps: NonNullable<ReturnType<typeof setupGuide>>) => steps.flatMap(s => s.lines).map(l => l.code).filter(Boolean)

describe("the steps, by the model's protocol", () => {
    it("walks ZKTeco's through the agent in five numbered steps, each saying who and where", () => {
        const steps = setupGuide("ZKTECO", { superAdmin: true, server: SERVER })!
        expect(steps.map(s => [s.title, s.who])).toEqual([
            ["att_guide_office_title", "att_guide_office_who"],
            ["att_guide_install_title", "att_guide_install_who"],
            ["att_guide_connect_title", "att_guide_connect_who"],
            ["att_guide_people_title", "att_guide_people_who"],
            ["att_guide_wrong_title", "att_guide_wrong_who"],
        ])
    })

    it("keeps the model's notes with finding the terminal's address, at the office", () => {
        const office = setupGuide("ZKTECO", { superAdmin: false, server: SERVER })![0]
        const at = keysOf(office.lines).indexOf("att_guide_office_address")
        expect(at).toBeGreaterThanOrEqual(0)
        expect(office.lines[at + 1]).toEqual({ text: "att_guide_model_notes", notes: true })
        expect(setupGuide("ZKTECO", { superAdmin: false, server: SERVER })!.slice(1).flatMap(s => s.lines).some(l => l.notes)).toBe(false)
    })

    it("tells the Super Admin where the agent is built, and anyone else to ask the Super Admin for it", () => {
        const install = (superAdmin: boolean) => keysOf(setupGuide("ZKTECO", { superAdmin, server: SERVER })![1].lines)
        expect(install(true)[0]).toBe("att_guide_download_sa")
        expect(install(true)).not.toContain("att_guide_download_other")
        expect(install(false)[0]).toBe("att_guide_download_other")
        expect(install(false)).not.toContain("att_guide_download_sa")
    })

    it("gives agent.json this Nizmo's own address, and the agent's commands exactly as the README has them", () => {
        const all = codes(setupGuide("ZKTECO", { superAdmin: true, server: SERVER })!)
        const settings = JSON.parse(all.find(c => c!.includes('"server"'))!)
        expect(settings).toEqual({ server: SERVER, devices: [{ host: "TERMINAL-ADDRESS", name: "Front door" }], pollSeconds: 60 })
        // A key to a line, so none runs past the guide's box (found in the browser).
        expect(Math.max(...all.find(c => c!.includes('"server"'))!.split("\n").map(l => l.length))).toBeLessThanOrEqual(50)
        expect(all).toEqual(expect.arrayContaining([
            "C:\\Program Files\\Nizmo Agent",
            "nizmo-agent.exe probe TERMINAL-ADDRESS",
            "nizmo-agent.exe enrol CODE",
            "nizmo-agent-service.exe install\nnizmo-agent-service.exe start",
            "\"sendFrom\": \"YYYY-MM-DD\"",
            "nizmo-agent-service.exe status",
        ]))
        const readme = readFileSync("agent/README.md", "utf8")
        for (const command of ["nizmo-agent.exe probe", "nizmo-agent.exe enrol", "nizmo-agent-service.exe install", "nizmo-agent-service.exe start", "nizmo-agent-service.exe status", '"sendFrom": "YYYY-MM-DD"', "C:\\Program Files\\Nizmo Agent"]) {
            expect(readme).toContain(command)
        }
        expect(readFileSync("agent/agent.example.json", "utf8")).toContain('"pollSeconds": 60')
    })

    it("names the brand picked in the step that sets it on the terminal", () => {
        const connect = setupGuide("ZKTECO", { superAdmin: true, server: SERVER })![2]
        expect(connect.lines.find(l => l.text === "att_guide_brand")).toEqual({ text: "att_guide_brand", brand: true })
    })

    it("has no steps for Hikvision's, which Nizmo doesn't read yet", () => {
        expect(setupGuide("HIKVISION", { superAdmin: true, server: SERVER })).toBeNull()
    })

    it("marks what's typed inside a sentence, such as a file's name, apart from the words", () => {
        expect(inlineCode("Copy `agent.example.json` to `agent.json`.")).toEqual([
            { text: "Copy " }, { code: "agent.example.json" }, { text: " to " }, { code: "agent.json" }, { text: "." },
        ])
        expect(inlineCode("No code here")).toEqual([{ text: "No code here" }])
    })
})

describe("its words", () => {
    const used = () => {
        const keys = new Set<string>(["att_guide_button", "att_guide_model", "att_guide_model_pick", "att_guide_pick_first", "att_guide_not_read", "att_guide_no_models", "att_guide_copy", "att_guide_copied", "att_guide_model_notes", "att_guide_model_notes_other"])
        for (const superAdmin of [true, false]) {
            for (const step of setupGuide("ZKTECO", { superAdmin, server: SERVER })!) {
                keys.add(step.title)
                keys.add(step.who)
                for (const line of step.lines) keys.add(line.text)
            }
        }
        return [...keys]
    }

    it("are in both languages", () => {
        for (const key of used()) {
            expect([key, !!(en as Record<string, string>)[key]]).toEqual([key, true])
            expect([key, !!(ar as Record<string, string>)[key]]).toEqual([key, true])
        }
    })

    it("are in sentence case, with no arrow, no middle dot, and no 'we'", () => {
        for (const key of used()) {
            for (const text of [(en as Record<string, string>)[key], (ar as Record<string, string>)[key]]) {
                expect([key, /→| · /.test(text)]).toEqual([key, false])
            }
            expect([key, /\b(we|our|us)\b/i.test((en as Record<string, string>)[key])]).toEqual([key, false])
        }
        expect(en.att_guide_button).toBe("How to set up a fingerprint terminal")
    })

    it("keep what's typed in Arabic the same as in English, never translated", () => {
        for (const key of used()) {
            const typed = (text: string) => inlineCode(text).flatMap(p => ("code" in p ? [p.code] : []))
            expect([key, typed((ar as Record<string, string>)[key])]).toEqual([key, typed((en as Record<string, string>)[key])])
        }
    })

    it("name the screens and states as the app shows them", () => {
        expect(en.att_guide_add).toContain(en.att_term_add_agent)
        expect(ar.att_guide_add).toContain(ar.att_term_add_agent)
        expect(en.att_guide_brand).toContain(en.att_term_agent_OK)
        expect(ar.att_guide_brand).toContain(ar.att_term_agent_OK)
        expect(en.att_guide_numbers).toContain(en.punch_tab_numbers)
        expect(ar.att_guide_numbers).toContain(ar.punch_tab_numbers)
        expect(en.att_guide_silent).toContain(en.att_term_agent_SILENT)
        expect(ar.att_guide_silent).toContain(ar.att_term_agent_SILENT)
        expect(en.att_guide_unreachable).toContain(en.att_term_device_UNREACHABLE)
        expect(ar.att_guide_unreachable).toContain(ar.att_term_device_UNREACHABLE)
        expect(en.att_guide_not_read).toContain(en.punch_tab_import)
        expect(ar.att_guide_not_read).toContain(ar.punch_tab_import)
    })
})

type Brand = import("@/components/TerminalSetupGuide").GuideBrand

async function guide(props: { brand: Brand; superAdmin?: boolean }, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { SetupGuideSteps } = await import("@/components/TerminalSetupGuide")
    return renderToStaticMarkup(h(SetupGuideSteps, { superAdmin: false, server: SERVER, ...props }))
}

describe("the guide's steps on screen", () => {
    it("are a numbered list, each step's title, then who and where, then a line for each thing to do", async () => {
        const html = await guide({ brand: CONVOY })
        // Read as a list in Safari too, whose markers are drawn by the page.
        expect(html).toMatch(/^<ol class="ui-guide-steps" role="list">/)
        expect(html.match(/<li class="ui-guide-step">/g)).toHaveLength(5)
        expect(html).toContain(`<span class="ui-guide-number" aria-hidden="true">1</span>`)
        expect(html).toContain(`<h3 class="ui-guide-title">${esc(en.att_guide_office_title)}</h3><p class="ui-guide-who">${esc(en.att_guide_office_who)}</p><ul class="ui-guide-lines">`)
    })

    it("numbers the steps in the page's digits", async () => {
        const html = await guide({ brand: CONVOY }, "ar")
        expect(html).toContain(`<span class="ui-guide-number" aria-hidden="true">١</span>`)
        expect(html).toContain(`<span class="ui-guide-number" aria-hidden="true">٥</span>`)
    })

    it("puts what's typed in a box of its own, left to right and never translated, with Copy beside it naming what it copies", async () => {
        const html = await guide({ brand: CONVOY }, "ar")
        const box = html.match(/<div class="ui-guide-code"><pre id="([^"]+)" dir="ltr" translate="no"><code>nizmo-agent.exe enrol CODE<\/code><\/pre><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" aria-describedby="([^"]+)">/)
        expect(box).not.toBeNull()
        expect(box![1]).toBe(box![2])
        expect(html).toContain(`${ar.att_guide_copy}</button>`)
        expect(html).toContain(esc(`"server": "${SERVER}"`))
    })

    it("keeps a file's name in a sentence left to right and untranslated, in Arabic too", async () => {
        const html = await guide({ brand: CONVOY }, "ar")
        expect(html).toContain(`<code class="ui-guide-inline" dir="ltr" translate="no">agent.json</code>`)
    })

    it("shows the model's notes with its address, in the page's language, or else the other's, marked as that language", async () => {
        // The model's name kept as it's printed, never machine-translated.
        const label = (text: string) => esc(`${text} `).replace("{model}", `<bdi translate="no">Convoy</bdi>`)
        const english = await guide({ brand: CONVOY })
        expect(english).toContain(`<p class="ui-guide-notes">${label(en.att_guide_model_notes)}<bdi>${esc(CONVOY.notesEn)}</bdi></p>`)
        const arabic = await guide({ brand: CONVOY }, "ar")
        expect(arabic).toContain(`<p class="ui-guide-notes">${label(ar.att_guide_model_notes_other)}<bdi lang="en">${esc(CONVOY.notesEn)}</bdi></p>`)
        const none = await guide({ brand: { ...CONVOY, notesEn: null } })
        expect(none).not.toContain("ui-guide-notes")
        const arabicOnly = await guide({ brand: ZK }, "ar")
        expect(arabicOnly).toContain(`<bdi>${ZK.notesAr}</bdi>`)
    })

    it("names the model as it's printed, never machine-translated", async () => {
        const html = await guide({ brand: CONVOY }, "ar")
        expect(html).toContain(esc(ar.att_guide_brand).replace(esc("{brand}"), `<bdi translate="no">Convoy</bdi>`))
    })

    it("tells the Super Admin where the agent is built, and anyone else to ask for it", async () => {
        expect(await guide({ brand: CONVOY, superAdmin: true })).toContain("Attendance agent")
        const other = await guide({ brand: CONVOY })
        expect(other).not.toContain("Attendance agent")
        expect(other).toContain(esc(en.att_guide_download_other.split("`")[0]))
    })

    it("says a model Nizmo can't read yet isn't, with no steps", async () => {
        const html = await guide({ brand: HIK })
        expect(html).toBe(`<p class="ui-card-note">${esc(en.att_guide_not_read)}</p>`)
    })
})

describe("the guide's dialog", () => {
    async function dialog(brands: Brand[] | null, locale: "en" | "ar" = "en", loadFailed = false) {
        state.locale = locale
        const { default: TerminalSetupGuide } = await import("@/components/TerminalSetupGuide")
        vi.stubGlobal("document", { body: {} })
        try {
            return renderToStaticMarkup(h(TerminalSetupGuide, { brands, loadFailed, superAdmin: false, server: SERVER, onClose: () => {} }))
        } finally {
            vi.unstubAllGlobals()
        }
    }

    it("is named for the guide, asks for the model at the top, and says to pick one until it's picked", async () => {
        const html = await dialog([CONVOY, HIK, ZK])
        expect(html).toContain(`<h2 id="`)
        expect(html).toContain(`class="ui-dialog-title">${en.att_guide_button}</h2>`)
        expect(html).toMatch(new RegExp(`<div class="ui-guide"><div class="ui-field"><label for="[^"]+" class="ui-label">${en.att_guide_model}</label>`))
        expect(html).toContain(`<option value="" selected="">${en.att_guide_model_pick}</option><option value="b1">Convoy</option><option value="b2">Hikvision</option><option value="b3">ZKTeco</option>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.att_guide_pick_first)}</p>`)
        expect(html).not.toContain("ui-guide-steps")
    })

    it("changes nothing: Close is its only button", async () => {
        const html = await dialog([CONVOY])
        const actions = html.slice(html.indexOf(`<div class="ui-dialog-actions">`))
        expect(actions.match(/<button/g)).toHaveLength(1)
        expect(actions).toContain(`>${en.close}</button>`)
    })

    // Found in the browser: opened before the brands had loaded, it said there were none.
    it("shows the picker as loading until the brands have loaded, and says if they didn't", async () => {
        const loading = await dialog(null)
        expect(loading).toMatch(new RegExp(`<select[^>]*disabled=""[^>]*><option value="" selected="">${en.loading}</option></select>`))
        expect(loading).not.toContain(esc(en.att_guide_no_models))
        const failed = await dialog(null, "en", true)
        expect(failed).toContain(`<p class="ui-card-note" role="status">${esc(en.att_term_load_failed)}</p>`)
        expect(failed).not.toContain("<select")
    })

    it("says when there's no model to pick yet", async () => {
        const html = await dialog([])
        expect(html).toContain(esc(en.att_guide_no_models))
        expect(html).not.toContain("<select")
    })

    it("is wide enough for a command on one line, and its button is round, 30px, 44px on phones", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-dialog:has\(\.ui-guide\) \{\s*width: min\(100%, 640px\);\s*\}/)
        expect(css).toMatch(/\.ui-guide-button \{[^}]*width: 30px;[^}]*border-radius: var\(--radius-pill\);[^}]*\}/)
        expect(css).toMatch(/@media \(max-width: 767px\) \{[^@]*\.ui-guide-button \{\s*width: 44px;\s*\}/)
        const guideCss = css.slice(css.indexOf("/* A guide (DESIGN.md §5.5"), css.indexOf("/* End of a guide */"))
        expect(guideCss.length).toBeGreaterThan(100)
        expect(guideCss).not.toMatch(/\b(left|right)\b/)
        expect(guideCss).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    })
})
