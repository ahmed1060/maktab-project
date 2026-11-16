import { receiveZkteco } from "@/lib/attendance/zkteco-handler"

/**
 * Where a ZKTeco terminal straight to Nizmo calls (ATTENDANCE_PLAN.md
 * §17.3, PR 296): the paths its ADMS protocol fixes under `/iclock/`, at
 * the root of Nizmo's address and outside the proxy (`proxy.ts`). Its
 * serial number names it, and the office's address it calls from proves
 * it. It asks for its options, sends its scans, and asks for commands,
 * of which there are none: the last is its heartbeat.
 */
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
    return receiveZkteco(req)
}

export async function POST(req: Request) {
    return receiveZkteco(req)
}
