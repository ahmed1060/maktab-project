/**
 * Text as text in an email's HTML (PR 325): the five characters HTML reads as
 * code written as text, so a name someone typed, a person's or a company's,
 * is shown as it was typed and never becomes part of the email. Everything
 * else is left as it is.
 */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ESCAPES[c])
