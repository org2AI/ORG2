# ORG2 Remote First-Release Submission Pack

Status: engineering draft; not submitted in App Store Connect. Date: 2026-09-08.
Use with the [release readiness checklist](ios-launch-readiness.md). The copy describes features awaiting acceptance; it does not mean they have passed on a Release build on a real device.

## Draft Store Listing

| Field | Simplified Chinese | English |
| --- | --- | --- |
| Name | ORG2 Remote | ORG2 Remote |
| Subtitle | 随时查看电脑上的 Agent 会话 | Your desktop agents, on mobile |
| Keywords | Agent,远程,会话,开发,编程,工作流 | agent,remote,desktop,sessions,developer,coding,workflow |
| First-release notes | 首个 iOS 版本：连接你的 ORG2 桌面，查看会话进展并处理待批准操作 | First iOS release: connect to your ORG2 desktop, follow sessions, and respond to approval requests. |

**Simplified Chinese description:**

ORG2 Remote 是 ORG2 桌面的移动遥控客户端。在 iPhone 上查看电脑中的 Agent 会话、阅读消息，并在授权范围内发送消息、停止任务或处理待批准操作。

登录 ORG2 Cloud 后，按照引导与自己的桌面配对。桌面启用公网 Relay 连接时，可以在不同网络下访问已配对电脑。

使用前需要安装兼容的 ORG2 桌面版本，并保持电脑运行和网络连接。Remote 不是在手机本地运行 Agent 的独立应用。可用操作取决于桌面授予的权限。

**English description:**

ORG2 Remote is the mobile companion for your ORG2 desktop. Follow agent sessions on your iPhone, read messages, and—when permitted by your desktop—send messages, stop tasks, or respond to approval requests.

Sign in to ORG2 Cloud and follow the pairing flow to connect your own desktop. With the public Relay connection enabled on your desktop, you can access a paired computer from another network.

A compatible ORG2 desktop installation, a running computer, and a network connection are required. Remote does not run agents independently on your phone. Available actions depend on the permissions granted by your desktop.

Do not advertise unaccepted features such as images, offline use, background notifications, end-to-end encryption, or desktop-free operation. Add copy and screenshots about images only after real-device acceptance.

## Store Fields for the Owner to Complete

- Release team and App Store Connect app record: verify after signing in to the account
- Bundle ID: current code uses `org2ai.org2.remote`; team ownership and availability have not been verified
- SKU: to be determined by the release team; do not create the app record automatically
- Version: candidate `0.1.0`; check existing uploads before choosing the build number
- Support URL, real support email, and copyright holder: awaiting details from the owner
- Privacy-policy URL: currently `https://org2-cloud-infra.vercel.app/legal/privacy`, but its content is not ready for release
- Category, age rating, price, territories, content rights, and trader status: owner to confirm each; do not infer them from the app name
- Review contact and review credentials: enter only in the relevant Apple fields; do not put them in the repository, chat, or screenshots

## Review Environment and Instructions

Apple requires reviewers to be able to access the app's features and have any necessary accounts, hardware, or other resources. See [App Review Guidelines — Before You Submit](https://developer.apple.com/app-store/review/guidelines/#before-you-submit).

Prepare a dedicated review desktop containing synthetic data and a separate review account. Do not use a developer's personal sessions, real work files, or production administrator account. Do not use a static, expired pairing QR code as an operational review environment. If review needs a dynamic pairing code, first determine how it will be provided and how a human will respond.

After the following flow has been verified on a Release build on a real device, add the actual steps to the review notes:

1. Open the app and sign in to ORG2 Cloud with the review account; confirm the browser returns to the app.
2. Tap the app's **“扫描或粘贴配对码”** (“Scan or paste pairing code”) action to start pairing, then generate a valid code on the dedicated desktop.
3. Compare the phrases shown on the desktop and phone, then confirm pairing.
4. On the Sessions page, open a synthetic test session and inspect its history and status.
5. Send a harmless test message. Use only an isolated test request for approve/deny actions.
6. Close and reopen the app; confirm the paired device is restored without scanning again.
7. Check the privacy-policy entry in Settings. Use a separate, disposable test account for account deletion; do not delete the persistent review account.

**Draft English review notes (submit only after the environment and steps have been verified):**

ORG2 Remote is a companion to ORG2 desktop. The agents run on the paired desktop, not on the iPhone. A dedicated review desktop with synthetic sessions will be provided for review. The desktop must remain online. Remote actions are limited by the permissions granted during pairing. Please use the review account and pairing instructions supplied in the review information fields.

## Screenshot Checklist

Capture only a real Release candidate, using synthetic sessions, and preserve the original screenshot dimensions. Choose device sizes according to the current App Store Connect requirements. If the current Xcode project also supports iPad, test iPad too.

| Screen | What to show | Must not appear |
| --- | --- | --- |
| Session list | Dedicated desktop connected and several clearly synthetic sessions | Personal titles, workspace paths, or a falsely successful empty list |
| Session details | Readable messages and task status | Private code, access tokens, or unverified image placeholders |
| Pending approval | User-controlled approve/deny action | A genuinely destructive command |
| Devices and settings | Pairing management, account, and privacy entry points | Pairing credentials, real email address, localhost, or debug errors |

## Code Review Notes: Privacy and Deletion Flows

The items below are facts within the inspected scope. They are not a final App Privacy label or a complete SDK audit.
The related Remote feature is still uncommitted in `junyu/remote-relay-contract`; Cloud source was inspected in `junyu/relay-account-auth-draft`.

| Boundary | Evidence | Current conclusion / follow-up |
| --- | --- | --- |
| Sign-in identity | Remote `platform/supabaseMobileAuthClient.ts`, `platform/tauri/tauriMobileAuthClient.ts` | Handles account identity and session tokens; this alone does not justify selecting “No data collected” |
| Local credentials | `apps/remote-ios/src-tauri/src/lib.rs` | Native storage calls Keychain; this says nothing about cloud data collection, retention, or logging policies |
| Relay access | Remote `platform/tauri/nativeSocketPreparation.ts`; Cloud `mobile-relay-worker/src/broker.ts` | Uses account credentials to request short-lived connection tickets. Historical ticket failures lack evidence from an actual response; do not hide them by weakening validation |
| Images | Desktop `src-tauri/src/api/mobile_bridge/adapters/images.rs`; Remote `components/transcript/MobileMessageImages.tsx` | Image read/transfer paths exist; real-device display is still awaiting acceptance |
| Camera | `Info.ios.plist`; Remote `platform/scanCameraQr.ts` | Used for pairing QR codes; check final archive permissions and recovery by pasting when permission is denied |
| Privacy policy | Live `/legal/privacy`, HTTP 200; Cloud `apps/org2-cloud-web/app/legal/privacy/page.tsx` | Still has a draft banner and placeholder `privacy@org2.example`; blocks release |
| Deletion entry point | Remote `screens/settings/SettingsTab.tsx` → Cloud `/account` | Entry point presence was checked; successful deletion was not established |
| Deletion service | Cloud `apps/org2-cloud-web/app/api/account/delete/route.ts` | Calls `cloud_delete_account` and then soft-deletes the Auth user. If step two fails, it returns `dataDeleted: true`; a recovery flow and tests are needed |
| Access after deletion | The same deletion route has no direct Relay cleanup call | This does not prove access remains possible, but Relay pairing revocation, invalidation of issued JWTs/existing connections, and scope of cloud-data deletion must be verified |
| Privacy manifest and export declaration | No `PrivacyInfo.xcprivacy` was found in the inspected native source; Info has no export declaration configured | Audit actual SDK/API use and encryption, then have the owner confirm and add declarations to the archive; do not create a falsely empty compliance declaration |

The live privacy policy was read back using a public HTTP GET on 2026-09-08, confirming the draft notice and placeholder contact information. No account deletion was performed and no legal declarations were submitted.

## Release Gate Record

Engineering automation, product acceptance, and account authorization are three separate gates. None may currently be marked complete overall.

- Release tooling: see PR #1418 and `ios-launch-readiness.md`.
- Feature source: uncommitted Remote changes must be reviewed and included in a reproducible release SHA.
- Real device: record build number, device, network, result, and evidence without sensitive information for each checklist item.
- Account: awaiting sign-in to the Apple release account, team confirmation, and iOS distribution credentials.
- Privacy: awaiting real contact details, policy review, and confirmation of data and encryption declarations.
- Upload: until the gates above pass, do not set an approved SHA, upload to TestFlight, or submit for review.

Engineering preflight for this pass (the Remote worktree still contained uncommitted content and cannot serve as acceptance evidence for an immutable release SHA):

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote`: 51 files and 290 tests passed; tests still emit pre-existing React `act` warnings from QRScanScreen and warnings about Tauri calls in the test environment.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build:mobile-native`: passed, with a warning that Browserslist data is outdated.
- Static scan found no `local-development.invalid`, `createDevelopmentAuthSession`, or `localhost:1999` in production JavaScript. This is only a static check; it does not replace archive inspection or a real-device launch outside the development environment.
- Replaced the old development-entry static-render test with an actual React mount test for “Restoring → No paired devices → Welcome.” It retains the assertion that no auth client is built and asserts that no demo entry point is present. This change remains in the Remote worktree and was not included in the release-tooling PR.
- `node --test scripts/ios-release/readiness.test.mjs`: 15 release-tool tests passed.
