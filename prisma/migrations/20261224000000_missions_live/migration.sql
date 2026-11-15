-- Missions on the Requests page (ATTENDANCE_PLAN.md §6.10, Phase 5 part 4,
-- PR 283): the page and the count on Requests in the side bar draw
-- themselves again when a mission is asked for, decided or withdrawn, as
-- for every other kind (prisma/migrations/20261210000000_live_requests).
--
-- Only adds triggers, calling that migration's function for a request that
-- carries its company. No row is read or changed by it, and the release
-- before, which writes no mission, notices nothing.
CREATE TRIGGER "live_requests_inserted" AFTER INSERT ON "MissionRequest"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
CREATE TRIGGER "live_requests_updated" AFTER UPDATE ON "MissionRequest"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
CREATE TRIGGER "live_requests_deleted" AFTER DELETE ON "MissionRequest"
    REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
