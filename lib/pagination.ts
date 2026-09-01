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
 */
export function parsePaging(searchParams: URLSearchParams, defaultLimit = 20, maxLimit = 100): Paging {
    const schema = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    })

    const result = schema.safeParse({
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
    })

    const { page, limit } = result.success ? result.data : { page: 1, limit: defaultLimit }

    return { page, limit, skip: (page - 1) * limit }
}
