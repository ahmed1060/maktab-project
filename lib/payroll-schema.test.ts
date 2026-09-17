import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * What the payroll tables have to be, asserted on the schema rather than
 * remembered.
 *
 * These are the columns a wrong answer hides in. A money column that is not a
 * Decimal drifts; a settlement whose sign lives somewhere other than its amount
 * can contradict itself; a run without a unique key lets two people approve
 * different figures for the same month.
 */
const SCHEMA = readFileSync("prisma/schema.prisma", "utf8")
const MIGRATION = readFileSync("prisma/migrations/20260917160000_payroll_schema/migration.sql", "utf8")

function model(name: string): string {
    const start = SCHEMA.indexOf(`model ${name} {`)
    expect(start, `model ${name} is missing`).toBeGreaterThan(-1)
    return SCHEMA.slice(start, SCHEMA.indexOf("\n}", start))
}

describe("every money column is a Decimal", () => {
    it("on the payslip, its lines, the settlement and the debt", () => {
        // F-07's rule, which the schema already took everywhere else. Float is
        // IEEE-754 double precision and repeated arithmetic on it drifts, which
        // is unacceptable for a value that gets paid out.
        const cases: [string, string[]][] = [
            ["Payslip", ["earningsAmount", "deductionsAmount", "netAmount", "carriedAmount"]],
            ["PayslipLine", ["amount"]],
            ["FinalSettlement", ["earnedAmount", "paidAmount", "netAmount"]],
            ["Debt", ["amount"]],
        ]
        for (const [name, columns] of cases) {
            const body = model(name)
            for (const column of columns) {
                expect(body, `${name}.${column} is not Decimal(12,2)`)
                    .toMatch(new RegExp(`${column}\\s+Decimal[^\\n]*@db\\.Decimal\\(12, 2\\)`))
            }
        }
    })
})

describe("a settlement cannot contradict itself", () => {
    it("carries one signed net rather than an amount beside a direction", () => {
        // Two columns, or an unsigned amount next to a direction flag, allow a
        // state where the sign and the figure disagree. The one thing a
        // settlement must never be is ambiguous about which way it points.
        const body = model("FinalSettlement")
        expect(body).toContain("netAmount")
        expect(body, "a separate direction column reintroduces the contradiction")
            .not.toMatch(/direction\s+/i)
    })

    it("has its own status and due date, not the payroll run's", () => {
        // The document is not the payment: a settlement is produced when the
        // contract ends and paid when payday comes round.
        const body = model("FinalSettlement")
        expect(body).toMatch(/status\s+SettlementStatus/)
        expect(body).toMatch(/dueDate\s+DateTime/)
        expect(body, "payrollRunId must be optional — a settlement exists before a run carries it")
            .toMatch(/payrollRunId\s+String\?/)
    })

    it("survives the deletion of the run that carried it", () => {
        // The entitlement or the debt outlives the run. Cascade here would
        // delete what somebody is owed along with a draft nobody wanted.
        expect(MIGRATION).toMatch(/FinalSettlement_payrollRunId_fkey[\s\S]{0,140}ON DELETE SET NULL/)
    })
})

describe("one run per company per month", () => {
    it("is enforced by the database, not by the code that writes it", () => {
        // Without it, two people can approve different figures for the same
        // payroll and both are stored.
        expect(model("PayrollRun")).toContain("@@unique([companyId, month, year])")
        expect(MIGRATION).toContain('CREATE UNIQUE INDEX "PayrollRun_companyId_month_year_key"')
    })

    it("copies the payroll day rather than reading it back", () => {
        // Changing the company's payroll day must not rewrite what a settlement
        // already closed was measured against.
        expect(model("PayrollRun")).toMatch(/payrollDay\s+Int/)
    })
})

describe("a payslip is a record, not a view", () => {
    it("stores its totals", () => {
        // Opening last March's payroll must show March's answer, not today's
        // answer to March's question.
        const body = model("Payslip")
        for (const column of ["earningsAmount", "deductionsAmount", "netAmount", "daysPaid"]) {
            expect(body, column).toContain(column)
        }
    })

    it("keeps an excluded person visible", () => {
        // An excluded person with no row is a person nobody notices is missing,
        // which is the failure a register exists to prevent.
        const body = model("Payslip")
        expect(body).toMatch(/excluded\s+Boolean/)
        expect(body).toMatch(/exclusionReason\s+String\?/)
    })

    it("can be issued in batches that resume", () => {
        // Stamped as each send succeeds, so a timeout costs a pause rather than
        // sixty people receiving their payslip twice.
        expect(model("Payslip")).toMatch(/emailedAt\s+DateTime\?/)
        expect(model("FinalSettlement")).toMatch(/emailedAt\s+DateTime\?/)
        expect(model("Payslip")).toContain("@@index([emailedAt])")
    })

    it("carries what its deductions could not take", () => {
        // The net floors at zero and the excess becomes a debt — see
        // totalPayslip() in lib/payroll.ts.
        expect(model("Payslip")).toContain("carriedAmount")
    })
})

describe("debts are one queue, not two lists", () => {
    it("records where each came from", () => {
        // A payslip whose deductions exceeded its earnings and a settlement that
        // came out negative are the same object to whoever has to collect it.
        const body = model("Debt")
        expect(body).toMatch(/source\s+String/)
        expect(body).toMatch(/sourceId\s+String\?/)
        expect(body).toContain("@@index([companyId, status, dueDate])")
    })

    it("distinguishes written off from paid", () => {
        // WAIVED claims a decision; SETTLED claims money moved. Collapsing them
        // loses the only thing anybody reviewing the list wants to know.
        expect(SCHEMA).toMatch(/enum DebtStatus \{[\s\S]*OUTSTANDING[\s\S]*SETTLED[\s\S]*WAIVED/)
        expect(SCHEMA).toMatch(/enum SettlementStatus \{[\s\S]*PENDING[\s\S]*APPROVED[\s\S]*PAID[\s\S]*WAIVED/)
    })
})

describe("company policy", () => {
    it("adds the three settings with defaults, so nothing needs backfilling", () => {
        expect(MIGRATION).toContain('ALTER TABLE "Company" ADD COLUMN "payrollDay" INTEGER NOT NULL DEFAULT 25')
        expect(MIGRATION).toContain('ALTER TABLE "Company" ADD COLUMN "payslipsVisible" BOOLEAN NOT NULL DEFAULT false')
        expect(MIGRATION).toContain('ALTER TABLE "Company" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT \'Africa/Cairo\'')
    })

    it("keeps payslips hidden until somebody decides otherwise", () => {
        // A default of true would publish pay records to every employee of every
        // existing company on the deploy that adds the column.
        expect(model("Company")).toMatch(/payslipsVisible\s+Boolean\s+@default\(false\)/)
    })
})

describe("P5's promise, finally keepable", () => {
    const service = stripComments(readFileSync("lib/services/settlement.service.ts", "utf8"))
    const route = stripComments(readFileSync("app/api/users/[id]/employment/route.ts", "utf8"))

    it("ends the contract and writes the settlement in one transaction", () => {
        // A contract ended with no statement leaves somebody locked out and owed
        // an amount nobody has written down; a statement with no ended contract
        // is a document about something that did not happen.
        expect(service).toContain("prisma.$transaction")
        const settle = service.slice(service.indexOf("static async settleAndEnd"))
        expect(settle).toContain('type: "CONTRACT_ENDED"')
        expect(settle).toContain("tx.finalSettlement.create")
    })

    it("leaves no route that ends a contract without one", () => {
        expect(route).toContain("SettlementService.settleAndEnd")
        expect(route, "the route still ends contracts directly, bypassing the settlement")
            .not.toContain("'CONTRACT_ENDED'")
    })

    it("works the paid figure out instead of being handed it", () => {
        // P5's pure preview took paidMinor as an argument because nothing knew
        // the payroll day yet. It does now.
        expect(service).toContain("daysAlreadyPaid")
        expect(service).not.toContain("paidMinor: input.paidMinor")
    })

    it("puts a negative settlement into the debts queue", () => {
        expect(service).toContain("preview.netMinor < 0")
        expect(service).toContain('source: "SETTLEMENT"')
    })
})
