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
 * what's typed, such as a file's name, is between backticks (`inlineCode`).
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
}

export type GuideStep = { key: string; title: TranslationKey; who: TranslationKey; lines: GuideLine[] }

/** Where the agent is installed on the office PC (agent/README.md, Install). */
const FOLDER = "C:\\Program Files\\Nizmo Agent"

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
        { text: "att_guide_office_delete" },
        { text: "att_guide_office_connected" },
        { text: "att_guide_office_address" },
        { text: "att_guide_model_notes", notes: true },
        { text: "att_guide_office_clock" },
        { text: "att_guide_office_pc" },
    ],
    HIKVISION: [
        { text: "att_guide_hik_user" },
        { text: "att_guide_hik_address" },
        { text: "att_guide_model_notes", notes: true },
        { text: "att_guide_hik_clock" },
        { text: "att_guide_hik_listening" },
        { text: "att_guide_office_pc" },
    ],
}

/**
 * At the office, for a ZKTeco terminal that sends: its address and the
 * PC's kept fixed, since each finds the other by it (PR 306). Nothing of
 * reading it: neither the PC software's settings nor its comm key.
 */
const OFFICE_PUSH: GuideLine[] = [
    { text: "att_guide_push_address" },
    { text: "att_guide_model_notes", notes: true },
    { text: "att_guide_office_clock" },
    { text: "att_guide_office_pc" },
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
            { text: "att_guide_hik_settings", code: settingsFor(server, protocol) },
            { text: "att_guide_hik_https" },
            // The password is asked for, never typed on the command line, where it would stay in its history (§17.4).
            { text: "att_guide_hik_probe", code: "nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER" },
        ]
    }
    return [
        { text: "att_guide_settings", code: settingsFor(server, protocol) },
        { text: "att_guide_password" },
        { text: "att_guide_probe", code: "nizmo-agent.exe probe TERMINAL-ADDRESS" },
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
        { text: "att_guide_push_settings", code: settingsFor(server, "ZKTECO", true) },
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
export function setupGuide(protocol: TerminalProtocol, { superAdmin, server, pushes = false }: { superAdmin: boolean; server: string; pushes?: boolean }): GuideStep[] {
    // Only a ZKTeco terminal sends to the agent (§17.12): a Hikvision one that pushes is read.
    const sends = pushes && protocol === "ZKTECO"
    return [
        { key: "office", title: "att_guide_office_title", who: "att_guide_office_who", lines: sends ? OFFICE_PUSH : OFFICE[protocol] },
        {
            key: "install", title: "att_guide_install_title", who: "att_guide_install_who",
            lines: [
                { text: superAdmin ? "att_guide_download_sa" : "att_guide_download_other" },
                ...installed(protocol, sends),
                { text: "att_guide_unzip", code: FOLDER },
                ...(sends ? listening(server) : reading(protocol, server)),
                { text: "att_guide_unknown_publisher" },
            ],
        },
        {
            key: "connect", title: "att_guide_connect_title", who: "att_guide_connect_who",
            lines: [
                { text: "att_guide_add" },
                { text: "att_guide_enrol", code: "nizmo-agent.exe enrol CODE" },
                { text: "att_guide_service", code: "nizmo-agent-service.exe install\nnizmo-agent-service.exe start" },
                // Its first call is the check that it reaches the agent, as probe is for one read.
                ...(sends ? [{ text: "att_guide_push_called" } as const] : []),
                { text: "att_guide_brand", brand: true },
                // Older scans come once it's told to send again, when it next asks for its options, as it does when it starts (PR 305).
                { text: sends ? "att_guide_push_older" : "att_guide_older", code: SEND_FROM },
            ],
        },
        {
            key: "people", title: "att_guide_people_title", who: "att_guide_people_who",
            lines: [
                { text: "att_guide_numbers" },
                { text: "att_guide_try" },
            ],
        },
        {
            key: "wrong", title: "att_guide_wrong_title", who: "att_guide_wrong_who",
            lines: [
                { text: "att_guide_silent", code: "nizmo-agent-service.exe status" },
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
