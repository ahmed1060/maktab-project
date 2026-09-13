-- Notification recipients become polymorphic: a row is addressed to either a
-- company User or a platform SuperAdmin, never both and never neither.
--
-- Fixes a live defect. CompanyService.checkSubscriptions() has always drawn its
-- recipients from the SuperAdmin table, whose UUIDs are from a different space
-- than User's, so every insert it attempted violated Notification_userId_fkey.
-- Production evidence at the time of this migration: 2 SuperAdmin rows, 0 of
-- them present in User, 0 User rows with role 'SUPER_ADMIN', and 0
-- SUBSCRIPTION_EXPIRY notifications ever written. The job had not yet surfaced
-- the error only because no subscription had entered its 14-day window; the
-- earliest paid endDate was 2026-10-08, due to enter it on 2026-09-24.

-- 1. userId becomes optional. Widening a NOT NULL to NULL takes only a brief
--    ACCESS EXCLUSIVE lock and rewrites nothing, and every existing row keeps
--    its value, so already-deployed code reading `userId` is unaffected.
ALTER TABLE "Notification" ALTER COLUMN "userId" DROP NOT NULL;

-- 2. The second recipient column, mirroring userId's ON DELETE CASCADE so that
--    removing a SuperAdmin clears their notifications the same way removing a
--    User does.
ALTER TABLE "Notification" ADD COLUMN "superAdminId" TEXT;

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_superAdminId_fkey"
    FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

-- 3. Exactly one recipient. This is the invariant that makes the two nullable
--    columns safe to reason about, and it is not expressible in schema.prisma —
--    it exists only here. Without it the table admits an orphan notification
--    (both null, addressed to nobody, visible to nobody) and a double-addressed
--    one (both set, which every reader would count twice).
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_recipient_exactly_one"
    CHECK (num_nonnulls("userId", "superAdminId") = 1);

-- 4. Indexes matching the ones userId already has. The bell reads
--    "this recipient's items" and "this recipient's unread items", and it
--    resolves a recipient with OR across both columns — which Postgres serves
--    from these two indexes plus userId's via a bitmap OR.
CREATE INDEX "Notification_superAdminId_idx" ON "Notification"("superAdminId");
CREATE INDEX "Notification_superAdminId_read_idx" ON "Notification"("superAdminId", "read");
