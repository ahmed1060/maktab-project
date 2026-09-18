-- I1: a leaver's existing debts now reach their settlement.
--
-- Recorded as its own column rather than folded into netAmount, because the
-- statement shows earned, paid and their difference, and a net that quietly
-- included something else would stop adding up in front of the person reading
-- it. Defaults to 0, so every settlement written before this reads as one that
-- recovered nothing — which is exactly what they did.
ALTER TABLE "FinalSettlement" ADD COLUMN "debtRecoveredAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
