import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { setupGuide, inlineCode, PROBE_SAMPLE, type CommandShell, type GuideHow, type GuideStep } from "./attendance/setup-guide"
import { CLOCK_WARN_SECONDS } from "./attendance/terminal-health"

/**
 * Show me how under the setup guide's lines (ATTENDANCE_PLAN.md §17.7, the
 * guide on a page of its own, part 2; DESIGN.md §5.5, A guide's page; PR 357),
 * as the owner approved in the Fingerprint terminal setup guide canvas: the
 * clicks of a line that needs them, opened under it, What it shows for what
 * probe prints, and the lines the canvas adds: ping, the first round by hand,
 * what enrol answers, and the agent's log. All names are made up.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))

const SERVER = "https://nizmo.example"
const CONVOY = { id: "b1", name: "Convoy", protocol: "ZKTECO" as const, notesEn: null, notesAr: null }
const HIK = { id: "b2", name: "Hikvision", protocol: "HIKVISION" as const, notesEn: null, notesAr: null }
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
type Words = Record<string, string>

const read = (shell: CommandShell = "CMD") => setupGuide("ZKTECO", { superAdmin: true, server: SERVER, shell })
const sends = (shell: CommandShell = "CMD") => setupGuide("ZKTECO", { superAdmin: false, server: SERVER, pushes: true, shell })
const hik = (shell: CommandShell = "CMD") => setupGuide("HIKVISION", { superAdmin: true, server: SERVER, shell })
const WAYS = { "ZKTeco's, read": read, "ZKTeco's, sending": sends, "Hikvision's": hik }
const lines = (steps: GuideStep[]) => steps.flatMap(s => s.lines)
const line = (steps: GuideStep[], key: string) => lines(steps).find(l => l.text === key)
const howKeys = (how: GuideHow) => [...how.parts.flatMap(p => [...(p.title ? [p.title] : []), ...p.steps]), ...(how.after ? [how.after] : [])]
const typed = (text: string) => inlineCode(text).flatMap(p => ("code" in p ? [p.code] : []))

describe("Show me how, under the lines that need it", () => {
    it("opens a ZKTeco terminal's clicks at the office: its PC software, its menu, address and comm key, and its clock", () => {
        // Leaving the PC software connected joins turning its deleting off, as the canvas has it.
        expect(read()[0].lines.map(l => l.text)).toEqual(["att_guide_office_delete", "att_guide_office_address", "att_guide_model_notes", "att_guide_office_clock", "att_guide_office_pc"])
        expect(line(read(), "att_guide_office_delete")!.how).toEqual({ parts: [{ steps: ["att_how_software_find", "att_how_software_untick", "att_how_software_close"] }] })
        expect(line(read(), "att_guide_office_address")!.how).toEqual({
            parts: [
                { title: "att_how_menu_title", steps: ["att_how_menu_open", "att_how_menu_admin", "att_how_menu_keys"] },
                { title: "att_how_address_title", steps: ["att_how_address_open", "att_how_address_note", "att_how_address_check"] },
                { title: "att_how_key_title", steps: ["att_how_key_open", "att_how_key_note"] },
            ],
            after: "att_how_menu_back",
        })
        expect(line(read(), "att_guide_office_clock")!.how).toEqual({ parts: [{ steps: ["att_how_clock_open", "att_how_clock_set"] }] })
    })

    it("opens the menu and address of one that sends, with no comm key, and its clock", () => {
        const how = line(sends(), "att_guide_push_address")!.how!
        expect(how.parts).toEqual(line(read(), "att_guide_office_address")!.how!.parts.slice(0, 2))
        expect(how.after).toBe("att_how_menu_back")
        expect(line(sends(), "att_guide_office_clock")!.how).toEqual(line(read(), "att_guide_office_clock")!.how)
    })

    it("leaves a Hikvision terminal's own lines without, as its menus differ by model", () => {
        // Its agent.json is written in Notepad as any model's is (above).
        const own = lines(hik()).filter(l => l.text.startsWith("att_guide_hik_") && l.text !== "att_guide_hik_settings")
        expect(own.length).toBeGreaterThan(5)
        for (const l of own) expect(l.how, l.text).toBeUndefined()
    })

    it("opens the same clicks for every model where they're the same: unzipping, agent.json in Notepad, the prompt picked, Add an agent, the brand and Employee numbers", () => {
        for (const shell of ["CMD", "POWERSHELL"] as const) {
            const prompt = shell === "CMD" ? "att_guide_folder" : "att_guide_folder_ps"
            for (const [way, guide] of Object.entries(WAYS)) {
                const steps = guide(shell)
                const at = `${shell} ${way}`
                expect(line(steps, "att_guide_unzip")!.how, at).toEqual({ parts: [{ steps: ["att_how_unzip_extract", "att_how_unzip_open", "att_how_unzip_folder", "att_how_unzip_copy"] }] })
                const settings = lines(steps).filter(l => ["att_guide_settings", "att_guide_hik_settings", "att_guide_push_settings"].includes(l.text))
                expect(settings, at).toHaveLength(1)
                expect(settings[0].how, at).toEqual({ parts: [{ steps: ["att_how_notepad_open", "att_how_notepad_paste", "att_how_notepad_save", "att_how_notepad_extension"] }] })
                expect(line(steps, prompt)!.how, at).toEqual({ parts: [{ steps: shell === "CMD" ? ["att_how_cmd_open", "att_how_prompt_admin", "att_how_cmd_folder"] : ["att_how_ps_open", "att_how_prompt_admin", "att_how_ps_folder"] }] })
                expect(line(steps, "att_guide_add")!.how, at).toEqual({ parts: [{ steps: ["att_how_add_open", "att_how_add_name", "att_how_add_code"] }] })
                expect(line(steps, "att_guide_brand")!.how, at).toEqual({ parts: [{ steps: ["att_how_brand_find", "att_how_brand_edit", "att_how_brand_set"] }] })
                expect(line(steps, "att_guide_numbers")!.how, at).toEqual({ parts: [{ steps: ["att_how_numbers_open", "att_how_numbers_pick", "att_how_numbers_who"] }] })
            }
        }
    })

    it("shows what probe prints for a ZKTeco terminal, as the agent prints it, under What it shows", () => {
        const how = line(read(), "att_guide_probe")!.how!
        expect(how).toEqual({ shows: true, sample: PROBE_SAMPLE, parts: [{ steps: ["att_how_probe_counts", "att_how_probe_clock", "att_how_probe_timeout", "att_how_probe_auth"] }] })
        // The agent's own keys, in its order, two spaces deep, as probe prints them.
        expect(Object.keys(JSON.parse(PROBE_SAMPLE))).toEqual(["serialNumber", "name", "firmware", "clock", "users", "records", "recordsCapacity"])
        expect(PROBE_SAMPLE).toBe(JSON.stringify(JSON.parse(PROBE_SAMPLE), null, 2))
        expect(readFileSync("agent/src/zk/client.ts", "utf8")).toContain("return { serialNumber, name, firmware, clock: await this.clock(), users: sizes.users, records: sizes.records, recordsCapacity: sizes.recordsCapacity }")
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain("process.stdout.write(`${JSON.stringify(info, null, 2)}\\n`)")
        // Clock off as Nizmo says it, past 2 minutes.
        expect(CLOCK_WARN_SECONDS).toBe(120)
        expect(en.att_how_probe_clock).toContain("2 minutes")
        expect(ar.att_how_probe_clock).toContain("دقيقتين")
        for (const w of [en, ar]) {
            expect(w.att_how_probe_clock).toContain(w.att_term_clock_off.split(" {d}")[0].replace(/ by$| بمقدار$/, ""))
            for (const key of ["`users`", "`records`", "`recordsCapacity`"]) expect(w.att_how_probe_counts, key).toContain(key)
            for (const error of ["`ZK_CONNECT_TIMEOUT`", "`ZK_CONNECT`"]) expect(w.att_how_probe_timeout, error).toContain(error)
            expect(w.att_how_probe_auth.startsWith("`ZK_AUTH_FAILED`")).toBe(true)
        }
        const client = readFileSync("agent/src/zk/client.ts", "utf8")
        for (const error of ['new ZkError("ZK_CONNECT_TIMEOUT"', 'new ZkError("ZK_CONNECT"', 'new ZkError("ZK_AUTH_FAILED"']) expect(client).toContain(error)
        // Hikvision's probe prints otherwise, and isn't walked yet.
        expect(line(hik(), "att_guide_hik_probe")!.how).toBeUndefined()
    })
})

describe("the lines the canvas adds", () => {
    it("checks the PC reaches the terminal with ping, and says what it answers, whatever the model", () => {
        for (const [way, guide] of Object.entries(WAYS)) {
            for (const shell of ["CMD", "POWERSHELL"] as const) {
                expect(line(guide(shell), "att_guide_office_pc"), `${shell} ${way}`).toEqual({ text: "att_guide_office_pc", code: "ping TERMINAL-ADDRESS", see: "att_guide_ping_see" })
            }
        }
        for (const w of [en, ar]) {
            for (const said of ["`Reply from`", "`Request timed out`", "`Destination host unreachable`"]) expect(w.att_guide_ping_see, said).toContain(said)
        }
    })

    it("sends the first round by hand between enrol and the service, for a terminal the agent reads, and says what its last line counts", () => {
        for (const guide of [read, hik]) {
            for (const shell of ["CMD", "POWERSHELL"] as const) {
                const connect = guide(shell)[2].lines
                expect(connect.map(l => l.text)).toEqual(["att_guide_add", "att_guide_enrol", "att_guide_check", "att_guide_service", "att_guide_brand", "att_guide_older"])
                expect(line(guide(shell), "att_guide_check")).toEqual({ text: "att_guide_check", code: `${shell === "POWERSHELL" ? ".\\" : ""}nizmo-agent.exe check`, see: "att_guide_check_see" })
            }
        }
        // One that sends is checked by its first call: check reads, and it isn't read.
        expect(sends()[2].lines.map(l => l.text)).toEqual(["att_guide_add", "att_guide_enrol", "att_guide_service", "att_guide_push_called", "att_guide_brand", "att_guide_push_older"])
        // The agent's own words: its command, and the line it ends with.
        const main = readFileSync("agent/src/main.ts", "utf8")
        expect(main).toContain("nizmo-agent check")
        expect(main).toContain("log.info(`Round: ${JSON.stringify(result)}`)")
        expect(readFileSync("agent/src/sync.ts", "utf8")).toContain("const result: RoundResult = { read: 0, pushed: this.pushed, queued: 0, delivered: 0, duplicates: 0, refused: 0, unreachable: [], cleared: [], stopped: null }")
        for (const w of [en, ar]) {
            for (const said of ["`Round:`", "`read`", "`delivered`", "`refused`", "`0`", "`unreachable`"]) expect(w.att_guide_check_see, said).toContain(said)
        }
    })

    it("says what enrol answers, as the agent words it", () => {
        for (const guide of Object.values(WAYS)) expect(line(guide(), "att_guide_enrol")).toEqual({ text: "att_guide_enrol", code: "nizmo-agent.exe enrol CODE", see: "att_guide_enrol_see" })
        for (const w of [en, ar]) expect(w.att_guide_enrol_see).toContain('`Enrolled as "Head office"`')
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain('log.info(`Enrolled as "${enrolled.name}" for ${enrolled.company}.')
    })

    it("reads the agent's log after the service's status, in each program's own way", () => {
        for (const [way, guide] of Object.entries(WAYS)) {
            expect(line(guide("CMD"), "att_guide_silent"), way).toEqual({ text: "att_guide_silent", code: "nizmo-agent-service.exe status", then: { text: "att_guide_log", code: "type logs\\agent.log" } })
            expect(line(guide("POWERSHELL"), "att_guide_silent"), way).toEqual({ text: "att_guide_silent", code: ".\\nizmo-agent-service.exe status", then: { text: "att_guide_log", code: "Get-Content .\\logs\\agent.log -Tail 20" } })
        }
        // Where the agent writes it, in its folder.
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain('log: join(dir, "logs", "agent.log")')
    })
})

describe("its words", () => {
    const used = () => {
        const keys = new Set<string>(["att_guide_how", "att_guide_shows"])
        for (const guide of Object.values(WAYS)) {
            for (const shell of ["CMD", "POWERSHELL"] as const) {
                for (const l of lines(guide(shell))) {
                    keys.add(l.text)
                    if (l.see) keys.add(l.see)
                    if (l.then) keys.add(l.then.text)
                    if (l.how) for (const key of howKeys(l.how)) keys.add(key)
                }
            }
        }
        return [...keys]
    }

    it("are in both languages, with what's typed the same in each, in sentence case with no arrow, middle dot or 'we'", () => {
        const all = used()
        expect(all.filter(k => k.startsWith("att_how_")).length).toBeGreaterThan(40)
        for (const key of all) {
            for (const w of [en, ar] as Words[]) {
                expect([key, !!w[key]]).toEqual([key, true])
                expect([key, /→| · /.test(w[key])]).toEqual([key, false])
                // A name on the screen is between ** and **: each opened is closed.
                expect([key, (w[key].match(/\*\*/g) ?? []).length % 2]).toEqual([key, 0])
            }
            expect([key, typed((ar as Words)[key])]).toEqual([key, typed((en as Words)[key])])
            expect([key, /\b(we|our|us)\b/i.test((en as Words)[key])]).toEqual([key, false])
        }
        expect(en.att_guide_how).toBe("Show me how")
        expect(en.att_guide_shows).toBe("What it shows")
        // The subtitle says what Show me how does.
        expect(en.att_guide_subtitle).toContain(en.att_guide_how)
        expect(ar.att_guide_subtitle).toContain(ar.att_guide_how)
        expect("att_guide_office_connected" in en).toBe(false)
        expect("att_guide_office_connected" in ar).toBe(false)
    })

    it("name the app's own screens and buttons as it shows them", () => {
        for (const w of [en, ar] as Words[]) {
            const named = (key: string, ...names: string[]) => { for (const name of names) expect(w[key], `${key}: ${name}`).toContain(`**${name}**`) }
            named("att_how_add_open", w.att_term_title)
            named("att_how_add_name", w.att_term_add_agent, w.att_term_agent_name)
            named("att_how_add_code", w.ui_more_actions, w.att_term_new_code)
            named("att_how_brand_find", w.att_term_title)
            named("att_how_brand_edit", w.ui_more_actions, w.edit)
            named("att_how_brand_set", w.att_term_brand, w.save)
            named("att_how_numbers_open", w.attendance_title, w.punch_tab_numbers)
            named("att_how_numbers_pick", w.punch_numbers_waiting, w.punch_map)
            expect(w.att_how_brand_set).toContain("{brand}")
            expect(w.att_guide_add).toContain(w.att_term_add_agent)
            expect(w.att_guide_silent).toContain(w.att_term_agent_SILENT)
        }
    })

    it("walk Windows as it is: Notepad as administrator, All files, UTF-8 without a BOM, and the prompt each program opens on", () => {
        for (const w of [en, ar] as Words[]) {
            expect(w.att_how_notepad_open).toContain("`notepad`")
            for (const said of ["`agent.json`", "UTF-8", "BOM"]) expect(w.att_how_notepad_save, said).toContain(said)
            expect(w.att_how_notepad_extension).toContain("`agent.json.txt`")
            expect(w.att_how_notepad_paste).toContain("`TERMINAL-ADDRESS`")
            expect(w.att_how_notepad_paste).toContain("`Front door`")
            expect(w.att_how_cmd_open).toContain("`cmd`")
            expect(w.att_how_cmd_folder).toContain("`C:\\Program Files\\Nizmo Agent>`")
            expect(w.att_how_ps_folder).toContain("`PS C:\\Program Files\\Nizmo Agent>`")
            expect(w.att_how_ps_open).toContain("Terminal (Admin)")
            expect(w.att_how_unzip_copy).toContain("`nizmo-agent.exe`")
            expect(w.att_how_unzip_folder).toContain("`Nizmo Agent`")
            // The line opening the prompt names it, and its clicks are under it now.
            expect(w.att_guide_folder).toContain("`Command Prompt`")
            expect(w.att_guide_folder_ps).toContain("`PowerShell`")
            expect(w.att_guide_folder).not.toContain("`cmd`")
        }
        expect(en.att_how_cmd_open).toContain("**Run as administrator**")
        expect(ar.att_how_cmd_open).toContain("**«تشغيل كمسؤول»**")
        // The agent reads agent.json as it is: a BOM before its first brace isn't JSON.
        expect(readFileSync("agent/src/config.ts", "utf8")).toMatch(/text = readFileSync\(path, "utf8"\)[^]*JSON\.parse\(text\)/)
        expect(() => JSON.parse("\uFEFF{}")).toThrow()
    })

    it("name the terminal's own menu as it shows it, both places its comm key is kept, and its port", () => {
        for (const w of [en, ar] as Words[]) {
            for (const name of ["`Comm.`", "`Ethernet`"]) expect(w.att_how_address_open, name).toContain(name)
            for (const name of ["`4370`", "`OFF`"]) expect(w.att_how_address_check, name).toContain(name)
            for (const name of ["`Comm Key`", "`PC Connection`"]) expect(w.att_how_key_open, name).toContain(name)
            expect(w.att_how_key_note).toContain("`0`")
            for (const key of ["att_how_menu_open", "att_how_menu_keys", "att_how_menu_back"]) expect(w[key], key).toContain("**")
        }
    })
})

async function guide(brand: typeof CONVOY | typeof HIK, shell: CommandShell = "CMD", locale: "en" | "ar" = "en") {
    state.locale = locale
    const { SetupGuideSteps } = await import("@/components/TerminalSetupGuide")
    return renderToStaticMarkup(h(SetupGuideSteps, { brand, superAdmin: false, server: SERVER, shell }))
}

describe("on screen", () => {
    it("puts Show me how under its line, closed, naming what it opens, with a caret that turns the page's way", async () => {
        const html = await guide(CONVOY)
        const button = /<button type="button" class="ui-btn ui-btn-quiet ui-btn-sm ui-guide-how-button" aria-expanded="false" aria-controls="([^"]+)" aria-describedby="([^"]+)"><svg[^>]*class="ui-icon ui-flip ui-guide-how-caret"[^>]*>[^]*?<\/svg>(Show me how|What it shows)<\/button><div id="([^"]+)" class="ui-guide-how" hidden="">/g
        const found = [...html.matchAll(button)]
        // It controls its own clicks, and its line's sentence, in the same line, describes it.
        for (const m of found) {
            expect(m[1]).toBe(m[4])
            const sentence = html.indexOf(`<p id="${m[2]}">`)
            expect(sentence).toBeGreaterThan(0)
            expect(sentence).toBeLessThan(m.index!)
            expect(html.slice(sentence, m.index)).not.toContain("</li>")
        }
        const ids = found.map(m => m[1])
        expect(new Set(ids).size).toBe(ids.length)
        const withHow = lines(setupGuide("ZKTECO", { superAdmin: false, server: SERVER })).filter(l => l.how)
        expect(found).toHaveLength(withHow.length)
        expect(found.filter(m => m[3] === "What it shows")).toHaveLength(1)
        // Every one starts closed.
        expect(html).not.toContain(`aria-expanded="true"`)
        expect(html.match(/class="ui-guide-how" hidden=""/g)).toHaveLength(withHow.length)
    })

    it("lists each part's clicks under its heading, the names on the screen in bold, and a line after them", async () => {
        const html = await guide(CONVOY)
        const bold = (text: string) => esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        expect(html).toContain(`<div class="ui-guide-how-part"><h4 class="ui-guide-how-title">${en.att_how_menu_title}</h4><ol class="ui-guide-how-steps"><li>${bold(en.att_how_menu_open)}</li>`)
        expect(html).toContain(`<p class="ui-guide-how-after">${bold(en.att_how_menu_back)}</p>`)
        // One part alone has no heading.
        expect(html).toContain(`<ol class="ui-guide-how-steps"><li>${bold(en.att_how_software_find)}</li>`)
        // The model picked, as it's printed, never machine-translated.
        expect(html).toContain(bold(en.att_how_brand_set.split("{brand}")[0]) + `<bdi translate="no">Convoy</bdi>`)
        // What's typed in a click, left to right and untranslated.
        expect(html).toContain(`<code class="ui-guide-inline" dir="ltr" translate="no">notepad</code>`)
    })

    it("shows what probe prints in a box of its own above What it shows' list", async () => {
        const html = await guide(CONVOY)
        expect(html).toContain(`hidden=""><pre class="ui-guide-sample" dir="ltr" translate="no"><code>${esc(PROBE_SAMPLE)}</code></pre><ol class="ui-guide-how-steps">`)
    })

    it("says what's seen under a box, and puts the log's box after the service's status", async () => {
        const html = await guide(CONVOY)
        const ping = html.indexOf("<code>ping TERMINAL-ADDRESS</code>")
        expect(ping).toBeGreaterThan(0)
        const said = esc(en.att_guide_ping_see.split("`")[0])
        expect(html.slice(ping)).toMatch(/^<code>ping TERMINAL-ADDRESS<\/code><\/pre><button[^>]*>[^]*?<\/button><span[^>]*><\/span><\/div><p class="ui-guide-see">/)
        expect(html.slice(ping)).toContain(`<p class="ui-guide-see">${said}<code class="ui-guide-inline"`)
        const status = html.indexOf("<code>nizmo-agent-service.exe status</code>")
        const log = html.indexOf("<code>type logs\\agent.log</code>")
        expect(status).toBeGreaterThan(0)
        expect(log).toBeGreaterThan(status)
        expect(html.slice(status, log)).toContain(`<p class="ui-guide-see">${esc(en.att_guide_log)}</p><div class="ui-guide-code">`)
        expect(await guide(CONVOY, "POWERSHELL")).toContain("<code>Get-Content .\\logs\\agent.log -Tail 20</code>")
    })

    it("is in the page's language, and Hikvision's own lines have none", async () => {
        const arabic = await guide(CONVOY, "CMD", "ar")
        expect(arabic).toContain(`<svg`)
        expect(arabic).toContain(`${ar.att_guide_how}</button>`)
        expect(arabic).toContain(`${ar.att_guide_shows}</button>`)
        const hikvision = await guide(HIK)
        const withHow = lines(hik()).filter(l => l.how).length
        expect(hikvision.match(/class="ui-guide-how" hidden=""/g)).toHaveLength(withHow)
        expect(hikvision).not.toContain("What it shows")
    })

    it("opens and closes each on its own", () => {
        const source = readFileSync("components/TerminalSetupGuide.tsx", "utf8")
        const how = source.slice(source.indexOf("export function ShowMeHow("))
        expect(how).toContain("const [open, setOpen] = useState(false)")
        expect(how).toContain("onClick={() => setOpen(o => !o)}")
        expect(how).toContain("hidden={!open}")
    })
})

describe("its styles", () => {
    const css = readFileSync("components/ui/ui.css", "utf8")
    const block = css.slice(css.indexOf("/* A guide's page (DESIGN.md §5.5"), css.indexOf("/* End of a guide's page */"))
    const screen = block.slice(0, block.indexOf("@media print"))
    const paper = block.slice(block.indexOf("@media print"))

    it("opens the clicks in a tinted panel, hides them while closed, and turns the caret down while open, the other way round in Arabic", () => {
        expect(screen).toMatch(/\.ui-guide-how \{[^}]*background: var\(--brand-tint\);[^}]*border: 1px solid var\(--brand-tint-strong\);[^}]*border-radius: var\(--radius-panel\);[^}]*\}/)
        expect(screen).toMatch(/\.ui-guide-how\[hidden\] \{\s*display: none;\s*\}/)
        expect(screen).toMatch(/\.ui-guide-how-button\[aria-expanded="true"\] \.ui-guide-how-caret \{\s*transform: rotate\(90deg\);\s*\}/)
        expect(screen).toMatch(/\[dir="rtl"\] \.ui-guide-how-button\[aria-expanded="true"\] \.ui-guide-how-caret \{\s*transform: scaleX\(-1\) rotate\(90deg\);\s*\}/)
        expect(screen).toMatch(/\.ui-guide-how-title \{[^}]*font-weight: 600;[^}]*\}/)
        // Its clicks counted in the page's digits (DESIGN.md §3).
        expect(screen).toMatch(/\[dir="rtl"\] \.ui-guide-how-steps \{\s*list-style-type: arabic-indic;\s*\}/)
        expect(screen).toMatch(/\.ui-guide-page strong \{\s*font-weight: 600;\s*\}/)
        expect(screen).toMatch(/\.ui-guide-see \{[^}]*color: var\(--muted\);[^}]*font-size: var\(--text-sm\);[^}]*\}/)
        // What probe prints wraps on a phone, rather than scroll out of the keyboard's reach (the web audit).
        expect(screen).toMatch(/\.ui-guide-sample \{[^}]*background: var\(--panel\);[^}]*white-space: pre-wrap;\s*overflow-wrap: anywhere;\s*\}/)
    })

    it("prints every one open, on white, without its button", () => {
        expect(paper).toMatch(/\.ui-guide-page \.ui-guide-how\[hidden\] \{\s*display: flex;\s*\}/)
        expect(paper).toMatch(/\.ui-guide-page \.ui-guide-how-button \{\s*display: none;\s*\}/)
        expect(paper).toMatch(/\.ui-guide-page \.ui-guide-how \{[^}]*background: none;[^}]*border: none;[^}]*\}/)
    })
})
