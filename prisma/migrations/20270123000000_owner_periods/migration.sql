-- Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426): each time someone is
-- an owner, from the start of the month they were marked to the start of the
-- month they were no longer one, open while they still are. Only adds: a
-- table, empty until someone is marked, and the built-in Admin role's grant
-- to mark them.
CREATE TABLE "OwnerPeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OwnerPeriod_userId_idx" ON "OwnerPeriod"("userId");

-- Someone's go with them.
ALTER TABLE "OwnerPeriod" ADD CONSTRAINT "OwnerPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the schema can't say: a period ends after it starts, and each person
-- has one open at most.
ALTER TABLE "OwnerPeriod" ADD CONSTRAINT "OwnerPeriod_ends_after_start" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
CREATE UNIQUE INDEX "OwnerPeriod_one_open" ON "OwnerPeriod"("userId") WHERE "endsAt" IS NULL;

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "OwnerPeriod" ENABLE ROW LEVEL SECURITY;

-- Marking owners: the built-in Admin role's new grant, lib/permissions/built-in.ts
-- row for row, and its holders reload their grants once. Run again, it
-- changes nothing but the version.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'employees.set_owner', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
