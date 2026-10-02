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

## Not yet

- **Face verification** (Phase 3b).

## How it was checked

The site's side runs against the real server in the test suite
(`lib/mobile-check-in.db.test.ts`), and the check-in page was driven in a
browser with a stand-in for the plugin. The Android plugin was compiled
against the Android framework, Capacitor's real method signatures and the
Play Integrity API's; the
Swift plugin has not been compiled here (it needs Xcode). Neither has run on a
phone yet: the first build on a real device is the test that remains.
