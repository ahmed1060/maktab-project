/**
 * A demo company whose payroll actually exercises the hard cases.
 *
 * The point is not to have data on screen. It is to have, in one company, every
 * shape the calculation has to get right — because each of these was argued
 * about in the plan and none of them can be checked by looking at a database
 * full of arbitrary numbers.
 *
 *   A leaver either side of payday, so the settlement falls one way for one and
 *   the other way for the other on the same salary.
 *   A mid-month raise, so a month splits and each half carries its own rate.
 *   A suspension ruled deductible, and one nobody has ruled on.
 *   Adjustments from all three sources, one of them filed against a past month.
 *
 * Every address is under a reserved TLD that cannot resolve, so nothing seeded
 * here can ever reach a person even if something tries to send to it.
 *
 *   npx tsx scripts/seed-payroll-demo.ts
 *   npx tsx scripts/seed-payroll-demo.ts --remove
 */
import { createScriptClient } from "../lib/prisma-script"
import bcrypt from "bcryptjs"
import { demoAddress, isUnroutableAddress } from "../lib/unroutable-address"
import { calendarMonth, startOfDayIn, DEFAULT_TIME_ZONE } from "../lib/time"
import { daysInMonth } from "../lib/payroll"
import { RoleService } from "../lib/services/role.service"
import { RoleAssignmentService } from "../lib/services/role-assignment.service"

const prisma = createScriptClient()

const COMPANY_NAME = "Nizmo Demo"

/**
 * The day the demo company pays on.
 *
 * Provisional: the real column lands on Company in P8. Until then the demo
 * states its assumption rather than pretending not to have one, because the
 * whole point of the two leavers is which side of this day they fall.
 */
const PAYROLL_DAY = 25

/** A password nobody can sign in with by guessing, for accounts nobody signs in to. */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || "demo-only-not-a-login-2026"

const TZ = DEFAULT_TIME_ZONE

/** A local wall-clock date in the company's calendar, as the instant it is. */
function localDay(year: number, month: number, day: number): Date {
    return startOfDayIn(new Date(Date.UTC(year, month - 1, day, 12)), TZ)
}

type Person = {
    key: string
    firstName: string
    lastName: string
    role: "ADMIN" | "TEAM_LEADER" | "EMPLOYEE"
    salary: number
    /** What this person exists to demonstrate. */
    demonstrates: string
}

const PEOPLE: Person[] = [
    { key: "mona", firstName: "Mona", lastName: "Fahmy", role: "ADMIN", salary: 24_000, demonstrates: "An ordinary full month, for comparison." },
    { key: "tarek", firstName: "Tarek", lastName: "Selim", role: "TEAM_LEADER", salary: 18_000, demonstrates: "A raise mid-month, so the month splits and each half carries its own rate." },
    { key: "sara", firstName: "Sara", lastName: "Kamal", role: "EMPLOYEE", salary: 12_000, demonstrates: "Leaves before payday: the company owes the days worked." },
    { key: "youssef", firstName: "Youssef", lastName: "Adel", role: "EMPLOYEE", salary: 12_000, demonstrates: "Leaves after payday: owes back the days paid for and not worked." },
    { key: "hala", firstName: "Hala", lastName: "Nour", role: "EMPLOYEE", salary: 15_000, demonstrates: "A suspension ruled deductible, and a second nobody has ruled on." },
]

async function remove() {
    const company = await prisma.company.findUnique({ where: { name: COMPANY_NAME } })
    if (!company) {
        console.log(`No company named "${COMPANY_NAME}". Nothing to remove.`)
        return
    }

    // Guard, not decoration. Deleting a company cascades to its people, their
    // pay and their history — so before that runs, prove that every account
    // under it is a seeded one. A real company that happened to be named this
    // would be removed by a script whose whole purpose is to be safe.
    const users = await prisma.user.findMany({ where: { companyId: company.id }, select: { email: true } })
    const real = users.filter(u => !isUnroutableAddress(u.email))
    if (real.length > 0) {
        throw new Error(
            `Refusing to remove "${COMPANY_NAME}": ${real.length} account(s) have routable email addresses, ` +
            `so this is not purely seeded data.`
        )
    }

    await prisma.company.delete({ where: { id: company.id } })
    console.log(`Removed "${COMPANY_NAME}" and ${users.length} seeded account(s).`)
}

async function seed() {
    const now = new Date()
    const { month, year } = calendarMonth(now, TZ)
    const length = daysInMonth(year, month)

    const previous = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year }

    const existing = await prisma.company.findUnique({ where: { name: COMPANY_NAME } })
    if (existing) {
        console.log(`"${COMPANY_NAME}" already exists. Run with --remove first if you want it rebuilt.`)
        return
    }

    // With its built-in roles, as every company is created — nobody can be
    // added to a company that has none.
    const company = await prisma.company.create({ data: { name: COMPANY_NAME } })
    await RoleService.seedBuiltInRoles(prisma as any, company.id)
    const hashed = await bcrypt.hash(DEMO_PASSWORD, 12)
    const ids: Record<string, string> = {}

    for (const person of PEOPLE) {
        const email = demoAddress(`${person.firstName}.${person.lastName}`)
        const user = await prisma.user.create({
            data: {
                email,
                username: `demo-${person.key}`,
                password: hashed,
                firstName: person.firstName,
                lastName: person.lastName,
                ...(await RoleAssignmentService.builtIn(prisma as any, person.role, company.id)),
                companyId: company.id,
                salary: person.salary,
                status: "OFFLINE",
                baseDayOffCredit: 21,
                dayOffCredit: 21,
                lastDayOffResetYear: year,
            },
        })
        ids[person.key] = user.id

        // The opening facts, at the epoch, matching what the migrations seed for
        // everybody else: one salary in force and one hire, so no month can
        // refuse to compute for want of a rate or a start.
        await prisma.salaryChange.create({
            data: {
                userId: user.id,
                monthlyAmount: person.salary,
                effectiveFrom: new Date(0),
                reason: "Demo opening salary",
            },
        })
        await prisma.employmentEvent.create({
            data: { userId: user.id, type: "HIRED", effectiveFrom: new Date(0), reason: "Demo hire" },
        })
    }

    // Tarek: a raise from the 16th, so this month splits into two segments and
    // each is valued at its own monthly rate over this month's own length.
    await prisma.salaryChange.create({
        data: {
            userId: ids.tarek,
            monthlyAmount: 22_000,
            effectiveFrom: localDay(year, month, 16),
            reason: "Promotion",
        },
    })
    await prisma.user.update({ where: { id: ids.tarek }, data: { salary: 22_000 } })

    // Sara leaves before payday, Youssef after. Same salary, same month: the
    // only difference is which side of the 25th the last working day falls, and
    // that alone decides who owes whom.
    const saraLastDay = PAYROLL_DAY - 5
    const youssefLastDay = Math.min(PAYROLL_DAY + 3, length - 1)

    for (const [key, lastWorkingDay] of [["sara", saraLastDay], ["youssef", youssefLastDay]] as const) {
        await prisma.employmentEvent.create({
            data: {
                userId: ids[key],
                type: "CONTRACT_ENDED",
                // The first instant they are no longer employed, so the last
                // working day is the day before.
                effectiveFrom: localDay(year, month, lastWorkingDay + 1),
                reason: "Demo leaver",
            },
        })
    }

    // Hala: one suspension ruled deductible, one still open and undecided —
    // the state the register has to be able to report rather than guess at.
    await prisma.employmentEvent.create({
        data: { userId: ids.hala, type: "SUSPENDED", effectiveFrom: localDay(year, month, 4), reason: "Demo: under review" },
    })
    await prisma.employmentEvent.create({
        data: {
            userId: ids.hala, type: "UNSUSPENDED", effectiveFrom: localDay(year, month, 7),
            deductSuspension: true, reason: "Demo: upheld, days deducted",
        },
    })
    await prisma.employmentEvent.create({
        data: { userId: ids.hala, type: "SUSPENDED", effectiveFrom: localDay(year, month, 20), reason: "Demo: second review, not yet decided" },
    })

    // Adjustments from each source, including one filed against last month —
    // the thing that could not be expressed at all before the period columns.
    const { SalaryService } = await import("../lib/services/salary.service")

    await SalaryService.applyAdjustment({
        userId: ids.mona, type: "BONUS", amount: 2,
        source: "MANUAL", reason: "Demo: covered a colleague's week",
    })
    await SalaryService.applyAdjustment({
        userId: ids.tarek, type: "DEDUCTION", amount: 1,
        source: "TASK_PENALTY", sourceId: "demo-task", reason: "Lateness Penalty Deduction",
    })
    await SalaryService.applyAdjustment({
        userId: ids.hala, type: "DEDUCTION", amount: 1.5,
        source: "DAY_OFF", sourceId: "demo-request", reason: "Day off deduction for request #demo-request",
    })
    await SalaryService.applyAdjustment({
        userId: ids.mona, type: "DEDUCTION", amount: 1,
        source: "MANUAL", reason: "Demo: agreed after the month closed",
        month: previous.month, year: previous.year,
    })

    console.log(`\nSeeded "${COMPANY_NAME}" for ${year}-${String(month).padStart(2, "0")} (payroll day ${PAYROLL_DAY}, assumed until P8):\n`)
    for (const person of PEOPLE) {
        console.log(`  ${person.firstName} ${person.lastName} — ${person.demonstrates}`)
    }
    console.log(`\n  Sara's last working day: ${saraLastDay} (before payday)`)
    console.log(`  Youssef's last working day: ${youssefLastDay} (after payday)`)
    console.log(`\nEvery address is under .invalid and cannot be delivered to.`)
}

async function main() {
    if (process.argv.includes("--remove")) return remove()
    return seed()
}

main()
    .catch(error => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
