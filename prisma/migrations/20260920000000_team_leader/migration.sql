-- ---------------------------------------------------------------------------
-- Who manages whom.
--
-- One nullable column, an index and a foreign key. Additive: no existing row
-- is rewritten and no existing query changes meaning. Every account starts
-- with no leader, which is the correct initial state — an unassigned employee
-- is visible to Admins only, so the boundary is closed from the first moment
-- the column exists rather than after somebody remembers to populate it.
--
-- The structure is flat: leaders are not led. teamLeaderId is only ever set on
-- an EMPLOYEE row and only ever points at a TEAM_LEADER in the same company.
-- Those two rules need to see another row, so they live in UserService where
-- they can be tested, not here.
--
-- ON DELETE SET NULL is a backstop for a hard DELETE only. The application
-- soft-deletes, and losing a leader that way — by demotion, archival, deletion
-- or a move to another company — is refused until their reports are rehomed.
-- Reports must never quietly become invisible to everybody, which is what a
-- silent null would do.
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "teamLeaderId" TEXT;

-- Every Team Leader read filters on this, on every page they open.
CREATE INDEX "User_teamLeaderId_idx" ON "User"("teamLeaderId");

ALTER TABLE "User" ADD CONSTRAINT "User_teamLeaderId_fkey"
    FOREIGN KEY ("teamLeaderId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- The one rule Postgres can enforce without reading another row, so it is
-- enforced here as well as in the service. Self-leadership is not a typo the
-- database should be willing to store: it would make a person their own
-- manager and put them in their own team scope twice.
--
-- Deliberately a CHECK and not a trigger. The relational rules above are
-- tempting to add as one, but a trigger firing mid-transaction would reject
-- valid orderings of the hand-off flow, where reports are reassigned and the
-- leader's role changes together in a single transaction.
ALTER TABLE "User" ADD CONSTRAINT "User_not_own_leader"
    CHECK ("teamLeaderId" IS NULL OR "teamLeaderId" <> "id");
