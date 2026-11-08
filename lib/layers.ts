/**
 * How the overlays above the building blocks' dialogs stack, bottom to top:
 * a building-block dialog opened over another, as a new location over a
 * task's edit window (`overModal`); and the code a high-risk action asks for
 * (ROLES_PLAN.md §6.15), a building-block dialog above every other
 * (`aboveAll`, PR 217; components/ui/ui.css). The code opens over the
 * confirmation that sent the action, which stays open, and busy, until the
 * answer comes, so it must be above it to be answered. The toasts are over
 * them all. The older pages' window, which had a layer of its own under
 * these, went in PR 222.
 */
export const LAYER = { confirm: 10000, codePrompt: 10001 } as const
