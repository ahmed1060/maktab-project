/**
 * Branding fallbacks that both sides of the wire need.
 *
 * This lives apart from SystemSettingsService because two client components
 * want the name and nothing else. Importing it from the service dragged the
 * service's Prisma client into the browser bundle along with it — harmless
 * looking under Prisma 5, which stubbed itself out for the browser, and a hard
 * build failure under Prisma 7, whose driver adapter reaches real node-postgres
 * and so asks webpack for `fs` and `dns`.
 *
 * A constant with no dependencies belongs in a module with no dependencies.
 */

// The fallback for the signature's name, used when the column is missing or has
// been emptied. Never an empty string: "Powered by" followed by nothing reads
// as a rendering bug, so clearing the field falls back here and switching the
// mark off entirely is the way to remove it.
export const DEFAULT_POWERED_BY_NAME = 'SHSD'
