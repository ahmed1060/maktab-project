# The face check for testing

Until a commercial face SDK is in the app (mobile/README.md, "Choosing the
SDK"), this lets you try the whole face verification flow on your own phone:
consent, set-up, approval, check-in with the face check, re-verification and
withdrawal. It runs in the app's web view, on the phone, with no native code
(`lib/mobile/face-check/`). Nothing about the face leaves the phone except
what the real SDK would send: the result of each check, one photo for a
person to approve, and the last frame of a check that failed.

**For testing only. Never with real employees, and never sold.** The
recognition weights are licensed for non-commercial research only; the
liveness check is not certified; the device key is not in the secure
hardware. It is meant to be replaced by a paid SDK before release.

## What it uses

| Job | Model | Licence | Size |
|---|---|---|---|
| Who it is | InsightFace `buffalo_l`: SCRFD-10GF detector and ArcFace ResNet50 trained on WebFace600K | **Non-commercial research only** | 17 MB + 174 MB |
| Blink and turn | Google MediaPipe Face Landmarker (478 points and blendshapes) | Apache-2.0 | 3.6 MB |
| Photo or screen held up | MiniFASNet V2 and V1SE (Silent-Face-Anti-Spoofing) | Apache-2.0 | 2 × 1.7 MB |

All run with WebAssembly (ONNX Runtime Web, MediaPipe Tasks). The ResNet50
is about as accurate as open models get: on the IJB-C benchmark it is within
a few points of the best commercial engines. The pipeline here was checked
against InsightFace's own Python code on 30 photos of 11 people: the same
512 numbers to within 0.996 cosine.

### How a check goes

1. **The first look.** Facing the camera with eyes open: the detector finds
   exactly one face, it is aligned by its five points and turned into 512
   numbers, and the anti-spoofing scores the frame. This frame is the photo
   for approval.
2. **The challenge,** in a random order: turn the head to one side and back,
   and close the eyes and open them. Read from MediaPipe, 15 to 30 times a
   second: the blink from its `eyeBlinkLeft`/`eyeBlinkRight` scores (about
   0.05 open, 0.6 or more shut), judged against the person's own open eyes;
   the turn from where the nose tip sits between the eye corners. A step
   that takes over 8 seconds is tried again, up to three times, all within
   45 seconds.
3. **The last look,** facing the camera again: another 512 numbers, which
   must be the same face as the first (cosine 0.5 or more), so one person
   can't do the challenge for another.

**Match:** both looks must be at least **0.40** cosine from an approved
template. On the test photos, the same person's lowest pair was 0.55 (years
apart, different light and angle) and two different people's highest 0.23.

**Anti-spoofing:** a signal, not a verdict. Its makers say it is reliable
only on direct camera captures, and on ordinary photos it scored some real
people low. So when it doubts a matched face (score below 0.5), the check-in
isn't refused: it is sent for a person to review, with the frame.

Three tries per check; then the check-in goes through flagged, with the last
frame for review, as the server always does: a face check never refuses a
check-in on its own.

### On the phone

- **First use** downloads about 200 MB (shown as a percentage on the camera
  screen), then it is kept in the app's Cache Storage. The recognition model
  is served in 40 MB parts (Vercel's limit for one file is 100 MB), joined on
  the phone and checked against its SHA-256 before use.
- One recognition takes about 1 to 3 seconds on a mid-range phone, twice per
  check; the challenge itself runs on the phone's GPU where it can.
- Templates are encrypted with a device key plus the server's wrapping key,
  in their own store (`nizmo-face-v2`). Templates from the first prototype
  (dlib) can't be matched with ArcFace: a phone set up with it is asked to
  set the face up again, as a re-verification, and its check-ins are flagged
  for review until the new photo is approved.

## Turning it on

Two locks keep it out of production:

1. The site offers it only when built with `NEXT_PUBLIC_FACE_PROTOTYPE=1`.
2. The server accepts its photos and results only with
   `FACE_ALLOW_PROTOTYPE=1`. Elsewhere, its photos are refused and its
   check-ins are flagged like ones with no face check. Reviewers see "Taken
   with the test version" beside its photos.

Then follow "To try it" in mobile/README.md.

## The models at build time

`scripts/fetch-face-models.mjs` runs before `dev` and `build`. It downloads
`buffalo_l.zip` from InsightFace's GitHub release and the Face Landmarker from
Google, checks both against fixed SHA-256 sums, keeps them in the build cache
(`.next/cache/face-models`, which Vercel keeps between builds), and writes
`public/face-models/v2/` (not committed). `FACE_MODELS=skip` skips it for a
quick local start; the face check then can't load.

`scripts/face-check-eval.mts` runs the same TypeScript pipeline in Node over
a folder of photos, for checking accuracy and thresholds.

## Replacing it

The paid SDK goes behind the same `FaceVerifier` interface
(`lib/mobile/face.ts`) as a native plugin. Its model version differs, so
everyone sets their face up again once, with their check-ins carrying on
meanwhile. Then remove `lib/mobile/face-check/`, the fetch script, and both
environment variables.
