-- The push outbox's claim, apart from "pushed" (review on #25): a run that
-- dies mid-send leaves a claim that lapses, not a notice marked as sent.
ALTER TABLE "Notification" ADD COLUMN "pushClaimedAt" TIMESTAMP(3);
