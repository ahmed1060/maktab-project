# Nizmo check-in app

The phone app employees check in with (ATTENDANCE_PLAN.md §9). It is
[Capacitor](https://capacitorjs.com) around the Nizmo website: the app opens
the site's check-in page, `/dashboard/check-in`, and everything else stays the
website people already use. One native plugin, `NizmoCheckIn`, does what a web
page can't:

| Method | What it does |
| --- | --- |
| `getInfo()` | `{ platform, model, appVersion }`, shown to whoever approves the phone |
| `getPublicKey()` | The public half of the phone's key, SubjectPublicKeyInfo DER in base64, or `null` before the first registration |
| `createKey()` | Makes a new key in the phone's secure hardware (Android Keystore, StrongBox when present; iOS Secure Enclave), replacing any before it. The private half never leaves the hardware |
| `sign({ text })` | ECDSA P-256 / SHA-256 signature of the text, DER in base64 |
| `getLocation()` | A fresh fix `{ latitude, longitude, accuracy, mocked }`; `mocked` is Android's mock-provider flag or iOS 15's simulated-by-software flag |
| `requestAttestation({ text, purpose })` | Proof of our genuine app over the text (see [Attestation](#attestation)): a Play Integrity token on Android; on iOS an App Attest attestation when `purpose` is `REGISTER`, an assertion when `CHECK_IN`. `{ token: null }` when the phone can't give one |

Errors reject with a code the page turns into words: `LOCATION_DENIED`,
`LOCATION_UNAVAILABLE`, `KEY_UNAVAILABLE`.

The page side is `lib/mobile/native.ts` (the bridge) and
`lib/mobile/check-in-flow.ts` (registering and checking in). What the phone
signs is built by `lib/attendance/signed-text.ts`, the same code the server
checks it with.

Where the code is:

- Android: `android/app/src/main/java/com/shsd/nizmo/NizmoCheckInPlugin.java`,
  registered in `MainActivity.java`; location permissions in `AndroidManifest.xml`.
- iOS: `ios/App/App/NizmoCheckInPlugin.swift`, registered by
  `NizmoViewController.swift` (set as the main screen in `Main.storyboard`);
  the location prompt's text is in `Info.plist`.

## Building

You need Node 22 or later (Capacitor 8 requires it), and Android Studio for Android or Xcode on a Mac for iOS.
No Google or Apple developer account is needed to build and install on your
own phone; you need them only to publish to the stores.

```sh
cd mobile
npm install
# The site the app opens. https://, no path. Each build talks only to this site.
export NIZMO_URL=https://your-nizmo-domain
npm run android   # syncs, then opens Android Studio: Run ▶ on a phone or emulator
npm run ios       # syncs, then opens Xcode: pick your team under Signing, then Run ▶
```

`npm run sync` (or `cap sync`) must run again whenever `NIZMO_URL` or
`capacitor.config.ts` changes; the files it writes are not committed.

The app ID is `com.shsd.nizmo`; change it in `capacitor.config.ts`,
`android/app/build.gradle` and the Xcode project before the first store
upload, since the stores never let it change afterwards.

### Trying it

1. Give the company a package with the **Attendance – Mobile App** add-on,
   add a work location under Company settings → Attendance, and assign the
   employee to it.
2. Sign in on the phone as that employee and tap **Register this phone**.
3. Approve it on the website: Attendance → Requests → Check-in phones.
4. Tap **Check in**. While attestation is in testing, a check-in the server
   can't verify is flagged for the Super Admin, who decides it under
   Check-in review, which also shows why it wasn't verified.

On an emulator, set its location to the work location's address in the
emulator's own location controls first. A fake-location app on a real phone
is what the check-in refuses.

### Testing before there are developer accounts

Everything that needs a Google Play or Apple developer account is in
[RELEASE_PLAN.md](RELEASE_PLAN.md), for later. Until then:

- `NIZMO_URL` must be a site the phone can open without logging in to
  Vercel: the production domain, or a preview with Deployment Protection
  turned off.
- Every check-in is flagged for the Super Admin with the reason
  `NOT_CONFIGURED` or `MISSING`. That is expected: nothing is refused for it
  while `ATTENDANCE_ATTESTATION` is unset.
- There are no pushes unless the optional Firebase steps are done (Android
  only). The app then simply doesn't ask for notifications.

**Android: an APK anyone can install**
1. `cd mobile && npm install`, then
   `NIZMO_URL=https://your-nizmo-domain npm run android`. Android Studio opens.
2. In Android Studio, choose Build → Build App Bundle(s) / APK(s) →
   Build APK(s). The file is
   `android/app/build/outputs/apk/debug/app-debug.apk`.
3. Send the file to the testers. On their phones, allow "Install unknown
   apps" for the app they open it with (Files, Chrome, WhatsApp…), then
   install.
4. To ship a new build, raise `versionCode` in `android/app/build.gradle` so
   the phone accepts it as an update. You only need a new APK when native
   code or `NIZMO_URL` changes. Everything else is the website and updates
   when you deploy it.

Optional: Firebase is free and needs no Play account. With the Firebase
steps under [Push notifications](#push-notifications) done, the APK gets
pushes too.

**iPhone: only your own, from a Mac**

Without the paid Apple Developer Program there is no `.ipa` you can hand to
other people. Apple signs builds for distribution (TestFlight, Ad Hoc) only
for paid accounts. With a free Apple ID you can still run the app on your
own iPhone:
1. `NIZMO_URL=https://your-nizmo-domain npm run ios`. Xcode opens.
2. In Xcode, go to Settings → Accounts → + and add your Apple ID.
3. Select the App target, open Signing & Capabilities, and choose your
   "(Personal Team)". Then remove the **Push Notifications** and
   **App Attest** capabilities (the × beside each): a free team can't sign
   them. Don't commit that change.
4. Connect the iPhone by cable, pick it as the run destination, and press
   Run ▶.
5. The first time, on the iPhone, go to Settings → General → VPN & Device
   Management and trust your Apple ID. Also turn on Settings → Privacy &
   Security → Developer Mode.

A free-account install stops opening after 7 days; run it from Xcode again.

## Push notifications

The app asks once for permission, then sends the server the token its push
service gives (`lib/mobile/push.ts`). Notices about the person's own
attendance (check-in decisions, days, phone, requests, reminders) are then
pushed to their phone as well as shown in the bell, in their language;
tapping one opens its page. Without the setup below the app works the same,
with no pushes.

**Android, through Firebase Cloud Messaging**
1. Create a Firebase project (free), add an Android app with the app ID
   `com.shsd.nizmo`, download `google-services.json` and put it in
   `mobile/android/app/`. Then rebuild.
2. In Firebase: Project settings → Service accounts → Generate new private
   key. Put the whole JSON, as one line, in the server's environment as
   `FCM_SERVICE_ACCOUNT`.

**iOS, through Apple Push Notification service** (needs the Apple developer account)
1. In Xcode: the App target → Signing & Capabilities → + Push Notifications.
2. In the Apple developer site: Keys → + → Apple Push Notifications service.
   Download the `.p8` file once. On the server set `APNS_KEY` (the file's
   text; newlines may be written as `\n`), `APNS_KEY_ID` (the key's ID),
   `APNS_TEAM_ID`, and `APNS_SANDBOX=true` while you test with builds from
   Xcode. `APNS_BUNDLE_ID` if the app ID isn't `com.shsd.nizmo`.

## Reminders

"You haven't checked in" goes to whoever checks in with the app and hasn't,
N minutes after their shift starts (the policy's setting, 15 in the standard
template). The same job sends the pushes. It must run every few minutes:

```
GET https://your-nizmo-domain/api/cron/check-in-reminder
Authorization: Bearer <CRON_SECRET>
```

Vercel's Hobby plan runs crons at most once a day, so it isn't in
`vercel.json`. Either:

- on Vercel Pro, add `{ "path": "/api/cron/check-in-reminder", "schedule": "*/5 * * * *" }`
  to `vercel.json`'s crons; or
- use a free scheduler such as cron-job.org: every 5 minutes, that URL, with
  the `Authorization` header above.

System Health shows "Check-in reminders" as late until something calls it.

## Attestation

Proof that a registration or check-in came from our genuine, unmodified app
on a genuine phone (ATTENDANCE_PLAN.md §9.4). The phone covers the text
`nizmo-attest|PURPOSE|number` (`attestedText` in `lib/attendance/signed-text.ts`),
hashed with SHA-256. The server verifies it in `lib/attendance/attestation.ts`.

While `ATTENDANCE_ATTESTATION` is unset, attestation is in **testing**:
nothing is refused for it. Every check-in it doesn't verify is flagged for the
Super Admin, with the reason, for example `NOT_CONFIGURED`, `APP_NOT_RECOGNIZED`
or `BAD_COUNTER`. Once real phones pass, set `ATTENDANCE_ATTESTATION=required`
and unverified phones are refused.

### Android: Play Integrity

1. In Play Console → your app → App integrity, link a Google Cloud project,
   and enable the **Play Integrity API** in that project.
2. Give a service account in that project access, and set it on the server as
   `PLAY_INTEGRITY_SERVICE_ACCOUNT` (the key's JSON). If the push account
   (`FCM_SERVICE_ACCOUNT`) is in the same project, it is used when this isn't set.
3. Optional, stricter: `PLAY_INTEGRITY_CERT_SHA256` set to the app signing
   certificate's SHA-256 from Play Console (hex with colons is fine; several,
   comma-separated).
4. `ATTENDANCE_ANDROID_PACKAGE` if the app ID isn't `com.shsd.nizmo`.
5. For a build not installed from Play, build with
   `NIZMO_CLOUD_PROJECT_NUMBER=<project number>` so the app can ask for a token.
   Such a build still fails with `APP_NOT_RECOGNIZED`, because Play didn't
   install it. Test through an internal testing track.

Google's default quota is 10,000 requests a day, one per registration and per
check-in. Ask Google for more before a large rollout.

### iOS: App Attest

1. In the Apple developer account, enable **App Attest** for the app ID.
   Release builds (TestFlight, App Store) use Apple's production environment
   (`ios/App/App/App.entitlements`). Debug builds run from Xcode use the
   development one (`App.Debug.entitlements`), which is what a development
   profile grants.
2. Set `APP_ATTEST_APP_ID` on the server to `TEAMID.bundle.id`, for example
   `ABCDE12345.com.shsd.nizmo`.
3. To test a Debug build against a server, also set
   `APP_ATTEST_ALLOW_DEVELOPMENT=1` there. Leave it unset in production.

A phone registered before App Attest was set up has no attested key; its
check-ins say `NO_ATTESTED_KEY`. Registering it again fixes that.

## Face verification

The server side and the check-in page are done (ATTENDANCE_PLAN.md §9.5,
§10.4): consent, set-up with a verification photo a person approves, the
face check at each check-in, and crypto-shredding. **The face SDK itself is
not in the app yet**, so a second plugin, `NizmoFace`, still has to be
written around it. Until it exists the page says "this version of the app
can't do the face check", nobody can set it up, and so it is in use for
nobody.

### Choosing the SDK

It must match **on the phone**: no face image or template may go to the
SDK's maker, or to any cloud service. A cloud face API (AWS Rekognition,
Azure Face and the like) does not fit, because it sends the face to the
provider. Look for a commercial on-device SDK for Android and iOS with:

- 1:1 matching (this face against the enrolled one), not identification;
- passive liveness (a photo or screen held up to the camera fails), ideally
  tested to ISO 30107-3;
- templates the app can encrypt itself, or that the SDK stores only through
  a key the app gives it;
- a licence that permits the use, and no network calls during matching.

### The plugin's methods

The page side is `lib/mobile/face.ts`. The plugin must give exactly this:

| Method | What it does |
| --- | --- |
| `getInfo()` | `{ modelVersion, enrolled }`: the SDK's model name and version (up to 60 characters), and whether templates are stored on this phone |
| `enrol({ wrappingKey })` | Shows the camera with a liveness check, makes the templates, and stores them encrypted with a key derived from **both** a key in the secure hardware (Keystore or Secure Enclave) and `wrappingKey` (32 bytes in base64, from the server). Deletes the set-up photos. Gives `{ photo }`: one frontal JPEG in base64, at most 400 KB, which a person approves |
| `verify({ wrappingKey })` | Up to three tries against the stored templates, decrypted with the same two halves. Gives `{ verified, score, liveness, attempts, frame }`: scores from 0 to 1; `frame` is the last camera frame as a JPEG in base64 (at most 400 KB) when it never matched, else `null` |
| `deleteTemplates()` | Deletes the stored templates |

Errors reject with `FACE_CANCELLED` (the person closed the camera; nothing
is sent), `CAMERA_DENIED`, or anything else. Any other error means the check
couldn't be done, and the check-in waits for a review.

The wrapping key is never stored on the phone: it is fetched for each use
and forgotten. When the server destroys it, the templates can no longer be
decrypted, even on a phone that is off or lost. The server then tells the
phone to call `deleteTemplates()`, and the phone confirms.

Register the plugin next to `NizmoCheckIn`: in `MainActivity.java` on
Android, and in `NizmoViewController.swift` on iOS. Add the camera
permission (`android.permission.CAMERA`, and `NSCameraUsageDescription` in
`Info.plist`).

## How it was checked

The site's side runs against the real server in the test suite
(`lib/mobile-check-in.db.test.ts`; face verification in
`lib/mobile-face.db.test.ts`, with a stand-in for the face SDK), and the check-in page was driven in a
browser with a stand-in for the plugin. The Android plugin was compiled
against the Android framework, Capacitor's real method signatures and the
Play Integrity API's; the
Swift plugin has not been compiled here (it needs Xcode). Neither has run on a
phone yet: the first build on a real device is the test that remains.
