export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { getEgyptTodayStr, getEgyptNow } from '@/lib/time'

export const GET = withStandardHandler(async () => {
    return ApiResponse.success({
        today: getEgyptTodayStr(),
        now: getEgyptNow().toISOString(),
        timezone: 'Africa/Cairo'
    })
})
