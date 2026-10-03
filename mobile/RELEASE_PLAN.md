# Nizmo app release plan

Everything that needs a Google Play or Apple developer account, in order,
for when the accounts exist. Until then the app is tested from an APK and
from Xcode on your own iPhone (README.md, "Testing before there are
developer accounts").

Keys and secrets go straight into the server's environment (Vercel → Project
→ Settings → Environment Variables, then redeploy). Never into the
repository or a chat.

## Right after the production merge (no accounts needed)

Do these as soon as the attendance PRs (#24–#26 and below) are merged to
`main` and deployed. Before that, production has no check-in, push or
reminder endpoints.

1. [ ] **Reminder scheduler.** This is a different job from the daily ones in
       `vercel.json`, which Vercel already runs. The check-in reminder needs
       every 5 minutes, which the Hobby plan can't do. On cron-job.org (free),
       create a job that calls
       `https://<production-domain>/api/cron/check-in-reminder` every 5
       minutes. Add the header `Authorization: Bearer <CRON_SECRET>`, using
       the same `CRON_SECRET` the other crons use. After a few minutes, System
       Health should show "Check-in reminders" as on time.
2. [ ] **Firebase (optional, free), for Android pushes:** README.md, Push
       notifications. That means `google-services.json` in
       `android/app/` and `FCM_SERVICE_ACCOUNT` on the server.
3. [ ] **Test APK** built with `NIZMO_URL=https://<production-domain>`
       (README.md, "Testing before there are developer accounts"), sent to
       the testers.
4. [ ] **iPhone** from Xcode with a free Apple ID, on your own phone.
5. [ ] **Test company:**
       - give it a package with the **Attendance – Mobile App** add-on;
       - add a work location and assign testers;
       - register and approve phones;
       - check in.
       Expect every check-in to be flagged `NOT_CONFIGURED` or `MISSING`
       until the store accounts exist.
6. [ ] Leave `ATTENDANCE_ATTESTATION` unset.

## 0. Decide before anything is uploaded

- [ ] **The app ID.** Today it is `com.shsd.nizmo`. Both stores fix it for
      ever at the first upload. To change it, change it in
      `capacitor.config.ts`, `android/app/build.gradle` (`namespace` and
      `applicationId`, plus the Java package folder) and the Xcode project
      (`PRODUCT_BUNDLE_IDENTIFIER`), and set `ATTENDANCE_ANDROID_PACKAGE` and
      `APNS_BUNDLE_ID` on the server.
- [ ] **The name** shown under the icon ("Nizmo") and in the stores.
- [ ] **The production site** the store build talks to (`NIZMO_URL`). Each
      build is tied to one site.
- [ ] **Icons and splash screen**, replacing Capacitor's defaults
      (`android/app/src/main/res`, `ios/App/App/Assets.xcassets`).
- [ ] **A privacy policy page** on the website. Both stores require its URL.
      It must cover precise location at check-in, the phone's key and model,
      and the push token.

## 1. Accounts

| | Cost | Notes |
| --- | --- | --- |
| Google Play Console | $25 once | An organization account needs a D-U-N-S number. A *personal* account created since late 2023 must run a closed test with at least 12 testers for 14 days before it may publish to production; organization accounts are exempt. |
| Apple Developer Program | $99 a year | An organization needs a D-U-N-S number. Enrolment review can take a few days. |
| Firebase | Free | Can be set up now, before either account (README.md, Push notifications). |

## 2. Android

1. [ ] **Firebase** (if not done yet): create the project, add the Android app
       with the app ID, put `google-services.json` in `android/app/`, and
       set `FCM_SERVICE_ACCOUNT` on the server.
2. [ ] **Signing**: in Android Studio, Build → Generate Signed App Bundle → create
       an *upload key* keystore. Keep the `.jks` file and its passwords
       somewhere safe and backed up; losing them means asking Google to reset
       the key. Play App Signing then holds the real signing key.
3. [ ] **Play Console**: Create app → name, default language, free.
4. [ ] **Internal testing**: Testing → Internal testing → create a release,
       upload the `.aab`, and add testers by email. They install from the
       opt-in link.
5. [ ] **Play Integrity**:
       - In Google Cloud (the Firebase project), go to APIs & Services →
         Library and enable "Play Integrity API".
       - In Play Console, go to App integrity → Play Integrity API → Link a
         Cloud project, and choose the same project.
       - On the server: nothing more if `FCM_SERVICE_ACCOUNT` is that
         project's account. Otherwise set `PLAY_INTEGRITY_SERVICE_ACCOUNT`.
       - Optional and stricter: `PLAY_INTEGRITY_CERT_SHA256` = the "App signing key
         certificate" SHA-256 from App integrity → App signing.
6. [ ] **Check it**: register a phone that installed the app from the testing
       track, then check in. In Check-in review there should be no
       "app check" reason. If there is one, the reason says what's wrong
       (README.md, Attestation).
7. [ ] **Store listing**:
       - descriptions and screenshots;
       - the privacy policy URL;
       - the content rating questionnaire and the target audience (adults,
         at work).
8. [ ] **Data safety form**:
       - It collects precise location (at check-in, for app functionality,
         not shared) and device or other IDs (the phone's key and push
         token).
       - Data is encrypted in transit.
       - Users can ask for deletion through their employer.
9. [ ] **Location**: the app asks for location only while in use, so no
       background-location declaration is needed. If that ever changes,
       Google wants a declaration and a video.
10. [ ] **Closed testing** (personal accounts: 12+ testers for 14 days), then
        **Production**: promote the tested release.

## 3. iOS

1. [ ] **App ID**: at developer.apple.com, go to Identifiers → + → App IDs,
       with the bundle ID = the app ID. Tick **App Attest** and
       **Push Notifications**.
2. [ ] **APNs key**: Keys → +, then Apple Push Notifications service. Download
       the `.p8` once. Set these on the server:
       - `APNS_KEY` (the file's text);
       - `APNS_KEY_ID`;
       - `APNS_TEAM_ID` (Membership details).
3. [ ] **App Attest** on the server: `APP_ATTEST_APP_ID` = `TEAMID.app.id`, for
       example `ABCDE12345.com.shsd.nizmo`.
4. [ ] **Xcode**: Signing & Capabilities → choose the paid team. Push
       Notifications and App Attest should be listed. Put them back if they
       were removed for free-account testing.
5. [ ] **While testing builds run from Xcode**: also set
       `APP_ATTEST_ALLOW_DEVELOPMENT=1` and `APNS_SANDBOX=true` on the server.
6. [ ] **App Store Connect**: My Apps → + → New App, with the bundle ID.
7. [ ] **TestFlight**:
       - In Xcode, Product → Archive → Distribute App → App Store Connect.
       - In App Store Connect, add internal testers (up to 100, no review).
       - Before testing TestFlight builds, **remove**
         `APP_ATTEST_ALLOW_DEVELOPMENT` and `APNS_SANDBOX` from the server:
         TestFlight uses Apple's production environment for both.
8. [ ] **Check it**: register an iPhone that installed from TestFlight, then
       check in. There should be no "app check" reason. A phone registered
       before App Attest was set up says `NO_ATTESTED_KEY` until it
       registers again.
9. [ ] **App privacy labels**: precise location (app functionality, linked to
       the user) and identifiers (the push token). No tracking.
10. [ ] **App Review**:
       - Give reviewers a demo account: an employee in a demo company whose
         work location is large enough, or note that check-ins away from it
         are flagged rather than refused.
       - Explain that the app is for employees of companies that use Nizmo.
       - Apple rejects apps that are "just a website" (guideline 4.2). The
         case to make in the review notes is the native parts: a hardware
         key held in the Secure Enclave, location checked against
         simulation, App Attest and push notifications.

## 4. Server, at go-live

- [ ] **The check-in reminder job** runs every 5 minutes: Vercel Pro cron, or
      cron-job.org with the `Authorization: Bearer <CRON_SECRET>` header
      (README.md, Reminders).
- [ ] Remove `APP_ATTEST_ALLOW_DEVELOPMENT` and `APNS_SANDBOX`.
- [ ] Once real phones on both platforms pass attestation (Check-in review
      shows no "app check" reasons for store installs), set
      `ATTENDANCE_ATTESTATION=required`. From then on an unverified app is
      refused rather than flagged. Old phones registered before App Attest
      must register again first.
- [ ] Watch the Play Integrity quota: 10,000 checks a day by default, one per
      registration and per check-in. Ask Google for more before a large
      rollout.

## 5. Every later release

- Most changes need **no store release**: the app shows the website, so
  deploying the site updates it.
- A store release is needed only when native code, plugins, the icon, or
  `NIZMO_URL` change:
  - Android: raise `versionCode` (and `versionName`) in
    `android/app/build.gradle`.
  - iOS: raise `CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION`) in Xcode.
  - Then `npm run sync`, build, upload to the testing track or TestFlight
    first, and promote.
