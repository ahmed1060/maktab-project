import type { Prisma } from "@prisma/client"

/**
 * Marks a transaction's writes as this release's (migration
 * 20261104000003_records_grants_kept). While main's release still runs
 * against the database, a records.* grant stays whenever a write without
 * this mark would remove it, since main's role and template editors save
 * every grant they know and drop the rest. Called before RoleService and
 * RoleTemplateService replace grants, so this release can still take one
 * away. 0b removes it, with the triggers, once main's release is gone.
 */
export async function asRecordsRelease(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT set_config('nizmo.release', 'records', true)`
}
