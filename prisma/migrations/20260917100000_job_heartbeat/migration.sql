-- One row per scheduled job, rewritten on every run. Purely additive: nothing
-- reads or writes this table until the cron routes are wired to it, and no
-- existing column or row is touched.
CREATE TABLE "JobHeartbeat" (
    "job" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "failureStreak" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobHeartbeat_pkey" PRIMARY KEY ("job")
);
