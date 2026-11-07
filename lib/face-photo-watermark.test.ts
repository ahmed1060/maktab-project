import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { dateTimeText } from "@/lib/calendar-text"

/**
 * The watermark over face photos (DESIGN.md §5.5, Face photos; PR 216): the
 * viewer's name, and under it the time the photos opened, on the viewer's own
 * clock and in the page's digits. It gave the time in UTC, unlabelled and in
 * Western digits in Arabic, after the name and a dot.
 */

const page = vi.hoisted(() => ({ locale: "en" as "en" | "ar" }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key, locale: page.locale }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Tarek Nabil", email: "tarek@example.com" } } }) }))

const OPENED = "2026-11-07T10:23:00.000Z"
// Intl puts a narrow no-break space before "pm" in some Node versions.
const spaced = (s: string) => s.replace(/[  ]/g, " ")

const zone = process.env.TZ
afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
    vi.useRealTimers()
    page.locale = "en"
})

/** What the watermark says when the photos open at 10:23 UTC on 7 Nov 2026, in a browser in `tz`. */
async function markAt(tz: string, locale: "en" | "ar") {
    process.env.TZ = tz
    page.locale = locale
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(OPENED))
    const { useWatermark } = await import("@/components/FacePhoto")
    let mark: ReturnType<typeof useWatermark> | undefined
    const Probe = () => {
        mark = useWatermark()
        return null
    }
    renderToStaticMarkup(h(Probe))
    if (!mark) throw new Error("the watermark wasn't read")
    return mark
}

describe("the watermark over face photos", () => {
    it("has the viewer's name, and the time on their own clock", async () => {
        const cairo = await markAt("Africa/Cairo", "en")
        expect(cairo.who).toBe("Tarek Nabil")
        // 10:23 UTC is 12:23 in Cairo: it was "2026-11-07 10:23", UTC with nothing to say so.
        expect(spaced(cairo.when).startsWith("7 Nov 2026")).toBe(true)
        expect(spaced(cairo.when).endsWith("12:23 pm")).toBe(true)
        // The same moment, seen from a browser in Los Angeles.
        const losAngeles = await markAt("America/Los_Angeles", "en")
        expect(spaced(losAngeles.when).endsWith("2:23 am")).toBe(true)
    })

    it("is written as a date and a time are, in the page's digits in Arabic", async () => {
        const mark = await markAt("Africa/Cairo", "ar")
        expect(mark.who).toBe("Tarek Nabil")
        process.env.TZ = "Africa/Cairo"
        expect(mark.when).toBe(dateTimeText(OPENED, "ar"))
        expect(spaced(mark.when).startsWith("٧ نوفمبر ٢٠٢٦")).toBe(true)
        expect(spaced(mark.when).endsWith("١٢:٢٣ م")).toBe(true)
        expect(mark.when).not.toMatch(/[0-9]/)
    })

    it("puts the time under the name, three times, with no dot between them", async () => {
        const { FacePhoto } = await import("@/components/FacePhoto")
        const html = renderToStaticMarkup(h(FacePhoto, { src: "/x", label: "New photo", mark: { who: "Tarek Nabil", when: "7 Nov 2026, 12:23 pm" } }))
        // The name isolated, so a Latin name ending in a bracket reads the same in Arabic (§3.3).
        const one = "<span><bdi>Tarek Nabil</bdi><span>7 Nov 2026, 12:23 pm</span></span>"
        expect(html.split(one).length - 1).toBe(3)
        expect(html).not.toContain("·")
        // One under the other, each in the middle.
        const css = readFileSync("components/ui/ui.css", "utf8")
        const start = css.indexOf("\n.ui-face-photo-marks > span {")
        const marks = css.slice(start, css.indexOf("}", start))
        expect(marks).toContain("display: grid;")
        expect(marks).toContain("justify-items: center;")
    })

    it("is said by lib/calendar-text.ts, not put together by hand, for every face photo", () => {
        const photo = readFileSync("components/FacePhoto.tsx", "utf8")
        expect(photo).toContain("dateTimeText(openedAt, locale)")
        expect(photo).not.toContain("toISOString().slice")
        expect(photo).not.toContain(" · ")
        // A flagged check-in's photos, and a face check's review.
        expect(photo).toContain("const mark = useWatermark()")
        const review = readFileSync("app/(dashboard)/dashboard/attendance/FaceTab.tsx", "utf8")
        expect(review).toContain("const mark = useWatermark()")
        expect(review.match(/<Photo [^>]*mark=\{mark\} \/>/g)).toHaveLength(2)
    })
})
