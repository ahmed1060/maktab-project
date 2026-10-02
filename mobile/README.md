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
| `requestAttestation({ nonce })` | `{ token: null }` for now (see below) |

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

You need Node 20+, and Android Studio for Android or Xcode on a Mac for iOS.
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
4. Tap **Check in**. While attestation is in testing every check-in is
   flagged for the Super Admin, who decides it under Check-in review.

On an emulator, set its location to the work location's address in the
emulator's own location controls first. A fake-location app on a real phone
is what the check-in refuses.

## Not yet

- **Attestation.** `requestAttestation` returns no token, and the server has
  no Play Integrity or App Attest verifier yet (`lib/attendance/attestation.ts`).
  Until both exist, every check-in is accepted but flagged for the Super Admin
  (`ATTENDANCE_ATTESTATION` unset). Play Integrity needs the app's Google Cloud
  project number; App Attest needs the Apple team. Once they are built, set
  `ATTENDANCE_ATTESTATION=required` on the server.
- **Push notifications** and the no-check-in reminder (§13.4): they need a
  Firebase project (Android) and an APNs key (iOS).
- **Face verification** (Phase 3b).

## How it was checked

The site's side runs against the real server in the test suite
(`lib/mobile-check-in.db.test.ts`), and the check-in page was driven in a
browser with a stand-in for the plugin. The Android plugin was compiled
against the Android framework and Capacitor's real method signatures; the
Swift plugin has not been compiled here (it needs Xcode). Neither has run on a
phone yet: the first build on a real device is the test that remains.
