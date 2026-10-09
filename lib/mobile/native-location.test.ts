import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The phone's location, as the native check-in plugins take it (§9.4). No
 * Android SDK or Xcode here, so the sources are read for the rules.
 */
describe("the phone's location for a check-in", () => {
    const java = readFileSync("mobile/android/app/src/main/java/com/shsd/nizmo/NizmoCheckInPlugin.java", "utf8")

    it("on Android, is never a fix taken before it was asked for, and waits for a live one instead (review on #61)", () => {
        // Up to 30 s old was accepted: a person who had just left the office could sign where they were.
        expect(java).toContain("long askedAt = SystemClock.elapsedRealtimeNanos();")
        expect(java).toContain("return location.getElapsedRealtimeNanos() >= askedAt;")
        expect(java).toContain("if (location == null || takenSince(location, askedAt)) answer(call, location);\n                    else liveUpdate(manager, provider, call, askedAt);")
        // Updates go on past an old one until the timeout; a single update ended at the first.
        expect(java).toContain("if (done[0] || !takenSince(location, askedAt)) return;")
        expect(java).toContain("manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper());")
        expect(java).not.toMatch(/MAX_FIX_AGE_MS|ageMillis|requestSingleUpdate/)
    })
})
