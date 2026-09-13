-- The expiry reminder becomes a 14/3/1 ladder, so the single
-- notifiedExpiryReminder boolean is replaced by the set of rungs already spent.
--
-- The boolean could record that *something* had been sent but not which, so it
-- could not drive more than one reminder, and — since nothing in the codebase
-- ever reset it — extending an existing period silently disabled that period's
-- reminders for good.
--
-- Expand step only: the old column stays for this deploy so a code rollback
-- still finds what it reads. The contract step drops it.

ALTER TABLE "CompanyPayment" ADD COLUMN "remindersSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Carry the old flag's meaning across. A row marked notified under the old
-- scheme had its one-and-only reminder sent, which is the ladder's 14 rung; the
-- later rungs were never reachable, so they are left unspent and will fire.
-- (No row in production currently has this set — every reminder insert failed on
-- a foreign-key violation before the polymorphic_notification_recipient fix — so
-- this is here for correctness rather than because it moves any data today.)
UPDATE "CompanyPayment" SET "remindersSent" = ARRAY[14] WHERE "notifiedExpiryReminder" = true;
