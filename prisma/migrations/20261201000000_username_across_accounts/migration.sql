-- One username, one account, across the two tables that hold them (Codex
-- on PR 185). Each table's lower(username) index keeps a username to one row
-- of its own; a person and a Super Admin given the same one at the same
-- moment would both pass the check in code and both be saved.
--
-- Whoever saves a username holds a lock on it, capitals aside, until their
-- save is done, and then the other table is looked in. The second of two
-- saves at once waits for the first, then sees it and is refused as a
-- unique clash, which is answered as a username in use.
CREATE FUNCTION "username_once_across_accounts"() RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('username:' || lower(NEW.username)));
    IF TG_TABLE_NAME = 'User' THEN
        IF EXISTS (SELECT 1 FROM "SuperAdmin" WHERE lower(username) = lower(NEW.username)) THEN
            RAISE EXCEPTION 'A Super Admin has the username %', NEW.username
                USING ERRCODE = 'unique_violation', CONSTRAINT = 'username_once_across_accounts';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM "User" WHERE lower(username) = lower(NEW.username)) THEN
        RAISE EXCEPTION 'Somebody has the username %', NEW.username
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'username_once_across_accounts';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_username_once" BEFORE INSERT OR UPDATE OF username ON "User"
    FOR EACH ROW EXECUTE FUNCTION "username_once_across_accounts"();
CREATE TRIGGER "SuperAdmin_username_once" BEFORE INSERT OR UPDATE OF username ON "SuperAdmin"
    FOR EACH ROW EXECUTE FUNCTION "username_once_across_accounts"();
