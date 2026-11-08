/**
 * A request's body as the audit log keeps it: any field whose name says it's
 * a password, a passcode, a token or a secret is hidden, at any depth. It hid
 * five names, as written, and a temporary password's route sends the Admin's
 * own as confirmPassword, which it kept as typed (PR 229).
 */
const SECRET_NAME = /password|passcode|token|secret/i

export function redactSecrets<T>(body: T): T {
    if (Array.isArray(body)) return body.map(redactSecrets) as T
    if (!body || typeof body !== "object") return body
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, SECRET_NAME.test(key) ? "[REDACTED]" : redactSecrets(value)])) as T
}
