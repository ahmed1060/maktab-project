/**
 * How the overlays above the building blocks' dialogs stack, bottom to top:
 * an older page's modal (components/Modal); a building-block dialog opened
 * over such a modal; and the code a high-risk action asks for (ROLES_PLAN.md
 * §6.15), a building-block dialog above every other (`aboveAll`, PR 217;
 * components/ui/ui.css). The code opens over the confirmation that sent the
 * action, which stays open, and busy, until the answer comes, so it must be
 * above it to be answered. The toasts are over them all.
 */
export const LAYER = { modal: 9999, confirm: 10000, codePrompt: 10001 } as const
