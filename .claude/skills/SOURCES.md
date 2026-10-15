# Where these skills come from

The design tools in `UI_PLAN.md` §7. Each was read in full, scripts included,
before it was added, and each is pinned to the version below (§7.3). To
update one, read the new version in full, replace the files, and change its
entry here in the same commit.

| Skill | Source | Pinned at | Licence |
|---|---|---|---|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), `.claude/skills/ui-ux-pro-max` | `09170eec67eefd46a7ae85de61b40c194020f997` (2026-09-27) | MIT |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), `skills/web-design-guidelines`; its rules from [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), `command.md` | skill `063bee94c3f4df8453406c830b0a7df0f2860278` (2026-08-28); rules `434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05) | MIT |
| `impeccable` (written guidance only) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable), `.claude/skills/impeccable` | `d631a8827f99414d2b6daba4ef08b7f8701751d7` (2026-10-08, tag `skill-v4.5.2`) | Apache 2.0 |

## What was changed here

- **`ui-ux-pro-max`:** the 47 files are identical to the pinned commit,
  except for a note at the top of `SKILL.md` on how it's used in Nizmo.
  The upstream project's own tests (`scripts/tests/`) are left out.
  - **What it runs:** its scripts use only Python's standard library. They
    make no network calls and run no other programs.
  - **What it writes:** only with `--persist`, which makes a `design-system/`
    folder. The note says not to use it, because `DESIGN.md` is the design
    system.
- **`web-design-guidelines`:** upstream, the skill fetches its rules from
  GitHub's `main` on every run, which would make it unpinned. Here the rules
  are a copy in `guidelines.md`, identical to the pinned commit, and
  `SKILL.md` reads that copy. `SKILL.md` also lists where `DESIGN.md`
  differs: sentence case instead of Title Case, logical properties, and
  tokens.
- **`impeccable`:** only its written guidance, as decided on 2026-10-15
  (`UI_PLAN.md` §6, question 8).
  - **Left out, the launcher:** upstream's `SKILL.md` runs `scripts/impeccable`
    at the start of every session. The launcher runs a compiled program,
    downloaded on first use into `~/.impeccable/bin/`, which can't be read
    like the rest and isn't pinned. Nothing from `scripts/` is here, so
    nothing in this folder runs code.
  - **Copied unchanged:** 19 of the 41 reference pages, the ones for
    building and refining web app screens: `adapt`, `animate`, `audit`,
    `bolder`, `clarify`, `colorize`, `craft-floor`, `delight`, `distill`,
    `extract`, `harden`, `layout`, `onboard`, `operate`, `optimize`,
    `polish`, `quieter`, `shape`, `typeset`. Also `LICENSE`.
  - **Rewritten:** `SKILL.md`. It says it was changed, as Apache 2.0 asks.
    It replaces the launcher's steps with reading `DESIGN.md` and
    `UI_PLAN.md`, the Vercel audit, Playwright and the guard tests, and
    lists where `DESIGN.md` differs.
  - **Left out, the other 22 pages and the `degraded/` folder:**
    - they drive the launcher, its live browser or its image generation:
      `live`, `live-setup`, `generate`, `hooks`, `doctor`, `routing`,
      `visualize`, `component-review`, `critique` (whose rules count a run
      without the launcher's detector as failed), `region-map`, `new-work`,
      `mode-operate`, and the subagent roles in `degraded/`;
    - they write a product file or a new `DESIGN.md`, which Nizmo already
      has: `init`, `document`;
    - native apps: `ios`, `android`, `adapt.native`, `audit.native`;
    - other kinds of page, or a deprecated alias: `mode-persuade`,
      `mode-read`, `overdrive`, `craft`.
  - **`NOTICE.md`:** upstream's notice covers only `ios.md` and
    `android.md`, which aren't copied, so it isn't needed here.
  - **Updating:** read the new version's pages in full, copy them over
    unchanged, check that `SKILL.md`'s list of left-out steps still holds,
    and change this entry in the same commit.

## Not added

- **Emil Design Engineering:** added with the motion work (`UI_PLAN.md` §7.1).
- **Frontend Design:** used once, to write `DESIGN.md`, and not kept.
