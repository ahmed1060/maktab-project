-- Each company's own username code (lib/username.ts): the letters before the
-- number in a username Nizmo makes up for its people, and the counter for the
-- number. Additive: the code that runs before this deploy reads neither.
ALTER TABLE "Company" ADD COLUMN "usernameCode" TEXT;
ALTER TABLE "Company" ADD COLUMN "usernameNext" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Company_usernameCode_key" ON "Company"("usernameCode");

-- The companies already there keep the letters their people's usernames use:
-- each company's most used letters-and-a-number prefix, and where two
-- companies' most used one is the same (both had ds, because the old way took
-- the name's initials), the company with more people on it, then the older
-- one. The other gets a code of its own the first time it needs one. The
-- counter starts after the highest number anybody has with those letters.
WITH named AS (
    SELECT "companyId" AS company, lower(substring(username FROM '^([A-Za-z]{1,8})[0-9]{1,9}$')) AS code
    FROM "User"
    WHERE "companyId" IS NOT NULL AND username ~ '^[A-Za-z]{1,8}[0-9]{1,9}$'
), counted AS (
    SELECT company, code, count(*) AS people FROM named GROUP BY company, code
), most AS (
    SELECT DISTINCT ON (company) company, code, people
    FROM counted
    ORDER BY company, people DESC, length(code), code
), owner AS (
    SELECT DISTINCT ON (most.code) most.company, most.code
    FROM most JOIN "Company" ON "Company".id = most.company
    ORDER BY most.code, most.people DESC, "Company"."createdAt", "Company".id
)
UPDATE "Company" SET
    "usernameCode" = owner.code,
    "usernameNext" = (
        SELECT COALESCE(max(CAST(substring(username FROM '[0-9]+$') AS INTEGER)), -1) + 1
        FROM (SELECT username FROM "User" UNION ALL SELECT username FROM "SuperAdmin") AS everyone
        WHERE username ~* ('^' || owner.code || '[0-9]{1,9}$')
    )
FROM owner
WHERE "Company".id = owner.company;
