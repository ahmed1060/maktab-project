-- A company's message put back to Nizmo's (CLIENT_PORTAL_PLAN.md §7.1, step
-- 10c-1, PR 348): its row stays, marked as using Nizmo's, rather than going,
-- so the time it was put back is what a save from an older page is told
-- apart by. Where its row went, a page that read Nizmo's before a copy was
-- made and put back would save over that as though nothing had changed.
-- Only adds: a column, false for every row there is, as none is a message
-- put back yet. A row marked keeps the text it had, which nothing reads.
ALTER TABLE "ClientMessageTemplate" ADD COLUMN "usesNizmo" BOOLEAN NOT NULL DEFAULT false;

-- Only a company's message uses Nizmo's: Nizmo's own is Nizmo's.
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_usesNizmo" CHECK ("companyId" IS NOT NULL OR NOT "usesNizmo");
