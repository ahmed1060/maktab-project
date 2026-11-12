-- Live updates, part 4b (REALTIME_PLAN.md): the database says when a
-- company's costs change in ways its tasks' own signal doesn't, so the
-- screens that show them draw themselves again: the Costs page's Employee
-- costs and Charged to clients tabs, and a client's charges on their page.
--
-- Only adds things: three functions and the triggers that call them. No row
-- is read or changed by it, and nothing anyone does today works differently.
--
-- As the other parts' signals, it says only that something changed, never
-- what: its event is 'costs' and its payload empty. No names, no amounts.
--
-- A cost is added or removed with its task, whose total and shares change
-- in the same transaction, and a share is paid on the task itself: part 1
-- tells the company's channel (tasks:<company id>) of those already, and
-- the screens draw again with it. Every open tab of the company hears that
-- channel, so a signal of costs' own for each would be heard by them all
-- again. What changes a cost without its task, its charge, is told to the
-- company here: a service fee set, left off its client's bill or charged
-- again, collected or uncollected, or its cost name merged or deleted.
--
-- The Super Admin hears no company's channel with no company in view, and
-- opens any client's page from wherever they are, so their own channel
-- (notices:<id>) hears 'costs' for every change the screens show: a cost
-- added, changed or removed, a task deleted with its costs, and any change
-- to a task with costs. One per statement.

-- Every Super Admin told that `event` changed, whatever company it was.
CREATE OR REPLACE FUNCTION live_super_admin_signal(event text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    admin text;
BEGIN
    FOR admin IN SELECT id FROM "SuperAdmin" ORDER BY 1 LOOP
        PERFORM live_signal('notices:' || admin, event);
    END LOOP;
END
$$;

-- A cost: changed, to its company and every Super Admin (part 4a's
-- live_company_signal), as nothing else tells the company; added or
-- removed, to every Super Admin, as the company hears its task change with
-- it. As the other parts' triggers, each branch reads only the transition
-- table its event has. A cost removed with its task, as the task is
-- deleted, finds no task to name a company: its company hears the task go.
CREATE OR REPLACE FUNCTION live_costs_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        PERFORM live_company_signal('costs', array(
            SELECT t."companyId" FROM live_new c JOIN "Task" t ON t.id = c."taskId"
        ));
    ELSIF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM live_new) THEN
            PERFORM live_super_admin_signal('costs');
        END IF;
    ELSIF EXISTS (SELECT 1 FROM live_old) THEN
        PERFORM live_super_admin_signal('costs');
    END IF;
    RETURN NULL;
END
$$;

-- A task with costs changing, to every Super Admin: paid, reviewed,
-- renamed, moved to another client, or its total and shares changing as a
-- cost is removed. Its company hears part 1's signal for it.
CREATE OR REPLACE FUNCTION live_costs_tasks_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM live_new n WHERE EXISTS (SELECT 1 FROM "TaskCost" c WHERE c."taskId" = n.id)) THEN
        PERFORM live_super_admin_signal('costs');
    END IF;
    RETURN NULL;
END
$$;

-- One trigger for each event, as the other parts': a trigger with
-- transition tables handles one event, and none may name its columns.
CREATE TRIGGER live_costs_inserted AFTER INSERT ON "TaskCost"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_costs_changed();
CREATE TRIGGER live_costs_updated AFTER UPDATE ON "TaskCost"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_costs_changed();
CREATE TRIGGER live_costs_deleted AFTER DELETE ON "TaskCost"
    REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION live_costs_changed();
CREATE TRIGGER live_costs_tasks_updated AFTER UPDATE ON "Task"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_costs_tasks_changed();
