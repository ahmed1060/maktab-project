import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { calendarDateStr, calendarParts, DEFAULT_TIME_ZONE } from "@/lib/time"
import { noticeRow } from "@/lib/notice-row"
import type { NoticeText } from "@/lib/notice"
import { holdersOf } from "@/lib/permissions/holders"
import { exposedTabs } from "@/lib/company-settings-access"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { SILENT_AFTER_MINUTES } from "@/lib/attendance/terminal-health"
import { workingNow } from "./attendance-terminal-status"

/**
 * A terminal nobody hears from during working hours is a decision for a
 * person (ATTENDANCE_PLAN.md §13.4): scans are not arriving, and every hour
 * of it is a day someone will have to correct by hand. So it raises a
 * CRITICAL notification, which stays red at the top of the bell until the
 * agent or terminal is heard from again, and then goes by itself.
 *
 * Checked whenever someone's bell asks for its notifications, rather than by
 * a cron job: an in-app notice is only seen by someone looking, and the bell
 * of anyone looking asks every few minutes. One notice per silence: the
 * agent or terminal carries `alertedAt` while it lasts, claimed with a
 * conditional update so two bells asking at once raise it once.
 */

export const TERMINAL_ALERT = "ATTENDANCE_TERMINAL"

const AT_WORK = ["ACTIVE", "OFFLINE"] as const

/** Not heard from since before this: an agent's heartbeat, or a terminal answering it. */
const silentSince = (cutoff: Date, firstField: "enrolledAt" | "firstSeenAt") => ({
    OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null, [firstField]: { lt: cutoff } }],
})

const heard = (lastSeenAt: Date | null, cutoff: Date) => !!lastSeenAt && lastSeenAt >= cutoff

/** Where the notice opens, and how it is found again when the silence ends. */
const linkFor = (who: "company" | "platform", companyId: string, subjectId: string) =>
    who === "company"
        ? `/dashboard/settings?tab=attendance&highlight=${subjectId}`
        : `/dashboard/companies/${companyId}/settings?tab=attendance&highlight=${subjectId}`

type Company = { id: string; name: string; timezone: string | null }

export class TerminalAlerts {
    /**
     * Raise what has gone silent and clear what has come back: for one
     * company, or for every company when the Super Admin's bell asks.
     */
    static async check(scope: { companyId: string } | "ALL", now = new Date()) {
        const cutoff = new Date(now.getTime() - SILENT_AFTER_MINUTES * 60_000)
        const inScope = scope === "ALL" ? {} : { companyId: scope.companyId }

        const [agents, devices] = await Promise.all([
            prisma.attendanceAgent.findMany({
                where: { ...inScope, OR: [{ alertedAt: { not: null } }, { status: "ACTIVE", alertedAt: null, ...silentSince(cutoff, "enrolledAt") }] },
                select: { id: true, name: true, status: true, lastSeenAt: true, enrolledAt: true, alertedAt: true, company: { select: { id: true, name: true, timezone: true } } },
            }),
            prisma.attendanceDevice.findMany({
                where: {
                    ...inScope,
                    OR: [{ alertedAt: { not: null } }, { retiredAt: null, alertedAt: null, agent: { status: "ACTIVE" }, ...silentSince(cutoff, "firstSeenAt") }],
                },
                select: {
                    id: true, name: true, retiredAt: true, lastSeenAt: true, firstSeenAt: true, alertedAt: true,
                    agent: { select: { name: true, status: true, lastSeenAt: true } },
                    company: { select: { id: true, name: true, timezone: true } },
                },
            }),
        ])

        // Back: heard again, or no longer expected to be (revoked, retired).
        for (const a of agents) {
            if (a.alertedAt && (a.status !== "ACTIVE" || heard(a.lastSeenAt, cutoff))) await TerminalAlerts.clear("agent", a.id)
        }
        for (const d of devices) {
            if (d.alertedAt && (d.retiredAt || d.agent?.status !== "ACTIVE" || heard(d.lastSeenAt, cutoff))) await TerminalAlerts.clear("device", d.id)
        }

        // Silent: raised only in working hours, when scans should be arriving.
        // A terminal is raised only while its agent is heard: when the agent
        // is silent, so are all of its terminals, and the agent's notice says so.
        const silentAgents = agents.filter(a => !a.alertedAt && a.status === "ACTIVE" && !heard(a.lastSeenAt, cutoff))
        const silentDevices = devices.filter(d => !d.alertedAt && !d.retiredAt && d.agent?.status === "ACTIVE" && heard(d.agent.lastSeenAt, cutoff) && !heard(d.lastSeenAt, cutoff))
        const companies = new Map<string, Company>()
        for (const x of [...silentAgents, ...silentDevices]) companies.set(x.company.id, x.company)

        for (const company of companies.values()) {
            if (!(await workingNow(company.id, now))) continue
            const recipients = await TerminalAlerts.recipients(company.id)
            if (!recipients) continue
            const timeZone = company.timezone ?? DEFAULT_TIME_ZONE
            for (const a of silentAgents.filter(x => x.company.id === company.id)) {
                await TerminalAlerts.raise("agent", a.id, cutoff, now, recipients, company, {
                    key: "notice_att_agent_silent",
                    params: { ...TerminalAlerts.since(a.lastSeenAt ?? a.enrolledAt ?? now, timeZone), agent: a.name },
                })
            }
            for (const d of silentDevices.filter(x => x.company.id === company.id)) {
                await TerminalAlerts.raise("device", d.id, cutoff, now, recipients, company, {
                    key: "notice_att_terminal_silent",
                    params: { ...TerminalAlerts.since(d.lastSeenAt ?? d.firstSeenAt, timeZone), terminal: d.name, agent: d.agent!.name },
                })
            }
        }
    }

    /** "since 08:40 on 2 Oct", in the company's own time. */
    private static since(at: Date, timeZone: string) {
        const { hour, minute } = calendarParts(at, timeZone)
        return { date: { date: calendarDateStr(at, timeZone) }, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` }
    }

    /**
     * Who is told: whoever in the company can open its terminals, which live
     * on the Attendance settings tab. A company whose tab the Super Admin has
     * not shown it, or with nobody holding settings, is the Super Admin's to
     * look after, so the Super Admin is told. Nobody, for a company that no
     * longer holds the Terminals add-on: its agents are refused anyway.
     */
    private static async recipients(companyId: string) {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { id: true, adminSettingsEnabled: true, adminSettingsTabs: true, package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } } },
        })
        if (!company || !hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS")) return null
        if (exposedTabs(company).includes("attendance")) {
            const people = await prisma.user.findMany({ where: { companyId, status: { in: [...AT_WORK] }, ...holdersOf("settings.view") }, select: { id: true } })
            if (people.length > 0) return { who: "company" as const, userIds: people.map(p => p.id), superAdminIds: [] as string[] }
        }
        const [table, platformUsers] = await Promise.all([
            prisma.superAdmin.findMany({ select: { id: true } }),
            prisma.user.findMany({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, select: { id: true } }),
        ])
        return { who: "platform" as const, userIds: platformUsers.map(p => p.id), superAdminIds: table.map(p => p.id) }
    }

    private static async raise(
        kind: "agent" | "device", id: string, cutoff: Date, now: Date,
        to: NonNullable<Awaited<ReturnType<typeof TerminalAlerts.recipients>>>, company: Company, text: NoticeText,
    ) {
        await prisma.$transaction(async tx => {
            // Still silent and not yet raised: two bells asking at once raise it once.
            const claimed = kind === "agent"
                ? await tx.attendanceAgent.updateMany({ where: { id, status: "ACTIVE", alertedAt: null, ...silentSince(cutoff, "enrolledAt") }, data: { alertedAt: now } })
                : await tx.attendanceDevice.updateMany({ where: { id, retiredAt: null, alertedAt: null, ...silentSince(cutoff, "firstSeenAt") }, data: { alertedAt: now } })
            if (claimed.count === 0) return
            // The Super Admin looks after many companies: say which.
            const row = noticeRow(to.who === "platform" ? { key: "notice_att_in_company", params: { company: company.name, notice: text } } : text)
            const base = { type: TERMINAL_ALERT, priority: "CRITICAL" as const, ...row, relatedId: linkFor(to.who, company.id, id) }
            const data: Prisma.NotificationCreateManyInput[] = [
                ...to.userIds.map(userId => ({ ...base, userId })),
                ...to.superAdminIds.map(superAdminId => ({ ...base, superAdminId })),
            ]
            if (data.length > 0) await tx.notification.createMany({ data })
        })
    }

    /** Heard again: the notice has done its job, and goes. */
    private static async clear(kind: "agent" | "device", id: string) {
        await prisma.$transaction(async tx => {
            const cleared = kind === "agent"
                ? await tx.attendanceAgent.updateMany({ where: { id, alertedAt: { not: null } }, data: { alertedAt: null } })
                : await tx.attendanceDevice.updateMany({ where: { id, alertedAt: { not: null } }, data: { alertedAt: null } })
            if (cleared.count === 0) return
            await tx.notification.updateMany({
                where: { type: TERMINAL_ALERT, priority: "CRITICAL", read: false, relatedId: { endsWith: `highlight=${id}` } },
                data: { read: true },
            })
        })
    }
}
