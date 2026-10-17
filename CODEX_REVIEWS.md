# Codex reviews

Which pull requests Codex has reviewed, and which commits it hasn't seen
yet. When Codex's usage limit stops a review, work goes on; this file is
the list of what to send Codex once the limit resets.

Last checked: 2026-10-17 12:35 UTC, against GitHub.

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
| #82 Records move onto clients (step 0, PR 0a) | Open | `767ca72` (2026-10-17 07:41 UTC) | Every commit after `767ca72` (below) |

#82's commits Codex hasn't seen, besides this file's own:

- `b57ca88` A search for records matches % and _ as the letters typed
- `8676560` A client's first record and a new section of its name don't collide
- `97bdcfa` A record file is noted as removed before storage removes it
- `35672c5` Plans: PR 0a's eighth review is fixed
- `f11e6e6` Plans: two fixes found in 0a get PRs of their own
- `971ba7b` The Records page adds a record in one form, without leaving
- `50390ab` Plans: the Records page's Add record is one form there (Decided)
- `b4d42a5` Plans: a client's own page keeps its Add record

Requests for it that hit the limit: 2026-10-17 07:54 UTC and 12:31 UTC.

## Reviewed

Every merged PR, #1 to #81, has been reviewed in full.

| PR | How |
| --- | --- |
| #4, #7, #8, #30–#32, #34, #39–#44, #46, #47, #49, #72, #79–#81 | At its last commit |
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
