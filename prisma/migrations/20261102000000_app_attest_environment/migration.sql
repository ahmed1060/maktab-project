-- The environment App Attest attested a phone's key in (review on #65).
-- A key from a development build was taken only while
-- APP_ATTEST_ALLOW_DEVELOPMENT was set, but nothing kept which kind it was:
-- once the setting went, the phone's check-ins still counted as attested.
-- Null for phones without a key, and for keys kept before this: production
-- has none (no iPhone has registered), and they are read as production.
ALTER TABLE "CheckInPhone" ADD COLUMN "appAttestEnvironment" TEXT;
