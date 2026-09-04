-- Adds the CASUAL day-off type. The day-off-request creation form has
-- always offered "Casual" as a choice, but it was never a valid value in
-- this enum (or, before F-13's String->enum migration, ever handled by
-- any backend logic at all) — every such request has been rejected by
-- Zod validation since that migration shipped. Deduction/credit logic in
-- DayOffService never branches on type, so no other code changes are
-- needed for this to work end to end.
ALTER TYPE "DayOffType" ADD VALUE 'CASUAL';
