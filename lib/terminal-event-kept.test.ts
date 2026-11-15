import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"

/**
 * What a scan keeps of its event, and the terminal's own time zone on its
 * row (ATTENDANCE_PLAN.md §17.5, Phase 4 part 5, PR 293): the migration,
 * where the kept event goes and doesn't, the row's badge and its words.
 * What is read from an event is in lib/attendance/hikvision-events.test.ts,
 * when the row is flagged in lib/attendance/terminal-health.test.ts, and
 * what is stored in lib/terminal-push.db.test.ts.
 */

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
/** Every source file under a folder, tests aside. */
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : filesUnder(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
})

describe("the migration", () => {
    const sql = readFileSync("prisma/migrations/20261230000000_terminal_event_kept/migration.sql", "utf8")
    const statements = sql.split("\n").filter(line => line.trim() && !line.startsWith("--")).join("\n").split(";").map(s => s.trim()).filter(Boolean)

    it("only adds two columns, each empty for every row there is", () => {
        expect(statements).toEqual([
            `ALTER TABLE "AttendancePunch" ADD COLUMN "rawPayload" JSONB`,
            `ALTER TABLE "AttendanceDevice" ADD COLUMN "utcOffsetMinutes" INTEGER`,
        ])
        // Previews run it on production (so nothing is dropped, rewritten or required).
        expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|NOT NULL|DEFAULT|RENAME|ALTER COLUMN)\b/)
    })

    it("is the schema's two fields, each optional", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const model = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf("\n}", schema.indexOf(`model ${name} {`)))
        expect(model("AttendancePunch")).toMatch(/\n\s+rawPayload\s+Json\?\n/)
        expect(model("AttendanceDevice")).toMatch(/\n\s+utcOffsetMinutes\s+Int\?\n/)
    })
})

describe("what a punch keeps", () => {
    it("is written by the ingest alone and sent out by nothing", () => {
        const naming = [...filesUnder("lib"), ...filesUnder("app"), ...filesUnder("components")].filter(path => source(path).includes("rawPayload"))
        expect(naming).toEqual(["lib/services/attendance-ingest.service.ts"])
        const ingest = source("lib/services/attendance-ingest.service.ts")
        // Once, on a new punch's row: one already there is skipped, not updated.
        expect(ingest.split("rawPayload")).toHaveLength(2)
        expect(ingest).toContain("...(c.kept && { rawPayload: c.kept }),")
        expect(ingest).toContain("skipDuplicates: true")
    })

    it("comes with a terminal's own scan, never with the agent's", () => {
        const ingest = source("lib/services/attendance-ingest.service.ts")
        // The one place a scan's kept event is passed on is the terminal's own way in.
        expect(ingest.split("kept: s.kept")).toHaveLength(2)
        const fromAgent = ingest.slice(ingest.indexOf("static async punches("), ingest.indexOf("static async fromTerminal("))
        expect(fromAgent).not.toContain("kept")
        const push = source("lib/services/attendance-terminal-push.service.ts")
        expect(push).toContain("AttendanceIngestService.fromTerminal(deviceId, scans.map(({ userNumber, at, kept }) => ({ userNumber, at, kept })))")
    })

    it("is the event's listed fields: no name, card or picture is on either list", () => {
        const events = source("lib/attendance/hikvision-events.ts")
        const list = (name: string) => /\[([^\]]*)\]/.exec(events.slice(events.indexOf(`const ${name} = `)))![1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean)
        expect(list("KEPT_OF_EVENT")).toEqual(["dateTime", "eventType", "eventState", "ipAddress", "macAddress", "channelID", "activePostCount"])
        expect(list("KEPT_OF_ACCESS")).toEqual([
            "deviceName", "majorEventType", "subEventType", "employeeNoString", "employeeNo", "serialNo", "verifyNo", "userType",
            "currentVerifyMode", "cardReaderNo", "doorNo", "attendanceStatus", "statusValue", "picturesNumber",
        ])
        // Nor whether the person wore a mask: it is theirs, and nothing here needs it.
        for (const field of [...list("KEPT_OF_EVENT"), ...list("KEPT_OF_ACCESS")]) expect(field, field).not.toMatch(/^name$|card(?!Reader)|pic(?!turesNumber)|face|url|photo|image|mask|temperature/i)
    })
})

describe("the terminal's own time zone", () => {
    it("is noted with the contact, from the last scan that states one, on a terminal straight to Nizmo that isn't retired", () => {
        const push = source("lib/services/attendance-terminal-push.service.ts")
        expect(push).toContain("const stated = scans.filter(s => s.offsetMinutes !== null)")
        expect(push).toContain(`where: { id: deviceId, connection: "DIRECT", retiredAt: null },`)
        expect(push).toContain("...(stated.length > 0 && { utcOffsetMinutes: stated[stated.length - 1].offsetMinutes })")
    })

    it("is compared on the list with the company's offset now", () => {
        const service = source("lib/services/attendance-device.service.ts")
        expect(service).toContain("prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })")
        expect(service).toContain("const zone = Math.round(offsetMsIn(now, company?.timezone ?? DEFAULT_TIME_ZONE) / 60_000)")
        expect(service).toContain("deviceHealth({ ...d, addedById }, now, working, zone)")
    })

    it("is said on the terminal's row beside Clock off, as a badge that waits, with the offset left to right", () => {
        const panel = source("components/AttendanceTerminalsPanel.tsx")
        const clock = panel.indexOf("{d.health.clockOff && ")
        const zone = panel.indexOf("{d.health.zoneOff && typeof d.utcOffsetMinutes === 'number' && <>{' '}<StatusBadge tone=\"waiting\">{zoneLine(d.utcOffsetMinutes)}</StatusBadge></>}")
        expect(clock).toBeGreaterThan(-1)
        expect(zone).toBeGreaterThan(clock)
        // An offset is written the same in either language, and never machine-translated.
        expect(panel).toContain("const [before, after] = t('att_term_zone_off').split('{zone}')")
        // In one piece: a badge sets its pieces apart, which would leave a gap before the comma.
        expect(panel).toContain(`return <span>{before}<bdi dir="ltr" translate="no">{utcOffsetLabel(minutes)}</bdi>{after}</span>`)
    })

    it("has its words in both languages, around the offset", () => {
        expect(en.att_term_zone_off).toBe("Time zone {zone}, not the company's")
        for (const words of [en.att_term_zone_off, ar.att_term_zone_off]) {
            expect(words.split("{zone}")).toHaveLength(2)
            expect(words).not.toMatch(/ · |→|\bwe\b/i)
        }
        expect(ar.att_term_zone_off).not.toBe(en.att_term_zone_off)
        expect(ar.att_term_zone_off).toMatch(/[؀-ۿ]/)
    })
})
