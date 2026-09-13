-- Whether the "Powered by SHSD" mark shows in the corner of dashboard pages.
--
-- Defaults true, so every existing install keeps the signature it has: an
-- upgrade that silently removed attribution would be a strange thing for a
-- migration to do, and turning it off should be a decision somebody took.
ALTER TABLE "SystemSettings" ADD COLUMN "showPoweredBy" BOOLEAN NOT NULL DEFAULT true;
