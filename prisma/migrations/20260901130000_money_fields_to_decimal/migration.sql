/*
  F-07: money/payroll-day fields moved from Float (double precision) to
  Decimal(12,2) (numeric). Float is IEEE-754 binary floating point, which
  cannot represent most decimal fractions exactly — repeated +/- on it
  (bonuses, deductions, rollbacks) drifts, e.g. a salary line landing on
  4999.999999999999 instead of 5000.00. Postgres NUMERIC stores the exact
  digits, and Prisma's atomic { increment }/{ decrement } operators used
  throughout salary.service.ts now do exact arithmetic in the database.

  The USING clause casts each existing value to numeric(12,2) in place —
  no data is discarded, only the storage representation changes. 12,2
  supports values up to 9,999,999,999.99, comfortably above any plausible
  salary/cost figure here.
*/

-- AlterTable
ALTER TABLE "User"
    ALTER COLUMN "salary" TYPE DECIMAL(12,2) USING "salary"::numeric(12,2);

-- AlterTable
ALTER TABLE "Task"
    ALTER COLUMN "totalCost" TYPE DECIMAL(12,2) USING "totalCost"::numeric(12,2);

-- AlterTable
ALTER TABLE "SalaryRecord"
    ALTER COLUMN "deductions" TYPE DECIMAL(12,2) USING "deductions"::numeric(12,2),
    ALTER COLUMN "bonusDays" TYPE DECIMAL(12,2) USING "bonusDays"::numeric(12,2),
    ALTER COLUMN "baseSalary" TYPE DECIMAL(12,2) USING "baseSalary"::numeric(12,2);

-- AlterTable
ALTER TABLE "CompanyPayment"
    ALTER COLUMN "cost" TYPE DECIMAL(12,2) USING "cost"::numeric(12,2);

-- AlterTable
ALTER TABLE "SalaryAdjustment"
    ALTER COLUMN "amount" TYPE DECIMAL(12,2) USING "amount"::numeric(12,2);
