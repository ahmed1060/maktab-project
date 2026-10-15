---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices", and on every Nizmo UI PR before it is called done.
metadata:
  author: vercel (adapted for Nizmo)
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

This is Vercel's `web-design-guidelines` skill, with one change: the rules are
read from `guidelines.md` beside this file, a copy pinned to a fixed version,
instead of being fetched fresh from GitHub on every run. See
`.claude/skills/SOURCES.md` for where it came from and how to update it.

## How It Works

1. Read the rules in `guidelines.md` (in this folder)
2. Read the specified files (or ask the user which files or pattern to review)
3. Check them against every rule
4. Output findings in the terse `file:line` format the guidelines describe

## In Nizmo

`DESIGN.md` wins where the two disagree (`UI_PLAN.md` §7.3). Known
differences:

- **Case:** the guidelines ask for Title Case on headings and buttons.
  Nizmo uses sentence case everywhere (`DESIGN.md` §3.4), because Arabic has
  no capitals and the two languages should match. Don't report sentence case.
- **Right to left:** check that new code uses logical properties (`start`,
  `end`, `inline`) and never `left` or `right` (`DESIGN.md` §7).
- **Tokens:** a colour, size or spacing typed as a value instead of a token
  from `app/globals.css` is a finding (`DESIGN.md` §10).

Report a rule that `DESIGN.md` contradicts as a question, not a finding.
