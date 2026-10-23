# Codex reviews

Which pull requests Codex has reviewed, and which commits it hasn't seen
yet. When Codex's usage limit stops a review, work goes on; this file is
the list of what to send Codex once the limit resets.

Last checked: 2026-10-23 00:56 UTC, against GitHub.

## When the limit resets

1. Under **Waiting for Codex** below, post `@codex review` on each open PR
   listed there, once. One review of the PR's latest commit covers every
   commit before it.
2. For a merged PR listed there, open a review-only PR, as #50–#71 were.
   Its base branch is the PR's last reviewed commit and its head branch is
   the PR's last commit. Both branches set `git.deploymentEnabled: false`
   in `vercel.json`, so Vercel builds no preview of old code against the
   live database. Close the PR once Codex has reviewed it.
3. Fix each real finding against today's code, in its own commit, with a
   test that fails on the old code. Reply on each thread and resolve it.
4. Move the PR to **Reviewed** here, with the commit Codex reviewed.

## How a PR counts as reviewed

A commit counts as reviewed when Codex reviewed it or a later commit of the
same PR. One of these on GitHub shows it:

- a Codex review on that commit or a later one;
- Codex's 👍 on the PR after that commit, meaning it reviewed and found
  nothing;
- a Codex review, after the merge, of main at a commit that contains the
  PR's last commit;
- a review-only PR covering the commits pushed after Codex's last review.

A request that Codex answers with "You have reached your Codex usage
limits" reviews nothing.

## Waiting for Codex

| PR | State | Last commit Codex reviewed | Not yet reviewed |
| --- | --- | --- | --- |
| #83 Every table has Row Level Security on again | Open | `5e3527d` (2026-10-23 00:52 UTC) | Every commit after `5e3527d` (below) |

Codex's first review of #83 found two things in `lib/rls-migrations.test.ts`.
They're fixed in the commits after it, which haven't been reviewed:

- `38afbf9` The RLS check reads a migration's statements in order, turning RLS off too
- `fba7b11` The RLS check holds every migration the catch-all doesn't cover, by name or not
- this file's own commit

## Reviewed

Every merged PR, #1 to #82, has been reviewed in full.

| PR | How |
| --- | --- |
| #4, #7, #8, #30–#32, #34, #39–#44, #46, #47, #49, #72, #79–#82 | At its last commit |
| #1, #28, #29, #33, #35–#38, #45, #48, #73–#78 | After merging, on main containing its last commit |
| #2 | Review-only #71 |
| #3 | Review-only #69 |
| #5 | Review-only #68 |
| #6 | Review-only #50 |
| #9 | Review-only #70 |
| #10, #11 | Review-only #64 (it covers #10's two missed commits too) |
| #12 | Review-only #56 |
| #13 | Review-only #54 |
| #14 | Review-only #58 |
| #15 | Review-only #60 |
| #16 | Review-only #55 |
| #17 | Review-only #51 |
| #18 | Review-only #62 |
| #19 | Review-only #66 |
| #20 | Review-only #67 |
| #21 | Review-only #59 |
| #22 | Review-only #57 |
| #23 | Review-only #63 |
| #24 | Review-only #61 |
| #25 | Review-only #53 |
| #26 | Review-only #65 |
| #27 | Review-only #52 |

#50–#71 are those review-only PRs, all reviewed at their last commit and
closed without merging.
