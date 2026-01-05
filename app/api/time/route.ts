import { NextResponse } from 'next/server';
import { getEgyptTodayStr, getEgyptNow } from '@/lib/time';

export async function GET() {
    return NextResponse.json({
        today: getEgyptTodayStr(),
        now: getEgyptNow().toISOString(),
        timezone: 'Africa/Cairo'
    });
}
