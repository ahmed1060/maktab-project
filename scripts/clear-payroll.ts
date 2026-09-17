/**
 * Clear the payroll figures, once, before real payroll starts.
 *
 * Everything in these two tables was typed to exercise a feature. None of it is
 * anybody's pay. But an irreversible mass delete against a live database is the
 * most dangerous thing in this plan, and the honest way to treat it is as
 * something that refuses by default and has to earn its way to running.
 *
 *   npx tsx scripts/clear-payroll.ts --all              # dry run, deletes nothing
 *   npx tsx scripts/clear-payroll.ts --all --execute    # only if every check passes
 *
 * Dry run is the default. There is no flag that skips a failed check: an escape
 * hatch on a gate like this gets used exactly once, in the moment somebody is in
 * a hurry, which is the moment the gate exists for.
 */
import { PrismaClient } from "@prisma/client"
import {
    CLEARED,
    KEPT,
    decideClear,
    hostOf,
    confirmationPhraseFor,
    looksLikeProvedDrill,
    type ClearCheck,
} from "../lib/payroll-clear"
import { BACKUP_STALE_AFTER_HOURS, backupAgeHours } from "../lib/backup-age"

const prisma = new PrismaClient()

// Same repository the restore route dispatches to. Spelled here rather than
// inferred, because a wrong guess would check somebody else's Actions history
// and pass.
const REPO = process.env.GITHUB_REPOSITORY || "ahmed1060/maktab-project"

function parseArgs(argv: string[]) {
    const execute = argv.includes("--execute")
    const all = argv.includes("--all")
    const companyArg = argv.find(a => a.startsWith("--company="))
    const companyId = companyArg ? companyArg.slice("--company=".length) : null
    return { execute, all, companyId }
}

/** The confirmation names the database, so a phrase cannot be pasted at another one. */
async function checkConfirmation(host: string | null): Promise<ClearCheck> {
    if (!host) {
        return {
            name: "Target database",
            passed: false,
            detail: "DATABASE_URL is missing or unparseable, so there is nothing to confirm against.",
            remedy: "Set DATABASE_URL to the database you mean to clear.",
        }
    }

    const expected = confirmationPhraseFor(host)
    const given = (process.env.CLEAR_PAYROLL_CONFIRM || "").trim()

    return {
        name: "Typed confirmation",
        passed: given === expected,
        detail: given
            ? `CLEAR_PAYROLL_CONFIRM does not match this database.`
            : "CLEAR_PAYROLL_CONFIRM is not set.",
        remedy: `Set CLEAR_PAYROLL_CONFIRM to exactly: ${expected}`,
    }
}

/** There has to be something to go back to. */
async function checkBackup(): Promise<ClearCheck> {
    try {
        const { GDriveService } = await import("../lib/services/gdrive.service")
        const backups = await GDriveService.listBackups()
        const newest = backups[0]

        if (!newest) {
            return {
                name: "Recent backup",
                passed: false,
                detail: "Google Drive has no backups at all.",
                remedy: "Run the backup workflow and confirm it succeeds before clearing anything.",
            }
        }

        const age = backupAgeHours(newest.modifiedTime)
        const fresh = !Number.isNaN(age) && age <= BACKUP_STALE_AFTER_HOURS

        return {
            name: "Recent backup",
            passed: fresh,
            detail: `Newest backup is ${newest.folder}/${newest.baseName}, ${Number.isNaN(age) ? "of unknown age" : `${age.toFixed(1)}h old`}.`,
            remedy: `Take a fresh backup — the newest must be under ${BACKUP_STALE_AFTER_HOURS}h old.`,
        }
    } catch (error: any) {
        // Unreachable is a failure, not an unknown. The whole point of this
        // check is that a restore is possible, and "I could not ask" does not
        // establish that.
        return {
            name: "Recent backup",
            passed: false,
            detail: `Could not reach Google Drive: ${error?.message ?? error}`,
            remedy: "Fix the Drive credentials, then re-run. An unreachable backup store is not a passing check.",
        }
    }
}

/**
 * A restore has actually been proved against a scratch database.
 *
 * Read from GitHub's own run history rather than from anything the operator
 * supplies. Until the restore path has been exercised end to end, the backups
 * are a belief rather than a fact, and deleting data on the strength of a
 * belief is how people discover their backups do not restore.
 */
async function checkDrill(): Promise<ClearCheck> {
    const token = process.env.GITHUB_DISPATCH_TOKEN
    if (!token) {
        return {
            name: "Restore drill proved",
            passed: false,
            detail: "GITHUB_DISPATCH_TOKEN is not set, so the drill history cannot be read.",
            remedy: "Provide the same token the dashboard's restore card uses, so this can verify the drill actually ran.",
        }
    }

    try {
        const res = await fetch(
            `https://api.github.com/repos/${REPO}/actions/workflows/restore.yml/runs?per_page=50`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            },
        )

        if (!res.ok) {
            return {
                name: "Restore drill proved",
                passed: false,
                detail: `GitHub returned ${res.status} for the restore workflow's run history.`,
                remedy: "The token needs read access to Actions. Without it this check cannot pass.",
            }
        }

        const body = await res.json() as { workflow_runs?: any[] }
        const drill = (body.workflow_runs ?? []).find(looksLikeProvedDrill)

        return {
            name: "Restore drill proved",
            passed: Boolean(drill),
            detail: drill
                ? `Last successful drill: ${drill.display_title} on ${drill.updated_at}.`
                : "No successful run of restore.yml with target 'drill' was found.",
            remedy:
                "Set DRILL_DATABASE_URL to a scratch Supabase project, then run the Restore workflow with target 'drill' and let it finish green.",
        }
    } catch (error: any) {
        return {
            name: "Restore drill proved",
            passed: false,
            detail: `Could not reach GitHub: ${error?.message ?? error}`,
            remedy: "Re-run when GitHub is reachable. This check does not pass on a network error.",
        }
    }
}

async function countTargets(companyId: string | null) {
    const userWhere = companyId ? { user: { companyId } } : {}
    const [adjustments, records] = await Promise.all([
        prisma.salaryAdjustment.count({ where: userWhere as any }),
        prisma.salaryRecord.count({ where: userWhere as any }),
    ])
    return { SalaryAdjustment: adjustments, SalaryRecord: records }
}

async function main() {
    const { execute, all, companyId } = parseArgs(process.argv.slice(2))

    if (!all && !companyId) {
        // No default scope. Making the choice explicit is the point: the
        // difference between one tenant and every tenant is not a thing to
        // leave to a default.
        console.error("Scope is required: pass --all, or --company=<companyId>.")
        process.exit(2)
    }
    if (all && companyId) {
        console.error("Pass --all or --company=<id>, not both.")
        process.exit(2)
    }

    const host = hostOf(process.env.DATABASE_URL)
    const scope = companyId ? `company ${companyId}` : "every company"

    console.log(`\nPayroll clear — ${execute ? "EXECUTE" : "DRY RUN"}`)
    console.log(`Database: ${host ?? "unknown"}`)
    console.log(`Scope:    ${scope}\n`)

    const counts = await countTargets(companyId)

    console.log("Would delete:")
    for (const target of CLEARED) {
        console.log(`  ${String(counts[target.table as keyof typeof counts] ?? 0).padStart(7)}  ${target.table}`)
        console.log(`           ${target.because}`)
    }

    console.log("\nWould keep:")
    for (const kept of KEPT) {
        console.log(`  ${kept.table}`)
        console.log(`           ${kept.because}`)
    }

    const checks = [
        await checkConfirmation(host),
        await checkBackup(),
        await checkDrill(),
    ]

    console.log("\nPreflight:")
    for (const check of checks) {
        console.log(`  ${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`)
        if (!check.passed && check.remedy) console.log(`        → ${check.remedy}`)
    }

    const decision = decideClear(checks)

    if (!execute) {
        console.log(`\nDry run. Nothing was deleted.`)
        console.log(decision.proceed
            ? "Every check passes — re-run with --execute to delete."
            : `${decision.blocking.length} check(s) would block an --execute run.`)
        return
    }

    if (!decision.proceed) {
        console.error(`\nRefusing to delete: ${decision.blocking.map(c => c.name).join(", ")}.`)
        process.exit(1)
    }

    // One transaction. A half-cleared payroll — adjustments gone, records left
    // holding totals nothing adds up to — is worse than either end state.
    const userWhere = companyId ? { user: { companyId } } : {}
    const result = await prisma.$transaction(async (tx) => {
        const adjustments = await tx.salaryAdjustment.deleteMany({ where: userWhere as any })
        const records = await tx.salaryRecord.deleteMany({ where: userWhere as any })
        return { adjustments: adjustments.count, records: records.count }
    })

    console.log(`\nDeleted ${result.adjustments} adjustments and ${result.records} salary records.`)
}

main()
    .catch(error => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
