-- Live updates, part 4a (REALTIME_PLAN.md): the database says when a
-- company's cash advances change, so the screens that show them draw
-- themselves again: the Costs page's Cash advances tab, a person's cash
-- advance and My cash advance, Add cost's line about the advance, and an
-- open Give advance, Record return or Correction window.
--
-- Only adds things: two functions and the triggers that call them. No row is
-- read or changed by it, and nothing anyone does today works differently.
--
-- As the other parts' signals, it says only that something changed, never
-- what: its event is 'advances' and its payload empty. No names, no amounts.
-- It goes on the channel part 1 already lets a company's people hear
-- (tasks:<company id>), and on each Super Admin's own (notices:<id>): a
-- Super Admin opens anyone's cash advance from wherever they are, with
-- another company in view or none, and hears no company's channel then.
--
-- Every way the ledger changes is covered, from its one table
-- ("CashAdvanceEntry"): an advance given, returned or corrected, a receipt
-- confirmed, a cost paid from it or put back, money moved to the running
-- balance or passed on with a transfer, and a balance turned into a debt as
-- a contract ends. And an entry's task, cost or client deleted, which the
-- history line says. One per statement for each company it touched, and one
-- for each Super Admin.

-- A statement's companies, and every Super Admin, told that `event` changed.
-- For the later parts too (costs and charges, attendance).
CREATE OR REPLACE FUNCTION live_company_signal(event text, companies text[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    company text;
    admin text;
    touched boolean := false;
BEGIN
    FOR company IN SELECT DISTINCT c FROM unnest(companies) c WHERE c IS NOT NULL ORDER BY 1 LOOP
        PERFORM live_signal('tasks:' || company, event);
        touched := true;
    END LOOP;
    IF touched THEN
        FOR admin IN SELECT id FROM "SuperAdmin" ORDER BY 1 LOOP
            PERFORM live_signal('notices:' || admin, event);
        END LOOP;
    END IF;
END
$$;

-- As the other parts' triggers, each branch reads only the transition table
-- its event has; a branch not taken is never planned, so the other is never
-- looked for. An entry's company never changes, but both are read on an
-- update all the same.
CREATE OR REPLACE FUNCTION live_advances_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_company_signal('advances', array(SELECT "companyId" FROM live_new));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_company_signal('advances', array(SELECT "companyId" FROM live_old));
    ELSE
        PERFORM live_company_signal('advances', array(SELECT "companyId" FROM live_new UNION SELECT "companyId" FROM live_old));
    END IF;
    RETURN NULL;
END
$$;

-- Three triggers, one for each event, as the other parts': a trigger with
-- transition tables handles one event, and none may name its columns.
CREATE TRIGGER live_advances_inserted AFTER INSERT ON "CashAdvanceEntry"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_advances_changed();
CREATE TRIGGER live_advances_updated AFTER UPDATE ON "CashAdvanceEntry"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_advances_changed();
CREATE TRIGGER live_advances_deleted AFTER DELETE ON "CashAdvanceEntry"
    REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION live_advances_changed();
