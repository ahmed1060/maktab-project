-- Apple App Attest (ATTENDANCE_PLAN.md §9.4): the key attested at registration, and its assertions' counter.
ALTER TABLE "CheckInPhone" ADD COLUMN "appAttestKey" TEXT;
ALTER TABLE "CheckInPhone" ADD COLUMN "appAttestCounter" INTEGER NOT NULL DEFAULT 0;
