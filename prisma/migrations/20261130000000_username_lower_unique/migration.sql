-- One username, one account, capitals aside (lib/username.ts).

-- A Super Admin added on the Super Admins page had no username typed, and
-- was given "", which the next one couldn't have. Each gets one from their
-- email's part before the @, as the page now gives them, with -2, -3…
-- after it when somebody already has it.
DO $$
DECLARE
    admin RECORD;
    base TEXT;
    candidate TEXT;
    n INTEGER;
BEGIN
    FOR admin IN SELECT id, email FROM "SuperAdmin" WHERE username = '' ORDER BY "createdAt", id LOOP
        base := substr(regexp_replace(regexp_replace(split_part(admin.email, '@', 1), '[^A-Za-z0-9._-]', '', 'g'), '^[^A-Za-z0-9]+', ''), 1, 26);
        IF length(base) < 2 THEN base := 'admin'; END IF;
        candidate := base;
        n := 1;
        WHILE EXISTS (SELECT 1 FROM "User" WHERE lower(username) = lower(candidate))
           OR EXISTS (SELECT 1 FROM "SuperAdmin" WHERE lower(username) = lower(candidate)) LOOP
            n := n + 1;
            candidate := base || '-' || n;
        END LOOP;
        UPDATE "SuperAdmin" SET username = candidate WHERE id = admin.id;
    END LOOP;
END $$;

-- Two that differ only in capitals are the same username. Each table's own;
-- between the two, the code checks (a Super Admin and a person never share
-- one), and a save that loses a race to it is caught here.
CREATE UNIQUE INDEX "User_username_lower_key" ON "User"(lower(username));
CREATE UNIQUE INDEX "SuperAdmin_username_lower_key" ON "SuperAdmin"(lower(username));
