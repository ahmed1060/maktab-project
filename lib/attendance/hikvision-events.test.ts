import { describe, it, expect } from "vitest"
import { NOT_SCANS, PASSED_CHECKS, eventsOf, readEvent, readEventText } from "./hikvision-events"

/**
 * What a Hikvision terminal's events are read as (ATTENDANCE_PLAN.md §17.2,
 * PR 291): a scan, something to count on the terminal as refused, or
 * something answered and dropped. No terminal is on hand, so the shapes here
 * are the documented ones; the trial has the last word (§17.8).
 */

/** An access event as a terminal sends it, with the fields Nizmo reads and some it never does. */
const access = (inner: Record<string, unknown>, outer: Record<string, unknown> = {}) => ({
    ipAddress: "192.0.2.10", portNo: 443, protocol: "HTTPS", macAddress: "00:00:5e:00:53:01", channelID: 1,
    dateTime: "2026-09-14T09:05:00+03:00", activePostCount: 1, eventType: "AccessControllerEvent", eventState: "active",
    eventDescription: "Access Controller Event",
    ...outer,
    AccessControllerEvent: { deviceName: "Lobby", majorEventType: 5, subEventType: 75, name: "Ehab", verifyNo: 147, employeeNoString: "7", serialNo: 223, userType: "normal", currentVerifyMode: "cardOrFaceOrFp", picturesNumber: 1, ...inner },
})

describe("one event", () => {
    it("is a scan when an identity check passed for an employee number, at the terminal's wall clock", () => {
        expect(readEvent(access({}))).toMatchObject({ kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00" })
        // Whatever offset the terminal names: its wall clock is what's read, as for the agent (§17.5).
        expect(readEvent(access({}, { dateTime: "2026-09-14T09:05:00Z" }))).toMatchObject({ at: "2026-09-14T09:05:00" })
        expect(readEvent(access({}, { dateTime: "2026-09-14T09:05:00-05:00" }))).toMatchObject({ at: "2026-09-14T09:05:00" })
        expect(readEvent(access({}, { dateTime: "2026-09-14T09:05:00" }))).toMatchObject({ at: "2026-09-14T09:05:00" })
    })

    it("counts every check Hikvision lists as passed, and nothing it lists as failed, timed out, or a door's", () => {
        // Card, card and password, fingerprint, the combinations, face, employee number with each, ID card.
        expect([...PASSED_CHECKS].sort((a, b) => a - b)).toEqual([0x01, 0x02, 0x26, 0x28, 0x2b, 0x2e, 0x36, 0x39, 0x3c, 0x3f, 0x42, 0x45, 0x48, 0x4b, 0x4d, 0x65, 0x69])
        for (const minor of PASSED_CHECKS) expect(readEvent(access({ subEventType: minor })).kind, `0x${minor.toString(16)}`).toBe("scan")
        // A failed check can still name someone: whoever's card it was, with another's finger.
        for (const minor of [0x03, 0x04, 0x27, 0x29, 0x2a, 0x2c, 0x2f, 0x37, 0x3a, 0x3d, 0x40, 0x43, 0x46, 0x49, 0x4c, 0x4e, 0x4f, 0x50, 0x66, 0x67, 0x68, 0x70, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c]) {
            expect(NOT_SCANS.has(minor), `0x${minor.toString(16)}`).toBe(true)
            expect(readEvent(access({ subEventType: minor }))).toEqual({ kind: "other" })
        }
        for (const minor of PASSED_CHECKS) expect(NOT_SCANS.has(minor)).toBe(false)
    })

    it("reads numbers written as text, and an older terminal's employee number", () => {
        expect(readEvent(access({ majorEventType: "5", subEventType: "38", employeeNoString: " 12 " }))).toMatchObject({ kind: "scan", userNumber: "12", at: "2026-09-14T09:05:00" })
        expect(readEvent(access({ employeeNoString: undefined, employeeNo: 44 }))).toMatchObject({ kind: "scan", userNumber: "44" })
    })

    it("is nothing to keep without an employee number, or when it isn't an access event at all", () => {
        expect(readEvent(access({ employeeNoString: "" }))).toEqual({ kind: "other" })
        expect(readEvent(access({ employeeNoString: undefined }))).toEqual({ kind: "other" })
        // Alarms, exceptions and operations are other major types.
        for (const major of [1, 2, 3]) expect(readEvent(access({ majorEventType: major }))).toEqual({ kind: "other" })
        expect(readEvent({ eventType: "heartBeat", dateTime: "2026-09-14T09:05:00+03:00", eventState: "active" })).toEqual({ kind: "other" })
        expect(readEvent({ eventType: "videoloss", dateTime: "2026-09-14T09:05:00+03:00" })).toEqual({ kind: "other" })
        for (const nothing of [null, undefined, 7, "x", [], {}]) expect(readEvent(nothing)).toEqual({ kind: "other" })
    })

    it("is counted, with its type, when it names an employee and is of a type on neither list", () => {
        // A model that names a passed check otherwise must show up in the trial, not vanish.
        expect(readEvent(access({ subEventType: 113 }))).toEqual({ kind: "refused", reason: "EVENT_NOT_KNOWN:113" })
        expect(readEvent(access({ subEventType: undefined }))).toEqual({ kind: "refused", reason: "EVENT_NOT_KNOWN:?" })
        // With nobody named, it's nothing.
        expect(readEvent(access({ subEventType: 113, employeeNoString: "" }))).toEqual({ kind: "other" })
    })

    it("is counted when its employee number is longer than any Nizmo maps", () => {
        expect(readEvent(access({ employeeNoString: "9".repeat(32) }))).toMatchObject({ kind: "scan" })
        expect(readEvent(access({ employeeNoString: "9".repeat(33) }))).toEqual({ kind: "refused", reason: "INVALID_NUMBER" })
    })

    it("reads the offset its time states, in minutes, beside the wall clock it doesn't change (PR 293)", () => {
        const offset = (dateTime: unknown) => (readEvent(access({}, { dateTime })) as { offsetMinutes: number | null }).offsetMinutes
        expect(offset("2026-09-14T09:05:00+03:00")).toBe(180)
        expect(offset("2026-09-14T09:05:00+02:00")).toBe(120)
        expect(offset("2026-09-14T09:05:00-05:00")).toBe(-300)
        expect(offset("2026-09-14T09:05:00+05:30")).toBe(330)
        expect(offset("2026-09-14T09:05:00+0530")).toBe(330)
        expect(offset("2026-09-14T09:05:00.250+08:00")).toBe(480)
        expect(offset("2026-09-14T09:05:00Z")).toBe(0)
        // None stated, or one no clock has: nothing is said of the terminal's zone.
        for (const dateTime of ["2026-09-14T09:05:00", "2026-09-14T09:05:00+15:00", "2026-09-14T09:05:00+03:70", "2026-09-14T09:05:00 +03:00", "yesterday", "", undefined, 20260914]) {
            expect(offset(dateTime), String(dateTime)).toBeNull()
        }
        // Whatever it states, the scan's time is the wall clock.
        for (const zone of ["+03:00", "-05:00", "Z", ""]) expect(readEvent(access({}, { dateTime: `2026-09-14T09:05:00${zone}` }))).toMatchObject({ at: "2026-09-14T09:05:00" })
    })

    it("keeps the fields of its event that Nizmo knows, and never a name, a card's number or a picture (PR 293)", () => {
        const event = access(
            { cardNo: "1234567890", cardType: 1, cardReaderNo: 1, doorNo: 1, attendanceStatus: "checkIn", statusValue: 0, mask: "no", pictureURL: "http://192.0.2.10/pic/1.jpg", FaceRect: { height: 0.2, width: 0.1, x: 0.4, y: 0.5 }, somethingNew: "who knows" },
            { PicInfo: [{ url: "http://192.0.2.10/pic/1.jpg" }], shortSerialNumber: "K1", deviceID: "abc" },
        )
        const { kept } = readEvent(event) as { kept: Record<string, unknown> }
        expect(kept).toEqual({
            dateTime: "2026-09-14T09:05:00+03:00", eventType: "AccessControllerEvent", eventState: "active",
            ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01", channelID: 1, activePostCount: 1,
            AccessControllerEvent: {
                deviceName: "Lobby", majorEventType: 5, subEventType: 75, employeeNoString: "7", serialNo: 223, verifyNo: 147,
                userType: "normal", currentVerifyMode: "cardOrFaceOrFp", cardReaderNo: 1, doorNo: 1, attendanceStatus: "checkIn", statusValue: 0, picturesNumber: 1,
            },
        })
        // Kept by name: the person's name, the card's number, pictures, and whatever nobody foresaw are not there.
        const text = JSON.stringify(kept)
        for (const never of ["Ehab", '"name"', "cardNo", "1234567890", "pictureURL", ".jpg", "FaceRect", "PicInfo", "mask", "somethingNew", "who knows", "deviceID", "portNo", "eventDescription"]) expect(text, never).not.toContain(never)
    })

    it("keeps each field as a short text, a number or a yes or no, and nothing nested (PR 293)", () => {
        const { kept } = readEvent(access(
            { deviceName: "L".repeat(500), userType: { nested: "Ehab" }, statusValue: true, currentVerifyMode: ["card"], doorNo: Number.NaN, verifyNo: null },
            { ipAddress: { v4: "192.0.2.10" }, eventState: ["active"] },
        )) as { kept: { AccessControllerEvent: Record<string, unknown> } & Record<string, unknown> }
        expect(kept.AccessControllerEvent.deviceName).toBe("L".repeat(100))
        expect(kept.AccessControllerEvent.statusValue).toBe(true)
        for (const gone of ["userType", "currentVerifyMode", "doorNo", "verifyNo"]) expect(kept.AccessControllerEvent, gone).not.toHaveProperty(gone)
        for (const gone of ["ipAddress", "eventState"]) expect(kept, gone).not.toHaveProperty(gone)
        expect(JSON.stringify(kept)).not.toContain("Ehab")
    })

    it("stays a scan with a time that can't be read, for the ingest to refuse and count", () => {
        for (const dateTime of [undefined, "", "yesterday", 20260914, "2026-09-14 09:05:00"]) {
            expect(readEvent(access({}, { dateTime }))).toMatchObject({ kind: "scan", userNumber: "7", at: "" })
        }
    })
})

const XML = (inner: string, dateTime = "2026-09-14T17:02:00+03:00") => `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<ipAddress>192.0.2.10</ipAddress><portNo>443</portNo><protocol>HTTPS</protocol>
<dateTime>${dateTime}</dateTime><activePostCount>1</activePostCount>
<eventType>AccessControllerEvent</eventType><eventState>active</eventState>
<AccessControllerEvent>${inner}</AccessControllerEvent>
</EventNotificationAlert>`

describe("a body's text", () => {
    it("is read as JSON, one event or several", () => {
        expect(readEventText(JSON.stringify(access({})))).toMatchObject([{ kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00" }])
        expect(readEventText(JSON.stringify([access({}), access({ subEventType: 0x4c, employeeNoString: "" })]))).toMatchObject([
            { kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00" }, { kind: "other" },
        ])
        expect(readEventText(`  \n${JSON.stringify({ eventType: "heartBeat" })}\n`)).toEqual([{ kind: "other" }])
    })

    it("is read as the older XML", () => {
        expect(readEventText(XML("<majorEventType>5</majorEventType><subEventType>38</subEventType><employeeNoString>7</employeeNoString><name>Ehab</name>")))
            .toMatchObject([{ kind: "scan", userNumber: "7", at: "2026-09-14T17:02:00" }])
        expect(readEventText(XML("<majorEventType>5</majorEventType><subEventType>39</subEventType>"))).toEqual([{ kind: "other" }])
        expect(readEventText(XML("<majorEventType>5</majorEventType><subEventType>200</subEventType><employeeNoString>7</employeeNoString>")))
            .toEqual([{ kind: "refused", reason: "EVENT_NOT_KNOWN:200" }])
        expect(readEventText(`<EventNotificationAlert><eventType>heartBeat</eventType></EventNotificationAlert>`)).toEqual([{ kind: "other" }])
    })

    it("keeps the same fields of the older XML, by their names, and its offset (PR 293)", () => {
        const [scan] = readEventText(XML("<deviceName>Lobby</deviceName><majorEventType>5</majorEventType><subEventType>38</subEventType><employeeNoString>7</employeeNoString><name>Ehab</name><cardNo>1234567890</cardNo><cardReaderNo>1</cardReaderNo>"))!
        expect(scan).toMatchObject({ kind: "scan", userNumber: "7", at: "2026-09-14T17:02:00", offsetMinutes: 180 })
        expect((scan as { kept: unknown }).kept).toEqual({
            dateTime: "2026-09-14T17:02:00+03:00", eventType: "AccessControllerEvent", eventState: "active", ipAddress: "192.0.2.10", activePostCount: "1",
            AccessControllerEvent: { deviceName: "Lobby", majorEventType: "5", subEventType: "38", employeeNoString: "7", cardReaderNo: "1" },
        })
        expect(JSON.stringify(scan)).not.toMatch(/Ehab|1234567890/)
    })

    it("is unreadable when it is neither", () => {
        for (const text of ["hello", "{not json", "<html><body>404</body></html>", "5", "null", '"text"']) expect(readEventText(text), text).toBeNull()
    })
})

const post = (init: RequestInit) => new Request("https://nizmo.example/api/terminals/hikvision/x", { method: "POST", ...init })
const PICTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe("a request", () => {
    it("is read from a multipart form: the event's part, never its pictures", async () => {
        const form = new FormData()
        form.set("event_log", JSON.stringify(access({})))
        // A picture whose bytes, read as an event, would be one: it is never opened.
        form.set("Picture", new File([JSON.stringify(access({ employeeNoString: "666" }))], "Picture.jpg", { type: "image/jpeg" }))
        form.set("FacePicture", new File([PICTURE], "face.jpeg", { type: "application/octet-stream" }))
        const events = await eventsOf(post({ body: form }))
        expect(events).toMatchObject([{ kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00" }])
        // Nor is anything of a picture in what the scan keeps (PR 293).
        expect(JSON.stringify(events)).not.toMatch(/666|JFIF|Picture/)
    })

    it("reads the event whatever its part is called, and when it comes as a file", async () => {
        const form = new FormData()
        form.set("AccessControllerEvent", new File([JSON.stringify(access({ employeeNoString: "8" }))], "event.json", { type: "application/json" }))
        expect(await eventsOf(post({ body: form }))).toMatchObject([{ kind: "scan", userNumber: "8", at: "2026-09-14T09:05:00" }])
        const xml = new FormData()
        xml.set("event", XML("<majorEventType>5</majorEventType><subEventType>75</subEventType><employeeNoString>9</employeeNoString>"))
        expect(await eventsOf(post({ body: xml }))).toMatchObject([{ kind: "scan", userNumber: "9", at: "2026-09-14T17:02:00" }])
    })

    it("is read from JSON alone, or XML alone, whatever content type it claims", async () => {
        expect(await eventsOf(post({ body: JSON.stringify(access({})), headers: { "Content-Type": "application/json" } }))).toMatchObject([{ kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00" }])
        const xml = XML("<majorEventType>5</majorEventType><subEventType>1</subEventType><employeeNoString>7</employeeNoString>")
        expect(await eventsOf(post({ body: xml, headers: { "Content-Type": "application/xml; charset=UTF-8" } }))).toMatchObject([{ kind: "scan", userNumber: "7", at: "2026-09-14T17:02:00" }])
        expect(await eventsOf(post({ body: xml, headers: { "Content-Type": "text/plain" } }))).toHaveLength(1)
    })

    it("with nothing in it is a contact and no more: the terminal's own test of its setting", async () => {
        expect(await eventsOf(post({}))).toEqual([])
        expect(await eventsOf(post({ body: "  \n", headers: { "Content-Type": "application/json" } }))).toEqual([])
    })

    it("is unreadable when no part of it is an event, or it isn't a form though it says so", async () => {
        expect(await eventsOf(post({ body: "hello", headers: { "Content-Type": "text/plain" } }))).toBeNull()
        const pictures = new FormData()
        pictures.set("Picture", new File([PICTURE], "Picture.jpg", { type: "image/jpeg" }))
        expect(await eventsOf(post({ body: pictures }))).toBeNull()
        expect(await eventsOf(post({ body: "not a form", headers: { "Content-Type": "multipart/form-data; boundary=x" } }))).toBeNull()
        // A part too large to be an event is not opened either.
        const huge = new FormData()
        huge.set("event_log", "x".repeat(300_000))
        expect(await eventsOf(post({ body: huge }))).toBeNull()
    })
})
