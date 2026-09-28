# ORG2 Remote First-Release Readiness

Updated: 2026-09-08. Current conclusion: **not ready for release**.

This work prepares a separate iOS release toolchain. It does not automatically merge the Remote feature branch, create or revoke Apple certificates, accept legal agreements, submit for review, or invite testers. A successful CI build does not mean Apple has approved the app or that the real-device experience has been accepted.

See the [first-release submission pack](ios-submission-pack.md) for store copy in Chinese and English, review-environment steps, a screenshot checklist, and privacy-boundary review. The live privacy policy was read back and confirmed to still contain a draft notice and placeholder contact email; these must be corrected before release.

## 1. Known Status and Owners

| Item | Status | Next step / owner |
| --- | --- | --- |
| Existing Apple credentials | CI confirmed only a valid Mac Developer ID signing identity | Apple team administrator to confirm membership is active and verify team ownership and permissions |
| iOS distribution identity | No Apple Distribution/iPhone Distribution identity was found in the existing certificate bundle | Administrator to provide an iOS certificate and provisioning profile; a Mac certificate cannot be reused |
| Release workflow | Written, but not run with signing | Configure a protected environment and credentials, then run build-only |
| Release source code | Feature work remains in another worktree with uncommitted changes | Engineering owner to review and land changes in batches, then determine the single release SHA |
| Native sign-in/ticket | `Invalid Relay connection ticket` occurred on a real device; later simulator success does not prove the root cause is gone | Engineering owner to identify the cause and retest with a release build on a real device |
| Sessions/images | Session list was previously empty and historical images did not display; no complete real-device end-to-end evidence yet | Verify actual session data and the image-loading path |
| First pairing/already-paired startup | Some regression tests exist | Test cold start, offline behavior, and foreground/background switching using a release build on a real device |
| Privacy manifest | No `PrivacyInfo.xcprivacy` was found in the inspected iOS source directory | Audit actual API/SDK use and add the declaration to build resources; do not casually declare “no data collected” |
| Encryption export declaration | Unconfirmed | Team to confirm `ITSAppUsesNonExemptEncryption` and required materials based on actual encryption use |
| Privacy policy/account deletion | The Remote feature branch has an entry point; that does not mean the server flow is complete | Verify the live page and the actual effects of account deletion and session/pairing revocation |
| Store listing and review | Not submitted | Product/account owner to confirm the information and business policies below |

## 2. Apple Team Setup (Administrator)

First confirm that this is an Apple Developer Program membership usable for App Store/TestFlight, not only free personal signing. Check whether App ID `org2ai.org2.remote` belongs to this team; an app installed from a personal development build does not prove the company team can register this ID. If there is a conflict, do not change the Bundle ID automatically. First assess effects on sign-in callbacks, Keychain, upgrades from existing installs, and server configuration.

Create or confirm the ORG2 Remote app record in App Store Connect and bind the same Bundle ID. Select the correct platform, SKU, primary language, content rights, age rating, territory availability, and support contact information. The account holder must handle agreement updates, membership renewal, tax/banking details, and trader status.

For the first release, the recommended approach is **explicit manual signing plus a separate upload API Key**. CI will not automatically create or revoke certificates. The certificate must include its private key. The provisioning profile must be an App Store Connect profile that exactly matches the Team, Bundle ID, certificate, and capabilities. Give the upload API Key only the permissions actually needed; do not require Admin by default just because the key is used for uploads.

## 3. GitHub Setup (Repository Administrator)

First create the `ios-release` Environment, configure required reviewers, prevent self-approval, and allow only approved release branches. Protect who can modify the workflow and release scripts. **An environment name alone does not provide approval protection.** If the GitHub plan or permissions do not support the required protections, do not configure upload secrets; upload manually instead. Do not reuse the Windows `code-signing` environment.

Configure the following Secrets in the protected environment. Do not send their values in chat or PRs, put them in logs, or commit them to the repository:

| Secret | Purpose |
| --- | --- |
| `IOS_CERTIFICATE` | Base64-encoded, encrypted `.p12` containing the iOS Apple Distribution certificate and private key |
| `IOS_CERTIFICATE_PASSWORD` | `.p12` export password; the current workflow requires a non-empty value |
| `IOS_MOBILE_PROVISION` | Base64-encoded App Store Connect `.mobileprovision` that exactly matches the App ID |
| `APPLE_TEAM_ID` | Confirmed release team ID |
| `ASC_PRIVATE_KEY` | Raw App Store Connect API `.p8` key, not a Mac app-specific password |
| `ASC_KEY_ID` | Key ID for that API Key |
| `ASC_ISSUER_ID` | Issuer ID for that API Key |

The last three are needed only for uploads. Do not inject these secrets into dependency-installation or test steps. Tauri's native signing flow consumes the certificate and provisioning profile. Use a temporary GitHub-hosted macOS runner; do not cache the Keychain. Put upload credentials in a separate temporary directory and delete them on both success and failure. Do not upload diagnostic logs or Keychain artifacts.

After all acceptance checks are complete, set the Environment variable `IOS_RELEASE_APPROVED_SHA` to the full, reviewed commit SHA. This records release acceptance; it does not replace environment approval and must not contain a branch name. A new commit must be accepted again.

## 4. Release Flow and Failure Recovery

1. Merge the reviewed release toolchain and Remote feature fixes. Record the corresponding Desktop, Relay/Cloud, and iOS versions.
2. Manually run `Build iOS release candidate`, specifying a numeric version (for example, `0.1.0`) and a unique, incrementing build number.
3. Keep `upload_testflight=false`: first check credentials, Xcode, types, and mobile tests, then build the Release IPA.
4. Inspect the exported IPA for signing, Team, App ID, version, non-debug entitlements, provisioning-profile expiration and distribution type, callbacks, camera usage description, privacy-manifest structure, and encryption declaration. Code checks do not replace a privacy-content audit.
5. Retain only the IPA build artifact for 7 days. Record SHA-256 and code SHA in the summary, and confirm it is not a development-server shell.
6. Complete the real-device matrix below and approve the corresponding SHA. Then run upload mode with a new build number and inspect the artifact again.
7. After Apple accepts the upload, wait for processing and handle export compliance and TestFlight test information/tester groups. The workflow does not automatically add testers, submit for external testing review, submit for App Review, or publish publicly.

Missing credentials, an incorrect version, or a failed check: stop; do not upload or fall back to development signing. If an upload times out or its status is unclear, check App Store Connect first; do not blindly retry with the same build number. If signing materials expire, have the administrator update the existing Secret instead of revoking a certificate in a way that affects Mac or colleague releases.

Rollback: disable this manual workflow and keep the existing Mac flow. Stop testing an uploaded test build in App Store Connect. Do not roll back by modifying an old package or reusing an old build number. A version already released publicly must be corrected with a new release.

## 5. Release Real-Device Acceptance Matrix

Record evidence for every item; a simulator cannot substitute for these checks.

| Scenario | Acceptance criteria | Status |
| --- | --- | --- |
| Install/upgrade | Fresh install; identity differences when replacing a development build; upgrade from an existing beta; no accidental data deletion | Not tested |
| Outside development environment | App UI remains available after shutting down the computer's frontend server; no `localhost:1999` dependency | Not tested |
| Sign-in | Browser already signed in/not signed in, cancellation, timeout, callback, expired-token refresh, sign out and back in | Not tested |
| Account isolation | Switching accounts does not show the previous account's devices, sessions, or images | Not tested |
| First pairing | QR scan, paste, camera denied/allowed, SAS confirmation, expired code, wrong account | Not tested |
| Restore existing pairing | Cold start goes directly to the session area; slow network does not return to pairing entry; failures can recover | Not tested |
| Relay | Production address on the same Wi-Fi and on cellular; network recovery; desktop sleep/wake; ticket expiration | Not tested |
| Device management | Switch among multiple devices, revoke permissions, disconnect, repeated taps, and isolate stale responses | Not tested |
| Sessions | List/pagination/empty/error states, historical turns, live updates, refresh on return from background | Not tested |
| Messages and images | Send, stop, approve/deny, read-only limits, retry after failure, image preview | Not tested |
| Privacy | Account deletion takes effect and pairing is invalidated; privacy policy and support links are accessible | Not tested |
| Lifecycle | Foreground/background, screen lock, repeated open/close, cancellation; no unlimited retries or resource growth | Not tested |
| Visual/accessibility | Small screen, large text, light/dark themes, VoiceOver; cover iPad too if supported | Not tested |

## 6. Store Listing and Review Materials

- App name, subtitle of at most 30 characters, description, keywords, release notes, support URL, and privacy-policy URL.
- Screenshots from a real release candidate at the device sizes currently required by App Store Connect. Do not use black screens or development placeholders.
- Review notes explaining that the app is a remote client for an existing desktop Agent, how to install the desktop app, and how to sign in and pair. Provide an isolated review account/demo desktop or another approved demo method. Do not expose personal sessions or production credentials.
- Check whether third-party sign-in meets equivalent-sign-in requirements under 4.8 or qualifies for an applicable exception. Do not assume GitHub-only sign-in is compliant.
- If users can create accounts, check the in-app account-deletion entry and the actual deletion flow. An external link must go directly to the deletion process, not just customer support.
- Audit account identifiers, session content, images, diagnostics, and third-party services for App Privacy labels. Confirm purpose, identity linkage, and tracking status for each.
- Check third-party SDK privacy manifests / required-reason APIs against the final archive. Record actual reasons; do not guess reason codes.
- Confirm disclosures and consent for sharing data with AI services, user-content handling, and applicable safety measures.
- Confirm whether digital features/subscriptions are sold and whether the app links to external purchases. Apply IAP/external-link rules for the target territories. Do not add payments, remove paid features, or accept agreements before the business model is confirmed.
- Owners must confirm content rating, encryption export, licenses/third-party declarations, and regional operating requirements. This checklist is not a legal determination.

## 7. Tool Verification and Remaining Work

Automated unit tests and shell/YAML syntax checks can run without Apple secrets. Local `node --test scripts/ios-release/readiness.test.mjs`: 15 tests passed. Coverage includes date/certificate data types in actual plists, version input, wrong team/app/version, development/enterprise/Ad Hoc profiles, expiration, and missing callback/camera/encryption declarations.

The workflow YAML and all run scripts passed parsing and `bash -n`; scripts passed the basic ESLint checks for undefined and unused variables. The current local development package was read. The release check rejected it because the encryption export declaration was not configured; the package was not uploaded or modified.

The full signed build/upload has not run because distribution credentials are missing. Do not describe this workflow as proven end to end. Many uncommitted changes remain in the feature branch and were not automatically brought into this release branch; icon, camera, and sign-in fixes in particular require review and integration. Every **Not tested** item in this document requires a real acceptance record before its status can change to passed.

## Official References (Checked 2026-09-08)

- [Apple submission requirements / minimum Xcode and SDK requirements](https://developer.apple.com/app-store/submitting/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [In-app account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Tauri iOS manual and automatic signing](https://v2.tauri.app/distribute/sign/ios/)
- [Tauri App Store build and upload](https://v2.tauri.app/distribute/app-store/)
