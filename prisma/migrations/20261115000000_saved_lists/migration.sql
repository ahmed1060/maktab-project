-- Saved lists of cost names and task titles (CLIENTS_PLAN.md §5, step 5):
-- each company's own, to type or pick from. A name is added only by
-- "+ Add", never from what's typed. A task keeps its title, and a cost its
-- name, as typed, with a link to the name picked: renaming a name changes
-- nothing already written, and reports still group them.
--
-- Additive: the release before doesn't know the table or the two links.

CREATE TYPE "ListKind" AS ENUM ('COST_NAME', 'TASK_TITLE');

CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ListKind" NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id"),
    -- Trimmed, and no longer than the longest field that takes one: a cost's
    -- name (a task's title takes 100).
    CONSTRAINT "ListEntry_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> ''),
    CONSTRAINT "ListEntry_name_length" CHECK (char_length("name") <= 200)
);

-- A name is in a company's list once, ignoring capitals (§5.6), archived
-- ones too: one archived is restored, not added again.
CREATE UNIQUE INDEX "ListEntry_name_once" ON "ListEntry"("companyId", "kind", lower("name"));
CREATE INDEX "ListEntry_companyId_kind_idx" ON "ListEntry"("companyId", "kind");

ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every table, reached only through the app (DATABASE_SETUP.md).
ALTER TABLE "ListEntry" ENABLE ROW LEVEL SECURITY;

-- The name a task's title and a cost's name were picked as. A name merged
-- into another moves its links there first; one is never deleted otherwise.
ALTER TABLE "Task" ADD COLUMN "titleEntryId" TEXT;
CREATE INDEX "Task_titleEntryId_idx" ON "Task"("titleEntryId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_titleEntryId_fkey" FOREIGN KEY ("titleEntryId") REFERENCES "ListEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskCost" ADD COLUMN "nameEntryId" TEXT;
CREATE INDEX "TaskCost_nameEntryId_idx" ON "TaskCost"("nameEntryId");
ALTER TABLE "TaskCost" ADD CONSTRAINT "TaskCost_nameEntryId_fkey" FOREIGN KEY ("nameEntryId") REFERENCES "ListEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
