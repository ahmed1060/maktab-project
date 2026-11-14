-- Who sets a company's fingerprint terminals up (ATTENDANCE_PLAN.md §17.10,
-- round 9; Phase 4 part 2): the Super Admin's switch letting the company's
-- people holding attendance.manage_terminals do it. Off for every company,
-- so the Super Admin alone does, as today: nobody in a company opens the
-- Fingerprint terminals section until it's turned on. Additive: one column
-- with a default, nothing already saved is changed, and the release before
-- this one doesn't read it.
ALTER TABLE "Company" ADD COLUMN "terminalsSetupByCompany" BOOLEAN NOT NULL DEFAULT false;
