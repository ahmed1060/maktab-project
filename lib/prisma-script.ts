import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { poolConfigFrom } from './postgres-ssl'

/**
 * A Prisma client for the command-line scripts — the seeds and the payroll
 * clear — rather than for a request.
 *
 * It exists because Prisma 7 requires a driver adapter, and what these scripts
 * need from one is the opposite of what a serverless request needs. They are
 * long-running and single-threaded, so they take the direct connection rather
 * than the shared pooler: a seed that writes thousands of rows should not be
 * holding a slot in the pool the live application is trying to use, and a
 * pooler in transaction mode is a poor host for the long transactions these
 * scripts run.
 *
 * lib/prisma.ts is the other half of this pair and deliberately not reused
 * here — importing it would give a script the pooled, max: 1 client meant for
 * a request handler.
 */
export function createScriptClient(): PrismaClient {
    const connectionString =
        process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL

    if (!connectionString) {
        throw new Error(
            'Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_PRISMA_URL before running this script',
        )
    }

    return new PrismaClient({ adapter: new PrismaPg(poolConfigFrom(connectionString)) })
}
