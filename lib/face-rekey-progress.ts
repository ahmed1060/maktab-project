/**
 * How many stored photos the face photo key rotation says are still on the
 * old key while it goes on press by press (components/FaceSystemSwitch.tsx).
 * A press moves a bounded share and the full status is read again only at the
 * end (review on #33), so the screen keeps its own count meanwhile: what showed
 * when a press began, less what that press moved.
 *
 * The status can also be read again on its own, after a reconnect say, and
 * then it already has the presses' moves in it. Taking them off it again
 * showed fewer left than there were, as few as none (Codex review on #49).
 * Both counts can only be too high, never too low, as photos leave the old key
 * and none join it, so the lower one shows.
 */
export function photosLeft(own: number | null, status: number): number {
    return own === null ? status : Math.min(own, status)
}

/** The screen's own count after a press that moved `moved`, from what showed when it began. */
export function leftAfterPress(shown: number, moved: number): number {
    return Math.max(0, shown - moved)
}
