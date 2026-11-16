import type { TranslationKey } from "@/lib/translations"
import type { TerminalProtocol } from "./setup-guide"
import { HIKVISION_ROUTE } from "./terminal-secrets"

/**
 * How a terminal added by hand connects (ATTENDANCE_PLAN.md §17.1, §17.7,
 * PR 292, PR 297): which ways are listed for it, which of them is built,
 * what to set on one that sends its scans straight to Nizmo, the office's
 * address a ZKTeco one is let in from, and the words for why a scan of its
 * own was refused.
 *
 * Shared by the dialog that offers the ways and the server that checks the
 * one picked, so the page is never the only thing standing in its way.
 */

export type { TerminalProtocol }
export type TerminalConnection = "AGENT" | "DIRECT"

/**
 * The ways Nizmo can connect a terminal of each protocol today. ZKTeco's
 * terminals straight to Nizmo came with part 6 (PR 297); the agent reads
 * Hikvision's from part 7 (§20), which adds its way here.
 */
export const CONNECTIONS_BUILT: Record<TerminalProtocol, readonly TerminalConnection[]> = {
    ZKTECO: ["AGENT", "DIRECT"],
    HIKVISION: ["DIRECT"],
}

/**
 * The ways listed for a terminal of this protocol at a company. Straight
 * to Nizmo is listed only where the Super Admin has turned it on for the
 * company (§17.8); a way that isn't built for the protocol yet stays
 * listed, not to be picked (DESIGN.md §5.3).
 */
export function connectionChoices(protocol: TerminalProtocol, directAllowed: boolean): { connection: TerminalConnection; built: boolean }[] {
    const listed: TerminalConnection[] = directAllowed ? ["AGENT", "DIRECT"] : ["AGENT"]
    return listed.map(connection => ({ connection, built: CONNECTIONS_BUILT[protocol].includes(connection) }))
}

/** Whether a terminal of this protocol can be added this way at a company. */
export function mayConnect(protocol: TerminalProtocol, connection: TerminalConnection, directAllowed: boolean): boolean {
    return connectionChoices(protocol, directAllowed).some(c => c.connection === connection && c.built)
}

/** Whether a terminal has an address of its own to issue again: Hikvision's, straight to Nizmo (§17.2). */
export function hasAddress(terminal: { protocol: TerminalProtocol; connection: TerminalConnection }): boolean {
    return terminal.protocol === "HIKVISION" && terminal.connection === "DIRECT"
}

/**
 * Whether a terminal is let in from its office's internet address alone:
 * ZKTeco's, straight to Nizmo, which names itself by its serial number and
 * has no secret (§17.3, PR 297).
 */
export function hasOfficeAddress(terminal: { protocol: TerminalProtocol; connection: TerminalConnection }): boolean {
    return terminal.protocol === "ZKTECO" && terminal.connection === "DIRECT"
}

/**
 * The office's addresses as typed: one a line, or several on one with
 * commas, as a check-in location's office IPs (§9.4). Whether each is an
 * address or a range is the server's to say (lib/attendance/ip-ranges.ts).
 */
export function addressLines(typed: string): string[] {
    return typed.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
}

/** The path a Hikvision terminal sends to, with its secret in it. */
export function hikvisionPath(secret: string): string {
    return HIKVISION_ROUTE.replace("[secret]", secret)
}

/**
 * What to set on a Hikvision terminal, under the names its HTTP listening
 * gives them, so they can be matched on its screen: never translated. The
 * two too long to type are copied. `host` is this Nizmo's own, as the page
 * was opened on (§18, 6).
 */
export function hikvisionSettings(host: string, path: string): { name: string; value: string; copy: boolean }[] {
    return [
        { name: "Destination IP or domain name", value: host, copy: true },
        { name: "URL", value: path, copy: true },
        { name: "Port", value: "443", copy: false },
        { name: "Protocol", value: "HTTPS", copy: false },
    ]
}

/**
 * What to set on a ZKTeco terminal straight to Nizmo, under the names its
 * Cloud Server Setting gives them, so they can be matched on its screen:
 * never translated. Nothing in it is secret (§17.7, PR 297). `host` is
 * this Nizmo's own, as the page was opened on (§18, 6). The names differ
 * by model and firmware; the trial checks them (§17.8).
 */
export function zktecoSettings(host: string): { name: string; value: string; copy: boolean }[] {
    return [
        { name: "Server address", value: host, copy: true },
        { name: "Server port", value: "443", copy: false },
        { name: "Enable domain name", value: "ON", copy: false },
        { name: "HTTPS", value: "ON", copy: false },
    ]
}

const REFUSALS: Record<string, TranslationKey> = {
    MONTH_LOCKED: "att_term_refusal_MONTH_LOCKED",
    INVALID_TIME: "att_term_refusal_INVALID_TIME",
    IN_FUTURE: "att_term_refusal_IN_FUTURE",
    DEVICE_RETIRED: "att_term_refusal_DEVICE_RETIRED",
    DEVICE_VIA_AGENT: "att_term_refusal_DEVICE_VIA_AGENT",
    DIRECT_NOT_ALLOWED: "att_term_refusal_DIRECT_NOT_ALLOWED",
    INVALID_NUMBER: "att_term_refusal_INVALID_NUMBER",
    UNREADABLE: "att_term_refusal_UNREADABLE",
}

/**
 * Why a terminal's own scan was refused, in words (§17.5): the reason kept
 * on the terminal, as a sentence's key. An event of a type on neither list
 * carries its type (`EVENT_NOT_KNOWN:113`), and a call in a ZKTeco
 * terminal's name from an address that isn't its office's carries that
 * address (`ADDRESS_NOT_ALLOWED:198.51.100.9`, PR 296). A reason with no
 * words yet is shown as it was kept.
 */
export function refusalWords(reason: string): { key: TranslationKey; type?: string; address?: string } | null {
    if (reason.startsWith("EVENT_NOT_KNOWN:")) return { key: "att_term_refusal_EVENT_NOT_KNOWN", type: reason.slice("EVENT_NOT_KNOWN:".length) }
    if (reason.startsWith("ADDRESS_NOT_ALLOWED:")) return { key: "att_term_refusal_ADDRESS_NOT_ALLOWED", address: reason.slice("ADDRESS_NOT_ALLOWED:".length) }
    const key = REFUSALS[reason]
    return key ? { key } : null
}
