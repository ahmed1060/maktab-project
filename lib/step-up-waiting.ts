/**
 * The requests waiting on the step-up prompt (components/StepUpInterceptor).
 *
 * Two high-risk requests refused at once share one prompt, and its answer
 * settles both: confirmed, each is sent again; cancelled, each gets its
 * refusal. A prompt that held only the latest request left the earlier one
 * pending for good, and whatever screen sent it stuck.
 */
export function stepUpWaiting() {
    let waiting: ((confirmed: boolean) => void)[] = []
    return {
        /** Wait for the prompt's answer; `show` is called for the first request waiting. */
        wait(show: () => void): Promise<boolean> {
            return new Promise<boolean>(resolve => {
                waiting.push(resolve)
                if (waiting.length === 1) show()
            })
        },
        /** The prompt's answer, for every request waiting on it. */
        settle(confirmed: boolean) {
            const settled = waiting
            waiting = []
            for (const resolve of settled) resolve(confirmed)
        },
    }
}
