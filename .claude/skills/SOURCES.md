# Where these skills come from

The design tools in `UI_PLAN.md` §7. Each was read in full, scripts included,
before it was added, and each is pinned to the version below (§7.3). To
update one, read the new version in full, replace the files, and change its
entry here in the same commit.

| Skill | Source | Pinned at | Licence |
|---|---|---|---|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), `.claude/skills/ui-ux-pro-max` | `09170eec67eefd46a7ae85de61b40c194020f997` (2026-09-27) | MIT |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), `skills/web-design-guidelines`; its rules from [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), `command.md` | skill `063bee94c3f4df8453406c830b0a7df0f2860278` (2026-08-28); rules `434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05) | MIT |

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

## Not added

- **Impeccable** ([pbakaus/impeccable](https://github.com/pbakaus/impeccable)):
  - its `SKILL.md` asks for `scripts/impeccable` to be run at the start of
    every session;
  - that launcher runs a compiled program, which it downloads on first use
    into `~/.impeccable/bin/`;
  - that program can't be read like the rest, and isn't pinned.

  So it can't meet the rule in §7.3 as it ships. Whether to add its written
  guidance alone is an open question in `UI_PLAN.md` §6.
- **Emil Design Engineering:** added with the motion work (`UI_PLAN.md` §7.1).
- **Frontend Design:** used once, to write `DESIGN.md`, and not kept.
