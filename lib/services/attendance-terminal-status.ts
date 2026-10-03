import { prisma } from "@/lib/prisma"
import { calendarDateStr, DEFAULT_TIME_ZONE } from "@/lib/time"
import { workWeekOn } from "@/lib/attendance/policy"
import { agentHealth, deviceHealth, inWorkingHours } from "@/lib/attendance/terminal-health"
import { AttendancePolicyService } from "./attendance-policy.service"

/**
 * Whether a company's terminals should be heard from now (ATTENDANCE_PLAN.md
 * §13.2): working hours on one of its working days, in its own time zone.
 */
export async function workingNow(companyId: string, now = new Date()): Promise<boolean> {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
    const timeZone = company?.timezone ?? DEFAULT_TIME_ZONE
    const policies = await AttendancePolicyService.versions(companyId)
    return inWorkingHours(now, timeZone, workWeekOn(policies, calendarDateStr(now, timeZone)))
}

/**
 * Every company's agents and terminals, worst first, for the Super Admin's
 * System Health page: the same health the company's own tab shows.
 */
export async function terminalsOverview(now = new Date()) {
    const companies = await prisma.company.findMany({
        where: { attendanceAgents: { some: { status: { not: "REVOKED" } } } },
        select: {
            id: true, name: true,
            attendanceAgents: { where: { status: { not: "REVOKED" } }, select: { id: true, name: true, status: true, lastSeenAt: true, lastSyncAt: true, agentVersion: true, queueDepth: true, clockDriftSeconds: true }, orderBy: { name: "asc" } },
            attendanceDevices: { where: { retiredAt: null }, select: { retiredAt: true, reachable: true, lastSeenAt: true, recordCount: true, recordCapacity: true, clockDriftSeconds: true } },
        },
        orderBy: { name: "asc" },
    })
    const rows = await Promise.all(companies.map(async c => {
        const working = await workingNow(c.id, now)
        const agents = c.attendanceAgents.map(a => ({ ...a, health: agentHealth(a, now, working) }))
        const devices = c.attendanceDevices.map(d => deviceHealth(d, now, working))
        const terminals = {
            total: devices.length,
            ok: devices.filter(d => d.state === "OK").length,
            unreachable: devices.filter(d => d.state === "UNREACHABLE").length,
            silent: devices.filter(d => d.state === "SILENT").length,
            memoryFull: devices.filter(d => d.memoryFull).length,
            clockOff: devices.filter(d => d.clockOff).length,
        }
        const bad = agents.some(a => a.health === "SILENT") || terminals.unreachable + terminals.silent > 0
        const warn = terminals.memoryFull + terminals.clockOff > 0 || agents.some(a => (a.queueDepth ?? 0) > 0 && a.health !== "OK")
        return { companyId: c.id, name: c.name, working, tone: bad ? "bad" as const : warn ? "warn" as const : "ok" as const, agents, terminals }
    }))
    const rank = { bad: 0, warn: 1, ok: 2 }
    return rows.sort((a, b) => rank[a.tone] - rank[b.tone] || a.name.localeCompare(b.name))
}
