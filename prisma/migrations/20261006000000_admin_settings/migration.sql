-- A company's own people seeing its settings (ATTENDANCE_PLAN.md §5.2): off by
-- default, so nobody's access changes until the Super Admin switches it on.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "adminSettingsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "adminSettingsTabs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The built-in Admin role's new grants: lib/permissions/built-in.ts, row for
-- row. They open nothing while the company's switch is off.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'settings.view', 'COMPANY'),
    ('ADMIN', 'settings.edit', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Holders reload their grants within a minute.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
