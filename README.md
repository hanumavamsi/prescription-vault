# Rx Vault (Prescription Vault)

Store prescriptions and medical reports for yourself and your family. iOS + Android, built with Expo SDK 58 (React Native, TypeScript, expo-router) and Supabase (Postgres + RLS + Storage + Auth) hosted in **ap-south-1 (Mumbai)**.

See `SPEC.md` for the product spec.

> **Expo Go will not work.** The app uses native modules (Sign in with Apple, Google Sign-In, document scanner, local authentication). Use a development build.

---

## 1. Supabase

1. Create a project at <https://supabase.com/dashboard> and choose region **South Asia (Mumbai) — ap-south-1**. Data must stay in India (see DPDP notes below).
2. Install the CLI and link the project:
   ```bash
   npm i -g supabase          # or: npx supabase ...
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
3. Run the migration (tables, RLS, RPCs, `documents` storage bucket and its policies):
   ```bash
   supabase db push
   ```
4. Deploy the account-deletion edge function (required by Apple/Google and DPDP):
   ```bash
   supabase functions deploy delete-account
   ```
   It uses the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets; nothing to configure.
5. **Auth → URL configuration**: you do not need redirect URLs; native sign-in uses ID tokens.
6. **Auth → Providers**: disable Email/Phone, enable **Apple** and **Google** (below).

### Sign in with Apple

Native iOS sign-in only needs the bundle ID:

1. Apple Developer → Identifiers → App ID `com.hanuma.rxvault` → enable **Sign in with Apple**.
2. Supabase → Auth → Providers → Apple → enable, and put `com.hanuma.rxvault` in **Client IDs** (authorized client IDs). A Services ID and secret key are only required for web/Android OAuth, which this app does not use.

Apple shares the user's name only on the first sign-in; the app stores it in the profile automatically.

### Google Sign-In

In Google Cloud Console → APIs & Services → Credentials, create three OAuth client IDs in the same project (configure the OAuth consent screen first: app name "Rx Vault", scopes `email`, `profile`, `openid`):

| Type | Settings | Used for |
| --- | --- | --- |
| **Web application** | none | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; the ID token audience Supabase verifies |
| **iOS** | Bundle ID `com.hanuma.rxvault` | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and the iOS URL scheme |
| **Android** | Package `com.hanuma.rxvault` + SHA-1 of each signing key | needed for Android sign-in to succeed |

Android SHA-1 fingerprints: debug keystore (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android`), EAS keystore (`npx eas-cli credentials` → Android → show), and the **Play App Signing** key (Play Console → Setup → App signing). Add one Android client per SHA-1.

Then in Supabase → Auth → Providers → Google: enable it, set **Client ID** to the web client ID followed by the iOS client ID, comma-separated (`<web-id>,<ios-id>`), add the web client secret, and turn on **Skip nonce check** (the native Google SDK on iOS adds a nonce the app cannot read).

**iOS URL scheme:** in `app.json`, replace the placeholder in the `@react-native-google-signin/google-signin` plugin:

```json
["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<NUMBERS-AND-LETTERS>" }]
```

This is the iOS client ID reversed: client ID `1234-abcd.apps.googleusercontent.com` becomes `com.googleusercontent.apps.1234-abcd`.

## 2. Environment

```bash
cp .env.example .env
```

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google Cloud credentials above |
| `EXPO_PUBLIC_INVITE_BASE_URL` | `prescriptionvault://invite` for development; your universal-link base (e.g. `https://rxvault.example/invite`) in production |
| `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` | Public URLs of your privacy policy and terms (shown on sign-in and in Settings) |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Support address shown in Settings |

For EAS builds, set the same variables as EAS environment variables (`npx eas-cli env:create` or expo.dev → Project → Environment variables) for `development`, `preview` and `production`. All are public client values; never put the service-role key in the app.

### Universal links for invites (optional, recommended)

Invite links default to the `prescriptionvault://` scheme, which WhatsApp and SMS do not always make tappable. For production, host a domain and:

1. Add to `app.json`:
   ```json
   "ios": { "associatedDomains": ["applinks:rxvault.example"] },
   "android": { "intentFilters": [{ "action": "VIEW", "autoVerify": true, "data": [{ "scheme": "https", "host": "rxvault.example", "pathPrefix": "/invite" }], "category": ["BROWSABLE", "DEFAULT"] }] }
   ```
2. Serve `/.well-known/apple-app-site-association` (appID `<TEAMID>.com.hanuma.rxvault`, paths `/invite/*`) and `/.well-known/assetlinks.json` (package `com.hanuma.rxvault` + release SHA-256).
3. Make `https://rxvault.example/invite/<token>` show a fallback page with App Store / Play Store links for people who don't have the app yet.
4. Set `EXPO_PUBLIC_INVITE_BASE_URL=https://rxvault.example/invite`.

## 3. Run (development build)

```bash
npm install
npx expo run:ios        # or: npx expo run:android   (local Xcode / Android Studio)
# or build in the cloud and install on a device:
npx eas-cli@latest build --profile development --platform ios
npx expo start --dev-client
```

Sign in with Apple only works on a real device or a simulator signed into an Apple ID. Checks:

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```

## 4. Build & submit

```bash
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios
npx eas-cli@latest submit --profile production --platform android
```

Fill in `submit.production` in `eas.json` (Apple ID, App Store Connect app ID, team ID) and place the Google Play service-account JSON at `./google-play-service-account.json` (git-ignored). Build numbers auto-increment remotely.

### Store submission checklist

- [ ] Replace placeholder app icon, adaptive icon and splash image in `assets/images` (and the template `assets/expo.icon`).
- [ ] Privacy policy and terms published at public URLs, set in env and in App Store Connect / Play Console.
- [ ] **App Store → App Privacy**: Health & Fitness → *Health* (prescriptions and reports), Contact info → *Name*, *Email address*, Identifiers → *User ID*, User content → *Photos* / *Other user content*. All **linked to the user**, **not used for tracking**, purpose *App functionality*.
- [ ] **Google Play → Data safety**: Health info, Personal info (name, email), Photos and files; collected, not shared with third parties, encrypted in transit, users can request deletion (in-app). Declare **Health** in the app content / health apps declaration.
- [ ] Account deletion is in-app: Settings → Delete account (deletes all records, files and the auth user). For Play, also provide a web URL describing how to request deletion.
- [ ] Encryption: `ITSAppUsesNonExemptEncryption = false` is set (HTTPS only).
- [ ] App Review notes: sign-in is Sign in with Apple / Google only, so reviewers can use **Sign in with Apple** with their own Apple ID; no demo account is needed. Mention that invites are shared via the share sheet and that the app does not provide medical advice. If review asks for a demo account anyway, create a Google account for review and seed it with sample (non-real) documents.
- [ ] Age rating: medical/treatment information → "Infrequent/Mild" in the questionnaire.
- [ ] Screenshots at 6.9" and 6.5" iPhone sizes (iPad is disabled: `supportsTablet: false`).

## 5. DPDP Act 2023 (India) notes

- **Consent**: sign-in requires an explicit, unticked-by-default consent to the terms, privacy policy and storage of the user's and family's health records. Every family share requires explicit approval by the data principal on the invite screen, with a plain statement of what the other person will be able to see.
- **Data localisation**: Supabase project in ap-south-1 (Mumbai); storage bucket in the same project.
- **Rights**: users can correct their name (Settings), revoke family access any time (Family), and erase all data (Settings → Delete account). Managed profiles for children/elderly are deleted with the managing account unless claimed.
- **Children**: managed profiles for minors are created by a parent/guardian (verifiable parental consent is the guardian's account). Do not market to children.
- **Security**: TLS in transit, Supabase at-rest encryption, row-level security on every table and storage object, session tokens in the iOS Keychain / Android Keystore (expo-secure-store), optional Face ID / passcode app lock, offline cache in the OS cache directory (excluded from backups).
- **Grievance officer**: the privacy policy must name a grievance officer / contact and response timelines, and describe breach notification to the Data Protection Board.

## Project layout

```
src/app/              routes (expo-router)
  _layout.tsx         providers, auth gate, splash, pending invites
  sign-in.tsx         welcome + consent + Apple/Google
  invite/[token].tsx  accept/decline family invites
  (app)/              signed-in stack: home, person, document, profile, family, settings, add, profile/new
src/lib/              api.ts (all data access), auth.tsx, app-lock.tsx, cache.ts, scan.ts, supabase.ts
src/components/ui.tsx shared UI kit
supabase/             migration + delete-account edge function
```
