# Codex reviews

Which pull requests Codex has reviewed, and which commits it hasn't seen
yet. When Codex's usage limit stops a review, work goes on; this file is
the list of what to send Codex once the limit resets.

Last checked: 2026-11-24 16:03 UTC, against GitHub.

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

Every merged PR, #1 to #409, has been reviewed in full. Codex's two
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
53113f4 were fixed there. #266 to #281 were reviewed at their last
commits, 64b07e4, cfcac9f, b77cbdb, 88b7d05, ed2e9a1, 2e36087,
984ee97, 2bfd874, 8d4d7c0, d592fb6, ae7f44c, 14d4c5d, 65e6bb7,
147a153, 7528129 and 4d6498f, with no findings. #282 was reviewed at
its last commit, a04fa01, with no findings, after its finding on
ee4f54b was fixed there. #283 was reviewed at its last commit, df18b0b,
with no findings, after its two findings on daf49c5 were fixed there.
#284 was reviewed at its last commit, 2c0b2ce, with no findings.
#285 was reviewed at its last commit, 0c89e79, with no findings.
#286 was reviewed at its last commit, c467c38, with no findings.
#287 was reviewed at its last commit, 15a70a8, with no findings.
#288 was reviewed at its last commit, 582c6f2, with no findings, after
its finding on 7b99c61 was fixed there.
#289 was reviewed at its last commit, dde3c78, with no findings.
#290 was reviewed at its last commit, 84105d1, with no findings.
#291 was reviewed at its last commit, 00a42d6, with no findings.
#292 was reviewed at its last commit, e43d858, with no findings.
#293 was reviewed at its last commit, b4e5fdb, with no findings.
#294 was reviewed at its last commit, e528826, with no findings, after
its three findings on 9c050e1 and its one on 83eebc7 were fixed there.
#295 was reviewed at its last commit, de030b8, with no findings, after
its one finding on aae44de was fixed there.
#296 was reviewed at its last commit, 3a07d50, with no findings, after
its one finding on 7d8a6fe was fixed there.
#297 was reviewed at its last commit, fa0498a, with no findings. #298 was reviewed at its last commit, c81edb5, with no findings, after its one finding on 230a41c was fixed there. #299 was reviewed at its last commit, e8c4d2a, with no findings, after its one finding on ef26b04 was fixed there. #300 was reviewed at its last commit, b183dda, with no findings, after its four findings on 2affc4a were fixed there. #301 was reviewed at its last commit, dffacc7, with no findings, after its two findings on 77924a7 were fixed there. #302 was reviewed at its last commit, 652f05d, with no findings, after its two findings on bd83d40 were fixed there. #303 was reviewed at its last commit, b61e164, with no findings. #304 was reviewed at its last commit, 5e7b16d, with no findings. #305 was reviewed at its last commit, 6d3b75c, with no findings, after its two findings on e737613 were fixed there. #306 was reviewed at its last commit, 26f82ba, with no findings. #307 was reviewed at its last commit, b2e7a9d, with no findings, after its one finding on f7471cf was fixed there. #308 was reviewed at its last commit, 7c298f1, with no findings. #309 was reviewed at its last commit, 17d66c9, with no findings. #310 was reviewed at its last commit, 2e4c293, with no findings. #311 was reviewed at its last commit, 2c16fec, with no findings, after its one finding on 75648d3 was fixed there. #312 was reviewed at its last commit, a1730e9, with no findings. #313 was reviewed at its last commit, 7de6379, with no findings. #314 was reviewed at its last commit, fe3c37f, with no findings, after its two findings on 40aacd7 were fixed there. #315 was reviewed at its last commit, 5e2f52f, with no findings. #316 was reviewed at its last commit, 7acf44c, with no findings, after its two findings on 1917eeb were fixed there. #317 was reviewed at its last commit, 51f7e63, with no findings. #318 was reviewed at its last commit, 5e85c02, with no findings, after its three findings on a688254 were fixed in 949f1ce, and its one finding on 949f1ce was fixed there. #319 was reviewed at its last commit, 8888219, with no findings. #320 was reviewed at its last commit, 0cc8567, with no findings. #321 was reviewed at its last commit, 3960dfa, with no findings. #322 was reviewed at its last commit, 73dea97, with no findings. #323 was reviewed at its last commit, 61b13cc, with no findings. #324 was reviewed at its last commit, c132d68, with no findings, after its two findings on 46bbd0b were fixed there. #325 was reviewed at its last commit, 07209c4, with no findings, after its one finding on b1a6b3f was fixed in d2d45a6, and its one finding on d2d45a6 was fixed there. #326 was reviewed at its last commit, 0368089, with no findings. #327 was reviewed at its last commit, be338d0, with no findings. #328 was reviewed at its last commit, 3d63ff4, with no findings. #329 was reviewed at its last commit, cdd513a, with no findings. #330 was reviewed at its last commit, 5ffa331, with no findings. #331 was reviewed at its last commit, 153ceb9, with no findings. #332 was reviewed at its last commit, 19e61d7, with no findings. #333 was reviewed at its last commit, fcdc1c6, with no findings. #334 was reviewed at its last commit, c3e24e5, with no findings. #335 was reviewed at its last commit, e2ddbde, with no findings. #336 was reviewed at its last commit, 69e1753, with no findings, after its one finding on 53279ec was fixed there. #337 was reviewed at its last commit, 31bea0f, with no findings, after its one finding on fd110e9 was fixed there. #338 was reviewed at its last commit, 180eecc, with no findings, after its one finding on 7d81f0b was fixed there. #339 was reviewed at its last commit, 6ca2c27, with no findings. #340 was reviewed at its last commit, 29bc8ca, with no findings. #341 was reviewed at its last commit, e57782b, with no findings. #342 was reviewed at its last commit, 883f489, with no findings. #343 was reviewed at its last commit, 01eacba, with no findings. #344 was reviewed at its last commit, a377342, with no findings. #345 was reviewed at its last commit, bbf0845, with no findings. #346 was reviewed at its last commit, 9efd79a, with no findings. #347 was reviewed at its last commit, 0c11e57, with no findings. #348 was reviewed at its last commit, efdc09d, with no findings. #349 was reviewed at its last commit, 51da729, with no findings. #350 was reviewed at its last commit, d8ed3f1, with no findings. #351 was reviewed at its last commit, 486294b, with no findings, after its one finding on 1182ead was fixed there. #352 was reviewed at its last commit, f2ed836, with no findings. #353 was reviewed at its last commit, aff7ee1, with no findings. #354 was reviewed at its last commit, ba8a170, with no findings. #355 was reviewed at its last commit, bcf51ca, with no findings. #356 was reviewed at its last commit, aa9c09d, with no findings, after its one finding on 0098b2b was fixed there. #357 was reviewed at its last commit, 52385c7, with no findings. #358 was reviewed at its last commit, a9e822b, with no findings. #359 was reviewed at its last commit, 384a22d, with no findings. #360 was reviewed at its last commit, 7f3903a, with no findings. #361 was reviewed at its last commit, 2ed6627, with no findings. #362 was reviewed at its last commit, 92a75d3, with no findings. #363 was reviewed at its last commit, 6d2c541, with no findings. #364 was reviewed at its last commit, 8d703bf, with no findings. #365 was reviewed at its last commit, c1fcd30, with no findings. #366 was reviewed at its last commit, 55c8a09, with no findings. #367 was reviewed at its last commit, 54fe6bb, with no findings. #368 was reviewed at its last commit, 5bb9eda, with no findings. #369 was reviewed at its last commit, 5960fec, with no findings. #370 was reviewed at its last commit, 1b908cd, with no findings, after its two findings on a09ca02 were fixed in 5de3f37, its one finding on 5de3f37 was fixed in 3f805ab, and its one finding on 3f805ab was fixed there. #371 was reviewed at its last commit, 3cf7aad, with no findings. #372 was reviewed at its last commit, 1c2da18, with no findings. #373 was reviewed at its last commit, 036824c, with no findings. #374 was reviewed at its last commit, 5b15031, with no findings. #375 was reviewed at its last commit, 8b7672f, with no findings. #376 was reviewed at its last commit, 8ae36b2, with no findings, after its two findings on c473d7d were fixed there. #377 was reviewed at its last commit, d1c1e8b, with no findings, on a second run after the first failed to complete. #378 was reviewed at its last commit, b636918, with no findings. #379 was reviewed at its last commit, 44fcd23, with no findings. #380 was reviewed at its last commit, 424fb33, with no findings. #381 was reviewed at its last commit, 4c8a436, with no findings. #382 was reviewed at its last commit, b4e1c39, with no findings. #383 was reviewed at its last commit, f82d8a8, with no findings. #384 was reviewed at its last commit, 004b7e9, with no findings. #385 was reviewed at its last commit, bf50f84, with no findings. #386 was reviewed at its last commit, 9d1f84b, with no findings. #387 was reviewed at its last commit, 010ed5d, with no findings. #388 was reviewed at its last commit, 978d1ca, with no findings. #389 was reviewed at its last commit, a3dc3f0, with no findings. #390 was reviewed at its last commit, 8533b0e, with no findings. #391 was reviewed at its last commit, 7292b31, with no findings. #392 was reviewed at its last commit, 13b40c7, with no findings. #393 was reviewed at its last commit, 4a844cd, with no findings. #394 was reviewed at its last commit, e26d064, with no findings. #395 was reviewed at its last commit, a9015cf, with no findings. #396 was reviewed at its last commit, d7e682d, with no findings. #397 was reviewed at its last commit, dd700df, with no findings. #398 was reviewed at its last commit, 87219c6, with no findings, after its two findings on ba9c47a were fixed there. #399 was reviewed at its last commit, 5f3bbc2, with no findings, after its two findings on dcfabe4 were fixed there. #400 was reviewed at its last commit, b167783, with no findings. #401 was reviewed at its last commit, 83206f0, with no findings, after its one finding on 67bc793 was fixed there. #402 was reviewed at its last commit, 68b05c6, with no findings, after its two findings on 5ea2ba3 were fixed in b143a8c. #403 was reviewed at its last commit, ab332ab, with no findings. #404 was reviewed at its last commit, 55b10d6, with no findings, after its one finding on 1f33a03 was fixed there. #405 was reviewed at its last commit, 58adf2a, with no findings. #406 was reviewed at its last commit, 1201fd8, with no findings. #407 was reviewed at its last commit, 270ce2e, with no findings. #408 was reviewed at its last commit, faccac6, with no findings. #409 was reviewed at its last commit, d1d3fa5, with no findings, after its one finding on 2c99edf was fixed there.

On 2026-11-11, every merged PR from #79 to #250 was checked against GitHub
for a last commit Codex hadn't seen: a fix pushed after its last review.
Two had one, #102 (d0d145e) and #244 (495903c). Codex reviewed both after
merging, on main at 50e4723 and 124721a, and found nothing.

| PR | How |
| --- | --- |
| #4, #7, #8, #30–#32, #34, #39–#44, #46, #47, #49, #72, #79–#101, #103–#240, #242, #243, #245–#250, #252–#409 | At its last commit |
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
