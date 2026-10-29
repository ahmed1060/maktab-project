-- Costs finish moving into their own table (CLIENTS_PLAN.md §4.5, PR 4d).
--
-- 4c gave every cost saved before it a row while the release before it was
-- live, and that release went on adding costs with no row, and removing a
-- cost's entry and leaving its row. This runs while 4c is live, which writes
-- a cost's row and its entry together, so once it has run they agree, and
-- from this release on the rows say which costs a task has.

-- As 4c's migration has them: a cost entry's amount to the cent, or none,
-- and a task's comments as a list.
CREATE FUNCTION pg_temp.cost_amount(entry jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN entry->>'type' = 'COST_ADDITION' AND jsonb_typeof(entry->'amount') = 'number'
                THEN CASE WHEN round((entry->>'amount')::numeric, 2) > 0
                           AND round((entry->>'amount')::numeric, 2) < 10000000000
                          THEN round((entry->>'amount')::numeric, 2) END END
$$;

CREATE FUNCTION pg_temp.entries(comments jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(comments) = 'array' THEN comments ELSE '[]'::jsonb END
$$;

-- Each cost added meanwhile names the row made for it.
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

-- And the rows, as the entries say: those added meanwhile had their
-- descriptions thrown away, as before 4c.
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

-- A row whose entry is gone was a cost the release before removed: it goes.
DELETE FROM "TaskCost" c
WHERE NOT EXISTS (
    SELECT 1
    FROM "Task" t, jsonb_array_elements(pg_temp.entries(t."comments")) AS e(val)
    WHERE t."id" = c."taskId" AND e.val->>'costId' = c."id"
);

-- Gone with this migration, as 4c's are.
DROP FUNCTION pg_temp.cost_amount(jsonb);
DROP FUNCTION pg_temp.entries(jsonb);
