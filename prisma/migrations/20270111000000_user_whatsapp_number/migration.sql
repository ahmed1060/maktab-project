-- A person's WhatsApp number, for their clients (CLIENT_PORTAL_PLAN.md §7,
-- step 9a, PR 340): the clients' people they're the responsible accountant
-- for write to it. Only adds: nobody has one until they, or whoever may edit
-- their profile, type it.
ALTER TABLE "User" ADD COLUMN "whatsappNumber" TEXT;

-- As it's kept (lib/whatsapp-number.ts): a + and its country code, then the
-- number, 8 to 15 digits in all.
ALTER TABLE "User" ADD CONSTRAINT "User_whatsappNumber_kept" CHECK ("whatsappNumber" IS NULL OR "whatsappNumber" ~ '^\+[1-9][0-9]{7,14}$');
