# Codex reviews

Which pull requests Codex has reviewed, and which commits it hasn't seen
yet. When Codex's usage limit stops a review, work goes on; this file is
the list of what to send Codex once the limit resets.

Last checked: 2026-11-12 16:00 UTC, against GitHub.

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
   test that fails on the old code. Reply on each thread and resolve it,
   then post `@codex review` again: the fix gets its own review.
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

A fix pushed after Codex's review, for one of its findings or anything
else, is a commit Codex hasn't seen. It gets its own `@codex review`, and
counts as reviewed only once Codex has reviewed it, or a later commit
(product owner, 2026-11-11).

## Waiting for Codex

Nothing is waiting: every open and merged PR has been reviewed.

## Reviewed

Every merged PR, #1 to #266, has been reviewed in full. Codex's two
findings on #251, from its review after the merge, were fixed in #253,
with a third Codex found there; #253 was reviewed at its last commit,
4d3229e, after that fix. #254 to #261 were reviewed at their last
commits, c4c2bf5, 83dbf67, 7ac37f7, 604866c, 5d074c7, d13a26a, 2a9bfaa
and a45fd64, with no findings. #262 was reviewed at its last commit,
86bccb0. Its one finding there, a brand-new tab's first report racing
another tab's sign-out, was deferred as a known limit
(`REALTIME_PLAN.md` part 6a). #263 and #264 were reviewed at their last
commits, 07de5c2 and aaebb43, with no findings. #265 was reviewed at its
last commit, e349b36, with no findings, after its two findings on
53113f4 were fixed there. #266 was reviewed at its last commit, 64b07e4,
with no findings.

On 2026-11-11, every merged PR from #79 to #250 was checked against GitHub
for a last commit Codex hadn't seen: a fix pushed after its last review.
Two had one, #102 (d0d145e) and #244 (495903c). Codex reviewed both after
merging, on main at 50e4723 and 124721a, and found nothing.

| PR | How |
| --- | --- |
| #4, #7, #8, #30–#32, #34, #39–#44, #46, #47, #49, #72, #79–#101, #103–#240, #242, #243, #245–#250, #252–#266 | At its last commit |
| #1, #28, #29, #33, #35–#38, #45, #48, #73–#78, #102, #241, #244, #251 | After merging, on main containing its last commit |
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
