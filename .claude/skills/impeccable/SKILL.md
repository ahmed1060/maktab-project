---
name: impeccable
description: Use when building or refining a Nizmo screen or building block (layout, type, colour, states, copy, responsive behaviour, motion, polish, or a technical UI audit). Impeccable's written guidance, without its launcher, read alongside DESIGN.md.
version: 4.5.2 (adapted for Nizmo)
license: Apache 2.0
---

# Impeccable, adapted for Nizmo

This is Impeccable's written guidance, version 4.5.2: 19 of its reference
pages, copied unchanged. **This `SKILL.md` is not Impeccable's own:** it was
rewritten for Nizmo, as the Apache 2.0 licence asks a changed file to say.
`.claude/skills/SOURCES.md` says where it came from, what was left out, and
how to update it.

## What isn't here

Upstream, the skill starts every session by running `scripts/impeccable
context`. That launcher downloads and runs a compiled program, which can't be
read like the rest of the skill and isn't pinned (`UI_PLAN.md` §7.3). So
there's no launcher here and nothing in this folder runs code.

Do what upstream says to do when the launcher is unavailable: read the
project's context directly.

- **Product context:** `UI_PLAN.md` (what's decided and why) and `DESIGN.md`
  §1. There's no `PRODUCT.md`; don't write one.
- **The visual world:** `DESIGN.md`. It's decided (style A, "Polished",
  `UI_PLAN.md` §7.2), so this skill works inside it and never replaces it.

Where a page says to run `.claude/skills/impeccable/scripts/impeccable …`
(`detect`, `critique-storage`, `live-server` and the rest), skip that step
and use these instead:

- the Vercel audit (`.claude/skills/web-design-guidelines`) on the changed
  screens;
- Playwright screenshots in English and Arabic, light and dark, at phone and
  desktop width (`UI_PLAN.md` §7.1);
- the repo's own guard tests (`npx vitest run`).

Ignore the "Live-mode signature params" sections and links to pages that
weren't copied (`new-work.md`, `live.md`, `critique.md`, `ios.md`,
`android.md` and the rest). A change to the visual world is a `DESIGN.md`
change, made first and in its own commit.

## How to use it

1. **Mode:** every Nizmo screen is **Operate**: someone is getting a job
   done. Read [reference/operate.md](reference/operate.md) once per task.
2. **Before any UI edit,** small ones included, read
   [reference/craft-floor.md](reference/craft-floor.md).
3. **Then the page for the job:**

| Job | Page |
|---|---|
| Plan a screen or feature before writing code | [shape](reference/shape.md) |
| Spacing, grouping, rhythm, hierarchy | [layout](reference/layout.md) |
| Type roles, scale, measure | [typeset](reference/typeset.md) |
| Colour roles, states, data colours, contrast | [colorize](reference/colorize.md) |
| A part that reads flat beside its neighbours | [bolder](reference/bolder.md) |
| A part that's too loud | [quieter](reference/quieter.md) |
| Too much on the screen | [distill](reference/distill.md) |
| Labels, errors, empty and loading text | [clarify](reference/clarify.md) |
| Long text, Arabic, errors, empty and permission states | [harden](reference/harden.md) |
| Phones, tablets, touch | [adapt](reference/adapt.md) |
| First use and empty states | [onboard](reference/onboard.md) |
| Motion that explains state | [animate](reference/animate.md) |
| One earned moment of character | [delight](reference/delight.md) |
| Slow screens | [optimize](reference/optimize.md) |
| Repeated patterns that should be building blocks or tokens | [extract](reference/extract.md) |
| A technical check: accessibility, theming, responsiveness | [audit](reference/audit.md) |
| The last pass before a PR | [polish](reference/polish.md) |

Upstream's core principles still hold: build it fully, check it in one
batched round (phone and desktop together), fix everything that round shows,
confirm with at most one more, and stop.

## In Nizmo

`DESIGN.md` wins where they disagree (`UI_PLAN.md` §7.3). Known differences:

- **The overdue bar:** the craft floor refuses a coloured start-edge border
  over 1px on list items. `DESIGN.md` §5.4 gives an overdue item a 3px red
  start-edge bar, beside the word "Overdue" and its icon, so the colour
  isn't the only signal. Keep it.
- **Total tiles:** the craft floor refuses "big number, small label" as a
  page's structure. `DESIGN.md` §5.5's total tiles are a small row above a
  list, from the approved mock-ups, not the page's structure. Keep them, and
  don't make them a page's whole layout.
- **Case:** sentence case everywhere (`DESIGN.md` §3.4), never Title Case.
- **Right to left:** logical properties only (`start`, `end`, `inline`),
  never `left` or `right` (`DESIGN.md` §7).
- **Tokens:** colours, sizes and spacing come from `app/globals.css`
  (`DESIGN.md` §10).

Raise anything else `DESIGN.md` contradicts as a question, not a change.
While building, this is one of the two design skills in use, with UI/UX Pro
Max as the reference library (`UI_PLAN.md` §7.3).
