import { describe, it, expect } from "vitest"
import {
    FIRST_CONTACTS, FIRST_CONTACTS_OF_A_KIND, FIRST_CONTACT_DAYS, MAX_KEPT_BODY,
    bodyOf, headersOf, keepingFor, outcomeOf, roomFor, textOf,
} from "./terminal-first-contact"
import { newPushSecret } from "./terminal-secrets"
import { MAX_EVENT_BYTES, type KeptEvent, type TerminalEvent } from "./hikvision-events"

/**
 * What is kept of a terminal's first requests (ATTENDANCE_PLAN.md §17.8,
 * Phase 4 part 5, PR 294): which headers, what of the body, what kind of
 * request it was, and for how long. What is stored and who reads it is in
 * lib/terminal-first-contacts.db.test.ts.
 */

const SECRET = newPushSecret()
const post = (init: RequestInit) => new Request(`https://nizmo.example/api/terminals/hikvision/${SECRET}`, { method: "POST", ...init })
/** A passed check as a Hikvision terminal sends it, with what must not be kept in it. */
const access = (inner: Record<string, unknown> = {}, outer: Record<string, unknown> = {}) => ({
    ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01", dateTime: "2026-09-14T09:05:00+03:00", eventType: "AccessControllerEvent", eventState: "active",
    AccessControllerEvent: {
        deviceName: "Lobby", majorEventType: 5, subEventType: 75, name: "Ehab Hassan", cardNo: "1234567890", employeeNoString: "7", serialNo: 223,
        currentVerifyMode: "cardOrFaceOrFp", pictureURL: "http://192.0.2.10/pic/ehab.jpg", FaceRect: { height: 0.2, width: 0.1, x: 0.4, y: 0.5 }, ...inner,
    },
    ...outer,
})

describe("how many are kept, and for how long", () => {
    it("is 50 in all, 5 of a kind, in a terminal's first 7 days", () => {
        expect([FIRST_CONTACTS, FIRST_CONTACTS_OF_A_KIND, FIRST_CONTACT_DAYS]).toEqual([50, 5, 7])
    })

    it("keeps for a terminal that has sent nothing yet, and until 7 days after its first request", () => {
        const first = new Date("2026-09-14T09:00:00Z")
        expect(keepingFor(null, first)).toBe(true)
        expect(keepingFor(first, first)).toBe(true)
        expect(keepingFor(first, new Date("2026-09-21T08:59:59Z"))).toBe(true)
        expect(keepingFor(first, new Date("2026-09-21T09:00:00Z"))).toBe(false)
        expect(keepingFor(first, new Date("2027-01-01T00:00:00Z"))).toBe(false)
    })

    it("has room while there are fewer than 50, and fewer than 5 of the request's kind", () => {
        const counts = [{ kind: "heartBeat", count: 5 }, { kind: "AccessControllerEvent 5/75", count: 2 }]
        expect(roomFor(counts)).toBe(true)
        expect(roomFor(counts, "heartBeat")).toBe(false)
        expect(roomFor(counts, "AccessControllerEvent 5/75")).toBe(true)
        expect(roomFor(counts, "empty")).toBe(true)
        const full = Array.from({ length: 10 }, (_, i) => ({ kind: `k${i}`, count: 5 }))
        expect(roomFor(full)).toBe(false)
        expect(roomFor(full, "new")).toBe(false)
        expect(roomFor([])).toBe(true)
    })
})

describe("a request's headers", () => {
    it("keeps the ones that say how a terminal speaks, with their values", () => {
        const kept = headersOf(new Headers({
            "Content-Type": "multipart/form-data; boundary=MIME_boundary", "Content-Length": "412", "User-Agent": "Hikvision-Webs", Accept: "*/*",
            Connection: "keep-alive", Host: "nizmo.example", Expect: "100-continue",
        }), SECRET)
        expect(kept.headers).toEqual({
            accept: "*/*", connection: "keep-alive", "content-length": "412", "content-type": "multipart/form-data; boundary=MIME_boundary",
            expect: "100-continue", host: "nizmo.example", "user-agent": "Hikvision-Webs",
        })
        expect(kept.others).toEqual([])
    })

    it("keeps a credential's scheme at most, and never the secret", () => {
        const kept = headersOf(new Headers({
            Authorization: "Digest username=\"admin\", response=\"6629fae49393a05397450978507c4ef1\"", "Proxy-Authorization": "Basic YWRtaW46aHVudGVyMg==",
            Cookie: "session=abc123", "User-Agent": `terminal ${SECRET}`,
        }), SECRET)
        expect(kept.headers).toEqual({ authorization: "Digest [removed]", "proxy-authorization": "Basic [removed]", cookie: "[removed]", "user-agent": "terminal [secret]" })
        const text = JSON.stringify(kept)
        for (const never of ["admin", "6629fae4", "YWRtaW46", "abc123", SECRET]) expect(text, never).not.toContain(never)
        // A credential with no scheme to name says only that it was there.
        expect(headersOf(new Headers({ Authorization: "c2VjcmV0" }), SECRET).headers).toEqual({ authorization: "[removed]" })
    })

    it("keeps every other header by its name alone: the hosting adds its own, and some are credentials", () => {
        const kept = headersOf(new Headers({
            "Content-Type": "application/json", "X-Vercel-Oidc-Token": "eyJhbGciOiJSUzI1NiJ9.payload.signature", "X-Forwarded-For": "198.51.100.7",
            "X-Real-Ip": "198.51.100.7", "X-Vercel-Proxy-Signature": "Bearer abcdef", "X-Matched-Path": "/api/terminals/hikvision/[secret]",
            "X-Invoke-Path": `/api/terminals/hikvision/${SECRET}`, "X-Something-New": "from the terminal",
        }), SECRET)
        expect(kept.headers).toEqual({ "content-type": "application/json" })
        expect(kept.others).toEqual(["x-forwarded-for", "x-invoke-path", "x-matched-path", "x-real-ip", "x-something-new", "x-vercel-oidc-token", "x-vercel-proxy-signature"])
        const text = JSON.stringify(kept)
        for (const never of ["eyJhbGci", "198.51.100.7", "abcdef", SECRET, "from the terminal"]) expect(text, never).not.toContain(never)
    })

    it("cuts a long value, and keeps no more names than it can show", () => {
        const many: Record<string, string> = { "User-Agent": "u".repeat(900) }
        for (let i = 0; i < 80; i++) many[`x-extra-${String(i).padStart(2, "0")}`] = "v"
        const kept = headersOf(new Headers(many), SECRET)
        expect(kept.headers["user-agent"].length).toBeLessThanOrEqual(300)
        expect(kept.others).toHaveLength(60)
    })
})

describe("a body's text", () => {
    it("keeps an event's JSON with names, card numbers and pictures taken out, each said in its place", () => {
        const read = textOf(JSON.stringify(access({ userName: "Ehab", cardNumber: 1234567890, FaceData: "A".repeat(40), picturesNumber: 1 }, { PicInfo: [{ url: "http://192.0.2.10/pic/ehab.jpg", size: 14233 }] })))
        expect(JSON.parse(read.body)).toEqual({
            ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01", dateTime: "2026-09-14T09:05:00+03:00", eventType: "AccessControllerEvent", eventState: "active",
            AccessControllerEvent: {
                deviceName: "Lobby", majorEventType: 5, subEventType: 75, name: "[name removed]", cardNo: "[card number removed]", employeeNoString: "7", serialNo: 223,
                currentVerifyMode: "cardOrFaceOrFp", pictureURL: "[removed, 30 characters]", FaceRect: { height: 0.2, width: 0.1, x: 0.4, y: 0.5 },
                userName: "[name removed]", cardNumber: "[card number removed]", FaceData: "[removed, 40 characters]", picturesNumber: 1,
            },
            // Everything under a picture's key goes, its address with it; a count stays.
            PicInfo: [{ url: "[removed, 30 characters]", size: 14233 }],
        })
        for (const never of ["Ehab", "Hassan", "1234567890", "ehab.jpg", "AAAA"]) expect(read.body, never).not.toContain(never)
        expect(read.kinds).toEqual(["AccessControllerEvent 5/75"])
        // Kept as it reads, a field to a line.
        expect(read.body).toContain('\n  "eventType": "AccessControllerEvent",\n')
    })

    it("keeps the terminal's own name, and takes out every other", () => {
        const body = textOf(JSON.stringify({ deviceName: "Lobby", channelName: "Door 1", name: "Ehab", employeeName: "Ehab", personName: "Ehab", NAME: "Ehab", nickname: "E" })).body
        expect(JSON.parse(body)).toEqual({ deviceName: "Lobby", channelName: "Door 1", name: "[name removed]", employeeName: "[name removed]", personName: "[name removed]", NAME: "[name removed]", nickname: "[name removed]" })
        // A name that is a number, or a whole object, goes the same way; an empty one says nothing was there.
        expect(JSON.parse(textOf(JSON.stringify({ name: 7, userName: { first: "Ehab" }, cardNo: 1234567890, fullName: "" })).body)).toEqual({ name: "[name removed]", userName: "[name removed]", cardNo: "[card number removed]", fullName: "" })
    })

    it("takes a card's number out, and leaves what only speaks of card readers", () => {
        const body = JSON.parse(textOf(JSON.stringify({ card: "99", cardNo: "99", cardNumber: "99", cardID: "99", CardNo: "99", cardReaderNo: 1, cardType: 1, cardReaderKind: 4 })).body)
        expect(body).toEqual({ card: "[card number removed]", cardNo: "[card number removed]", cardNumber: "[card number removed]", cardID: "[card number removed]", CardNo: "[card number removed]", cardReaderNo: 1, cardType: 1, cardReaderKind: 4 })
    })

    it("takes any long text out: a template or a picture sent as text is one", () => {
        const body = JSON.parse(textOf(JSON.stringify({ something: "x".repeat(201), short: "x".repeat(200), fingerPrint: "abc", irisData: "abc", faceModelData: "abc" })).body)
        expect(body).toEqual({ something: "[text removed, 201 characters]", short: "x".repeat(200), fingerPrint: "[removed, 3 characters]", irisData: "[removed, 3 characters]", faceModelData: "[removed, 3 characters]" })
    })

    it("says what kind each event is, by its type and its codes", () => {
        expect(textOf(JSON.stringify({ eventType: "heartBeat", dateTime: "2026-09-14T09:05:00+03:00" })).kinds).toEqual(["heartBeat"])
        expect(textOf(JSON.stringify([access({ subEventType: 38 }), { eventType: "heartBeat" }, access({ subEventType: 38 })])).kinds).toEqual(["AccessControllerEvent 5/38", "heartBeat", "AccessControllerEvent 5/38"])
        expect(textOf(JSON.stringify({ AccessControllerEvent: { majorEventType: "x", subEventType: null } })).kinds).toEqual(["event ?/?"])
        // A type is a short word: anything else in it is dropped, so a kind can't carry a name.
        expect(textOf(JSON.stringify({ eventType: "Ehab Hassan <b>" + "x".repeat(80) })).kinds[0]).toMatch(/^[A-Za-z0-9_.-]{1,40}$/)
        expect(textOf(JSON.stringify("just text")).kinds).toEqual([])
    })

    it("keeps the older XML the same way, element by element", () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><ipAddress>192.0.2.10</ipAddress><dateTime>2026-09-14T17:02:00+03:00</dateTime><eventType>AccessControllerEvent</eventType><AccessControllerEvent><deviceName>Lobby</deviceName><majorEventType>5</majorEventType><subEventType>1</subEventType><employeeNoString>7</employeeNoString><name>Ehab Hassan</name><cardNo>1234567890</cardNo><pictureURL>http://192.0.2.10/pic/ehab.jpg</pictureURL><remark><![CDATA[Ehab <at the door>]]></remark></AccessControllerEvent></EventNotificationAlert>`
        const read = textOf(xml)
        expect(read.body).toContain("<deviceName>Lobby</deviceName>")
        expect(read.body).toContain("<employeeNoString>7</employeeNoString>")
        expect(read.body).toContain("<name>[name removed]</name>")
        expect(read.body).toContain("<cardNo>[card number removed]</cardNo>")
        expect(read.body).toContain("<pictureURL>[removed, 30 characters]</pictureURL>")
        expect(read.body).toContain("<remark>[text removed]</remark>")
        for (const never of ["Ehab", "1234567890", "ehab.jpg", "at the door"]) expect(read.body, never).not.toContain(never)
        expect(read.kinds).toEqual(["AccessControllerEvent 5/1"])
        expect(textOf("<EventNotificationAlert><eventType>heartBeat</eventType></EventNotificationAlert>").kinds).toEqual(["heartBeat"])
    })

    it("takes out what is under a picture's, a name's or a card's element in XML, and what an element's attributes hold (review on PR 294)", () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0"><eventType>AccessControllerEvent</eventType><AccessControllerEvent><majorEventType>5</majorEventType><subEventType>75</subEventType><employeeNoString>7</employeeNoString>`
            + `<PicInfo><url>http://192.0.2.10/pic/ehab.jpg</url><size>14233</size></PicInfo>`
            + `<personName><first>Ehab</first><last>Hassan</last></personName>`
            + `<card><number>1234567890</number></card>`
            + `<FaceTemplate><data>QUJDRA==</data></FaceTemplate>`
            + `<Person name="Ehab Hassan" cardNo="1234567890" id="7"/>`
            + `<snapshot url="http://192.0.2.10/s/1" width="640">kept?</snapshot>`
            + `<door no="1">open</door><!-- Ehab was here -->`
            + `</AccessControllerEvent></EventNotificationAlert>`
        const read = textOf(xml)
        expect(read.body).toBe(`<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0"><eventType>AccessControllerEvent</eventType><AccessControllerEvent><majorEventType>5</majorEventType><subEventType>75</subEventType><employeeNoString>7</employeeNoString>`
            + `<PicInfo><url>[removed, 30 characters]</url><size>[removed, 5 characters]</size></PicInfo>`
            + `<personName><first>[name removed]</first><last>[name removed]</last></personName>`
            + `<card><number>[card number removed]</number></card>`
            + `<FaceTemplate><data>[removed, 8 characters]</data></FaceTemplate>`
            + `<Person name="[name removed]" cardNo="[card number removed]" id="7"/>`
            + `<snapshot url="[removed, 21 characters]" width="[removed, 3 characters]">[removed, 5 characters]</snapshot>`
            + `<door no="1">open</door><!--[removed]-->`
            + `</AccessControllerEvent></EventNotificationAlert>`)
        for (const never of ["Ehab", "Hassan", "1234567890", "ehab.jpg", "QUJDRA", "192.0.2.10/s"]) expect(read.body, never).not.toContain(never)
        expect(read.kinds).toEqual(["AccessControllerEvent 5/75"])
        // Once an element that holds a picture closes, what follows it is kept as ever, also when the XML is broken.
        expect(textOf(`<EventNotificationAlert><PicInfo><url>http://192.0.2.10/a.jpg</PicInfo><doorNo>1</doorNo></EventNotificationAlert>`).body)
            .toBe(`<EventNotificationAlert><PicInfo><url>[removed, 23 characters]</PicInfo><doorNo>1</doorNo></EventNotificationAlert>`)
    })

    it("reads markup that is broken, or made to be slow to read, once from start to end", () => {
        const event = (inside: string) => `<EventNotificationAlert><eventType>heartBeat</eventType>${inside}</EventNotificationAlert>`
        // A bracket that opens nothing is text; a comment or a section that never ends goes whole.
        expect(textOf(event("<doorNo>1 < 2</doorNo>")).body).toBe(event("<doorNo>1 < 2</doorNo>"))
        expect(textOf(event("<doorNo>1</doorNo><!-- Ehab")).body).toBe("<EventNotificationAlert><eventType>heartBeat</eventType><doorNo>1</doorNo><!--[removed]-->")
        expect(textOf(event("<remark><![CDATA[Ehab")).body).toBe("<EventNotificationAlert><eventType>heartBeat</eventType><remark>[text removed]")
        expect(textOf(event(`<!DOCTYPE x [<!ENTITY who "Ehab">]><doorNo>1</doorNo>`)).body).not.toContain("Ehab")
        // A closing tag that was never opened closes nothing: the name's element is still open.
        expect(textOf(event("<name></door>Ehab</name>")).body).toBe(event("<name></door>[name removed]</name>"))
        // An element's attributes past a few hundred characters aren't read.
        expect(textOf(event(`<door ${"x".repeat(500)}="Ehab">1</door>`)).body).toBe(event("<door>1</door>"))
        const started = Date.now()
        for (const slow of ["<".repeat(250_000), "<![CDATA[".repeat(28_000), "<!--".repeat(60_000), `<a ${"x".repeat(250_000)}>`, "<a>".repeat(80_000) + "</b>".repeat(60_000), `<a b="1" `.repeat(28_000), `"a":"`.repeat(50_000), "a=".repeat(125_000)]) {
            textOf(event(slow))
            textOf(slow)
            textOf(`{"broken": ${slow}`)
        }
        // And text made to be read over and over: escaped many times, or one pair inside another.
        const nested = `&${"amp;".repeat(40)}lt;name&${"amp;".repeat(40)}gt;Ehab`
        expect(textOf(JSON.stringify({ remark: nested })).body).not.toContain("Ehab")
        textOf(JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "a=".repeat(100)]))))
        textOf(JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, `${"[".repeat(99)}"${"x".repeat(99)}`]))))
        expect(Date.now() - started).toBeLessThan(5_000)
    })

    it("takes a picture's address out whatever its field is called, and a file's name with it", () => {
        const body = JSON.parse(textOf(JSON.stringify({
            url: "http://192.0.2.10/LOCALS/pic/acsLinkCap/1_2.jpeg@WEB000000000123", file: "Ehab_Hassan.JPG", link: "http://192.0.2.10/doc/page", type: "image/jpeg",
        })).body)
        expect(body).toEqual({ url: "[removed, 64 characters]", file: "[removed, 15 characters]", link: "http://192.0.2.10/doc/page", type: "image/jpeg" })
    })

    it("reads a text that holds an event of its own by the same rules: a field's name inside a text still says what it is", () => {
        const inner = JSON.stringify({ name: "Ehab Hassan", cardNo: "1234567890", employeeNoString: "7" })
        const body = JSON.parse(textOf(JSON.stringify({ data: inner, query: "employeeNo=7&name=Ehab&cardNo=99", markup: "<name>Ehab</name><doorNo>1</doorNo>" })).body)
        expect(body).toEqual({
            data: `{"name":"[name removed]","cardNo":"[card number removed]","employeeNoString":"7"}`,
            query: "employeeNo=7&name=[name removed]&cardNo=[card number removed]",
            markup: "<name>[name removed]</name><doorNo>1</doorNo>",
        })
        // What was taken out is said once, however many times the text is read.
        const address = textOf(`{"url":"http://192.0.2.10/x?name=Ehab&id=3","broken`).body
        expect(address).toBe(`{"url":"http://192.0.2.10/x?name=[name removed]&id=3","broken`)
    })

    it("reads JSON that is cut short or broken field by field all the same: a number, and what is under a name or a picture (second review on PR 294)", () => {
        // A card's number written as a number, in an event cut short.
        expect(textOf(`{"cardNo":1234567890,`).body).toBe(`{"cardNo":"[card number removed]",`)
        expect(textOf(`{"eventType":"AccessControllerEvent","AccessControllerEvent":{"cardNo": 1234567890, "name": 7, "employeeNoString":"7","serialNo":223`).body)
            .toBe(`{"eventType":"AccessControllerEvent","AccessControllerEvent":{"cardNo": "[card number removed]", "name": "[name removed]", "employeeNoString":"7","serialNo":223`)
        // What is under a name, a card or a picture goes with it, in a list as well.
        expect(textOf(`{"name":{"first":"Ehab","age":41},"PicInfo":{"url":"http://192.0.2.10/s/1","n":2},"doorNo":1`).body)
            .toBe(`{"name":{"first":"[name removed]","age":"[name removed]"},"PicInfo":{"url":"[removed, 21 characters]","n":2},"doorNo":1`)
        expect(textOf(`{"cardNo":[123,456],"names":["Ehab","Mona"],"doorNo":[1,2]`).body)
            .toBe(`{"cardNo":["[card number removed]","[card number removed]"],"names":["[name removed]","[name removed]"],"doorNo":[1,2]`)
        // Once a name's field closes, what follows is kept as ever.
        expect(textOf(`{"name":{"first":"Ehab"},"doorNo":1,"remark":"late"`).body).toBe(`{"name":{"first":"[name removed]"},"doorNo":1,"remark":"late"`)
        // A value cut off in its middle is still its field's.
        expect(textOf(`{"doorNo":1,"name":"Ehab Has`).body).toBe(`{"doorNo":1,"name":"[name removed]`)
        // Fields written without quotes, or with single ones, and a name with a space in it.
        expect(textOf(`{name: Ehab Hassan, cardNo: 1234567890, doorNo: 1}x`).body).toBe(`{name: "[name removed]", cardNo: "[card number removed]", doorNo: 1}x`)
        expect(textOf(`{'name':'Ehab Hassan','doorNo':'1'`).body).toBe(`{'name':"[name removed]",'doorNo':'1'`)
        expect(textOf("name=Ehab Hassan&cardNo=12 34&door=1 open").body).toBe("name=[name removed]&cardNo=[card number removed]&door=1 open")
        // An event sent as text inside a text, its quotes escaped.
        expect(textOf(`{"data":"{\\"name\\":\\"Ehab\\",\\"cardNo\\":99,\\"doorNo\\":1}","x`).body).toBe(`{"data":"{\\"name\\":\\"[name removed]\\",\\"cardNo\\":\\"[card number removed]\\",\\"doorNo\\":1}","x`)
        // A field's name written with an escape is still its name.
        expect(textOf(`{"na\\u006de":"Ehab","doorNo":1`).body).toBe(`{"na\\u006de":"[name removed]","doorNo":1`)
        // Markup and fields sent inside XML's text, their brackets and quotes escaped.
        const inside = (remark: string) => `<EventNotificationAlert><eventType>heartBeat</eventType><remark>${remark}</remark><door title="${remark}">1</door></EventNotificationAlert>`
        expect(textOf(inside(`&lt;name&gt;Ehab&lt;/name&gt; &amp; {&quot;cardNo&quot;:99} &#60;doorNo&#x3e;1&lt;/doorNo&gt;`)).body)
            .toBe(inside(`&lt;name&gt;[name removed]&lt;/name&gt; &amp; {&quot;cardNo&quot;:&quot;[card number removed]&quot;} &lt;doorNo&gt;1&lt;/doorNo&gt;`))
        expect(textOf(inside("open &amp; shut &#0; &bogus;")).body).toBe(inside("open &amp; shut &#0; &bogus;"))
        // Where a field's name can't be relied on, a long number is taken out wherever it is: there it can't be told from a card's.
        expect(textOf(`Hassan","cardNo":1234567890,"doorNo":1}`).body).not.toContain("1234567890")
        expect(textOf("card 1234567890 at door 12345 on 2026-09-14T09:05:00").body).toBe("card [number removed] at door 12345 on 2026-09-14T09:05:00")
        // What was taken out is said once, however many times the text is read.
        for (const text of [`{"cardNo":1234567890,`, `{name: Ehab Hassan, doorNo: 1`, "name=Ehab Hassan&door=1"]) expect(textOf(textOf(text).body).body).toBe(textOf(text).body)
    })

    it("keeps the start of what is neither, with what looks like a name or a card number taken out", () => {
        const broken = textOf(`{"eventType":"AccessControllerEvent","name":"Ehab Hassan","cardNo":"1234567890","employeeNoString":"7",`)
        expect(broken.body).toBe(`{"eventType":"AccessControllerEvent","name":"[name removed]","cardNo":"[card number removed]","employeeNoString":"7",`)
        expect(broken.kinds).toEqual([])
        expect(textOf("name=Ehab+Hassan&cardNo=1234567890&employeeNo=7").body).toBe("name=[name removed]&cardNo=[card number removed]&employeeNo=7")
        const long = textOf("hello ".repeat(400))
        expect(long.body.length).toBeLessThan(700)
        expect(long.body).toContain("[cut: 2,399 characters in all]")
    })
})

describe("a request's body", () => {
    it("is empty for the terminal's own test of its setting", async () => {
        expect(await bodyOf(post({}), SECRET)).toEqual({ body: "", kind: "empty" })
        expect(await bodyOf(post({ body: "  \n" }), SECRET)).toEqual({ body: "", kind: "empty" })
    })

    it("keeps JSON and XML sent alone, and says a body it can't read is one", async () => {
        const json = await bodyOf(post({ body: JSON.stringify(access()), headers: { "Content-Type": "application/json" } }), SECRET)
        expect(json.kind).toBe("AccessControllerEvent 5/75")
        expect(json.body).toContain('"name": "[name removed]"')
        const beats = await bodyOf(post({ body: JSON.stringify([{ eventType: "heartBeat" }, access(), { eventType: "heartBeat" }]) }), SECRET)
        // Each kind once, in order of the alphabet, whatever order they came in.
        expect(beats.kind).toBe("AccessControllerEvent 5/75 + heartBeat")
        expect(await bodyOf(post({ body: "hello", headers: { "Content-Type": "text/plain" } }), SECRET)).toEqual({ body: "hello", kind: "unreadable" })
    })

    it("never opens a form's pictures: their part's name, type and size are kept", async () => {
        const form = new FormData()
        form.set("event_log", JSON.stringify(access()))
        form.set("Picture", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "Ehab_Hassan.jpg", { type: "image/jpeg" }))
        form.set("FacePic", new File([new Uint8Array(12)], "capture.bin", { type: "application/octet-stream" }))
        const read = await bodyOf(post({ body: form }), SECRET)
        expect(read.kind).toBe("AccessControllerEvent 5/75")
        expect(read.body).toContain('part "event_log": text, ')
        expect(read.body).toContain('"employeeNoString": "7"')
        expect(read.body).toContain('part "Picture": a file (image/jpeg, .jpg, 7 bytes), not opened')
        // One that doesn't say it's a picture, and isn't text, isn't kept either.
        expect(read.body).toContain('part "FacePic": a file (application/octet-stream, .bin, 12 bytes), not kept: it isn\'t text')
        // A file's own name can be a person's: only what kind of file it is stays.
        for (const never of ["Ehab", "Hassan", "JFIF", "capture"]) expect(read.body, never).not.toContain(never)
    })

    it("reads an event sent as a file of text, as the terminal's request is read", async () => {
        const form = new FormData()
        form.set("AccessControllerEvent", new File([JSON.stringify(access())], "event.json", { type: "application/json" }))
        const read = await bodyOf(post({ body: form }), SECRET)
        expect(read.kind).toBe("AccessControllerEvent 5/75")
        expect(read.body).toContain('part "AccessControllerEvent": a file (application/json, .json, ')
        expect(read.body).toContain('"name": "[name removed]"')
    })

    it("takes a form's field out by its own name, as it would a field of an event (review on PR 294)", async () => {
        const form = new FormData()
        form.set("eventType", "AccessControllerEvent")
        form.set("name", "Ehab Hassan")
        form.set("cardNo", "1234567890")
        form.set("FaceData", "abc123")
        form.set("employeeNoString", "7")
        form.set("personName", new File(["Ehab Hassan"], "who.txt", { type: "text/plain" }))
        // A picture's field that holds an event keeps its shape and its numbers, and none of its text.
        form.set("FaceCapture", JSON.stringify({ eventType: "faceCapture", who: "Ehab", count: 2 }))
        const read = await bodyOf(post({ body: form }), SECRET)
        expect(read.body).toBe([
            'part "eventType": text, 21 characters\nAccessControllerEvent',
            'part "name": text, 11 characters\n[name removed]',
            'part "cardNo": text, 10 characters\n[card number removed]',
            'part "FaceData": text, 6 characters\n[removed, 6 characters]',
            'part "employeeNoString": text, 1 characters\n7',
            'part "personName": a file (text/plain, .txt, 11 bytes), 11 characters\n[name removed]',
            'part "FaceCapture": text, 50 characters\n{\n  "eventType": "[removed, 11 characters]",\n  "who": "[removed, 4 characters]",\n  "count": 2\n}',
        ].join("\n\n"))
        for (const never of ["Ehab", "Hassan", "1234567890", "abc123"]) expect(read.body, never).not.toContain(never)
        // Its kind is still read from the event it holds.
        expect(read.kind).toBe("faceCapture")
    })

    it("says a form it can't read is one", async () => {
        const read = await bodyOf(post({ body: "not a form", headers: { "Content-Type": "multipart/form-data; boundary=x" } }), SECRET)
        expect(read).toEqual({ body: "[a form that couldn't be read]", kind: "unreadable" })
    })

    it("doesn't open a body, or a part, past the size Nizmo reads an event from: it says how long it was", async () => {
        expect(MAX_EVENT_BYTES).toBe(256 * 1024)
        const long = JSON.stringify({ eventType: "heartBeat", name: "Somebody Nobody", filler: "x".repeat(MAX_EVENT_BYTES) })
        expect(await bodyOf(post({ body: long }), SECRET)).toEqual({ body: `[${long.length.toLocaleString("en-US")} characters, more than is read, not kept]`, kind: "unreadable" })
        const form = new FormData()
        form.set("event_log", long)
        form.set("AccessControllerEvent", new File([long], "event.json", { type: "application/json" }))
        const read = await bodyOf(post({ body: form }), SECRET)
        expect(read.kind).toBe("unreadable")
        expect(read.body).toBe([
            `part "event_log": text, ${long.length.toLocaleString("en-US")} characters, more than is read, not kept`,
            `part "AccessControllerEvent": a file (application/json, .json, ${long.length.toLocaleString("en-US")} bytes), not opened`,
        ].join("\n\n"))
        expect(read.body).not.toContain("Somebody")
    })

    it("takes the secret out wherever it is, and cuts a body past 8,000 characters", async () => {
        const echoed = await bodyOf(post({ body: JSON.stringify({ eventType: "heartBeat", url: `https://nizmo.example/api/terminals/hikvision/${SECRET}` }) }), SECRET)
        expect(echoed.body).not.toContain(SECRET)
        expect(echoed.body).toContain("/api/terminals/hikvision/[secret]")
        const many = await bodyOf(post({ body: JSON.stringify(Array.from({ length: 400 }, () => access())) }), SECRET)
        expect(MAX_KEPT_BODY).toBe(8000)
        expect(many.body.length).toBeLessThanOrEqual(MAX_KEPT_BODY + 60)
        expect(many.body).toMatch(/\[cut: [\d,]+ characters in all\]$/)
        // A kind stays short however many events came.
        expect(many.kind).toBe("AccessControllerEvent 5/75")
    })
})

describe("what Nizmo made of a request", () => {
    const scan: TerminalEvent = { kind: "scan", userNumber: "7", at: "2026-09-14T09:05:00", offsetMinutes: 180, kept: { AccessControllerEvent: {} } as unknown as KeptEvent }
    const result = (over: object) => ({ accepted: 0, duplicates: 0, skipped: 0, refused: [], ...over })

    it("is unreadable, empty, or what became of each event in it", () => {
        expect(outcomeOf(null, null)).toEqual(["UNREADABLE"])
        expect(outcomeOf([], null)).toEqual(["EMPTY"])
        expect(outcomeOf([{ kind: "other" }], null)).toEqual(["NOTHING"])
        expect(outcomeOf([scan], result({ accepted: 1 }))).toEqual(["STORED"])
        expect(outcomeOf([scan], result({ duplicates: 1 }))).toEqual(["ALREADY"])
        expect(outcomeOf([scan], result({ skipped: 1 }))).toEqual(["SKIPPED"])
        expect(outcomeOf([scan], result({ refused: [{ index: 0, reason: "IN_FUTURE" }] }))).toEqual(["REFUSED:IN_FUTURE"])
        expect(outcomeOf([{ kind: "refused", reason: "EVENT_NOT_KNOWN:113" }], null)).toEqual(["REFUSED:EVENT_NOT_KNOWN:113"])
    })

    it("says each outcome once, a scan's first, however many events came", () => {
        const events: TerminalEvent[] = [scan, { kind: "other" }, scan, { kind: "refused", reason: "INVALID_NUMBER" }, { kind: "other" }, scan]
        expect(outcomeOf(events, result({ accepted: 2, duplicates: 1 }))).toEqual(["STORED", "ALREADY", "REFUSED:INVALID_NUMBER", "NOTHING"])
    })
})
