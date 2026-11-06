import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { BellIcon, CalendarBlankIcon, UserCircleIcon } from "@phosphor-icons/react/ssr"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { ITEM_ICONS } from "./side-bar-icons"

/**
 * The bell's panel (DESIGN.md §5.1), as the mock-up of the app's frame the
 * product owner approved on 2026-11-05 draws it: 380px, Mark all as read at
 * its top, and each notification a link with its subject's icon, what it
 * says and how long ago, tinted with a dot while unread.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
const raw = readFileSync("components/ui/ui.css", "utf8")
const css = stripComments(raw)
// The panel's own rules, from its first to the marker at their end.
const block = stripComments(raw.slice(raw.indexOf("\n.ui-bell {"), raw.indexOf("/* end of the bell's panel */")))
const rule = (selector: string, from = css) => {
    const at = from.indexOf(`\n${selector} {`)
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
    return from.slice(at, from.indexOf("}", at))
}
const BELL = "components/NotificationBell.tsx"
const source = () => stripComments(readFileSync(BELL, "utf8"))

// 6 Nov 2026, noon UTC: far enough from midnight that a day is the same day in Cairo.
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000

const notice = (over: Record<string, unknown> = {}) => ({
    id: "n1", type: "TASK_ASSIGNED", message: "A task for you", messageKey: null, messageParams: null,
    read: false, priority: "NORMAL", userId: "u1", superAdminId: null, relatedId: "t1", createdAt: ago(10 * MIN), ...over,
})

describe("where a notification leads", () => {
    const target = async (over: Record<string, unknown>) => (await import("@/lib/notice-target")).noticeTarget(notice(over) as never)

    it("is the page of what it's about, as the bell's rows led", async () => {
        expect(await target({ type: "TASK_ASSIGNED", relatedId: "t1" })).toBe("/dashboard/tasks?highlight=t1")
        expect(await target({ type: "OBLIGATION_APPROVED", relatedId: "o1" })).toBe("/dashboard/obligations?highlight=o1")
        expect(await target({ type: "DAY_OFF_RESULT", relatedId: "d1" })).toBe("/dashboard/requests?kind=dayOff&highlight=d1")
        expect(await target({ type: "PROFILE_UPDATE_REJECTED", relatedId: "p1" })).toBe("/dashboard/requests?kind=nameChange&highlight=p1")
        expect(await target({ type: "NEW_REQUEST", relatedId: "q1" })).toBe("/dashboard/requests?highlight=q1")
        expect(await target({ type: "REQUEST_STATUS_UPDATED", relatedId: "q2" })).toBe("/dashboard/requests?highlight=q2")
        expect(await target({ type: "BONUS_ADDED", relatedId: "b1", userId: "u9" })).toBe("/dashboard/employees/u9/history?highlight=b1")
        expect(await target({ type: "DEDUCTION_ADDED", relatedId: "b2", userId: "u9" })).toBe("/dashboard/employees/u9/history?highlight=b2")
    })

    it("is the page an attendance notice names, before the other requests'", async () => {
        expect(await target({ type: "ATTENDANCE_REQUEST", relatedId: "r1", messageKey: "notice_att_permission_approved" })).toBe("/dashboard/requests?kind=permission&highlight=r1")
        expect(await target({ type: "ATTENDANCE_CHECK_IN", relatedId: "c1" })).toBe("/dashboard/attendance")
        expect(await target({ type: "ATTENDANCE_PHONE", relatedId: "/dashboard/requests?tab=review&kind=phone" })).toBe("/dashboard/requests?tab=review&kind=phone")
    })

    it("is the page a notice names itself, a note's with it picked out", async () => {
        expect(await target({ type: "ROLE_CHANGE_DONE", relatedId: "/dashboard/roles-and-access" })).toBe("/dashboard/roles-and-access")
        expect(await target({ type: "SUBSCRIPTION_EXPIRY", relatedId: "/dashboard/companies/c1" })).toBe("/dashboard/companies/c1")
        expect(await target({ type: "TEAM_CHANGED", relatedId: "/dashboard/employees/u2" })).toBe("/dashboard/employees/u2")
        expect(await target({ type: "NOTE_REMINDER", id: "n7", relatedId: "/dashboard/records/r1" })).toBe("/dashboard/records/r1?highlight=n7")
        expect(await target({ type: "NOTE_EXPIRING", id: "n7", relatedId: "/dashboard/records/r1?tab=notes" })).toBe("/dashboard/records/r1?tab=notes&highlight=n7")
        expect(await target({ type: "NOTE_EXPIRING", id: "n7", relatedId: "/dashboard/records/r1?noteId=x" })).toBe("/dashboard/records/r1?noteId=x")
    })

    it("is nowhere for one with nothing to open, or whose page isn't one of the app's", async () => {
        expect(await target({ type: "TASK_ASSIGNED", relatedId: null })).toBeNull()
        expect(await target({ type: "LATE_ARRIVAL", relatedId: "x" })).toBeNull()
        expect(await target({ type: "BONUS_ADDED", relatedId: "b1", userId: null })).toBeNull()
        expect(await target({ type: "ROLE_CHANGE_DONE", relatedId: "r1" })).toBeNull()
        // An address on another site, written as one of the app's: never followed.
        for (const away of ["//elsewhere.example/x", "/\\elsewhere.example"]) {
            expect(await target({ type: "ROLE_CHANGE_DONE", relatedId: away }), away).toBeNull()
            expect(await target({ type: "NOTE_REMINDER", relatedId: away }), away).toBeNull()
            expect(await target({ type: "ATTENDANCE_PHONE", relatedId: away }), away).toBeNull()
        }
    })

    it("keeps an id with odd characters inside the address", async () => {
        expect(await target({ type: "TASK_ASSIGNED", relatedId: "a b&c" })).toBe("/dashboard/tasks?highlight=a%20b%26c")
    })
})

describe("how long ago one came", () => {
    const age = async (iso: string, locale: "en" | "ar" = "en") => (await import("@/lib/notice-age")).noticeAge(iso, NOW, locale, locale === "ar" ? ar.notice_just_now : en.notice_just_now)
    const rtf = (locale: "en" | "ar") => new Intl.RelativeTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { numeric: "auto" })

    it("is Just now for the last minute, and for one the clock puts a little ahead", async () => {
        expect(await age(ago(30_000))).toBe("Just now")
        expect(await age(ago(-90_000))).toBe("Just now")
        expect(await age(ago(30_000), "ar")).toBe(ar.notice_just_now)
    })

    it("is in minutes, then hours, for the last day", async () => {
        expect(await age(ago(10 * MIN))).toBe("10 minutes ago")
        expect(await age(ago(59 * MIN + 50_000))).toBe("59 minutes ago")
        expect(await age(ago(HOUR))).toBe("1 hour ago")
        expect(await age(ago(3 * HOUR + 59 * MIN))).toBe("3 hours ago")
        expect(await age(ago(10 * MIN), "ar")).toBe(rtf("ar").format(-10, "minute"))
    })

    it("is Yesterday, then days, for the last week, and then its date", async () => {
        expect(await age(ago(26 * HOUR))).toBe("Yesterday")
        expect(await age(ago(4 * DAY))).toBe("4 days ago")
        expect(await age(ago(6 * DAY))).toBe("6 days ago")
        expect(await age(ago(8 * DAY))).toBe("29 Oct 2026")
        expect(await age(ago(26 * HOUR), "ar")).toBe(rtf("ar").format(-1, "day"))
        expect(await age(ago(8 * DAY), "ar")).toBe(new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(NOW - 8 * DAY))
    })

    it("gives the exact date and time, for the hover", async () => {
        const { noticeExactTime } = await import("@/lib/notice-age")
        expect(noticeExactTime(ago(0), "en")).toBe(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(NOW))
    })
})

describe("its icon", () => {
    const icon = async (type: string) => (await import("@/lib/notice-icon")).noticeIcon(type)

    it("is the side bar's where its subject has a page there", async () => {
        expect(await icon("ATTENDANCE_REQUEST")).toBe(ITEM_ICONS.attendance)
        expect(await icon("ATTENDANCE_FACE_REVIEW")).toBe(ITEM_ICONS.attendance)
        expect(await icon("LATE_ARRIVAL")).toBe(ITEM_ICONS.attendance)
        expect(await icon("TASK_SUBMITTED")).toBe(ITEM_ICONS.tasks)
        expect(await icon("OBLIGATION_APPROVED")).toBe(ITEM_ICONS.obligations)
        expect(await icon("BONUS_ADDED")).toBe(ITEM_ICONS.payroll)
        expect(await icon("DEDUCTION_ADDED")).toBe(ITEM_ICONS.payroll)
        expect(await icon("ROLE_CHANGE_FOR_SUPER_ADMIN")).toBe(ITEM_ICONS.rolesAndAccess)
        expect(await icon("SUBSCRIPTION_EXPIRY")).toBe(ITEM_ICONS.packages)
        expect(await icon("TEAM_CHANGED")).toBe(ITEM_ICONS.employees)
        expect(await icon("NOTE_REMINDER")).toBe(ITEM_ICONS.records)
        expect(await icon("NEW_REQUEST")).toBe(ITEM_ICONS.requests)
        expect(await icon("REQUEST_STATUS_UPDATED")).toBe(ITEM_ICONS.requests)
    })

    it("is a calendar for a day off, a person for a name change, and the bell for anything else", async () => {
        expect(await icon("DAY_OFF_REQUEST")).toBe(CalendarBlankIcon)
        expect(await icon("DAY_OFF_RESULT")).toBe(CalendarBlankIcon)
        expect(await icon("PROFILE_UPDATE")).toBe(UserCircleIcon)
        expect(await icon("SOMETHING_NEW")).toBe(BellIcon)
    })
})

describe("the panel", () => {
    const panel = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { NotificationsPanel } = await import("@/components/NotificationBell")
        return render(h(NotificationsPanel, { id: "p1", notices: [], status: "ready", now: NOW, onFollow: () => {}, onMarkAll: () => {}, onRetry: () => {}, ...props }), locale)
    }

    it("has Notifications at its top, and Mark all as read while there's one it can read", async () => {
        const html = await panel({ notices: [notice()] })
        expect(html).toMatch(/^<div id="p1" class="ui-notices"><div class="ui-notices-head"><h2 id="p1-title" tabindex="-1" class="ui-notices-title">Notifications<\/h2><button type="button" class="ui-btn ui-btn-quiet ui-btn-sm">Mark all as read<\/button><\/div>/)
        expect(html).toContain('<ul class="ui-notices-list" aria-labelledby="p1-title">')
        // None left to read, or only one to deal with now: no button.
        expect(await panel({ notices: [notice({ read: true })] })).not.toContain("Mark all as read")
        expect(await panel({ notices: [notice({ priority: "CRITICAL" })] })).not.toContain("Mark all as read")
    })

    it("has each notification as a link to what it's about, with its icon, what it says and when", async () => {
        const html = await panel({ notices: [notice({ read: true })] })
        expect(html).toMatch(/<li><a class="ui-notice" href="\/dashboard\/tasks\?highlight=t1"><span class="ui-notice-icon" aria-hidden="true"><svg[^>]*class="ui-icon"[^>]*>[\s\S]*?<\/svg><\/span><span class="ui-notice-main"><span class="ui-notice-text">A task for you<\/span><time class="ui-notice-time" dateTime="[^"]+" title="[^"]+">10 minutes ago<\/time><\/span><\/a><\/li>/)
    })

    it("tints an unread one, with a dot, and a screen reader hears Unread before it", async () => {
        const html = await panel({ notices: [notice()] })
        expect(html).toMatch(/<li data-unread="true"><a class="ui-notice" href="\/dashboard\/tasks\?highlight=t1"><span class="ui-notice-icon" aria-hidden="true">[\s\S]*?<\/span><span class="ui-notice-main"><span class="ui-visually-hidden">Unread, <\/span><span class="ui-notice-text">A task for you<\/span>[\s\S]*?<\/span><span class="ui-notice-dot" aria-hidden="true"><\/span><\/a><\/li>/)
        expect(await panel({ notices: [notice()] }, "ar")).toContain(`<span class="ui-visually-hidden">${ar.notification_unread} </span>`)
    })

    it("gives one to deal with now an overdue row's look, and one with nowhere to go no link", async () => {
        const html = await panel({ notices: [notice({ priority: "CRITICAL", type: "ATTENDANCE_FACE_REVIEW", relatedId: "/dashboard/attendance?tab=faces" }), notice({ id: "n2", type: "LATE_ARRIVAL", relatedId: null, read: true })] })
        expect(html).toContain('<li data-unread="true" data-tone="overdue"><a class="ui-notice" href="/dashboard/attendance?tab=faces">')
        expect(html).toMatch(/<li><div class="ui-notice"><span class="ui-notice-icon"/)
    })

    it("says what it says in the reader's language", async () => {
        const html = await panel({ notices: [notice({ messageKey: "no_notifications", message: "old English" })] }, "ar")
        expect(html).toContain(`<span class="ui-notice-text">${ar.no_notifications}</span>`)
        expect(html).toContain(">قبل ١٠ دقائق<")
    })

    it("says when there are none, while they're on their way, and when they didn't load, with Try again", async () => {
        expect(await panel({ notices: [] })).toContain('<p class="ui-notices-note">No notifications</p>')
        expect(await panel({ status: "loading" })).toContain('<p class="ui-notices-note" role="status">Loading…</p>')
        const failed = await panel({ status: "failed" })
        expect(failed).toContain('<div class="ui-notices-note" role="alert"><span>Notifications didn&#x27;t load</span><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">Try again</button></div>')
        expect(failed).not.toContain("<ul")
    })
})

describe("the bell", () => {
    it("opens and closes its panel without reading anything, and says which it controls", () => {
        const src = source()
        expect(src).toContain("aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={() => setIsOpen(open => !open)}")
        // Opening it read them all, before.
        expect(src).not.toContain("toggleOpen")
        expect(src).not.toContain("router.push")
    })

    it("reads one that's followed, at once on screen and on the server, but not one to deal with now", () => {
        const src = source()
        expect(src).toMatch(/const follow = \(n: Notice\) => \{\s*setIsOpen\(false\)\s*if \(n\.read \|\| pinned\(n\)\) return/)
        expect(src).toContain("mutate(current => readIn(current, x => x.id === n.id), { revalidate: false })")
        expect(src).toContain("fetch(`/api/notifications/${encodeURIComponent(n.id)}`, { method: 'PATCH', keepalive: true })")
    })

    it("reads the rest with Mark all as read, and moves the focus to the heading as the button goes", () => {
        const src = source()
        expect(src).toMatch(/const markAll = \(\) => \{\s*mutate\(current => readIn\(current, x => !pinned\(x\)\), \{ revalidate: false \}\)\s*headingRef\.current\?\.focus\(\)\s*fetch\('\/api\/notifications', \{ method: 'PATCH' \}\)/)
    })

    it("puts back what the server has when a read fails", () => {
        expect(source().match(/\.then\(r => \{ if \(!r\.ok\) mutate\(\) \}, \(\) => mutate\(\)\)/g)).toHaveLength(2)
    })

    it("closes with Escape from anywhere in it, giving the focus back, and on a click outside or the focus leaving it", () => {
        const src = source()
        expect(src).toMatch(/onKeyDown=\{e => \{ if \(e\.key === 'Escape' && isOpen\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); close\(\) \} \}\}/)
        expect(src).toContain("const close = () => { setIsOpen(false); bellRef.current?.focus() }")
        expect(src).toContain("document.addEventListener('pointerdown', outside)")
        expect(src).toMatch(/onBlur=\{e => \{ if \(e\.relatedTarget && !box\.current\?\.contains\(e\.relatedTarget as Node\)\) setIsOpen\(false\) \}\}/)
    })

    it("leads each row with the shared addresses and icons, and keeps its time moving", () => {
        const src = source()
        expect(src).toContain("const href = noticeTarget(n)")
        expect(src).toContain("noticeIcon(n.type)")
        expect(src).toContain("const now = useNow()")
    })
})

describe("the server", () => {
    it("reads one notification of the person's own, never one to deal with now", () => {
        const service = stripComments(readFileSync("lib/services/notification.service.ts", "utf8"))
        const one = service.slice(service.indexOf("static async markAsRead("), service.indexOf("static async countUnread("))
        expect(one).toContain("where: { id, ...NotificationService.recipientFilter(principalId), read: false, priority: { not: \"CRITICAL\" } }")
        expect(one).toContain("data: { read: true }")
    })

    it("has the address the bell reads one at", () => {
        const route = stripComments(readFileSync("app/api/notifications/[id]/route.ts", "utf8"))
        expect(route).toContain("export const PATCH = withStandardHandler(async (_req, session, _json, context) => {")
        expect(route).toContain("await NotificationService.markAsRead(session.user.id, context.params.id)")
    })
})

describe("its look", () => {
    it("is 380px under the bar from the bell's end edge, drawn as the menus are", () => {
        const p = rule(".ui-notices")
        for (const part of ["position: absolute;", "inset-block-start: calc(100% + var(--space-2));", "inset-inline-end: 0;", "inline-size: 380px;", "background: var(--panel-raised);", "border: 1px solid var(--rule);", "border-radius: var(--radius-menu);", "box-shadow: var(--elev-2);"]) expect(p, part).toContain(part)
        expect(rule(".ui-bell")).toContain("position: relative;")
    })

    it("has its heading at --text-lg over a hairline, and scrolls its rows under it", () => {
        expect(rule(".ui-notices-title")).toContain("font-size: var(--text-lg);")
        expect(rule(".ui-notices-head")).toContain("border-block-end: 1px solid var(--rule);")
        const list = rule(".ui-notices-list")
        for (const part of ["max-block-size: min(480px, calc(100vh - 160px));", "overflow-y: auto;", "overscroll-behavior: contain;"]) expect(list, part).toContain(part)
        expect(rule(".ui-notices-list > li")).toContain("border-block-end: 1px solid var(--rule);")
    })

    it("draws each row with a 32px circle, what it says in --ink, and when in --muted", () => {
        const icon = rule(".ui-notice-icon")
        for (const part of ["inline-size: 32px;", "block-size: 32px;", "background: var(--status-neutral-bg);", "color: var(--status-neutral-fg);"]) expect(icon, part).toContain(part)
        expect(rule(".ui-notice-text")).toContain("color: var(--ink);")
        expect(rule(".ui-notice-time")).toContain("color: var(--muted);")
        expect(rule(".ui-notice-time")).toContain("font-size: var(--text-sm);")
    })

    it("tints an unread one, its circle in the brand's colours, with an 8px --brand dot", () => {
        expect(rule('.ui-notices-list > li[data-unread]')).toContain("background: var(--brand-tint);")
        expect(css).toMatch(/\n\.ui-notices-list > li\[data-unread\] \.ui-notice-icon \{\s*background: var\(--brand-tint-strong\);\s*color: var\(--brand-text\);/)
        expect(rule('.ui-notices-list > li[data-unread] .ui-notice-text')).toContain("font-weight: 500;")
        const dot = rule(".ui-notice-dot")
        for (const part of ["inline-size: 8px;", "block-size: 8px;", "background: var(--brand);"]) expect(dot, part).toContain(part)
    })

    it("gives one to deal with now an overdue row's look", () => {
        const overdue = rule('.ui-notices-list > li[data-tone="overdue"]')
        expect(overdue).toContain("background: var(--overdue-row);")
        expect(overdue).toContain("border-inline-start: 3px solid var(--problem-text);")
    })

    it("gives its links a hover and a focus ring, and the bell the brand's tint while it's open", () => {
        expect(rule("a.ui-notice:hover")).toContain("background: var(--brand-tint);")
        expect(rule("a.ui-notice:focus-visible")).toContain("outline: 2px solid var(--brand-text);")
        const open = rule('.ui-bell .ui-topbar-button[aria-expanded="true"]')
        expect(open).toContain("background: var(--brand-tint);")
        expect(open).toContain("color: var(--brand-text);")
    })

    it("spans the bar on a phone, 8px in from its edges", () => {
        expect(block.length).toBeGreaterThan(100)
        const phone = block.slice(block.indexOf("@media (max-width: 1023px)"))
        expect(phone).toMatch(/\.ui-bell \{\s*position: static;/)
        expect(phone).toMatch(/\.ui-notices \{\s*inset-inline: var\(--space-2\);\s*inline-size: auto;/)
    })

    it("answers a tap at once, as the building blocks' other controls do", () => {
        const touch = css.slice(0, css.indexOf("touch-action: manipulation;"))
        expect(touch.slice(touch.lastIndexOf("}") + 1)).toContain(".ui-notice")
    })
})

describe("its words", () => {
    it("are in both languages, and the Arabic asks nothing of a man or a woman", () => {
        expect([en.notifications_mark_all_read, en.notification_unread, en.notice_just_now, en.notifications_load_failed]).toEqual(["Mark all as read", "Unread,", "Just now", "Notifications didn't load"])
        expect([ar.notifications_mark_all_read, ar.notification_unread, ar.notice_just_now, ar.notifications_load_failed]).toEqual(["تحديد الكل كمقروء", "غير مقروء،", "الآن", "لم يتم تحميل التنبيهات"])
    })
})
