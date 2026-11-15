import { receiveHikvision } from "@/lib/attendance/terminal-handler"

/**
 * Where a Hikvision terminal straight to Nizmo sends its events
 * (ATTENDANCE_PLAN.md §17.2, PR 291): set on the terminal as its HTTP
 * listening server, over HTTPS, with this path. The secret in the path is
 * the terminal's credential; the company is the terminal's. Answers with an
 * empty 200 once the request is taken, which is all a terminal reads.
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
    return receiveHikvision(req, (await params).secret)
}
