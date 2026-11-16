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
}

export type GuideStep = { key: string; title: TranslationKey; who: TranslationKey; lines: GuideLine[] }

/** Where the agent is installed on the office PC (agent/README.md, Install). */
const FOLDER = "C:\\Program Files\\Nizmo Agent"

/**
 * agent.json as the README sets it, sending to this Nizmo, with the
 * terminal's address to fill in, and for Hikvision's the user made on it
 * for the agent (§17.4): a key to a line, so no line runs past the guide's
 * box (found in the browser).
 */
function settingsFor(server: string, protocol: TerminalProtocol): string {
    const terminal = protocol === "HIKVISION"
        ? [`      "protocol": "hikvision",`, `      "host": "TERMINAL-ADDRESS",`, `      "user": "AGENT-USER",`, `      "password": "AGENT-PASSWORD",`]
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
 * Before installing: an agent already at the office may be older than the
 * one that reads Hikvision's terminals, 0.3.0 (§17.4, PR 303). ZKTeco's
 * are read by any.
 */
function installed(protocol: TerminalProtocol): GuideLine[] {
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
 * The steps for a model speaking this protocol. The Super Admin is told
 * where the agent is built; anyone else, to ask the Super Admin for it.
 */
export function setupGuide(protocol: TerminalProtocol, { superAdmin, server }: { superAdmin: boolean; server: string }): GuideStep[] {
    return [
        { key: "office", title: "att_guide_office_title", who: "att_guide_office_who", lines: OFFICE[protocol] },
        {
            key: "install", title: "att_guide_install_title", who: "att_guide_install_who",
            lines: [
                { text: superAdmin ? "att_guide_download_sa" : "att_guide_download_other" },
                ...installed(protocol),
                { text: "att_guide_unzip", code: FOLDER },
                ...reading(protocol, server),
                { text: "att_guide_unknown_publisher" },
            ],
        },
        {
            key: "connect", title: "att_guide_connect_title", who: "att_guide_connect_who",
            lines: [
                { text: "att_guide_add" },
                { text: "att_guide_enrol", code: "nizmo-agent.exe enrol CODE" },
                { text: "att_guide_service", code: "nizmo-agent-service.exe install\nnizmo-agent-service.exe start" },
                { text: "att_guide_brand", brand: true },
                { text: "att_guide_older", code: "\"sendFrom\": \"YYYY-MM-DD\"" },
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
                { text: "att_guide_unreachable" },
                ...refused(protocol),
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
