export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { calendarDateStr, DEFAULT_TIME_ZONE } from '@/lib/time'

// The server's own answer to "what is today", so a client cannot shift it by
// changing the device clock. `now` is a real UTC instant — the two halves of
// the clock rule, in one response: the calendar date is local, the timestamp
// is not.
export const GET = withStandardHandler(async () => {
    const now = new Date()
    return ApiResponse.success({
        today: calendarDateStr(now),
        now: now.toISOString(),
        timezone: DEFAULT_TIME_ZONE
    })
})
