import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * Asking for a salary advance (LATER_CHANGES_PLAN.md §7.5, step 3a; DESIGN.md
 * §5.5, Asking for a salary advance), against a real Postgres built from the
 * migrations, with made-up people. Company One has Payroll (no package: every
 * module), its payroll closing on the month's last day, social insurance at
 * 10%, and the policy's defaults: 2 months' salary at most, 3 months worked
 * first, one at a time, 10% an installment, 25% all debts together, Block.
 * Two has a package without Payroll. The clock is 10:00 on 28 November 2026
 * in Cairo.
 *
 * - Ehab: hired 15 January, 10,000.00 a month, 9,000.00 net.
 * - Mona: hired 1 January, 10,000.00, social insurance not applied to her.
 * - Nour: hired 1 October, not 3 months yet.
 * - Sami: hired 1 January, no salary set.
 * - Rana: hired 1 January, 6,000.00, owing 5,000.00 on a debt, and another waived.
 * - Omar: an owner. Tarek: of Two. Lina: with no contract recorded.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('ehab', 'ehab@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'ehab', 'c1'),
 ('mona', 'mona@x', 'p', 'Mona', 'One', 'EMPLOYEE', 2026, 'mona', 'c1'),
 ('nour', 'nour@x', 'p', 'Nour', 'One', 'EMPLOYEE', 2026, 'nour', 'c1'),
 ('sami', 'sami@x', 'p', 'Sami', 'One', 'EMPLOYEE', 2026, 'sami', 'c1'),
 ('rana', 'rana@x', 'p', 'Rana', 'One', 'EMPLOYEE', 2026, 'rana', 'c1'),
 ('omar', 'omar@x', 'p', 'Omar', 'One', 'ADMIN', 2026, 'omar', 'c1'),
 ('tarek', 'tarek@x', 'p', 'Tarek', 'Two', 'EMPLOYEE', 2026, 'tarek', 'c2'),
 ('lina', 'lina@x', 'p', 'Lina', 'One', 'EMPLOYEE', 2026, 'lina', 'c1');
`

const NOW = new Date("2026-11-28T08:00:00Z")

describe.skipIf(!ADMIN_URL)("asking for a salary advance, in Postgres", () => {
    const dbName = `salary_advance_test_${Date.now()}`
    let db: Client
    let Advances: typeof import("@/lib/services/salary-advance.service")
    const offer = (userId: string) => Advances.SalaryAdvanceService.offer(userId)
    const ask = (userId: string, amount: string, months: string, first: string, locale = "en") =>
        Advances.SalaryAdvanceService.ask(userId, { amount, months, first }, locale)
    const refusal = async (p: Promise<unknown>) => {
        try {
            await p
        } catch (e) {
            return e
        }
        throw new Error("Not refused")
    }
    const rows = async (userId: string) => (await db.query(`SELECT * FROM "SalaryAdvance" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).rows

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW })
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = await import("@/lib/services/salary-advance.service")
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "updatedAt") VALUES ('pk', 'No payroll', false, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'pk' WHERE id = 'c2'`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
            ('h1', 'ehab', 'HIRED', '2026-01-14 22:00'), ('h2', 'mona', 'HIRED', '2025-12-31 22:00'), ('h3', 'nour', 'HIRED', '2026-09-30 21:00'),
            ('h4', 'sami', 'HIRED', '2025-12-31 22:00'), ('h5', 'rana', 'HIRED', '2025-12-31 22:00'), ('h6', 'omar', 'HIRED', '2025-12-31 22:00'),
            ('h7', 'tarek', 'HIRED', '2025-12-31 22:00')`)
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
            ('s1', 'ehab', 10000, '2026-01-14 22:00'), ('s2', 'mona', 10000, '2025-12-31 22:00'), ('s3', 'nour', 8000, '2026-09-30 21:00'),
            ('s5', 'rana', 6000, '2025-12-31 22:00'), ('s6', 'omar', 20000, '2025-12-31 22:00'), ('s7', 'tarek', 9000, '2025-12-31 22:00')`)
        await db.query(`INSERT INTO "PayrollDeduction"(id, "companyId", kind, basis, value, "updatedAt") VALUES ('si', 'c1', 'SOCIAL_INSURANCE', 'PERCENT', 10, now())`)
        await db.query(`INSERT INTO "PersonDeduction"(id, "userId", "deductionId", mode, "updatedAt") VALUES ('pd', 'mona', 'si', 'NONE', now())`)
        // Owed on one debt, and another waived, which isn't owed.
        await db.query(`INSERT INTO "Debt"(id, "userId", "companyId", amount, source, "dueDate", "updatedAt", status) VALUES
            ('d1', 'rana', 'c1', 5000, 'MANUAL', '2026-12-01', now(), 'OUTSTANDING'), ('d2', 'rana', 'c1', 9000, 'MANUAL', '2026-12-01', now(), 'WAIVED')`)
        await db.query(`INSERT INTO "OwnerPeriod"(id, "userId", "startsAt") VALUES ('op', 'omar', '2026-01-01')`)
    }, 180_000)

    afterEach(async () => {
        vi.setSystemTime(NOW)
        await db.query(`DELETE FROM "SalaryAdvance"`)
        await db.query(`DELETE FROM "PayrollRun"`)
        await db.query(`UPDATE "Company" SET "salaryAdvanceOneOpen" = true, "salaryAdvanceOverLimit" = 'BLOCK' WHERE id = 'c1'`)
    })

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    describe("what asking offers", () => {
        it("is measured against the monthly salary less the payroll deductions, with this month's payroll or next for the first installment", async () => {
            expect(await offer("ehab")).toEqual({
                closed: null,
                salaryMinor: 1_000_000,
                netMinor: 900_000,
                otherDebtsMinor: 0,
                maxAmountMinor: 2_000_000,
                maxMonths: 2,
                installmentPercent: 10,
                debtsPercent: 25,
                overLimit: "BLOCK",
                firsts: [{ year: 2026, month: 11 }, { year: 2026, month: 12 }],
                approved: null,
            })
        })

        it("takes their own payroll deductions where they have them", async () => {
            expect((await offer("mona"))!.netMinor).toBe(1_000_000)
        })

        it("is next month's payroll alone once this month's is approved or paid", async () => {
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES ('r11', 'c1', 11, 2026, 'APPROVED', 1, '2026-11-01', '2026-11-30', now())`)
            expect(await offer("ehab")).toMatchObject({ firsts: [{ year: 2026, month: 12 }], approved: { year: 2026, month: 11 } })
            await db.query(`UPDATE "PayrollRun" SET status = 'PAID'`)
            expect(await offer("ehab")).toMatchObject({ firsts: [{ year: 2026, month: 12 }], approved: { year: 2026, month: 11 } })
            await db.query(`UPDATE "PayrollRun" SET status = 'DRAFT', "periodStart" = NULL, "periodEnd" = NULL`)
            expect((await offer("ehab"))!.firsts).toHaveLength(2)
        })

        it("follows when payroll closes: past this month's close, it's next month's payroll month", async () => {
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
            try {
                expect((await offer("ehab"))!.firsts).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }])
            } finally {
                await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
            }
        })

        it("counts what's still owed, as a payslip takes it back, among their other debts", async () => {
            // 5,000.00 owed, all of a 5,400.00 net pay may be taken for it.
            expect(await offer("rana")).toMatchObject({ netMinor: 540_000, otherDebtsMinor: 500_000 })
            await db.query(`UPDATE "Company" SET "debtRecoveryPercent" = 50 WHERE id = 'c1'`)
            try {
                expect((await offer("rana"))!.otherDebtsMinor).toBe(270_000)
            } finally {
                await db.query(`UPDATE "Company" SET "debtRecoveryPercent" = 100 WHERE id = 'c1'`)
            }
        })

        it("is none for an owner, nor in a company without Payroll, nor for someone with no contract, nor for nobody", async () => {
            expect(await offer("omar")).toBeNull()
            expect(await offer("tarek")).toBeNull()
            expect(await offer("lina")).toBeNull()
            expect(await offer("nobody")).toBeNull()
        })
    })

    describe("why one can't be asked for", () => {
        it("before the months worked first are up, with when they are", async () => {
            expect((await offer("nour"))!.closed).toEqual({ reason: "SERVICE", months: 3, from: "2027-01-01" })
            await db.query(`UPDATE "Company" SET "salaryAdvanceMinServiceMonths" = 0 WHERE id = 'c1'`)
            try {
                expect((await offer("nour"))!.closed).toBeNull()
            } finally {
                await db.query(`UPDATE "Company" SET "salaryAdvanceMinServiceMonths" = 3 WHERE id = 'c1'`)
            }
        })

        it("with no monthly salary", async () => {
            expect((await offer("sami"))!.closed).toEqual({ reason: "NO_SALARY" })
        })

        it("where the payroll deductions leave no net pay", async () => {
            await db.query(`UPDATE "PayrollDeduction" SET value = 100 WHERE id = 'si'`)
            try {
                expect((await offer("ehab"))!.closed).toEqual({ reason: "NO_NET" })
            } finally {
                await db.query(`UPDATE "PayrollDeduction" SET value = 10 WHERE id = 'si'`)
            }
        })

        it("with Block, where their other debts already take what all debts together may; with Warn, it may be asked for", async () => {
            expect((await offer("rana"))!.closed).toEqual({ reason: "DEBTS", percent: 25 })
            await db.query(`UPDATE "Company" SET "salaryAdvanceOverLimit" = 'WARN' WHERE id = 'c1'`)
            expect((await offer("rana"))!.closed).toBeNull()
        })

        it("with only one at a time, while another waits or is being paid back", async () => {
            await ask("ehab", "5000", "6", "2026-12")
            expect((await offer("ehab"))!.closed).toEqual({ reason: "OPEN", status: "PENDING" })
            await db.query(`UPDATE "SalaryAdvance" SET status = 'APPROVED'`)
            expect((await offer("ehab"))!.closed).toEqual({ reason: "OPEN", status: "APPROVED" })
            await db.query(`UPDATE "SalaryAdvance" SET status = 'REJECTED'`)
            expect((await offer("ehab"))!.closed).toBeNull()
        })
    })

    describe("asking", () => {
        it("keeps it waiting, with what the limits were measured against, and the consent in its language", async () => {
            const { id } = await ask("ehab", "5000", "6", "2026-12")
            const [row] = await rows("ehab")
            expect(row).toMatchObject({
                id, companyId: "c1", amount: "5000.00", months: 6, firstYear: 2026, firstMonth: 12, status: "PENDING",
                salary: "10000.00", netPay: "9000.00", otherDebts: "0.00", overInstallment: false, overDebts: false,
                consentLocale: "en", withdrawnAt: null,
            })
            expect(row.consentText).toBe("By sending this, you agree to having each installment above taken from your payslip for its month, until the 5,000.00 EGP is repaid.")
            expect(row.consentedAt.getTime()).toBe(NOW.getTime())
            const audit = (await db.query(`SELECT action, "entityType", "userId", details FROM "AuditLog" WHERE "entityId" = $1`, [id])).rows
            expect(audit).toEqual([{
                action: "REQUEST_SALARY_ADVANCE", entityType: "SALARY_ADVANCE", userId: "ehab",
                details: { companyId: "c1", amount: "5000.00", months: 6, firstInstallment: "2026-12", overInstallment: false, overDebts: false },
            }])
        })

        it("keeps the consent in Arabic, with its digits, where it was shown so", async () => {
            await ask("ehab", "٥٠٠٠", "٦", "2026-11", "ar")
            const [row] = await rows("ehab")
            expect(row).toMatchObject({ amount: "5000.00", months: 6, firstMonth: 11, consentLocale: "ar" })
            expect(row.consentText).toBe("يعني إرسال هذا الطلب الموافقة على خصم كل قسط أعلاه من قسيمة الراتب عن شهره، حتى سداد مبلغ ٥٬٠٠٠٫٠٠ ج.م.")
        })

        it("is refused, with what's wrong under each field, by the dialog's own rules", async () => {
            const over = await refusal(ask("ehab", "20000.01", "6", "2026-12")) as InstanceType<typeof Advances.SalaryAdvanceRefused>
            expect(over).toMatchObject({ code: "SALARY_ADVANCE_INVALID", errors: { amount: "salary_advance_ask_amount_over" } })
            // 10,000.00 over 6 months is 1,666.70 at most a month, over 10% of 9,000.00.
            const few = await refusal(ask("ehab", "10000", "6", "2026-12")) as InstanceType<typeof Advances.SalaryAdvanceRefused>
            expect(few).toMatchObject({ code: "SALARY_ADVANCE_INVALID", errors: { months: "salary_advance_ask_months_few" } })
            const first = await refusal(ask("ehab", "5000", "6", "2027-01")) as InstanceType<typeof Advances.SalaryAdvanceRefused>
            expect(first).toMatchObject({ code: "SALARY_ADVANCE_INVALID", errors: { first: "salary_advance_ask_first_invalid" } })
            expect(await rows("ehab")).toEqual([])
        })

        it("with Warn, keeps one over a limit, saying which", async () => {
            await db.query(`UPDATE "Company" SET "salaryAdvanceOverLimit" = 'WARN' WHERE id = 'c1'`)
            await ask("ehab", "10000", "6", "2026-12")
            expect((await rows("ehab"))[0]).toMatchObject({ overInstallment: true, overDebts: false })
        })

        it("is refused where none may be asked for, saying why", async () => {
            expect(await refusal(ask("nour", "1000", "1", "2026-12"))).toMatchObject({ code: "SALARY_ADVANCE_CLOSED", closed: { reason: "SERVICE" } })
            expect(await refusal(ask("omar", "1000", "1", "2026-12"))).toMatchObject({ code: "SALARY_ADVANCE_NOT_OFFERED" })
            expect(await refusal(ask("tarek", "1000", "1", "2026-12"))).toMatchObject({ code: "SALARY_ADVANCE_NOT_OFFERED" })
        })

        it("keeps one of two sent at once, where only one may be open", async () => {
            const sent = await Promise.allSettled([ask("mona", "4000", "5", "2026-12"), ask("mona", "4000", "5", "2026-12")])
            expect(sent.map(s => s.status).sort()).toEqual(["fulfilled", "rejected"])
            expect((sent.find(s => s.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "SALARY_ADVANCE_CLOSED", closed: { reason: "OPEN" } })
            expect(await rows("mona")).toHaveLength(1)
        })

        it("with more than one at a time, measures the next with the open one's installments among their other debts", async () => {
            await db.query(`UPDATE "Company" SET "salaryAdvanceOneOpen" = false WHERE id = 'c1'`)
            await ask("ehab", "5000", "6", "2026-12")
            // 5,000.00 over 6 months: the last installment, 833.35, is the largest.
            expect((await offer("ehab"))!.otherDebtsMinor).toBe(83_335)
            await ask("ehab", "5000", "6", "2026-12")
            expect((await rows("ehab"))[1].otherDebts).toBe("833.35")
        })
    })

    describe("withdrawing", () => {
        it("takes one's own back while it waits, and logs it", async () => {
            const { id } = await ask("ehab", "5000", "6", "2026-12")
            await Advances.SalaryAdvanceService.withdraw(id, "ehab")
            const [row] = await rows("ehab")
            expect(row.status).toBe("WITHDRAWN")
            expect(row.withdrawnAt.getTime()).toBe(NOW.getTime())
            const audit = (await db.query(`SELECT action, details FROM "AuditLog" WHERE "entityId" = $1 AND action = 'WITHDRAW_SALARY_ADVANCE'`, [id])).rows
            expect(audit).toEqual([{ action: "WITHDRAW_SALARY_ADVANCE", details: { companyId: "c1", amount: "5000.00", months: 6 } }])
            // Withdrawn, another may be asked for.
            expect((await offer("ehab"))!.closed).toBeNull()
        })

        it("is refused for someone else's, and once it's no longer waiting", async () => {
            const { id } = await ask("ehab", "5000", "6", "2026-12")
            await expect(Advances.SalaryAdvanceService.withdraw(id, "mona")).rejects.toThrow("REQUEST_NOT_FOUND")
            await Advances.SalaryAdvanceService.withdraw(id, "ehab")
            await expect(Advances.SalaryAdvanceService.withdraw(id, "ehab")).rejects.toThrow("REQUEST_ALREADY_DECIDED")
            await db.query(`UPDATE "SalaryAdvance" SET status = 'APPROVED', "withdrawnAt" = NULL`)
            await expect(Advances.SalaryAdvanceService.withdraw(id, "ehab")).rejects.toThrow("REQUEST_ALREADY_DECIDED")
        })
    })

    describe("the table", () => {
        const insert = (set: string) => db.query(`INSERT INTO "SalaryAdvance"(id, "companyId", "userId", amount, months, "firstYear", "firstMonth", salary, "netPay", "otherDebts", "consentText", "consentLocale", "consentedAt", "updatedAt", status, "withdrawnAt")
            SELECT 'x', 'c1', 'ehab', amount, months, 2026, 12, 10000, 9000, 0, 'Agreed', locale, now(), now(), status::"SalaryAdvanceStatus", withdrawn FROM (SELECT ${set}) v`)
        const ok = "5000 AS amount, 6 AS months, 'en' AS locale, 'PENDING' AS status, NULL::timestamp AS withdrawn"

        it("holds what an advance may be", async () => {
            await insert(ok)
            await db.query(`DELETE FROM "SalaryAdvance"`)
            for (const wrong of [
                "0 AS amount, 6 AS months, 'en' AS locale, 'PENDING' AS status, NULL::timestamp AS withdrawn",
                "5000 AS amount, 25 AS months, 'en' AS locale, 'PENDING' AS status, NULL::timestamp AS withdrawn",
                "5000 AS amount, 0 AS months, 'en' AS locale, 'PENDING' AS status, NULL::timestamp AS withdrawn",
                "5000 AS amount, 6 AS months, 'fr' AS locale, 'PENDING' AS status, NULL::timestamp AS withdrawn",
                "5000 AS amount, 6 AS months, 'en' AS locale, 'WITHDRAWN' AS status, NULL::timestamp AS withdrawn",
                "5000 AS amount, 6 AS months, 'en' AS locale, 'PENDING' AS status, now()::timestamp AS withdrawn",
            ]) await expect(insert(wrong), wrong).rejects.toThrow(/SalaryAdvance_figures/)
        })

        it("has Row Level Security on", async () => {
            expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'SalaryAdvance'`)).rows[0].relrowsecurity).toBe(true)
        })
    })
})
