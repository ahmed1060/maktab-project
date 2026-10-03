'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { checkInDevice } from '@/lib/mobile/native'
import { enablePush, onPushTapped, pushPlugin } from '@/lib/mobile/push'
import { send, json } from '@/app/(dashboard)/dashboard/attendance/send'

/**
 * Inside the Nizmo app only (ATTENDANCE_PLAN.md §13.4): turns pushes on for
 * this phone once per launch, and opens the page a tapped notice is about.
 * Renders nothing.
 */
export default function AppPush() {
    const router = useRouter()
    useEffect(() => {
        const device = checkInDevice()
        const push = pushPlugin()
        if (!device || !push) return
        const post = async (url: string, body: unknown) => {
            const r = await send(url, json('POST', body), 'push')
            if (!r.ok) throw new Error(r.error)
            return r.body
        }
        void enablePush(device, push, post)
        let stop: (() => void) | null = null
        let gone = false
        void onPushTapped(push, path => router.push(path)).then(s => { if (gone) s(); else stop = s })
        return () => { gone = true; stop?.() }
    }, [router])
    return null
}
