import { NextResponse } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { reviewToDecide, reviewer } from "@/lib/attendance/face-access"

/**
 * One photo of an open review, the new one or the current reference
 * (ATTENDANCE_PLAN.md §9.5). Streamed through this check, never a public or
 * lasting URL, not cached, and every view audited.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const found = await reviewToDecide(session, id)
    if ("denied" in found) return found.denied
    const which = new URL(req.url).searchParams.get("which") === "reference" ? "reference" : "new"
    const photo = await FaceReviewService.photo(id, which, reviewer(session))
    return new NextResponse(new Uint8Array(photo), {
        status: 200,
        headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-store, private, max-age=0",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    })
})
