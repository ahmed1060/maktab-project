import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { isDateString, spanOf, toDateString } from "@/lib/attendance/calendar"
import { policyBodySchema, policyProblem, type PolicyBody, type PolicyVersion } from "@/lib/attendance/policy"
import { AttendanceCalendarService, serialize } from "./attendance-calendar.service"
import { AuditLogService } from "./audit-log.service"

/**
 * A company's attendance policy, version by version (ATTENDANCE_PLAN.md §6.1),
 * and the templates it can start from (§6.8). Access is the caller's: the
 * company's Attendance settings tab for the policy, the Super Admin for
 * templates.
 *
 * The rule the calendar keeps applies here too: nothing changes inside a
 * month whose payroll is approved or paid, counting every month a version
 * governs up to the next one, not just the month it starts in.
 */

/** The dates of a company's other versions, read under the company's policy lock. */
async function otherDates(tx: Prisma.TransactionClient, companyId: string, except: string) {
    await serialize(tx, `policy:${companyId}`)
    const rows = await tx.attendancePolicy.findMany({ where: { companyId }, select: { effectiveFrom: true } })
    return rows.map(r => toDateString(r.effectiveFrom)).filter(d => d !== except)
}

const DATE_ONLY = (date: string) => new Date(`${date}T00:00:00Z`)

function fail(code: string): never {
    throw new Error(code)
}

/** A stored body read back through the schema, so a hand-edited row cannot reach the engine malformed. */
function parseBody(body: unknown): PolicyBody {
    const parsed = policyBodySchema.safeParse(body)
    if (!parsed.success) fail("POLICY_INVALID")
    return parsed.data
}

function checkBody(body: unknown): PolicyBody {
    const parsed = policyBodySchema.safeParse(body)
    if (!parsed.success) fail("POLICY_INVALID")
    const problem = policyProblem(parsed.data)
    if (problem) fail(problem)
    return { ...parsed.data, workWeek: [...new Set(parsed.data.workWeek)].sort() }
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

export class AttendancePolicyService {
    /** Every version, oldest first, each parsed. */
    static async versions(companyId: string): Promise<(PolicyVersion & { appliedTemplateId: string | null; createdAt: Date })[]> {
        const rows = await prisma.attendancePolicy.findMany({ where: { companyId }, orderBy: { effectiveFrom: "asc" } })
        return rows.map(r => ({
            id: r.id,
            effectiveFrom: toDateString(r.effectiveFrom),
            body: parseBody(r.body),
            appliedTemplateId: r.appliedTemplateId,
            createdAt: r.createdAt,
        }))
    }

    /**
     * A new version from a date. A version not yet in force may be replaced by
     * saving again on its date; one already in force stays, and a change to it
     * is a new version from a later date.
     */
    static async saveVersion(
        companyId: string,
        input: { effectiveFrom: string; body: unknown; appliedTemplateId?: string | null },
        actorId: string,
    ) {
        if (!isDateString(input.effectiveFrom)) fail("INVALID_DATE")
        const body = checkBody(input.body)
        const today = await AttendanceCalendarService.today(companyId)

        return prisma.$transaction(async tx => {
            const dates = await otherDates(tx, companyId, input.effectiveFrom)
            await AttendanceCalendarService.assertSpanUnlocked(companyId, spanOf(dates, input.effectiveFrom), tx)
            const key = { companyId_effectiveFrom: { companyId, effectiveFrom: DATE_ONLY(input.effectiveFrom) } }
            const existing = await tx.attendancePolicy.findUnique({ where: key })
            if (existing && input.effectiveFrom <= today) fail("VERSION_DATE_TAKEN")
            const template = input.appliedTemplateId
                ? await tx.policyTemplate.findUnique({ where: { id: input.appliedTemplateId }, select: { id: true, name: true } })
                : null
            if (input.appliedTemplateId && !template) fail("TEMPLATE_NOT_FOUND")
            const data = { body: body as Prisma.InputJsonValue, appliedTemplateId: template?.id ?? null, createdById: actorId }
            const saved = existing
                ? await tx.attendancePolicy.update({ where: key, data })
                : await tx.attendancePolicy.create({ data: { companyId, effectiveFrom: DATE_ONLY(input.effectiveFrom), ...data } })
            await AuditLogService.log(existing ? "UPDATE_ATTENDANCE_POLICY" : "CREATE_ATTENDANCE_POLICY", "ATTENDANCE_POLICY", saved.id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, effectiveFrom: input.effectiveFrom, ...(template ? { template: template.name } : {}) },
            })
            return { id: saved.id, effectiveFrom: input.effectiveFrom, body }
        })
    }

    static async versionOf(versionId: string) {
        return prisma.attendancePolicy.findUnique({ where: { id: versionId }, select: { id: true, companyId: true, effectiveFrom: true } })
    }

    /** Withdraws a version payroll has not locked. Without any, days are measured but not priced. */
    static async deleteVersion(versionId: string, actorId: string) {
        const version = await this.versionOf(versionId) ?? fail("VERSION_NOT_FOUND")
        const effectiveFrom = toDateString(version.effectiveFrom)
        await prisma.$transaction(async tx => {
            // Withdrawing hands this version's span to the one before it.
            const dates = await otherDates(tx, version.companyId, effectiveFrom)
            await AttendanceCalendarService.assertSpanUnlocked(version.companyId, spanOf(dates, effectiveFrom), tx)
            await tx.attendancePolicy.delete({ where: { id: versionId } })
            await AuditLogService.log("DELETE_ATTENDANCE_POLICY", "ATTENDANCE_POLICY", versionId, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: version.companyId, effectiveFrom },
            })
        })
    }

    // --- templates (§6.8) -----------------------------------------------------

    static async templates() {
        const rows = await prisma.policyTemplate.findMany({ orderBy: { name: "asc" } })
        return rows.map(t => ({ id: t.id, name: t.name, nameAr: t.nameAr, description: t.description, body: parseBody(t.body) }))
    }

    static async createTemplate(input: { name: string; nameAr?: string | null; description?: string | null; body: unknown }, superAdminId: string) {
        const name = input.name.trim()
        if (!name) fail("TEMPLATE_NAME_REQUIRED")
        const body = checkBody(input.body)
        if (await prisma.policyTemplate.findUnique({ where: { name } })) fail("TEMPLATE_NAME_TAKEN")
        const created = await prisma.policyTemplate.create({
            data: { name, nameAr: input.nameAr?.trim() || null, description: input.description?.trim() || null, body: body as Prisma.InputJsonValue },
        })
        await AuditLogService.log("CREATE_POLICY_TEMPLATE", "POLICY_TEMPLATE", created.id, { superAdminId, details: { name } })
        return { id: created.id, name, nameAr: created.nameAr, description: created.description, body }
    }

    /** A template edit changes no company: applying copied it (§6.8). */
    static async updateTemplate(id: string, input: { name: string; nameAr?: string | null; description?: string | null; body: unknown }, superAdminId: string) {
        const existing = await prisma.policyTemplate.findUnique({ where: { id } }) ?? fail("TEMPLATE_NOT_FOUND")
        const name = input.name.trim()
        if (!name) fail("TEMPLATE_NAME_REQUIRED")
        const body = checkBody(input.body)
        const clash = await prisma.policyTemplate.findUnique({ where: { name } })
        if (clash && clash.id !== id) fail("TEMPLATE_NAME_TAKEN")
        await prisma.policyTemplate.update({
            where: { id },
            data: { name, nameAr: input.nameAr?.trim() || null, description: input.description?.trim() || null, body: body as Prisma.InputJsonValue },
        })
        await AuditLogService.log("UPDATE_POLICY_TEMPLATE", "POLICY_TEMPLATE", id, {
            superAdminId, details: { name: existing.name === name ? name : { from: existing.name, to: name } },
        })
        return { id, name, body }
    }

    static async deleteTemplate(id: string, superAdminId: string) {
        const existing = await prisma.policyTemplate.findUnique({ where: { id } }) ?? fail("TEMPLATE_NOT_FOUND")
        await prisma.policyTemplate.delete({ where: { id } })
        await AuditLogService.log("DELETE_POLICY_TEMPLATE", "POLICY_TEMPLATE", id, { superAdminId, details: { name: existing.name } })
    }
}
