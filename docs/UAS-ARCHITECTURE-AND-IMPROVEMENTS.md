# Unified Accounting System (UAS) — Architecture & System Improvements Specification

## Core Operating Model: Three Equal Runtime Modes + Cross-Mode Sync & Recovery
UAS provides full feature parity across three first-class deployment modes, allowing every organization that purchases or subscribes to UAS to run on the topology that fits them best—or combine them:
1. **Local Database Mode (SQLite):** Standalone Windows desktop (`UAS.exe`) or Android mobile app operating locally with full accounting, offline queue, and backup capabilities.
2. **Office LAN Mode:** On-premise local server (`http://<lan-ip>:<port>`) serving multiple office computers and mobile devices over the local network.
3. **Live Cloud Multi-Tenant Mode (`https://<slug>.qat.world` with Strongly Isolated DBs):** A full live production workspace on `qat.world` where tenants access their own branded landing/login page (`https://<slug>.qat.world`), log in directly, run all accounting and ERP operations live on the web, sync their desktop and mobile devices **automatically and manually** with their live cloud workspace, and optionally use their isolated cloud DB as an off-site recovery/backup mirror for Local or LAN deployments.

---

## 1. Multi-Tenant Subdomain-on-Key & Branded Tenant Workspaces (`<slug>.qat.world`)
- **Subdomain Provisioning on Activation Key Generation:**
  - When generating an Activation Key for a tenant, automatically derive and validate an immutable ASCII lowercase `slug` (`^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`, **3–32 chars**, `[a-z0-9-]`, reserved-word guarded).
  - Transliterate/normalize tenant names (Arabic or English) into a clean ASCII `slug` (with collision disambiguation and admin preview before locking) while storing full localized `nameAr` and `nameEn` for UI, landing pages, invoices, and reports.
  - Provision the tenant's strongly isolated PostgreSQL database/schema and map `https://<slug>.qat.world` immediately upon key creation.
- **Wildcard TLS & Deterministic Tenant Resolution:**
  - Configure Nginx wildcard TLS (`*.qat.world` and `qat.world`) forwarding `Host` and `X-Forwarded-Host` headers to the Next.js backend.
  - Resolve tenant context deterministically in order:
    1. Subdomain `<slug>.qat.world` from `Host` / `X-Forwarded-Host`
    2. Explicit `x-uas-tenant-id` header (for desktop/mobile/API/LAN clients)
    3. Authenticated session/token tenant binding
- **Branded Tenant Landing/Login Page & In-App Tenant Admin Configuration:**
  - Visiting `https://<slug>.qat.world` renders a **branded tenant landing and login page** specific to that organization (`nameAr`/`nameEn`, logo, brand colors, welcome/compliance notice, support contact, and credential/passkey login) with zero leakage from other tenants or the root `qat.world` marketing/platform portal.
  - Inside the authenticated tenant workspace, provide a **Tenant Admin Configuration** studio allowing authorized tenant admins to customize their tenant landing page, branding, localization, fiscal/approval rules, sync intervals, and device policies—strictly scoped to their own tenant and isolated from root `qat.world` platform super-admin controls.

---

## 2. Automatic & Manual Multi-Device Sync + Recovery Backup
- **Live Automatic & Manual Sync Across Web, Desktop & Mobile:**
  - Tenants working live on `https://<slug>.qat.world` can connect Windows desktop (`UAS.exe`) and Android APK clients to their `<slug>.qat.world` workspace.
  - Support both **automatic background/interval sync** (on reconnect, app foreground, and configurable timer) and **manual one-tap Sync Now** (`مزامنة الآن`), using per-tenant monotonic cursors (`sinceCursor`) and idempotency keys on every mutation so retries never duplicate vouchers or ledger lines.
- **Explicit Conflict Detection & Resolution:**
  - Flag conflicting edits on locked/posted or concurrently modified records as `CONFLICT_PENDING` with clear side-by-side resolution controls rather than silently overwriting accounting balances.
- **Tenant-Scoped Backup & Recovery (`.uasbak` / Snapshots):**
  - Support portable backup and restore across Local SQLite, LAN, and isolated cloud tenant DBs (`<slug>.qat.world`), creating a pre-restore safety snapshot before restoring and recording audit + notification events.

---

## 3. Microphone & Android / WebView Voice Input Fix
- **Root Causes Addressed:**
  - Android runtime `RECORD_AUDIO` permission does not automatically grant WebView audio capture (`PermissionRequest.RESOURCE_AUDIO_CAPTURE`).
  - Locale-dependent permission checks (`ar-YE` vs. `en-*`) caused inconsistent permission prompts/errors, and speech engines that only emit interim results or stop on silence lost captured text if not flushed on `onend`/stop.
  - Android *"Manage app if unused"* can revoke microphone and notification permissions after inactivity.
- **Required Implementation:**
  - Implement a native Android Capacitor bridge that checks/requests `Manifest.permission.RECORD_AUDIO` and grants `PermissionRequest.RESOURCE_AUDIO_CAPTURE` inside the WebView only after runtime permission is granted.
  - Decouple microphone permission checks from speech language (`ar-YE`, `en-US`, `en-GB`, etc.); expose a single permission/status check and a direct **"Open App Settings"** button when denied.
  - Enable `interimResults = true`, render live interim transcript in the Copilot input, commit any pending interim transcript on `onend`/stop, handle `no-speech` / `audio-capture` / `not-allowed` cleanly without wedging listening state, and surface a diagnostic warning when *"Manage app if unused"* is enabled.

---

## 4. Notification Engine (Web, Desktop & Android)
- **Event & Delivery Pipeline:**
  - Emit structured tenant-scoped notifications for accounting, sync, backup/restore, and security events (`JOURNAL_POSTED`, `APPROVAL_REQUIRED`, `LOW_STOCK`, `SYNC_COMPLETED`, `SYNC_CONFLICT`, `BACKUP_COMPLETED`, `RESTORE_COMPLETED`, `DEVICE_LOCKED`, `PASSWORD_RESET`, `SYSTEM_ALERT`).
  - Provide an in-app **Notification Center** with read/unread badges, severity filters, and deep links to the target voucher, sync conflict, user, or device.
  - On Android (API 33+), request `POST_NOTIFICATIONS` cleanly, register categorized notification channels (`approvals`, `sync`, `security`, `general`), and deliver local/push notifications while queuing offline events for delivery upon reconnection.

---

## 5. Tenant Devices Control Plane & Per-Device Sync Governance
- **Device Registry & Admin Control Panel:**
  - Track per-tenant devices (`deviceId`, `slug`/`tenantId`, `platform`: `web` | `windows` | `android`, `appVersion`, `osVersion`, `deviceLabel`, `userId`, `lastSeenAt`, `ipAddress`, `status`: `ACTIVE` | `SUSPENDED` | `REVOKED`, `syncMode`: `AUTO` | `MANUAL`, `pendingQueueCount`, `lastCursor`, `lastSyncAt`, `lastSyncError`).
  - Provide a **Tenant Devices Control Plane** UI and API so tenant admins can:
    - Approve, suspend/lock, or revoke any device (immediately returning `403 DEVICE_REVOKED` / lock state on next request and clearing local credentials on revoked devices).
    - Trigger targeted **Sync Now** or **Force Full Re-Sync** commands for a specific device and toggle per-device `AUTO` vs. `MANUAL` sync policies.
    - Inspect per-device sync lag, unsynced local queue counts, and last sync error details.

---

## 6. Networking, Offline Resilience & Production Service Hardening
- **Unified Transport Resolver:**
  - Centralize base-URL and header resolution across Live Cloud (`https://<slug>.qat.world` / `https://qat.world`), Office LAN (`http://<ip>:<port>`), and Local SQLite offline mode.
  - Enforce request timeouts, exponential backoff with jitter on transient `502`/`503`/`504`/network failures, and clear online/LAN/offline status badges.
- **Standalone Build & Systemd Hardening:**
  - Keep `.next/standalone/server.js`, `.next/static`, `public`, and `systemd` (`uas-qat.service`) aligned with `output: "standalone"` and PostgreSQL (`qat.world`) vs. SQLite (Windows/Android packaging) workflows.

---

## 7. AI Copilot Document & Image Extraction and Posting
- **Document & Image Ingestion:**
  - Support uploading or capturing invoices, receipts, purchase bills, delivery notes, and expense slips (images and PDFs/documents) inside UAS AI Copilot.
  - Extract structured accounting fields (vendor/customer, date, currency, line items, tax/totals, payment method, suggested GL debit/credit accounts, cost center/project).
- **Safe Human-in-the-Loop Posting:**
  - Render an editable structured draft preview with validation and confidence warnings (missing fields, unbalanced debits/credits, duplicate checks, fiscal-period status).
  - Require explicit user confirmation (`تأكيد الترحيل` / Confirm Post) and enforce RBAC, fiscal-period locks, idempotency keys, and immutable audit logging upon posting.
  