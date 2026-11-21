import { describe, it, expect, vi } from "vitest"
import { createElement as h, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { setupGuide, inlineCode, PUSH_AGENT_VERSION, type GuideLine } from "./attendance/setup-guide"
import { HIKVISION_AGENT_VERSION } from "./attendance/terminal-connections"

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
const codes = (steps: ReturnType<typeof setupGuide>) => steps.flatMap(s => s.lines).map(l => l.code).filter(Boolean)

describe("the steps, by the model's protocol", () => {
    it("walks ZKTeco's through the agent in five numbered steps, each saying who and where", () => {
        const steps = setupGuide("ZKTECO", { superAdmin: true, server: SERVER })
        expect(steps.map(s => [s.title, s.who])).toEqual([
            ["att_guide_office_title", "att_guide_office_who"],
            ["att_guide_install_title", "att_guide_install_who"],
            ["att_guide_connect_title", "att_guide_connect_who"],
            ["att_guide_people_title", "att_guide_people_who"],
            ["att_guide_wrong_title", "att_guide_wrong_who"],
        ])
    })

    it("keeps the model's notes with finding the terminal's address, at the office", () => {
        const office = setupGuide("ZKTECO", { superAdmin: false, server: SERVER })[0]
        const at = keysOf(office.lines).indexOf("att_guide_office_address")
        expect(at).toBeGreaterThanOrEqual(0)
        expect(office.lines[at + 1]).toEqual({ text: "att_guide_model_notes", notes: true })
        expect(setupGuide("ZKTECO", { superAdmin: false, server: SERVER }).slice(1).flatMap(s => s.lines).some(l => l.notes)).toBe(false)
    })

    it("tells the Super Admin where the agent is built, and anyone else to ask the Super Admin for it", () => {
        const install = (superAdmin: boolean) => keysOf(setupGuide("ZKTECO", { superAdmin, server: SERVER })[1].lines)
        expect(install(true)[0]).toBe("att_guide_download_sa")
        expect(install(true)).not.toContain("att_guide_download_other")
        expect(install(false)[0]).toBe("att_guide_download_other")
        expect(install(false)).not.toContain("att_guide_download_sa")
    })

    it("gives agent.json this Nizmo's own address, and the agent's commands exactly as the README has them", () => {
        const all = codes(setupGuide("ZKTECO", { superAdmin: true, server: SERVER }))
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

    // Codex on PR 282: probe reads only what it's given, never agent.json, so a
    // terminal with a comm key failed it whatever agent.json said.
    it("gives probe the port and comm key itself, right after it, since probe doesn't read agent.json", () => {
        const install = setupGuide("ZKTECO", { superAdmin: false, server: SERVER })[1].lines
        const at = install.findIndex(l => l.text === "att_guide_probe")
        expect(install[at + 1]).toEqual({ text: "att_guide_probe_key", code: "nizmo-agent.exe probe TERMINAL-ADDRESS 4370 1234" })
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain("nizmo-agent probe <address> [port] [password]")
        expect(readFileSync("agent/README.md", "utf8")).toContain("nizmo-agent.exe probe 192.168.1.20 4370 1234")
        expect(en.att_guide_probe_key).toContain("`4370`")
        expect(ar.att_guide_probe_key).toContain("`4370`")
    })

    it("names the brand picked in the step that sets it on the terminal", () => {
        const connect = setupGuide("ZKTECO", { superAdmin: true, server: SERVER })[2]
        expect(connect.lines.find(l => l.text === "att_guide_brand")).toEqual({ text: "att_guide_brand", brand: true })
    })

    it("walks Hikvision's through the agent in the same five steps, written in PR 301 and shown from PR 303", () => {
        const steps = setupGuide("HIKVISION", { superAdmin: true, server: SERVER })
        expect(steps.map(s => [s.title, s.who])).toEqual(setupGuide("ZKTECO", { superAdmin: true, server: SERVER }).map(s => [s.title, s.who]))
    })

    it("has Hikvision's office make a user for the agent, check its address and HTTPS, its clock, and leave its HTTP Listening off, with the model's notes by its address", () => {
        expect(setupGuide("HIKVISION", { superAdmin: false, server: SERVER })[0].lines).toEqual([
            { text: "att_guide_hik_user" },
            { text: "att_guide_hik_address" },
            { text: "att_guide_model_notes", notes: true },
            { text: "att_guide_hik_clock" },
            { text: "att_guide_hik_listening" },
            { text: "att_guide_office_pc" },
        ])
    })

    it("gives Hikvision's agent.json its protocol, address, the agent's user and password, and probe the user, never the password", () => {
        const steps = setupGuide("HIKVISION", { superAdmin: false, server: SERVER })
        expect(keysOf(steps[1].lines)).toEqual(["att_guide_download_other", "att_guide_hik_version", "att_guide_hik_installed", "att_guide_unzip", "att_guide_folder", "att_guide_hik_settings", "att_guide_hik_https", "att_guide_hik_probe", "att_guide_unknown_publisher"])
        const settings = steps[1].lines.find(l => l.text === "att_guide_hik_settings")!.code!
        expect(JSON.parse(settings)).toEqual({
            server: SERVER, devices: [{ protocol: "hikvision", host: "TERMINAL-ADDRESS", user: "AGENT-USER", password: "AGENT-PASSWORD", name: "Front door" }], pollSeconds: 60,
        })
        expect(Math.max(...settings.split("\n").map(l => l.length))).toBeLessThanOrEqual(50)
        const probe = steps[1].lines.find(l => l.text === "att_guide_hik_probe")!.code!
        expect(probe).toBe("nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER")
        // As the plan has it for part 7's third PR, which builds it (§17.4).
        expect(readFileSync("ATTENDANCE_PLAN.md", "utf8")).toContain(`\`${probe}\``)
        // Its comm key is ZKTeco's alone.
        for (const zk of ["att_guide_password", "att_guide_probe_key", "att_guide_auth", "att_guide_office_address"]) expect(steps.flatMap(s => keysOf(s.lines)), zk).not.toContain(zk)
    })

    it("says which agent version reads Hikvision's, where to see it, and how an agent already installed takes the terminal (PR 303)", () => {
        const install = setupGuide("HIKVISION", { superAdmin: true, server: SERVER })[1].lines
        expect(install.find(l => l.text === "att_guide_hik_version")!.code).toBe("nizmo-agent.exe version")
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain('if (command === "version" || command === "--version")')
        for (const w of [en, ar]) {
            // As the agent's version is printed, and as the agent released with it, 0.3.0, says it (PR 302).
            expect(w.att_guide_hik_version).toContain(`\`${HIKVISION_AGENT_VERSION}\``)
            expect(w.att_guide_hik_installed).toContain(`\`${HIKVISION_AGENT_VERSION}\``)
            // Stopped before its folder is unzipped over, and started again once the terminal is in agent.json: as the service is named.
            for (const typed of ["`nizmo-agent-service.exe stop`", "`nizmo-agent-service.exe start`", "`agent.json`"]) expect(w.att_guide_hik_installed, typed).toContain(typed)
            expect(w.att_guide_hik_installed.indexOf("`nizmo-agent-service.exe stop`")).toBeLessThan(w.att_guide_hik_installed.indexOf("`nizmo-agent-service.exe start`"))
        }
        // As the README an office reads updates an agent.
        const readme = readFileSync("agent/README.md", "utf8")
        expect(readme).toContain(`It reads Hikvision terminals from version ${HIKVISION_AGENT_VERSION}.`)
        const updating = readme.slice(readme.indexOf("## Updating the agent"), readme.indexOf("## Moving to another PC"))
        for (const said of ["`nizmo-agent-service.exe stop`", "`nizmo-agent-service.exe start`", "`nizmo-agent.exe version`", "needs no new code", `needs ${HIKVISION_AGENT_VERSION} or later`]) expect(updating, said).toContain(said)
        // ZKTeco's are read by any agent: none of this is in their steps.
        for (const key of ["att_guide_hik_version", "att_guide_hik_installed"]) expect(setupGuide("ZKTECO", { superAdmin: true, server: SERVER }).flatMap(st => keysOf(st.lines))).not.toContain(key)
    })

    it("names probe's --http for a terminal whose HTTPS is off, as the agent's help has it (PR 302)", () => {
        for (const w of [en, ar]) expect(w.att_guide_hik_https).toContain("`--http`")
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain("nizmo-agent probe hikvision <address> <user> [port] [--http]")
    })

    it("connects and matches numbers as ZKTeco's do, and names the agent's own errors for a refused user and a certificate changed", () => {
        const [hik, zk] = [setupGuide("HIKVISION", { superAdmin: true, server: SERVER }), setupGuide("ZKTECO", { superAdmin: true, server: SERVER })]
        expect(hik[2]).toEqual(zk[2])
        expect(hik[3]).toEqual(zk[3])
        expect(keysOf(hik[4].lines)).toEqual(["att_guide_silent", "att_guide_unreachable", "att_guide_hik_auth", "att_guide_hik_certificate", "att_guide_revoked", "att_guide_clock"])
        // A renewed certificate is trusted with the service stopped, as the agent's help says (PR 302, PR 303).
        expect(hik[4].lines.find(l => l.text === "att_guide_hik_certificate")!.code).toBe("nizmo-agent-service.exe stop\nnizmo-agent.exe trust TERMINAL-ADDRESS\nnizmo-agent-service.exe start")
        expect(en.att_guide_hik_certificate.startsWith("`HIK_CERTIFICATE_CHANGED`")).toBe(true)
        expect(ar.att_guide_hik_certificate.startsWith("`HIK_CERTIFICATE_CHANGED`")).toBe(true)
        expect(readFileSync("agent/src/hik/client.ts", "utf8")).toContain('new HikError("HIK_CERTIFICATE_CHANGED"')
        expect(readFileSync("agent/src/main.ts", "utf8")).toContain("nizmo-agent trust <address> [port]")
        expect(en.att_guide_hik_auth.startsWith("`HIK_AUTH_FAILED`")).toBe(true)
        expect(readFileSync("agent/src/hik/client.ts", "utf8")).toContain('new HikError("HIK_AUTH_FAILED"')
    })

    it("marks what's typed inside a sentence, such as a file's name, apart from the words", () => {
        expect(inlineCode("Copy `agent.example.json` to `agent.json`.")).toEqual([
            { text: "Copy " }, { code: "agent.example.json" }, { text: " to " }, { code: "agent.json" }, { text: "." },
        ])
        expect(inlineCode("No code here")).toEqual([{ text: "No code here" }])
    })
})

// ATTENDANCE_PLAN.md §17.12, PR 306: a ZKTeco terminal that sends its scans
// to the agent's PC over plain HTTP, which the agent (0.4.0) listens for.
describe("a terminal that sends its scans to the agent (PR 306)", () => {
    const push = (superAdmin = false) => setupGuide("ZKTECO", { superAdmin, server: SERVER, pushes: true })
    const read = (superAdmin = false) => setupGuide("ZKTECO", { superAdmin, server: SERVER })
    const readme = () => readFileSync("agent/README.md", "utf8")
    const flat = (text: string) => text.replace(/\s+/g, " ")

    it("walks it through the same five steps, each saying who and where", () => {
        expect(push().map(s => [s.key, s.title, s.who])).toEqual(read().map(s => [s.key, s.title, s.who]))
    })

    it("has the office fix the terminal's address and the PC's, with the model's notes by its address, and nothing of reading it", () => {
        expect(push()[0].lines).toEqual([
            { text: "att_guide_push_address" },
            { text: "att_guide_model_notes", notes: true },
            { text: "att_guide_office_clock" },
            { text: "att_guide_office_pc" },
            { text: "att_guide_push_pc_address" },
        ])
    })

    it("installs the agent that listens, names the terminal by its address with push, lets it through the firewall, and sets the terminal to send, with no probe", () => {
        expect(keysOf(push(true)[1].lines)).toEqual(["att_guide_download_sa", "att_guide_push_version", "att_guide_push_installed", "att_guide_unzip", "att_guide_folder", "att_guide_push_settings", "att_guide_push_firewall", "att_guide_push_profile", "att_guide_push_terminal", "att_guide_unknown_publisher"])
        expect(keysOf(push()[1].lines)[0]).toBe("att_guide_download_other")
        // Its comm key and probe are for a terminal the agent reads.
        for (const key of ["att_guide_settings", "att_guide_password", "att_guide_probe", "att_guide_probe_key", "att_guide_auth", "att_guide_unreachable", "att_guide_office_address", "att_guide_office_delete", "att_guide_office_connected"]) {
            expect(push().flatMap(s => keysOf(s.lines)), key).not.toContain(key)
        }
        expect(codes(push())).not.toEqual(expect.arrayContaining([expect.stringContaining("probe")]))
    })

    it("gives agent.json the terminal by its address with \"push\": true, no port or comm key, as the agent reads it", () => {
        const settings = push()[1].lines.find(l => l.text === "att_guide_push_settings")!.code!
        expect(JSON.parse(settings)).toEqual({ server: SERVER, devices: [{ host: "TERMINAL-ADDRESS", push: true, name: "Front door" }], pollSeconds: 60 })
        expect(Math.max(...settings.split("\n").map(l => l.length))).toBeLessThanOrEqual(50)
        // As the agent's README and example list one, and as its config reads it.
        expect(readme()).toContain('{ "host": "192.168.1.40", "push": true, "name": "Side door" }')
        expect(readFileSync("agent/agent.example.json", "utf8")).toContain('"push": true')
        expect(readFileSync("agent/src/config.ts", "utf8")).toContain("if (d.push === true) {")
    })

    it("lets the terminal through Windows Firewall from its address alone, on the agent's port, as the README has it", () => {
        const line = push()[1].lines.find(l => l.text === "att_guide_push_firewall")!
        const firewall = line.code!
        expect(firewall).toBe('netsh advfirewall firewall add rule name="Nizmo agent" dir=in action=allow protocol=TCP localport=8081 remoteip=TERMINAL-ADDRESS profile=private,domain')
        // One line, longer than the guide's box is wide: it scrolls sideways (found in the browser).
        expect(line.wide).toBe(true)
        expect(push().flatMap(st => st.lines).filter(l => l.wide).map(l => l.text)).toEqual(["att_guide_push_firewall"])
        expect(readme()).toContain(firewall.replace("TERMINAL-ADDRESS", "192.168.1.40"))
        // 8081 is the agent's own, unless agent.json sets "listenPort".
        expect(readFileSync("agent/src/config.ts", "utf8")).toContain("c.listenPort === undefined ? 8081")
        for (const w of [en, ar]) {
            expect(w.att_guide_push_firewall).toContain("`8081`")
            expect(w.att_guide_push_profile).toContain("`remoteip=`")
        }
        expect(flat(readme())).toContain("list their addresses after `remoteip=`, separated by commas")
    })

    it("names the terminal's Cloud Server Setting as the README does: domain name off, the PC's address, the agent's port, HTTPS and proxy off", () => {
        for (const w of [en, ar]) {
            for (const name of ["`Cloud Server Setting`", "`Domain Name`", "`Server Address`", "`Server Port`", "`8081`", "`HTTPS`", "`Proxy`"]) expect(w.att_guide_push_terminal, name).toContain(name)
        }
        for (const name of ["**Domain Name** off", "**Server Address** to the PC's address", "**Server Port** to 8081", "**HTTPS** and **Proxy** off"]) expect(flat(readme()), name).toContain(name)
    })

    it("says which agent version takes it, where to see it, and how an agent already installed takes the terminal", () => {
        expect(PUSH_AGENT_VERSION).toBe("0.4.0")
        expect(push()[1].lines.find(l => l.text === "att_guide_push_version")!.code).toBe("nizmo-agent.exe version")
        for (const w of [en, ar]) {
            expect(w.att_guide_push_version).toContain(`\`${PUSH_AGENT_VERSION}\``)
            expect(w.att_guide_push_installed).toContain(`\`${PUSH_AGENT_VERSION}\``)
            for (const typed of ["`nizmo-agent-service.exe stop`", "`nizmo-agent-service.exe start`", "`agent.json`"]) expect(w.att_guide_push_installed, typed).toContain(typed)
            expect(w.att_guide_push_installed.indexOf("`nizmo-agent-service.exe stop`")).toBeLessThan(w.att_guide_push_installed.indexOf("`nizmo-agent-service.exe start`"))
        }
        // As the README an office reads updates an agent, and as the agent released with it says it (PR 305).
        expect(flat(readme())).toContain(`a terminal that pushes to the agent ${PUSH_AGENT_VERSION} or later`)
        expect(flat(readme())).toContain(`From version ${PUSH_AGENT_VERSION} it also takes the scans of a ZKTeco terminal that pushes`)
        // A terminal the agent reads needs none of it.
        for (const key of ["att_guide_push_version", "att_guide_push_installed"]) expect(read(true).flatMap(st => keysOf(st.lines))).not.toContain(key)
    })

    it("connects it as a terminal read is connected, with the agent's log saying it called, and older scans sent again once the terminal restarts", () => {
        const connect = push()[2]
        expect(keysOf(connect.lines)).toEqual(["att_guide_add", "att_guide_enrol", "att_guide_service", "att_guide_push_called", "att_guide_brand", "att_guide_push_older"])
        expect(connect.lines.find(l => l.text === "att_guide_brand")).toEqual({ text: "att_guide_brand", brand: true })
        expect(connect.lines.find(l => l.text === "att_guide_push_older")!.code).toBe("\"sendFrom\": \"YYYY-MM-DD\"")
        // The agent's own words when it first takes what the terminal sends (PR 305).
        for (const w of [en, ar]) expect(w.att_guide_push_called).toContain("`called for the first time`")
        expect(readFileSync("agent/src/sync.ts", "utf8")).toContain("called for the first time.")
        // Told to send its memory again only when it next asks for its options, as it does when it starts (PR 305).
        expect(en.att_guide_push_older).toMatch(/restart the service, then restart the terminal/)
        expect(push()[3]).toEqual(read()[3])
    })

    it("names what goes wrong in the agent's own words: not heard from, never called, its port taken, a call from an address not named", () => {
        expect(keysOf(push()[4].lines)).toEqual(["att_guide_silent", "att_guide_push_unreachable", "att_guide_push_never", "att_guide_push_port", "att_guide_push_stranger", "att_guide_revoked", "att_guide_clock"])
        const sync = readFileSync("agent/src/sync.ts", "utf8")
        const listener = readFileSync("agent/src/zk/listener.ts", "utf8")
        expect(en.att_guide_push_unreachable).toContain("`Not heard from since`")
        expect(sync).toContain("error: `Not heard from since ${since}.`")
        expect(en.att_guide_push_never.startsWith("`hasn't called yet`")).toBe(true)
        expect(sync).toContain("pushes to this agent and hasn't called yet.")
        expect(en.att_guide_push_port.startsWith("`Port 8081 is in use`")).toBe(true)
        expect(listener).toContain("`Port ${options.port} is in use by another program on this PC.`")
        expect(en.att_guide_push_stranger.startsWith("`no terminal in agent.json is at that address`")).toBe(true)
        expect(listener).toContain("called the agent, but no terminal in agent.json is at that address.")
        for (const w of [ar]) {
            for (const key of ["att_guide_push_never", "att_guide_push_port", "att_guide_push_stranger"] as const) expect(w[key].startsWith(en[key].slice(0, en[key].indexOf("`", 1) + 1)), key).toBe(true)
        }
        expect(en.att_guide_push_port).toContain('`"listenPort"`')
    })

    it("leaves a Hikvision model's steps as they are", () => {
        expect(setupGuide("HIKVISION", { superAdmin: true, server: SERVER, pushes: true })).toEqual(setupGuide("HIKVISION", { superAdmin: true, server: SERVER }))
    })
})

describe("its words", () => {
    const used = () => {
        const keys = new Set<string>(["att_guide_button", "att_guide_model", "att_guide_model_pick", "att_guide_pick_first", "att_guide_direct_too", "att_guide_no_models", "att_guide_copy", "att_guide_copied", "att_guide_model_notes", "att_guide_model_notes_other",
            "att_guide_way", "att_guide_way_READ", "att_guide_way_PUSH", "att_guide_way_READ_hint", "att_guide_way_PUSH_hint",
            // The guide's page (PR 356).
            "att_guide_subtitle", "att_guide_shell", "att_guide_shell_CMD_hint", "att_guide_shell_POWERSHELL_hint", "att_guide_printed"])
        for (const [superAdmin, protocol, pushes] of [[true, "ZKTECO", false], [false, "ZKTECO", false], [true, "ZKTECO", true], [false, "ZKTECO", true], [true, "HIKVISION", false], [false, "HIKVISION", false]] as const) {
            for (const step of [...setupGuide(protocol, { superAdmin, server: SERVER, pushes }), ...setupGuide(protocol, { superAdmin, server: SERVER, pushes, shell: "POWERSHELL" })]) {
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
        expect(en.att_guide_push_unreachable).toContain(en.att_term_device_UNREACHABLE)
        expect(ar.att_guide_push_unreachable).toContain(ar.att_term_device_UNREACHABLE)
    })
})

type Brand = import("@/components/TerminalSetupGuide").GuideBrand

async function guide(props: { brand: Brand; superAdmin?: boolean; pushes?: boolean; directAllowed?: boolean }, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { SetupGuideSteps } = await import("@/components/TerminalSetupGuide")
    return renderToStaticMarkup(h(SetupGuideSteps, { superAdmin: false, server: SERVER, ...props }))
}

/** The model's guide once it's picked: how its scans reach the agent, the agent reading them to start with, then its steps (PR 306; on the guide's page since PR 356). */
async function guideFor(props: { brand: Brand; directAllowed?: boolean }, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { SetupGuideSteps, WayChoice } = await import("@/components/TerminalSetupGuide")
    return renderToStaticMarkup(h(Fragment, null,
        h(WayChoice, { brand: props.brand, way: "READ", onChange: () => {} }),
        h(SetupGuideSteps, { superAdmin: false, server: SERVER, ...props })))
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

    it("shows Hikvision's steps, the agent's settings for it in their box", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await guide({ brand: HIK }, locale)
            expect(html).toMatch(/^<ol class="ui-guide-steps"/)
            expect(html).toContain(esc('"protocol": "hikvision",'))
            expect(html).toContain("nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER")
            // Which agent reads it, and trusting a renewed certificate (PR 303).
            expect(html).toContain("nizmo-agent.exe version")
            expect(html).toContain("nizmo-agent.exe trust TERMINAL-ADDRESS")
        }
    })
})

describe("how a ZKTeco terminal's scans reach the agent, on screen (PR 306)", () => {
    it("is asked under the model as a choice, the agent reading them picked to start with, with a line saying which terminals that's for, then the steps", async () => {
        for (const locale of ["en", "ar"] as const) {
            const w = locale === "ar" ? ar : en
            const html = await guideFor({ brand: CONVOY }, locale)
            const choice = html.indexOf(`<fieldset class="ui-choices"><legend class="ui-label">${esc(w.att_guide_way)}</legend>`)
            expect(choice).toBe(0)
            expect(html).toContain(`<input type="radio" class="ui-radio" name="way" checked="" value="READ"/>${esc(w.att_guide_way_READ)}</label>`)
            expect(html).toContain(`<input type="radio" class="ui-radio" name="way" value="PUSH"/>${esc(w.att_guide_way_PUSH)}</label>`)
            const hint = html.indexOf(`<p class="ui-hint">${esc(w.att_guide_way_READ_hint.split("`")[0])}<code class="ui-guide-inline" dir="ltr" translate="no">4370</code>`)
            expect(hint).toBeGreaterThan(choice)
            expect(html.indexOf(`<ol class="ui-guide-steps"`)).toBeGreaterThan(hint)
            expect(html).toContain("nizmo-agent.exe probe TERMINAL-ADDRESS")
            expect(html).not.toContain(esc(w.att_guide_way_PUSH_hint.split("`")[0]))
        }
    })

    it("isn't asked for a Hikvision model, which the agent always reads", async () => {
        const html = await guideFor({ brand: HIK })
        expect(html).not.toContain("ui-choices")
        expect(html).not.toContain(esc(en.att_guide_way))
        expect(html).toMatch(/^<ol class="ui-guide-steps"/)
    })

    it("shows the steps for one that sends: agent.json with push, the firewall rule, its Cloud Server Setting, and no probe", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await guide({ brand: CONVOY, pushes: true }, locale)
            expect(html).toContain(esc('"push": true,'))
            expect(html).toContain(esc('netsh advfirewall firewall add rule name="Nizmo agent"'))
            // Its box scrolls sideways, so the keyboard reaches it, to scroll it; the others don't take focus.
            expect(html).toMatch(/<pre id="[^"]+" dir="ltr" translate="no" tabindex="0"><code>netsh advfirewall/)
            expect(html.match(/tabindex="0"/g)).toHaveLength(1)
            expect(html).toContain(`<code class="ui-guide-inline" dir="ltr" translate="no">Cloud Server Setting</code>`)
            expect(html).toContain("nizmo-agent.exe version")
            expect(html).not.toContain("nizmo-agent.exe probe")
            // The model's notes stay by its address.
            expect(html).toContain("ui-guide-notes")
        }
    })

    it("never says one that sends can be added straight to Nizmo, which takes only HTTPS", async () => {
        expect(await guide({ brand: CONVOY, directAllowed: true })).toContain(esc(en.att_guide_direct_too))
        expect(await guide({ brand: CONVOY, directAllowed: true, pushes: true })).not.toContain(esc(en.att_guide_direct_too))
    })
})

// The guide's dialog became a page of its own in PR 356 (lib/terminal-guide-page.test.ts).
describe("the guide's button", () => {
    it("is round, 30px, 44px on phones, and the guide's own styles are logical and on tokens", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-guide-button \{[^}]*width: 30px;[^}]*border-radius: var\(--radius-pill\);[^}]*\}/)
        expect(css).toMatch(/@media \(max-width: 767px\) \{[^@]*\.ui-guide-button \{\s*width: 44px;\s*\}/)
        const guideCss = css.slice(css.indexOf("/* A guide (DESIGN.md §5.5"), css.indexOf("/* End of a guide */"))
        expect(guideCss.length).toBeGreaterThan(100)
        expect(guideCss).not.toMatch(/\b(left|right)\b/)
        expect(guideCss).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    })
})

// What the first customer's setup on 21 November 2026 found (ATTENDANCE_PLAN.md
// §17.13): the office PC's prompt was PowerShell, where a program in the folder
// needs .\ before it, and the terminal kept its comm key under PC Connection.
// The guide says both, as the agent's README does since PR 354 (PR 355).
describe("the guide, as the first customer's setup found it", () => {
    const FOLDER_LINE = 'cd "C:\\Program Files\\Nizmo Agent"'
    const ways = {
        "ZKTeco's, read": setupGuide("ZKTECO", { superAdmin: true, server: SERVER }),
        "ZKTeco's, sending": setupGuide("ZKTECO", { superAdmin: true, server: SERVER, pushes: true }),
        "Hikvision's": setupGuide("HIKVISION", { superAdmin: false, server: SERVER }),
    }

    it("opens the prompt once, in the agent's folder, right after unzipping it, before any command", () => {
        for (const [way, steps] of Object.entries(ways)) {
            const lines = steps[1].lines
            const at = lines.findIndex(l => l.text === "att_guide_unzip")
            expect(lines[at + 1], way).toEqual({ text: "att_guide_folder", code: FOLDER_LINE })
            // Before any command after the folder is unzipped.
            const firstCommand = lines.findIndex((l, i) => i > at && l.code !== undefined && /nizmo-agent|netsh/.test(l.code))
            expect(firstCommand, way).toBeGreaterThan(at + 1)
            // And only once, here.
            expect(steps.flatMap(st => st.lines).filter(l => l.text === "att_guide_folder"), way).toHaveLength(1)
        }
        // As the agent's README has it (PR 354).
        expect(readFileSync("agent/README.md", "utf8")).toContain(FOLDER_LINE)
    })

    it("says how to open the prompt, in both languages, with the lines after it not opening another", () => {
        for (const w of [en, ar]) {
            for (const typed of ["`Command Prompt`", "`cmd`"]) expect(w.att_guide_folder, typed).toContain(typed)
            for (const key of ["att_guide_probe", "att_guide_hik_probe", "att_guide_push_firewall"] as const) expect(w[key], key).not.toContain("Command Prompt")
        }
        expect(en.att_guide_folder).toContain("Run as administrator")
        expect(ar.att_guide_folder).toContain("«تشغيل كمسؤول»")
    })

    it("names both places a ZKTeco terminal keeps its comm key, in both languages", () => {
        for (const w of [en, ar]) {
            for (const typed of ["`Comm Key`", "`PC Connection`", "`0`"]) expect(w.att_guide_office_address, typed).toContain(typed)
        }
    })
})
