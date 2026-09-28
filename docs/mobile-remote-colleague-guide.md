# ORGII Mobile Remote — Colleague Guide

> **EN:** Use your phone to control Agent sessions in the ORGII desktop app: send messages, approve actions, and check progress from anywhere. This guide covers everyday use (production PWA + Cloudflare Relay), not local development setup.

---

## What It Is

**Mobile Remote** lets you control ORGII Agent sessions on your computer from your phone:

- Message your desktop Agent and read its replies over 4G/5G while you're away
- Tap **Allow** or **Deny** on your phone when the desktop needs your authorization
- Use voice input and send images (screenshots or photos)

**The 30-second overview:** ORGII desktop connects to the public Relay → generates a pairing code → phone opens the PWA and scans the code → both sides verify a security phrase → remote control is ready.

**Production addresses (deployed for the team):**

| Purpose | Address |
| --- | --- |
| Phone PWA (bookmark this link) | https://orgii-mobile-relay.superficial-jasper.workers.dev/orgii/mobile |
| Desktop Relay (filled in automatically by the “Production” preset) | `wss://orgii-mobile-relay.superficial-jasper.workers.dev/v1/mobile/ws` |

---

## Who Configures What

| Role | What to do | What you don't need to do |
| --- | --- | --- |
| **Desktop user** | Enable Mobile Remote in ORGII desktop, sign in to ORG2 Cloud, choose the “Production” preset, and generate a pairing code | Change router settings or keep track of keys or tokens |
| **Phone user** | Open the PWA, sign in with GitHub, pair by scanning the code, and verify the security phrase | Join the same Wi-Fi as the desktop (the public Relay works over mobile networks) |
| **Deployment maintainer** | Update the Relay and PWA on Cloudflare Workers (see the maintainer section of the [Development and Production Guide](./mobile-remote-dev-prod-guide.md)) | Handle anything during everyday use |

---

## Desktop: Get Started in 5 Minutes

For colleagues who have the **ORGII desktop app installed**.

### 1. Sign in to ORG2 Cloud

1. Open **Settings → General**.
2. Click **Sign in** and complete ORG2 Cloud sign-in (the same flow used for cloud sync and invitations).

> All Relay presets identify the desktop using your ORG2 Cloud identity. “Local” and “Production” only change the Relay address.

### 2. Enable Mobile Remote

1. Open **Settings → Mobile Remote**.
2. Turn on **Mobile Remote**.

### 3. Connect to the Public Relay

In the **Remote connection** section:

1. Turn on **Connect to public Relay**.
2. Select the **“Production”** preset. The Relay address should be:
   ```
   wss://orgii-mobile-relay.superficial-jasper.workers.dev/v1/mobile/ws
   ```
3. Confirm the **ORG2 Cloud sign-in** row shows your signed-in account.
4. Check **Relay status**. It should show **Connected** (it may briefly show “Connecting” first).

If the status is wrong, see [Troubleshooting](#troubleshooting).

### 4. Generate a Pairing Code

1. Click **Generate remote pairing code**.
2. A **QR code** and **security phrase** will appear.
3. Let the phone user scan the QR code, or copy and send them the **pairing payload** text.

### 5. Confirm Pairing

1. After the phone scans the code, both people verify that the **security phrase** matches.
2. On the desktop, click **The phrase matches — confirm pairing**.
3. After pairing succeeds, the phone appears in the **Paired devices** list.

**Optional:** Use **Allow actions** to control phone permissions. When disabled, the phone can view sessions but cannot send messages or approve actions.

---

## Phone: Get Started in 3 Minutes

Works in any smartphone browser, including Safari and Chrome. Add the PWA to your home screen for an experience closer to a native app.

### 1. Open the PWA

On your phone, open:

**https://orgii-mobile-relay.superficial-jasper.workers.dev/orgii/mobile**

(On iOS: open it in Safari → Share → **Add to Home Screen**.)

### 2. Sign In

1. The first time you open it, choose **Continue with GitHub**.
2. Complete GitHub OAuth (it uses the same account system as ORG2 Cloud).
3. After sign-in, the welcome page appears.

### 3. Pair by Scanning the Code

1. Tap **Scan or paste pairing code**.
2. **Scan** the QR code shown in desktop settings, or **paste** the pairing payload copied from the desktop.
3. Verify that the **security phrase** on the phone matches the one on the desktop.
4. Wait for the desktop user to click **The phrase matches — confirm pairing**.
5. After pairing succeeds, the app opens the **Sessions** list.

### 4. Send a Message

1. In the **Sessions** tab, choose a desktop Agent session.
2. Type and send a message. You can also tap **Add photo** to choose an image or press and hold the microphone button to dictate.
3. If the Agent needs your authorization for an action on the desktop, the phone shows **Authorization required**. Tap **Allow** or **Deny**.

**Tip:** If the desktop is offline (the top banner says **Desktop offline**), it is not connected to the Relay or ORGII is not running. Ask the desktop user to check Relay status.

---

## Permissions

### Microphone (Voice Input)

The browser asks for microphone permission the first time you use voice input.

| Platform | How to enable |
| --- | --- |
| **iOS Safari (browser tab)** | Settings → Safari → Microphone → Allow |
| **iOS home-screen PWA (ORGII Mobile)** | Settings → ORGII Mobile → Microphone → Allow |
| **Android Chrome** | Lock icon to the left of the address bar → Permissions → Microphone → Allow |

If you previously tapped **Deny**, enable the permission manually using the table above, then return to the PWA and tap **Retry**.

### Choosing Images (Add Photo)

- Tap **Add photo** beside the input field to select an image from your photo library (image files only).
- You can attach multiple images at once; the interface shows how many slots remain.
- No additional app is needed; this uses the system photo picker.

### Desktop Permissions

- **Allow actions** (Settings → Mobile Remote) controls whether the phone can send messages, stop sessions, and respond to Agent approvals.
- A paired device can be **Revoked** from the desktop at any time.

---

## Troubleshooting

### Relay Shows Disconnected / 401 / `auth_required`

**Cause:** The desktop is not signed in to ORG2 Cloud, or its sign-in session has expired.

**Try this:**

1. Open **Settings → General** and confirm that you are signed in to ORG2 Cloud.
2. If you are signed in but it still fails, try **Sign out**, then sign in again.
3. Return to **Settings → Mobile Remote** and refresh Relay status.
4. Confirm the preset is **“Production”** and the address is `wss://orgii-mobile-relay.superficial-jasper.workers.dev/v1/mobile/ws`.

### “Connecting” or “Waiting to reconnect” Does Not Change After Selecting “Production”

Check that:

- The computer can access the internet. The desktop only needs an **outbound** connection; no router port needs to be opened.
- The ORGII desktop app is running.
- The company network is not blocking WebSocket (`wss://`) traffic. Try using a phone hotspot.

### Pairing Fails / Scanning Does Nothing

Check that:

1. The desktop has **Generated a remote pairing code**. Codes expire; if necessary, click **Generate a new pairing code**.
2. The phone is signed in with **GitHub**.
3. The pairing payload was copied completely, with no characters missing from the beginning or end.
4. The **security phrase** matches exactly on both devices, and the desktop user clicked **The phrase matches — confirm pairing**.

### Phone Shows “Desktop Offline”

**Cause:** The desktop Relay connection is down, or ORGII has quit.

**Try this:** Ask the desktop user to confirm that ORGII is running and **Relay status** is **Connected**.

### Microphone Permission Was Denied

See [Permissions → Microphone](#microphone-voice-input). Enable the system permission, then return to the PWA and retry.

### Use a Direct LAN Connection on the Same Wi-Fi (Optional)

The recommended default is **public remote access** using the “Production” preset, so the phone and computer do not need to be on the same network.

To try it only on the same office Wi-Fi, on the desktop open **Settings → Mobile Remote → LAN fallback connection**, turn on **Allow LAN connections**, and scan the code shown. This method does not use the public Relay and is suitable for a quick test on an internal network.

---

## Local Development (For Engineers)

This guide is for colleagues using the production environment day to day. If you need to:

- Start a local Relay and test it with an ORG2 Cloud account
- Run `pnpm run tauri:dev` for integration work
- Release or update Cloudflare Workers

See the **[Mobile Remote Development and Production Guide](./mobile-remote-dev-prod-guide.md)**.

---

## Related Links

- Production PWA: https://orgii-mobile-relay.superficial-jasper.workers.dev/orgii/mobile
- Feature PR: [#1150](https://github.com/org2AI/ORG2/pull/1150)
- Development/deployment details: [mobile-remote-dev-prod-guide.md](./mobile-remote-dev-prod-guide.md)
- Repository contribution guide: [CONTRIBUTING.md](../.github/CONTRIBUTING.md)
