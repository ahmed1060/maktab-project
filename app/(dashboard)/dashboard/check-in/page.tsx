'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { checkInDevice, inNativeApp } from '@/lib/mobile/native'
import CheckInScreen from './CheckInScreen'

const subscribeNever = () => () => {}

/**
 * Checking in (ATTENDANCE_PLAN.md §9): the phone, when this page is inside
 * the Nizmo app, and the screen (./CheckInScreen.tsx), which takes it as it
 * is, so it can be shown without a phone too.
 */
export default function CheckInPage() {
    // Read once the page is in the browser: the server can't know it's inside the app.
    const native = useSyncExternalStore(subscribeNever, inNativeApp, () => false)
    const device = useMemo(() => (native ? checkInDevice() : null), [native])
    return <CheckInScreen device={device} />
}
