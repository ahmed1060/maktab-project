export class VerificationService {
    private static readonly PASSCODE = "2025"

    /**
     * Minimalist verification for high-risk actions.
     * Higher security would involve dynamic codes, but this acts as an effective "conscious gate".
     */
    static isValid(code: string): boolean {
        return code === this.PASSCODE
    }
}
