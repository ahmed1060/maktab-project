export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { calendarDateStr, DEFAULT_TIME_ZONE } from '@/lib/time'

// The server's own answer to "what is today", so a client cannot shift it by
// changing the device clock. `now` is a real UTC instant — the two halves of
// the clock rule, in one response: the calendar date is local, the timestamp
// is not.
//
// Local to a company (review on PR 425): the signed-in person's own, or for the
// Super Admin the one asked about, as Add employee's contract start date is
// today in the calendar of the company they're joining. Cairo's with neither.
export const GET = withStandardHandler(async (req, session) => {
    const now = new Date()
    const companyId = session.user.role === 'SUPER_ADMIN' ? new URL(req.url).searchParams.get('companyId') : session.user.companyId
    const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } }) : null
    const timezone = company?.timezone ?? DEFAULT_TIME_ZONE
    return ApiResponse.success({
        today: calendarDateStr(now, timezone),
        now: now.toISOString(),
        timezone
    })
})
