-- Which subscription lifecycle notices have already been sent for a company's
-- current period: TRIAL_ENDING_24H, GRACE_STARTED, GRACE_ENDING_24H, LOCKED.
--
-- Same shape as CompanyPayment.remindersSent, and for the same reason: without
-- a marker the daily job re-sends every morning. It matters more here because
-- two of these are emails, and outbound mail goes through a single Gmail
-- account with no queue and no retry — the same account that carries password
-- resets and MFA codes. Getting it rate-limited does not merely annoy a
-- customer; it locks people out of the product.
ALTER TABLE "Company" ADD COLUMN "lifecycleNoticesSent" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
