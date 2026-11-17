-- The client portal add-on (CLIENT_PORTAL_PLAN.md §2, PR 310). Off on every
-- package there, so no company's access changes. A company with no package
-- hasn't it either: the feature gate leaves it out of what such a company
-- has (lib/features/bundles.ts).

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "hasClientPortal" BOOLEAN NOT NULL DEFAULT false;

-- The rule the service enforces, held by the database too: not without
-- Company Management, where clients are.
ALTER TABLE "Package" ADD CONSTRAINT "Package_client_portal_requires_company_management"
    CHECK ("hasCompanyManagement" OR NOT "hasClientPortal");
