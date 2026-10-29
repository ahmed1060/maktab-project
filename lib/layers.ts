/**
 * How the older overlays stack, bottom to top: an older page's modal; a
 * confirmation, or a building-block dialog opened over such a modal; and the
 * code a high-risk action asks for (ROLES_PLAN.md §6.15). The code opens
 * over the confirmation that sent the action, which stays open, and busy,
 * until the answer comes, so it must be above it to be answered.
 */
export const LAYER = { modal: 9999, confirm: 10000, codePrompt: 10001 } as const
