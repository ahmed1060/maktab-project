import type { TranslationKey } from "@/lib/translations"

/**
 * How to set up a fingerprint terminal (ATTENDANCE_PLAN.md §17.7, PR 282;
 * DESIGN.md §5.5, Dialog): the guide behind the round "i" on Fingerprint
 * terminals, its steps following the protocol of the model picked.
 *
 * Each protocol's steps read it through the Local Sync Agent, so they are
 * the agent's README in order: at the office, installing the agent,
 * connecting it, matching terminal numbers to people, and what to do when
 * something goes wrong. ZKTeco's and Hikvision's differ at the office, in
 * `agent.json` and `probe`, and in what goes wrong with signing in
 * (§17.4): Hikvision's terminal has a user made on it for the agent, where
 * ZKTeco's has a comm key (PR 301). Hikvision's also say which agent
 * version reads them, 0.3.0, how an agent already installed takes the
 * terminal, and what to do when its certificate changes (PR 303).
 *
 * A ZKTeco terminal can instead send its scans to the agent's PC, over
 * plain HTTP on the office network, when it can't be read (§17.12, PR 306).
 * Its steps name it in `agent.json` with `"push": true`, let it through
 * Windows Firewall, and set its Cloud Server Setting to the PC, as the
 * agent's README has them, with the agent that listens, 0.4.0.
 *
 * Each line is a translation key, with what's typed after it in a box of its
 * own, exactly as the agent takes it, never translated. Inside a sentence,
 * what's typed, such as a file's name, is between backticks (`inlineCode`),
 * and a name on the screen, such as a key, a menu or a button, between `**`.
 *
 * Under a line whose clicks aren't plain, Show me how opens them (PR 357), as
 * the first customer's setup walked them (§17.13), and What it shows says what
 * `probe` prints. They're the same for every model where the clicks are the
 * office PC's or Nizmo's; a ZKTeco terminal's own menu is walked too, and a
 * Hikvision one's, which differs by model, isn't yet.
 */

export type TerminalProtocol = "ZKTECO" | "HIKVISION"

export type GuideLine = {
    text: TranslationKey
    /** Typed or pasted as it is: a command, or a file's contents. */
    code?: string
    /** The model's notes, the Super Admin's, go here (the step that finds its address). */
    notes?: true
    /** The line names the model picked, as {brand}. */
    brand?: true
    /** What's typed is one line longer than the guide's box is wide, so its box scrolls sideways (PR 306). */
    wide?: true
    /** What's seen once it's typed, under its box (PR 357). */
    see?: TranslationKey
    /** A second sentence and box in the same line, such as the log after the service's status (PR 357). */
    then?: { text: TranslationKey; code: string }
    /** The clicks, under Show me how (PR 357). */
    how?: GuideHow
}

/** One part of a line's clicks, under its heading where there's more than one. */
export type GuidePart = { title?: TranslationKey; steps: TranslationKey[] }

/** A line's clicks, opened under it (DESIGN.md §5.5, A guide's page; PR 357). */
export type GuideHow = {
    /** What a command prints rather than what to do: named What it shows, not Show me how. */
    shows?: true
    /** An example of what it prints, above the list. */
    sample?: string
    parts: GuidePart[]
    /** A line after them, such as going back to the terminal's clock. */
    after?: TranslationKey
}

export type GuideStep = { key: string; title: TranslationKey; who: TranslationKey; lines: GuideLine[] }

/** Where the agent is installed on the office PC (agent/README.md, Install). */
const FOLDER = "C:\\Program Files\\Nizmo Agent"

/**
 * The program the commands are typed in, picked on the guide's page (PR 356):
 * Command Prompt runs the agent's commands as they are; PowerShell runs a
 * program from the folder it's in only with `.\` before it, as the first
 * customer's setup found (ATTENDANCE_PLAN.md §17.13).
 */
export type CommandShell = "CMD" | "POWERSHELL"
export const COMMAND_SHELLS = ["CMD", "POWERSHELL"] as const satisfies readonly CommandShell[]
/** Each program by its own name, never translated. */
export const SHELL_NAMES: Record<CommandShell, string> = { CMD: "Command Prompt", POWERSHELL: "PowerShell" }

/** What's typed, written for the program picked: in PowerShell, each line that runs the agent starts with `.\`. */
export function forShell(code: string, shell: CommandShell): string {
    if (shell === "CMD") return code
    return code.split("\n").map(line => (/^nizmo-agent(-service)?\.exe\b/.test(line) ? `.\\${line}` : line)).join("\n")
}

/** The guide's page (PR 356): the company's people's own, or a company's for the Super Admin. */
export function guidePath(companyId: string | null): string {
    return companyId === null ? "/dashboard/settings/terminal-guide" : `/dashboard/companies/${encodeURIComponent(companyId)}/settings/terminal-guide`
}

/**
 * The program picked, opened once, in the agent's folder, right after it's
 * unzipped (PR 355), and how to open it (PR 356). As the README has it (PR 354).
 */
function prompt(shell: CommandShell): GuideLine[] {
    return [{ text: shell === "POWERSHELL" ? "att_guide_folder_ps" : "att_guide_folder", code: `cd "${FOLDER}"`, how: HOW_PROMPT[shell] }]
}

/**
 * The clicks under Show me how (PR 357). At the office, a ZKTeco terminal's own
 * menu, as the Convoy's was walked: opened with M/OK, its address under
 * Comm., Ethernet, its comm key under Comm Key or PC Connection.
 */
const MENU: GuidePart = { title: "att_how_menu_title", steps: ["att_how_menu_open", "att_how_menu_admin", "att_how_menu_keys"] }
const ADDRESS: GuidePart = { title: "att_how_address_title", steps: ["att_how_address_open", "att_how_address_note", "att_how_address_check"] }
const COMM_KEY: GuidePart = { title: "att_how_key_title", steps: ["att_how_key_open", "att_how_key_note"] }
const HOW_SOFTWARE: GuideHow = { parts: [{ steps: ["att_how_software_find", "att_how_software_untick", "att_how_software_close"] }] }
const HOW_CLOCK: GuideHow = { parts: [{ steps: ["att_how_clock_open", "att_how_clock_set"] }] }
/** On the office PC: the package into the agent's folder, and agent.json in Notepad, saved as UTF-8 without a BOM, which the agent can't read. */
const HOW_UNZIP: GuideHow = { parts: [{ steps: ["att_how_unzip_extract", "att_how_unzip_open", "att_how_unzip_folder", "att_how_unzip_copy"] }] }
const HOW_NOTEPAD: GuideHow = { parts: [{ steps: ["att_how_notepad_open", "att_how_notepad_paste", "att_how_notepad_save", "att_how_notepad_extension"] }] }
const HOW_PROMPT: Record<CommandShell, GuideHow> = {
    CMD: { parts: [{ steps: ["att_how_cmd_open", "att_how_prompt_admin", "att_how_cmd_folder"] }] },
    POWERSHELL: { parts: [{ steps: ["att_how_ps_open", "att_how_prompt_admin", "att_how_ps_folder"] }] },
}
/** Here, in Nizmo: as its own screens name them. */
const HOW_ADD: GuideHow = { parts: [{ steps: ["att_how_add_open", "att_how_add_name", "att_how_add_code"] }] }
const HOW_BRAND: GuideHow = { parts: [{ steps: ["att_how_brand_find", "att_how_brand_edit", "att_how_brand_set"] }] }
const HOW_NUMBERS: GuideHow = { parts: [{ steps: ["att_how_numbers_open", "att_how_numbers_pick", "att_how_numbers_who"] }] }

/**
 * What `probe` prints for a ZKTeco terminal, as the agent prints it, two
 * spaces deep, its values made up (agent/src/zk/client.ts, `info`).
 */
export const PROBE_SAMPLE = JSON.stringify({
    serialNumber: "ABC1234567890", name: "MODEL", firmware: "Ver 6.60", clock: "2026-11-21T09:30:00", users: 25, records: 4180, recordsCapacity: 100000,
}, null, 2)
const HOW_PROBE: GuideHow = { shows: true, sample: PROBE_SAMPLE, parts: [{ steps: ["att_how_probe_counts", "att_how_probe_clock", "att_how_probe_timeout", "att_how_probe_auth"] }] }

/** Picking the PC, and checking it reaches the terminal, whatever its model (PR 357). */
const PC: GuideLine = { text: "att_guide_office_pc", code: "ping TERMINAL-ADDRESS", see: "att_guide_ping_see" }

/** The agent's log, in its folder (agent/src/main.ts): its last lines, in each program's own way. */
const LOG: Record<CommandShell, string> = { CMD: "type logs\\agent.log", POWERSHELL: "Get-Content .\\logs\\agent.log -Tail 20" }

/** The first agent that takes the scans a terminal sends it (§17.12, PR 305). */
export const PUSH_AGENT_VERSION = "0.4.0"

/** The agent's port unless agent.json sets "listenPort" (agent/src/config.ts). */
const LISTEN_PORT = 8081

/**
 * Lets a terminal that sends reach the agent through Windows Firewall, on
 * the office network and from its address alone, as the README has it.
 */
const FIREWALL = `netsh advfirewall firewall add rule name="Nizmo agent" dir=in action=allow protocol=TCP localport=${LISTEN_PORT} remoteip=TERMINAL-ADDRESS profile=private,domain`

/**
 * agent.json as the README sets it, sending to this Nizmo, with the
 * terminal's address to fill in, and for Hikvision's the user made on it
 * for the agent (§17.4): a key to a line, so no line runs past the guide's
 * box (found in the browser).
 */
function settingsFor(server: string, protocol: TerminalProtocol, pushes = false): string {
    const terminal = protocol === "HIKVISION"
        ? [`      "protocol": "hikvision",`, `      "host": "TERMINAL-ADDRESS",`, `      "user": "AGENT-USER",`, `      "password": "AGENT-PASSWORD",`]
        // One that sends is named by its IP address, where its requests come from, with no port or comm key (PR 305).
        : pushes ? [`      "host": "TERMINAL-ADDRESS",`, `      "push": true,`]
        : [`      "host": "TERMINAL-ADDRESS",`]
    return [
        "{",
        `  "server": "${server}",`,
        `  "devices": [`,
        `    {`,
        ...terminal,
        `      "name": "Front door"`,
        `    }`,
        `  ],`,
        `  "pollSeconds": 60`,
        "}",
    ].join("\n")
}

/** At the office, before the agent: what each protocol's terminal needs. The model's notes go with finding its address. */
const OFFICE: Record<TerminalProtocol, GuideLine[]> = {
    ZKTECO: [
        // Leaving it connected joins turning its deleting off, as the canvas has it (PR 357).
        { text: "att_guide_office_delete", how: HOW_SOFTWARE },
        { text: "att_guide_office_address", how: { parts: [MENU, ADDRESS, COMM_KEY], after: "att_how_menu_back" } },
        { text: "att_guide_model_notes", notes: true },
        { text: "att_guide_office_clock", how: HOW_CLOCK },
        PC,
    ],
    HIKVISION: [
        { text: "att_guide_hik_user" },
        { text: "att_guide_hik_address" },
        { text: "att_guide_model_notes", notes: true },
        { text: "att_guide_hik_clock" },
        { text: "att_guide_hik_listening" },
        PC,
    ],
}

/**
 * At the office, for a ZKTeco terminal that sends: its address and the
 * PC's kept fixed, since each finds the other by it (PR 306). Nothing of
 * reading it: neither the PC software's settings nor its comm key.
 */
const OFFICE_PUSH: GuideLine[] = [
    // Its address with no comm key, which only reading it needs (PR 357).
    { text: "att_guide_push_address", how: { parts: [MENU, ADDRESS], after: "att_how_menu_back" } },
    { text: "att_guide_model_notes", notes: true },
    { text: "att_guide_office_clock", how: HOW_CLOCK },
    PC,
    { text: "att_guide_push_pc_address" },
]

/**
 * Before installing: an agent already at the office may be older than the
 * one that reads Hikvision's terminals, 0.3.0 (§17.4, PR 303), or the one
 * that listens for a terminal that sends, 0.4.0 (PR 306). ZKTeco's are
 * read by any.
 */
function installed(protocol: TerminalProtocol, sends: boolean): GuideLine[] {
    if (sends) {
        return [
            { text: "att_guide_push_version", code: "nizmo-agent.exe version" },
            { text: "att_guide_push_installed" },
        ]
    }
    if (protocol !== "HIKVISION") return []
    return [
        { text: "att_guide_hik_version", code: "nizmo-agent.exe version" },
        { text: "att_guide_hik_installed" },
    ]
}

/** Setting the agent to read it, and checking it answers. */
function reading(protocol: TerminalProtocol, server: string): GuideLine[] {
    if (protocol === "HIKVISION") {
        return [
            { text: "att_guide_hik_settings", code: settingsFor(server, protocol), how: HOW_NOTEPAD },
            { text: "att_guide_hik_https" },
            // The password is asked for, never typed on the command line, where it would stay in its history (§17.4).
            { text: "att_guide_hik_probe", code: "nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER" },
        ]
    }
    return [
        { text: "att_guide_settings", code: settingsFor(server, protocol), how: HOW_NOTEPAD },
        { text: "att_guide_password" },
        { text: "att_guide_probe", code: "nizmo-agent.exe probe TERMINAL-ADDRESS", how: HOW_PROBE },
        // probe reads only what it's given, never agent.json (Codex on PR 282).
        { text: "att_guide_probe_key", code: "nizmo-agent.exe probe TERMINAL-ADDRESS 4370 1234" },
    ]
}

/** What the agent says when the terminal won't let it in, in that protocol's own words. */
function refused(protocol: TerminalProtocol): GuideLine[] {
    if (protocol === "HIKVISION") {
        return [
            { text: "att_guide_hik_auth" },
            // A renewed certificate is trusted with the service stopped, as `trust` asks (PR 302, PR 303).
            { text: "att_guide_hik_certificate", code: "nizmo-agent-service.exe stop\nnizmo-agent.exe trust TERMINAL-ADDRESS\nnizmo-agent-service.exe start" },
        ]
    }
    return [{ text: "att_guide_auth" }]
}

/**
 * Setting the agent to listen for a terminal that sends, and the terminal
 * to send to it, as the README has them: no `probe`, which reads, and the
 * agent's log says when it first calls (PR 306).
 */
function listening(server: string): GuideLine[] {
    return [
        { text: "att_guide_push_settings", code: settingsFor(server, "ZKTECO", true), how: HOW_NOTEPAD },
        { text: "att_guide_push_firewall", code: FIREWALL, wide: true },
        { text: "att_guide_push_profile" },
        { text: "att_guide_push_terminal" },
    ]
}

/** What goes wrong with a terminal that sends, in the agent's own words (PR 305). */
const WRONG_PUSH: GuideLine[] = [
    { text: "att_guide_push_unreachable" },
    { text: "att_guide_push_never" },
    { text: "att_guide_push_port" },
    { text: "att_guide_push_stranger" },
]

const SEND_FROM = "\"sendFrom\": \"YYYY-MM-DD\""

/**
 * The steps for a model speaking this protocol, and for a ZKTeco one, as
 * the agent reads it or as it sends to the agent (`pushes`, PR 306). The
 * Super Admin is told where the agent is built; anyone else, to ask the
 * Super Admin for it.
 */
export function setupGuide(protocol: TerminalProtocol, { superAdmin, server, pushes = false, shell = "CMD" }: { superAdmin: boolean; server: string; pushes?: boolean; shell?: CommandShell }): GuideStep[] {
    // Only a ZKTeco terminal sends to the agent (§17.12): a Hikvision one that pushes is read.
    const sends = pushes && protocol === "ZKTECO"
    // Every box written for the program picked (PR 356). A line's second box is
    // written for it already, as the log is read in each program's own way (PR 357).
    return steps(protocol, superAdmin, server, sends, shell).map(step => ({
        ...step,
        lines: step.lines.map(l => (l.code === undefined ? l : { ...l, code: forShell(l.code, shell) })),
    }))
}

function steps(protocol: TerminalProtocol, superAdmin: boolean, server: string, sends: boolean, shell: CommandShell): GuideStep[] {
    return [
        { key: "office", title: "att_guide_office_title", who: "att_guide_office_who", lines: sends ? OFFICE_PUSH : OFFICE[protocol] },
        {
            key: "install", title: "att_guide_install_title", who: "att_guide_install_who",
            lines: [
                { text: superAdmin ? "att_guide_download_sa" : "att_guide_download_other" },
                ...installed(protocol, sends),
                { text: "att_guide_unzip", code: FOLDER, how: HOW_UNZIP },
                ...prompt(shell),
                ...(sends ? listening(server) : reading(protocol, server)),
                { text: "att_guide_unknown_publisher" },
            ],
        },
        {
            key: "connect", title: "att_guide_connect_title", who: "att_guide_connect_who",
            lines: [
                { text: "att_guide_add", how: HOW_ADD },
                { text: "att_guide_enrol", code: "nizmo-agent.exe enrol CODE", see: "att_guide_enrol_see" },
                // The first round by hand, before the service holds the agent's folder (PR 357): it reads, so not for one that sends.
                ...(sends ? [] : [{ text: "att_guide_check", code: "nizmo-agent.exe check", see: "att_guide_check_see" } as const]),
                { text: "att_guide_service", code: "nizmo-agent-service.exe install\nnizmo-agent-service.exe start" },
                // Its first call is the check that it reaches the agent, as probe is for one read.
                ...(sends ? [{ text: "att_guide_push_called" } as const] : []),
                { text: "att_guide_brand", brand: true, how: HOW_BRAND },
                // Older scans come once it's told to send again, when it next asks for its options, as it does when it starts (PR 305).
                { text: sends ? "att_guide_push_older" : "att_guide_older", code: SEND_FROM },
            ],
        },
        {
            key: "people", title: "att_guide_people_title", who: "att_guide_people_who",
            lines: [
                { text: "att_guide_numbers", how: HOW_NUMBERS },
                { text: "att_guide_try" },
            ],
        },
        {
            key: "wrong", title: "att_guide_wrong_title", who: "att_guide_wrong_who",
            lines: [
                { text: "att_guide_silent", code: "nizmo-agent-service.exe status", then: { text: "att_guide_log", code: LOG[shell] } },
                ...(sends ? WRONG_PUSH : [{ text: "att_guide_unreachable" } as const, ...refused(protocol)]),
                { text: "att_guide_revoked" },
                { text: "att_guide_clock" },
            ],
        },
    ]
}

/** A sentence's words and what's typed in it, which is between backticks. */
export function inlineCode(text: string): ({ text: string } | { code: string })[] {
    return text.split("`").map((part, i) => (i % 2 === 1 ? { code: part } : { text: part })).filter(p => ("code" in p ? true : p.text !== ""))
}
