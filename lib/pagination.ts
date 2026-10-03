import { z } from "zod"

export type Paging = { page: number; limit: number; skip: number }

/**
 * Shared page/limit parser for list routes.
 *
 * Two failure modes this closes (F-08):
 *  - `?limit=999999` used to be handed straight to Prisma/Postgres, which
 *    would ask for (effectively) the whole table through the pooled
 *    connection on a single request.
 *  - `?limit=abc` used to parseInt to NaN, which Prisma rejects with an
 *    unhandled 500 instead of a clean 400.
 *
 * Invalid or out-of-range input falls back to sane defaults rather than
 * throwing, so callers don't need their own try/catch just to page a list.
 *
 * A limit above the cap is lowered to the cap, not replaced by the default.
 * It used to fall back to the default, so a screen asking /api/users for
 * `limit=1000` (every Team Leader, for a picker) got 10 and never showed the
 * eleventh. Each of page and limit also falls back on its own: a bad page no
 * longer resets a good limit.
 */
export function parsePaging(searchParams: URLSearchParams, defaultLimit = 20, maxLimit = 100): Paging {
    const whole = (raw: string | null) => {
        const n = z.coerce.number().int().safeParse(raw ?? undefined)
        return n.success ? n.data : undefined
    }

    const askedPage = whole(searchParams.get("page"))
    const askedLimit = whole(searchParams.get("limit"))
    const page = askedPage !== undefined && askedPage >= 1 ? askedPage : 1
    const limit = askedLimit !== undefined && askedLimit >= 1 ? Math.min(askedLimit, maxLimit) : defaultLimit

    return { page, limit, skip: (page - 1) * limit }
}
