import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { poolConfigFrom } from './postgres-ssl'

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
 *  - max: 5, and emphatically not 1.
 *
 *    One is the tempting answer, and it deadlocks. A serverless function
 *    handles one *request* at a time, but a single request is not the same as
 *    a single connection: an interactive transaction holds one for its whole
 *    duration, and if anything inside it queries through this client rather
 *    than through the transaction's own `tx`, that query needs a second.
 *
 *    That is not hypothetical — it is what SalaryService.addAdjustment does.
 *    It opens a transaction, and applyAdjustment inside it calls
 *    baseSalaryFor, which goes through the global client. With a pool of one
 *    the inner query waits for a connection the outer transaction is holding,
 *    neither can finish, and it dies five seconds later on the interactive
 *    transaction timeout. Adding a bonus or a deduction failed outright.
 *
 *    Prisma 5 hid this: its engine sized its own pool at num_cpus * 2 + 1
 *    unless the URL said otherwise, and the URL never did. Setting max: 1 here
 *    reproduced a limit production never had.
 *
 *    Five, not fifty: the pooler is shared, and idle connections held by a
 *    sleeping lambda are connections somebody else is refused. Five leaves
 *    room for the nesting above without hoarding.
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

    // poolConfigFrom rather than the raw string: see lib/postgres-ssl.ts for
    // why handing the URL straight to node-postgres breaks TLS against Supabase.
    const client = new PrismaClient({
        adapter: new PrismaPg(poolConfigFrom(connectionString, { max: 5 })),
    })

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
