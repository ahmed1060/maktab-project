import pg from 'pg'

/**
 * A database connection that is given its queries one at a time (PR 268;
 * TROUBLESHOOTING.md).
 *
 * A connection runs one query at a time. node-postgres used to queue a query
 * handed to it while another was still on its way, and now warns that pg 9
 * will refuse it instead. Inside a transaction, which is one connection, that
 * happened in two ways:
 *
 *  - Prisma 7 fetches a read's relations at once: a task read with its
 *    assignees, its company and its place sends three queries together.
 *  - Our own Promise.all over a transaction's queries, as the company's time
 *    zone was read, with the system's default, while a task was submitted.
 *
 * So each connection keeps its own turn: a query waits for the one before it
 * to be answered, whether that one succeeded or failed, then goes. That is
 * exactly what pg's queue did, so nothing is slower: on one connection they
 * were one at a time anyway. Outside a transaction, the pool gives each query
 * a connection of its own, and this changes nothing.
 *
 * Only the promise form is taken in turn, which is the one Prisma's adapter
 * uses. A query given a callback, as the pool's own `pool.query` gives one,
 * and a cursor or stream, go to pg as they are.
 */
export class OneAtATimeClient extends pg.Client {
    private turn: Promise<unknown> = Promise.resolve()

    // pg's query has many overloads; this keeps every one of them and adds the turn.
    query(...args: unknown[]): never {
        const last = args[args.length - 1]
        const first = args[0] as { submit?: unknown } | undefined
        const sendNow = () => (pg.Client.prototype.query as (...a: unknown[]) => unknown).apply(this, args)
        if (typeof last === 'function' || typeof first?.submit === 'function') return sendNow() as never
        const answer = this.turn.then(sendNow)
        // The next waits for this one's answer, not for it to succeed.
        this.turn = answer.catch(() => undefined)
        return answer as never
    }
}
