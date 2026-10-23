import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { renderNotice, roleParam, roleKindParam, optional, type NoticeText } from "./notice"
import { englishNotice, noticeRow } from "./notice-row"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

const tAr = (k: string) => (ar as Record<string, string>)[k] ?? ""
const arabic = (text: NoticeText) => renderNotice(text, tAr, iso => new Date(iso).toLocaleDateString("ar", { timeZone: "UTC" }))
const day = (s: string) => ({ date: new Date(s).toISOString() })
const d = (s: string) => new Date(s).toLocaleDateString()

describe("a notification's message, in either language", () => {
    it("fills in names, numbers, dates and labels", () => {
        expect(englishNotice({ key: "notice_role_request_asked", params: { by: "Huda Ali", person: "Omar Said", role: roleParam({ name: "Admin", builtIn: "ADMIN" }) } }))
            .toBe("Huda Ali asks to give Omar Said the role Admin.")
        expect(arabic({ key: "notice_role_request_asked", params: { by: "Huda Ali", person: "Omar Said", role: roleParam({ name: "Admin", builtIn: "ADMIN" }) } }))
            .toBe("يطلب Huda Ali منح Omar Said الدور مسؤول.")
        // A role the Super Admin made is named as they named it, in both.
        expect(arabic({ key: "notice_role_now", params: { role: roleParam({ name: "HR Officer", builtIn: null }) } })).toBe("دورك الآن HR Officer.")
    })

    it("shows what somebody typed as they typed it, even when it looks like a placeholder", () => {
        expect(englishNotice({ key: "notice_task_assigned", params: { title: "Fix {title} and {name}" } })).toBe("You have been assigned a new task: Fix {title} and {name}")
    })

    it("leaves out an optional part when there is nothing to say", () => {
        expect(englishNotice({ key: "notice_name_change_rejected", params: { note: optional("notice_note_suffix", { note: "" }, "") } }))
            .toBe("Your name change request has been rejected.")
        expect(arabic({ key: "notice_name_change_rejected", params: { note: optional("notice_note_suffix", { note: "اسم غير صحيح" }, "اسم غير صحيح") } }))
            .toBe("تم رفض طلب تغيير اسمك. ملاحظة: اسم غير صحيح")
    })

    it("names an account's kind as a word", () => {
        expect(englishNotice({ key: "notice_task_updated", params: { title: "Audit", role: roleKindParam("TEAM_LEADER"), name: "Karim" } })).toBe("Task \"Audit\" updated by Team Leader Karim.")
        expect(arabic({ key: "notice_task_updated", params: { title: "Audit", role: roleKindParam("SUPER_ADMIN"), name: "Karim" } })).toBe("حدّث مسؤول عام Karim المهمة \"Audit\".")
    })

    it("stores the key, the details and the English", () => {
        expect(noticeRow({ key: "notice_bonus_added", params: { amount: 2 } })).toEqual({
            message: "Congratulations! You have received a bonus of 2 days.",
            messageKey: "notice_bonus_added",
            messageParams: { amount: 2 },
        })
    })
})

/**
 * The English each call site wrote before it wrote a key, word for word, so
 * the switch changes nothing for an English reader. Two read better now, on
 * purpose: an account's kind reads "Admin", not "ADMIN", and a request's
 * status "In Progress", not "IN PROGRESS".
 */
const SAME_ENGLISH: [NoticeText, string][] = [
    [{ key: "notice_name_change_approved", params: { name: "Omar Said" } }, "Your name change request has been approved! Your name is now Omar Said."],
    [{ key: "notice_name_change_rejected", params: { note: optional("notice_note_suffix", { note: "Typo" }, "Typo") } }, "Your name change request has been rejected. Note: Typo"],
    [{ key: "notice_team_leader_now", params: { leader: "Karim Farid" } }, "Your team leader is now Karim Farid."],
    [{ key: "notice_team_leader_now", params: { leader: { key: "notice_someone_new" } } }, "Your team leader is now someone new."],
    [{ key: "notice_team_unassigned" }, "You are no longer assigned to a team leader. An administrator will assign you again."],
    [{ key: "notice_team_joined", params: { who: { key: "notice_people", params: { count: 3 } } } }, "3 people joined your team."],
    [{ key: "notice_team_left", params: { who: { key: "notice_someone" } } }, "Someone left your team."],
    [{ key: "notice_team_joined_left", params: { joined: "Omar Said", left: "Laila Fouad" } }, "Omar Said joined and Laila Fouad left your team."],
    [{ key: "notice_acting_held", params: { name: "Omar Said", reason: { key: "notice_acting_held_last_admin" } } }, "Omar Said's acting role has ended, but they cannot return yet: they are the company's only Admin at work."],
    [{ key: "notice_acting_held", params: { name: "Omar Said", reason: { key: "notice_acting_held_reports" } } }, "Omar Said's acting role has ended, but they cannot return yet: people still report to them."],
    [{ key: "notice_acting_ended", params: { role: "HR Officer" } }, "Your acting role HR Officer has ended."],
    [{ key: "notice_trial_ending", params: { company: "Cura" } }, "Cura's free trial ends within 24 hours and no payment has been recorded."],
    [{ key: "notice_grace_ending", params: { company: "Cura" } }, "Cura's grace period ends within 24 hours and no payment has been recorded."],
    [{ key: "notice_company_locked", params: { company: "Cura" } }, "Cura has been locked — the subscription expired and grace has run out."],
    [{ key: "notice_grace_started", params: { company: "Cura" } }, "Cura's subscription has expired and it is now in its grace period."],
    [{ key: "notice_subscription_expiring_operator", params: { company: "Cura", days: 3, date: day("2026-10-01T00:00:00Z") } }, `Subscription for Cura will expire in 3 day(s) (${d("2026-10-01T00:00:00Z")}).`],
    [{ key: "notice_subscription_expiring", params: { days: 3, date: day("2026-10-01T00:00:00Z") } }, `Your subscription expires in 3 day(s) (${d("2026-10-01T00:00:00Z")}). Please renew to avoid interruption.`],
    [{ key: "notice_access_review_ready", params: { count: 8 } }, "An access review is ready: 8 lines to confirm."],
    [{ key: "notice_task_assigned", params: { title: "Audit" } }, "You have been assigned a new task: Audit"],
    [{ key: "notice_task_submitted", params: { title: "Audit", name: "Omar" } }, "Task \"Audit\" has been submitted by Omar"],
    [{ key: "notice_task_transferred", params: { title: "Audit" } }, "You have been assigned a transferred task: Audit"],
    [{ key: "notice_task_reverted", params: { title: "Audit" } }, "Super Admin has reverted task \"Audit\" back to In Progress."],
    [{ key: "notice_task_imported", params: { title: "Audit" } }, "New task assigned: Audit"],
    [{ key: "notice_obligation_approved", params: { title: "Rent" } }, "Your obligation \"Rent\" has been approved."],
    [{ key: "notice_obligation_rejected", params: { title: "Rent" } }, "Your obligation \"Rent\" has been rejected."],
    [{ key: "notice_obligation_reverted", params: { title: "Rent" } }, "Super Admin has reverted obligation \"Rent\" back to In Progress."],
    [{ key: "notice_obligation_recurred", params: { title: "Rent" } }, "New recurrent instance of \"Rent\" has been created."],
    [{ key: "notice_role_change_asked", params: { company: "Cura", what: { key: "notice_the_role", params: { role: "HR Officer" } } } }, "Cura asks for a change to the role HR Officer."],
    [{ key: "notice_role_change_asked", params: { company: "Cura", what: { key: "notice_its_roles" } } }, "Cura asks for a change to its roles."],
    [{ key: "notice_role_change_done", params: { response: " Added." } }, "Your request for a role change has been done. Added."],
    [{ key: "notice_role_change_declined", params: { response: "Not now" } }, "Your request for a role change was declined: Not now"],
    // Records now (CLIENTS_PLAN.md §0.2), no longer the old Clients section's notes.
    [{ key: "notice_note_expiring_today", params: { snippet: "Call the supplier a", client: "Acme" } }, "Record \"Call the supplier a...\" for Acme expires today."],
    [{ key: "notice_note_expiring", params: { snippet: "Call the supplier a", client: "Acme", days: 3 } }, "Record \"Call the supplier a...\" for Acme expires in 3 days."],
    [{ key: "notice_role_request_approved", params: { person: "Omar Said", role: "HR Officer" } }, "Omar Said now has the role HR Officer."],
    [{ key: "notice_role_request_declined", params: { person: "Omar Said", role: "HR Officer", note: "Not yet" } }, "Your request to give Omar Said the role HR Officer was declined: Not yet"],
    [{ key: "notice_role_request_waiting", params: { person: "Omar Said", role: "HR Officer" } }, "Still waiting for a decision: Omar Said for the role HR Officer."],
    [{ key: "notice_dayoff_requested", params: { name: "Omar", type: { key: "notice_dayoff_type_SICK" }, when: day("2026-10-04") } }, `Omar has requested a sick day off on ${d("2026-10-04")}.`],
    [{ key: "notice_dayoff_requested", params: { name: "Omar", type: { key: "notice_dayoff_type_REGULAR" }, when: { key: "notice_date_range", params: { from: day("2026-10-04"), to: day("2026-10-06") } } } }, `Omar has requested a regular day off on ${d("2026-10-04")} to ${d("2026-10-06")}.`],
    [{ key: "notice_dayoff_approved", params: { date: day("2026-10-04"), salary: optional("notice_dayoff_from_salary", {}, true) } }, `Your day off request for ${d("2026-10-04")} has been approved (deducted from salary).`],
    [{ key: "notice_dayoff_approved", params: { date: day("2026-10-04"), salary: optional("notice_dayoff_from_salary", {}, false) } }, `Your day off request for ${d("2026-10-04")} has been approved.`],
    [{ key: "notice_dayoff_rejected", params: { date: day("2026-10-04"), reason: optional("notice_reason_suffix", { reason: "Busy week" }, "Busy week") } }, `Your day off request for ${d("2026-10-04")} has been rejected. Reason: Busy week`],
    [{ key: "notice_dayoff_reevaluated", params: { date: day("2026-10-04"), from: 2, to: 1 } }, `Your day off request for ${d("2026-10-04")} has been re-evaluated. Adjusted from 2 to 1 days.`],
    [{ key: "notice_deduction_added", params: { amount: 1 } }, "A deduction of 1 days has been applied to your record."],
    [{ key: "notice_request_new", params: { name: "Omar", title: "Laptop" } }, "New request from Omar: Laptop"],
]

describe("the English is what it was", () => {
    it.each(SAME_ENGLISH)("%j", (text, before) => {
        expect(englishNotice(text)).toBe(before)
    })
})

describe("every message is in both languages", () => {
    const keys = Object.keys(en).filter(k => k.startsWith("notice_"))
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

    it("in Arabic, with the same details to fill in", () => {
        for (const key of keys) {
            const translated = (ar as Record<string, string>)[key]
            expect(translated, key).toBeTruthy()
            expect(holes(translated), key).toEqual(holes((en as Record<string, string>)[key]))
            expect(translated, key).not.toBe((en as Record<string, string>)[key])
        }
    })
})

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
        const path = join(dir, f)
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(path) && !path.includes(".test.") ? [path] : []
    })
}

describe("notifications are written with a key", () => {
    it("never with a finished sentence", () => {
        // NotificationService takes a NoticeText, so the compiler checks its
        // callers. This catches rows written directly, which must use noticeRow().
        const found: string[] = []
        for (const file of [...files("lib"), ...files("app")]) {
            const source = readFileSync(file, "utf8")
            if (!/notification\.create/.test(source)) continue
            source.split("\n").forEach((line, i) => {
                if (/\bmessage:\s*[`'"]/.test(line) && !line.includes("No expiring subscriptions found")) found.push(`${file}:${i + 1}: ${line.trim()}`)
            })
        }
        expect(found).toEqual([])
    })
})
