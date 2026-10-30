/**
 * Who decided a task or an obligation, as it's said: their name. It's saved
 * with their role's code before it ("ADMIN Hana Saad"), which isn't a word
 * anyone reads.
 */
export function decidedByName(saved: string): string {
    return saved.replace(/^(SUPER_ADMIN|ADMIN|TEAM_LEADER|EMPLOYEE) /, '')
}
