import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { calendarDateStr, calendarParts, DEFAULT_TIME_ZONE } from "@/lib/time"
import { noticeRow } from "@/lib/notice-row"
import type { NoticeText } from "@/lib/notice"
import { holdersOf } from "@/lib/permissions/holders"
import { exposedTabs } from "@/lib/company-settings-access"
import { hasBundle, resolveBundles, type PackageFacts } from "@/lib/features/bundles"
import { SILENT_AFTER_MINUTES } from "@/lib/attendance/terminal-health"
import { workingNow } from "./attendance-terminal-status"

/**
 * A terminal nobody hears from during working hours is a decision for a
 * person (ATTENDANCE_PLAN.md §13.4): scans are not arriving, and every hour
 * of it is a day someone will have to correct by hand. So it raises a
 * CRITICAL notification, which stays red at the top of the bell until the
 * agent or terminal is heard from again, and then goes by itself.
 *
 * Checked after someone's bell has asked for its notifications, rather than
 * by a cron job: an in-app notice is only seen by someone looking, and the
 * bell of anyone looking asks every few minutes. The agent or terminal
 * carries `alertedAt` while its silence lasts. Each check, under a lock on
 * it, gives a notice to whoever should have one now and has none — so the
 * first check raises it once however many bells ask at the same moment, and
 * a later one reaches someone who has since come to look after terminals.
 */

export const TERMINAL_ALERT = "ATTENDANCE_TERMINAL"

const AT_WORK = ["ACTIVE", "OFFLINE"] as const

/** Not heard from since before this: an agent's heartbeat, or a terminal answering it. */
const silentSince = (cutoff: Date, firstField: "enrolledAt" | "firstSeenAt") => ({
    OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null, [firstField]: { lt: cutoff } }],
})

const heard = (lastSeenAt: Date | null, cutoff: Date) => !!lastSeenAt && lastSeenAt >= cutoff

/** Where the notice opens; it ends with the agent's or terminal's id, by which it is found again. */
const linkFor = (who: "company" | "platform", companyId: string, subjectId: string) =>
    who === "company"
        ? `/dashboard/settings?tab=attendance&highlight=${subjectId}`
        : `/dashboard/companies/${companyId}/settings?tab=attendance&highlight=${subjectId}`
const aboutSubject = (subjectId: string) => ({ type: TERMINAL_ALERT, priority: "CRITICAL" as const, read: false, relatedId: { endsWith: `highlight=${subjectId}` } })

const PACKAGE = { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } } as const
const COMPANY = { select: { id: true, name: true, timezone: true, adminSettingsEnabled: true, adminSettingsTabs: true, package: PACKAGE } } as const

type Company = { id: string; name: string; timezone: string | null; adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: PackageFacts }
type Recipients = { who: "company" | "platform"; userIds: string[]; superAdminIds: string[] }

/** Whether the company still holds the Terminals add-on: without it, its agents are refused and nothing is expected of them. */
const holdsTerminals = (company: Pick<Company, "package">) => hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS")

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
                select: { id: true, name: true, status: true, lastSeenAt: true, enrolledAt: true, alertedAt: true, company: COMPANY },
            }),
            prisma.attendanceDevice.findMany({
                where: {
                    ...inScope,
                    OR: [{ alertedAt: { not: null } }, { retiredAt: null, alertedAt: null, agent: { status: "ACTIVE" }, ...silentSince(cutoff, "firstSeenAt") }],
                },
                select: {
                    id: true, name: true, retiredAt: true, lastSeenAt: true, firstSeenAt: true, alertedAt: true,
                    agent: { select: { name: true, status: true, lastSeenAt: true } },
                    company: COMPANY,
                },
            }),
        ])

        // What is silent now. A terminal only while its agent is heard: when
        // the agent is silent, so are all its terminals, and the agent's
        // notice says so in their place.
        const agentSilent = (a: (typeof agents)[number]) => a.status === "ACTIVE" && holdsTerminals(a.company) && !heard(a.lastSeenAt, cutoff)
        const deviceSilent = (d: (typeof devices)[number]) =>
            !d.retiredAt && d.agent?.status === "ACTIVE" && heard(d.agent.lastSeenAt, cutoff) && holdsTerminals(d.company) && !heard(d.lastSeenAt, cutoff)

        // Over: heard again, or no longer expected to be — revoked, retired,
        // the add-on gone, or a terminal now covered by its agent's notice.
        for (const a of agents) if (a.alertedAt && !agentSilent(a)) await TerminalAlerts.clear("agent", a.id)
        for (const d of devices) if (d.alertedAt && !deviceSilent(d)) await TerminalAlerts.clear("device", d.id)
        if (scope === "ALL") await TerminalAlerts.clearOrphans()

        // Raised, and kept reaching the right people, in working hours: when
        // scans should be arriving.
        const silentAgents = agents.filter(agentSilent)
        const silentDevices = devices.filter(deviceSilent)
        const companies = new Map<string, Company>()
        for (const x of [...silentAgents, ...silentDevices]) companies.set(x.company.id, x.company)

        await Promise.all([...companies.values()].map(async company => {
            if (!(await workingNow(company.id, now))) return
            const recipients = await TerminalAlerts.recipients(company)
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
        }))
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
     * look after, so the Super Admin is told.
     */
    private static async recipients(company: Company): Promise<Recipients> {
        if (exposedTabs(company).includes("attendance")) {
            const people = await prisma.user.findMany({ where: { companyId: company.id, status: { in: [...AT_WORK] }, ...holdersOf("settings.view") }, select: { id: true } })
            if (people.length > 0) return { who: "company", userIds: people.map(p => p.id), superAdminIds: [] }
        }
        const [table, platformUsers] = await Promise.all([
            prisma.superAdmin.findMany({ select: { id: true } }),
            prisma.user.findMany({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, select: { id: true } }),
        ])
        return { who: "platform", userIds: platformUsers.map(p => p.id), superAdminIds: table.map(p => p.id) }
    }

    private static async raise(kind: "agent" | "device", id: string, cutoff: Date, now: Date, to: Recipients, company: Company, text: NoticeText) {
        await prisma.$transaction(async tx => {
            // One check at a time per agent or terminal, and only while it is
            // still silent: two bells asking at once raise it once.
            const still = kind === "agent"
                ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "AttendanceAgent" WHERE id = ${id} AND status = 'ACTIVE' AND COALESCE("lastSeenAt", "enrolledAt") < ${cutoff} FOR UPDATE`
                : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "AttendanceDevice" WHERE id = ${id} AND "retiredAt" IS NULL AND COALESCE("lastSeenAt", "firstSeenAt") < ${cutoff} FOR UPDATE`
            if (still.length === 0) return
            if (kind === "agent") await tx.attendanceAgent.updateMany({ where: { id, alertedAt: null }, data: { alertedAt: now } })
            else await tx.attendanceDevice.updateMany({ where: { id, alertedAt: null }, data: { alertedAt: now } })

            // Whoever should be told now and has not been: everyone, the first
            // time; later, someone who has come to look after terminals since.
            const told = await tx.notification.findMany({ where: aboutSubject(id), select: { userId: true, superAdminId: true } })
            const toldUsers = new Set(told.map(n => n.userId))
            const toldAdmins = new Set(told.map(n => n.superAdminId))
            // The Super Admin looks after many companies: say which.
            const row = noticeRow(to.who === "platform" ? { key: "notice_att_in_company", params: { company: company.name, notice: text } } : text)
            const base = { type: TERMINAL_ALERT, priority: "CRITICAL" as const, ...row, relatedId: linkFor(to.who, company.id, id) }
            const data: Prisma.NotificationCreateManyInput[] = [
                ...to.userIds.filter(u => !toldUsers.has(u)).map(userId => ({ ...base, userId })),
                ...to.superAdminIds.filter(a => !toldAdmins.has(a)).map(superAdminId => ({ ...base, superAdminId })),
            ]
            if (data.length > 0) await tx.notification.createMany({ data })
        })
    }

    /** Over: the notices have done their job, and go. */
    private static async clear(kind: "agent" | "device", id: string) {
        await prisma.$transaction(async tx => {
            const cleared = kind === "agent"
                ? await tx.attendanceAgent.updateMany({ where: { id, alertedAt: { not: null } }, data: { alertedAt: null } })
                : await tx.attendanceDevice.updateMany({ where: { id, alertedAt: { not: null } }, data: { alertedAt: null } })
            if (cleared.count === 0) return
            await tx.notification.updateMany({ where: aboutSubject(id), data: { read: true } })
        })
    }

    /**
     * Notices about an agent or terminal that no longer exists: its company
     * was deleted. A company's own people went with it; the Super Admin's
     * notices would otherwise stay pinned for good.
     */
    private static async clearOrphans() {
        const open = await prisma.notification.findMany({ where: { type: TERMINAL_ALERT, priority: "CRITICAL", read: false }, select: { id: true, relatedId: true } })
        const subjectOf = (n: { relatedId: string | null }) => /highlight=([^&]+)$/.exec(n.relatedId ?? "")?.[1] ?? null
        const ids = [...new Set(open.map(subjectOf).filter((x): x is string => !!x))]
        if (ids.length === 0) return
        const [agents, devices] = await Promise.all([
            prisma.attendanceAgent.findMany({ where: { id: { in: ids } }, select: { id: true } }),
            prisma.attendanceDevice.findMany({ where: { id: { in: ids } }, select: { id: true } }),
        ])
        const exists = new Set([...agents, ...devices].map(x => x.id))
        const orphans = open.filter(n => !exists.has(subjectOf(n) ?? ""))
        if (orphans.length > 0) await prisma.notification.updateMany({ where: { id: { in: orphans.map(n => n.id) } }, data: { read: true } })
    }
}
