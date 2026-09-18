import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * The one Prisma client.
 *
 * Prisma 7 no longer opens the connection itself from a URL in the schema —
 * the query engine is gone and the client talks to the database through a
 * driver adapter. PrismaPg is node-postgres underneath, so the pool settings
 * below are now ours to state rather than something Prisma inferred from the
 * connection string.
 *
 * POSTGRES_PRISMA_URL is Supabase's pooled endpoint (pgBouncer in transaction
 * mode). Two things follow from that and both are set deliberately:
 *
 *  - max: 1. A serverless function handles one request at a time, so a larger
 *    local pool cannot make it faster; it can only hold open connections that
 *    the shared pooler then refuses to somebody else. The old
 *    `?connection_limit=1` in the URL said the same thing to the engine.
 *
 * The other half of what `?pgbouncer=true` used to buy is free here: it told
 * the Rust engine to stop naming its prepared statements, because a
 * transaction pooler hands a different backend to each transaction and a
 * statement prepared on one is missing on the next. node-postgres only names
 * a statement when the caller passes `name`, and this adapter never does, so
 * there is nothing to turn off.
 *
 * The global cache is unchanged and still matters for the same reason: in
 * development Next.js reloads this module on every edit, and without it each
 * reload would leak a pool.
 */

const globalForPrisma = global as unknown as { prisma: PrismaClient }

function createClient(): PrismaClient {
    const connectionString = process.env.POSTGRES_PRISMA_URL
    if (!connectionString) {
        // Said plainly, because the alternative is node-postgres quietly
        // falling back to a local socket and failing later with an error that
        // names neither this variable nor this file.
        throw new Error('POSTGRES_PRISMA_URL is not set')
    }

    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) })

    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
    return client
}

/**
 * Built on first use, not on import.
 *
 * Importing this module has to stay free of side effects. Plenty of modules
 * pull it in for a type or for one helper that never touches the database, and
 * several unit tests import such a module with no database configured at all —
 * constructing eagerly turned those into three import-time failures the moment
 * the connection string became required. The old client was lazy by accident,
 * because Prisma 5 read the URL when it first connected rather than when it
 * was constructed; this keeps that property on purpose.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
    get(_target, property, receiver) {
        const client = globalForPrisma.prisma ?? createClient()
        const value = Reflect.get(client, property, receiver)
        // Methods have to keep their receiver, or `this` inside the client
        // points at the proxy's empty target.
        return typeof value === 'function' ? value.bind(client) : value
    },
})
