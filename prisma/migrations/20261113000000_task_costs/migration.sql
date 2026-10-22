-- Costs get their own table (CLIENTS_PLAN.md §4.5), with their descriptions
-- (§4.4): each one an id that client charges and cash advances can point at
-- later, where today a cost is an entry in its task's comments, found by the
-- time it was added, which costs added together share.
--
-- Additive: the release before reads and writes the entries in the task's
-- comments, and this one still does, with each entry naming its row
-- ("costId"). While this waits for review, the release before adds entries
-- with no row and removes entries without their rows; this release lists
-- the entries, so it agrees with it, and a later migration gives those
-- entries their rows and removes the rows left over.

CREATE TABLE "TaskCost" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskCost_amount_positive" CHECK ("amount" > 0),
    -- As the task's page takes it.
    CONSTRAINT "TaskCost_description_length" CHECK (char_length("description") <= 200)
);

CREATE INDEX "TaskCost_taskId_idx" ON "TaskCost"("taskId");

ALTER TABLE "TaskCost" ADD CONSTRAINT "TaskCost_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table, reached only through the app (DATABASE_SETUP.md).
ALTER TABLE "TaskCost" ENABLE ROW LEVEL SECURITY;

-- A cost entry's amount to the cent, or none for anything that isn't one:
-- the app never wrote a cost of nothing or less. CASE, so nothing that
-- isn't a number is ever cast.
CREATE FUNCTION pg_temp.cost_amount(entry jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN entry->>'type' = 'COST_ADDITION' AND jsonb_typeof(entry->'amount') = 'number'
                THEN CASE WHEN round((entry->>'amount')::numeric, 2) > 0
                           AND round((entry->>'amount')::numeric, 2) < 10000000000
                          THEN round((entry->>'amount')::numeric, 2) END END
$$;

-- A task's comments as a list, or an empty one.
CREATE FUNCTION pg_temp.entries(comments jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(comments) = 'array' THEN comments ELSE '[]'::jsonb END
$$;

-- Each cost entry names the row made for it.
UPDATE "Task" t
SET "comments" = (
    SELECT jsonb_agg(
        CASE WHEN pg_temp.cost_amount(e.val) IS NOT NULL AND NOT (e.val ? 'costId')
             THEN e.val || jsonb_build_object('costId', gen_random_uuid()::text)
             ELSE e.val END
        ORDER BY e.ord)
    FROM jsonb_array_elements(pg_temp.entries(t."comments")) WITH ORDINALITY AS e(val, ord)
)
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(pg_temp.entries(t."comments")) AS e(val)
    WHERE pg_temp.cost_amount(e.val) IS NOT NULL AND NOT (e.val ? 'costId')
);

-- And the rows, as the entries say. None has a description: they were
-- thrown away (§1).
INSERT INTO "TaskCost" ("id", "taskId", "authorId", "authorName", "amount", "createdAt")
SELECT e.val->>'costId', t."id", e.val->>'authorId', e.val->>'author',
       pg_temp.cost_amount(e.val),
       CASE WHEN e.val->>'date' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
            THEN (e.val->>'date')::timestamptz AT TIME ZONE 'UTC'
            ELSE now() AT TIME ZONE 'UTC' END
FROM "Task" t, jsonb_array_elements(pg_temp.entries(t."comments")) AS e(val)
WHERE pg_temp.cost_amount(e.val) IS NOT NULL
  AND jsonb_typeof(e.val->'costId') = 'string'
ON CONFLICT ("id") DO NOTHING;

-- Gone with this migration: a later one in the same session, as a database
-- set up from scratch runs them, makes its own.
DROP FUNCTION pg_temp.cost_amount(jsonb);
DROP FUNCTION pg_temp.entries(jsonb);
