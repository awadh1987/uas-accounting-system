# UAS Enterprise — 5-Phase Implementation Blueprint

> Project: `E:\2026\uas-accounting-system` — Windows Desktop `.exe` + Android Capacitor `.apk` + `https://qat.world` portal.

## Phase Tracking Checklist

- [x] Phase 1 — Database schema, extended Ed25519 payload & issuer CLI
- [x] Phase 2 — Company-name lock & 7-user × (1 Win + 1 Android) seat enforcement
- [x] Phase 3 — Bilingual customer-service knowledge base & user manual
- [x] Phase 4 — Bilingual voice + text reasoning ERP Copilot (online & offline)
- [x] Phase 5 — Final integration, packaging & multi-platform verification

## Goals

1. **Company-Locked Multi-Seat Ed25519 Licensing** — 7 users × [1 Windows + 1 Android] per user.
2. **Embedded Offline-Capable Bilingual (AR/EN) Customer Service & User Manual Assistant.**
3. **Bilingual (AR/EN) Voice + Text Reasoning ERP Copilot** executing operations across all UAS modules online and offline, with strict accounting confirmation guardrails.

## Governance & Gate Rules (Mandatory)

- Execute **ONE PHASE at a time**.
- At the end of each phase run verification (`npx tsc --noEmit`, `npm test`, or build checks) and update the checklist above.
- STOP at the end of every phase and output a **Phase Completion Report**:
  1. Confirmation of this plan file (Phase 1) & Summary of Changes (exact files created/modified).
  2. Verification Results (TypeScript, unit tests, schema/build outputs).
  3. Findings & Edge Cases Discovered.
  4. Remediation Suggestions.
  5. Approval Request: "Phase X is complete and verified. Please reply 'Approve Phase X+1' to proceed."
- Do NOT start the next phase until the user explicitly approves.

---

## Phase 1 — Database Schema, Extended Ed25519 Payload & Issuer CLI

**Objective:** Upgrade the cryptographic license payload, SQLite/Prisma seat-binding schema, and issuance CLI without breaking existing builds.

1. **Prisma schema & template DB (`prisma/schema.prisma`)**
   - Add `LicenseDeviceBinding` (`id`, `licenseId`, `userEmail`, `platform` = `"windows" | "android"`, `hwid`, `deviceName`, `activatedAt`, `lastSeenAt`, `active` Boolean default `true`), `@@unique([licenseId, userEmail, platform])`, index on `licenseId`.
   - Run `npx prisma db push` and regenerate `template.db` so fresh desktop installs include the table.
2. **Extended Ed25519 payload & normalization (licensing library)**
   - Add `company_name` (string), `max_users` (number, default `7`), `per_user_devices` (`{ windows: 1, android: 1 }`) to the signed payload type and signature verification.
   - `normalizeCompanyName(name)`: trim, collapse spaces, lowercase Latin, Arabic `أ/إ/آ → ا`, `ة → ه`, `ى → ي`.
   - Support `hwid: "*"` (company-wide, seat-managed), comma-separated HWIDs, and single HWID matching; keep strict Ed25519 verification.
3. **Issuer CLI (`scripts/licensing/issue-license.mjs`)**
   - Accept `--company "<Name>" --users 7 --win-per-user 1 --android-per-user 1 --hwid "*" --modes "local,lan,cloud" --days 365`.
   - Print summary: `Company Name`, `Max Users: 7`, `Devices/User: 1 Windows + 1 Android`; output `license.uas` and `UASKEY-...`.
4. **Verification:** `npx tsc --noEmit`; unit tests for `normalizeCompanyName`, signature integrity, `*` / multi-HWID parsing; mark Phase 1 complete; **STOP** + report.

## Phase 2 — Company-Name Lock & 7-User × (1 Win + 1 Android) Seat Enforcement

**Objective:** Strict company-name matching and per-user dual-platform seat limits across Local SQLite, Capacitor Android offline mode, and `https://qat.world` online verification.

1. **Strict company-name lock** (`/api/licensing/activate`, offline/Capacitor verifier, Company Settings)
   - Compare target org name with `payload.company_name` via `normalizeCompanyName`.
   - Fresh install with empty/default `CompanyProfile.name` → auto-set to `payload.company_name`.
   - Existing mismatching name → reject with:
     `"اسم المنشأة لا يطابق الترخيص المعتمد / Company name mismatch: License belongs to '${payload.company_name}'."`
   - Company Profile save endpoint blocks renaming to a different organization that violates the active license.
2. **Seat quota enforcement** (SQLite `LicenseDeviceBinding` + online `https://qat.world/api/licensing/verify-key` with `{ key, company_name, user_email, platform, hwid }`)
   - Max 7 distinct active users per `licenseId`; max 1 Windows + 1 Android HWID per user.
   - Re-activating same `(userEmail, platform, hwid)` updates `lastSeenAt` and succeeds.
   - Exceeding 7 users or a 2nd Windows/Android device for same user → clear bilingual error.
3. **Seat management UI (`src/components/LicenseActivationModal.tsx`)**
   - Company Name confirmation field; seat usage (`X / 7 Users`, Windows & Android slots per user).
   - `SUPER_ADMIN` button **"إلغاء ربط الجهاز / Release Device Seat"**.
4. **Verification:** `npx tsc --noEmit`, `npm test` proving: matching company activates 7 × (1 Win + 1 Android); wrong company blocked; 8th user blocked; 2nd Win/Android for same user blocked; seat release frees slot. Mark Phase 2 complete; **STOP** + report.

## Phase 3 — Bilingual Customer Service Knowledge Base & User Manual

**Objective:** Embedded offline-capable Arabic + English Customer Service and interactive User Manual module.

1. **Knowledge base (`src/lib/uasSupportKnowledge.ts`)** — structured AR + EN chapters:
   1. First-Time Setup, Login & RBAC Permissions
   2. Company-Locked 7-User Licensing & Seat Management
   3. Operating Modes (`Local Standalone`, `Office LAN Server 0.0.0.0:3000`, `Cloud qat.world`)
   4. 5-Level Chart of Accounts & Double-Entry Journal Vouchers
   5. Receipts, Payment Vouchers & Cost Centers
   6. Sales/Purchase Invoicing, Inventory & Public QR Verification
   7. Financial Reports (Trial Balance, Income Statement, Balance Sheet) & SQLite Backup/Restore
2. **Offline diagnostic & retrieval engine (`src/lib/localSupportEngine.ts` & `/api/support/chat`)** — weighted bilingual BM25/keyword + Arabic root matching over the knowledge base, combined with live diagnostics (license status, company-name match, active mode, seat usage).
3. **Verification:** `npx tsc --noEmit`; unit tests for Arabic/English manual queries and live diagnostics working 100% offline. Mark Phase 3 complete; **STOP** + report.

## Phase 4 — Bilingual Voice + Text Reasoning ERP Copilot (Online & Offline)

**Objective:** Multi-functional reasoning agent executing operations across all UAS modules by text or voice (AR/EN), online & offline, with strict confirmation guardrails.

1. **Cross-module RBAC tool registry (`src/lib/ai/uasAgentTools.ts`)**
   - Navigation: `navigate_to_module`.
   - Accounting: `query_account_balance`, `search_journal_entries`, `draft_journal_entry` (balanced `debit === credit`, valid 5-level COA codes), `draft_voucher`.
   - Invoicing & Inventory: `draft_invoice`, `check_item_stock`, `verify_qr_document`.
   - Reports & Support: `generate_report_summary` (TB, P&L, BS), `diagnose_system_health`, `search_user_manual`.
2. **Hybrid reasoning engine (`src/app/api/ai/agent/route.ts` & `src/lib/ai/offlineAgentEngine.ts`)**
   - **Tier 1:** Online cloud LLM with multi-step function calling.
   - **Tier 2:** Auto-detect local Ollama / OpenAI-compatible server (`http://127.0.0.1:11434`) on Windows desktop.
   - **Tier 3:** Zero-dependency deterministic bilingual NLP intent/entity engine against local SQLite/state (Windows + Android APK).
   - **Mandatory Confirmation Gate:** reads, reports, diagnostics, manual lookups, navigation execute immediately; ALL writes (`draft_journal_entry`, `draft_voucher`, `draft_invoice`, `create_account`) return a **Confirmation Preview Card** (Debit/Credit table, accounts, amounts, narration) requiring explicit click on **"تأكيد وترحيل / Confirm & Execute"**, recording `executed_by_ai: true` in the audit trail.
3. **Floating Copilot & Voice UI (`src/components/UasAiCopilot.tsx`)**
   - Mounted in `UasAppShell.tsx` (available on Login/Activation for Customer Service/Manual and inside the workspace).
   - Voice mic (`ar-SA`/`ar-YE`, `en-US`; Web Speech API on Windows + native Capacitor speech recognition with graceful fallback), optional TTS toggle, collapsible reasoning trace, confirmation preview cards, deep-link action buttons, searchable **User Manual** tab.
4. **Verification:** `npx tsc --noEmit`, `npm test`: bilingual reasoning, offline deterministic execution, balanced JE preview + confirmation gate, RBAC blocking, navigation deep links. Mark Phase 4 complete; **STOP** + report.

## Phase 5 — Final Integration, Packaging & Multi-Platform Verification

**Objective:** Rebuild clean production Windows (.exe) and Android (.apk) installers; full end-to-end verification.

1. **Android APK:** `npm run build:mobile`, `npx cap sync android`, `.\android\gradlew.bat assembleDebug` → update `public\downloads\uas-latest.apk`. Confirm zero `.exe`/`.apk` download buttons inside the mobile app.
2. **Windows installer:** `npm run release:build` → update `public\downloads\UAS-Setup-Win64.exe`. Confirm `.next/static` CSS chunks bundled, zero `.apk` files inside `release\UAS-Commercial-Dist\`, zero download buttons inside desktop app.
3. **End-to-end smoke:** `node scripts/verify-standalone-zero-db.mjs` — `200 OK` HTML, `200 OK` Tailwind CSS, `/api/licensing/status`, `/api/support/chat`, `/api/ai/agent` respond cleanly. Mark all 5 phases complete; **STOP** + **Phase 5 Final Release Report** with exact commands to install locally and run `.\scripts\deploy-all.ps1 -TargetDomain "qat.world"`.

---

## Progress Log

### Phase 1 — COMPLETE (2026-11-18) — awaiting approval for Phase 2

**Files created:** `tests/licensingV2.test.ts`, `src/lib/licensing/index.ts` (client-safe barrel)
**Files modified:** `prisma/schema.prisma`, `prisma/migrations/20261117000000_init/migration.sql`, `src/lib/sqliteInitSql.ts` (regenerated), `src/lib/sqliteBootstrap.ts` (`LicenseDeviceBinding` added to required tables so existing installs self-heal), `scripts/build-template-db.mjs`, `src/lib/licensing/licenseSchema.ts`, `src/lib/licensing/hwid.ts`, `src/lib/licensing/verifier.ts`, `scripts/licensing/issue-license.mjs`
**Regenerated:** `prisma/dev.db` (`prisma db push`), `release/UAS-Commercial-Dist/app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), Prisma Client.
**Verification:** `npx tsc --noEmit` exit 0; `npm test` 47/47 pass (29 new).
**Notes:** the licensing library is the directory `src/lib/licensing/` (not a single `licensing.ts`); legacy v1 licenses keep their byte-identical canonical form; v2 licenses are detected by a signed `company_name`.

### Phase 2 — COMPLETE (2026-11-18) — awaiting approval for Phase 3

**Files created:**
- `src/lib/licensing/seatService.ts` — single shared seat-binding service (`bindSeat`, `releaseSeat`, `getSeatUsage`, `MemorySeatStore`) normalizing `userEmail` with `.trim().toLowerCase()`, enforcing max 7 active users per license and max 1 Windows + 1 Android device per user, and updating `lastSeenAt` on re-activation.
- `src/lib/licensing/prismaSeatStore.ts` — SQLite/Prisma `LicenseDeviceBinding` store with transactional quota serialization.
- `src/lib/licensing/companyLock.ts` — company-name lock evaluator (`evaluateCompanyLock`, `checkProfileUpdateAgainstLock`, `companyMismatchMessage`).
- `src/lib/licensing/companyLockServer.ts` — Prisma `EnterpriseProfile` repository & cryptographically verified active locked license loader (`loadActiveLockedLicense`).
- `src/lib/licensing/activationPolicy.ts` — shared activation policy combining company lock adoption/verification with seat binding.
- `src/lib/licensing/licenseAuthority.ts` — stateless Ed25519 verification + stateful seat quota enforcement for the `https://qat.world/api/licensing/verify-key` cloud endpoint.
- `src/lib/licensing/seatContext.ts` — loopback vs remote device HWID resolution and explicit `SUPER_ADMIN` guard.
- `src/lib/licensing/seatClient.ts` — browser/Capacitor Android offline Ed25519 WebCrypto verifier, `LocalStorageSeatStore`, `LocalStorageProfileStore`, `activateOfflineClientLicense`, and `releaseOfflineClientSeat`.
- `src/app/api/licensing/verify-key/route.ts` — cloud license authority endpoint (`/api/licensing/verify-key`).
- `src/app/api/licensing/seats/route.ts` — seat usage inspection (`GET`) and session seat bind/refresh (`POST`).
- `src/app/api/licensing/seats/release/route.ts` — `SUPER_ADMIN` seat release endpoint (`POST`) with immutable audit trail logging.

**Files modified:**
- `src/app/api/licensing/activate/route.ts` — enforces company-name lock against `EnterpriseProfile` (auto-adopting when `isConfigured` is false, rejecting mismatches with exact bilingual error), binds user seat, and supports online verification against `https://qat.world/api/licensing/verify-key`.
- `src/app/api/licensing/status/route.ts` — exposes `company_name`, `company_locked`, `company_matches`, `seat_managed`, `max_users`, `per_user_devices`, and live `seats` counters.
- `src/app/api/system/branding/route.ts` — blocks changing `EnterpriseProfile.legalNameAr` / `legalNameEn` to an organization name that violates the active signed license.
- `src/lib/licensing/guard.ts` — checks `EnterpriseProfile` company lock inside `checkLicenseAndClock`.
- `src/lib/licensing/index.ts` — exports all browser-safe licensing modules.
- `src/components/LicenseActivationModal.tsx` — adds Company Name confirmation field, live seat usage indicator (`X / 7 Users`, Windows & Android slots), per-user device seat table, and `SUPER_ADMIN` **"إلغاء ربط الجهاز / Release Device Seat"** controls.
- `src/components/UasAppShell.tsx` — binds/refreshes user device seat on login and passes `currentUser` and `enterpriseProfile` to `LicenseActivationModal`.
- `tests/licensingV2.test.ts` — adds 7 comprehensive Phase 2 test suites across SQLite/Prisma, cloud `verify-key`, and Capacitor offline mode.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 54/54 pass.

### Phase 3 — COMPLETE (2026-11-18) — awaiting approval for Phase 4

**Files created:**
- `src/lib/uasSupportKnowledge.ts` — 7 comprehensive bilingual (Arabic + English) chapters covering: (1) First-Time Setup, Login & 7 RBAC Roles, (2) Company-Locked 7-User Licensing & Seat Management (`SUPER_ADMIN` seat release & resolving company mismatches), (3) Operating Modes (`Local Standalone`, `Office LAN Server 0.0.0.0:3000`, `Cloud qat.world`), (4) 5-Level Chart of Accounts & Double-Entry Journal Vouchers, (5) Receipts, Payment Vouchers & Cost Centers, (6) Sales/Purchase Invoicing, Inventory & Public QR Verification, and (7) Financial Reports (TB, P&L, BS) & SQLite Backup/Restore.
- `src/lib/localSupportEngine.ts` — zero-dependency browser/server offline support retrieval & live diagnostic engine with weighted BM25, Arabic normalization (`أ/إ/آ -> ا`, `ة -> ه`, `ى -> ي`), prefix/suffix stemming, 3-consonant broken-plural root matching, and live diagnostic analysis (`diagnoseLiveSystemState`, `answerSupportQuery`).
- `src/lib/supportDiagnosticsServer.ts` — server-side live SQLite & runtime diagnostic collector (`collectServerSupportDiagnostics`).
- `src/app/api/support/chat/route.ts` — `GET` and `POST /api/support/chat` endpoint combining manual retrieval with live system diagnostics.
- `tests/supportEngine.test.ts` — 7 unit & integration test suites verifying bilingual manual completeness, BM25 + Arabic root retrieval, and live offline diagnostics.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 61/61 pass.

### Phase 4 — COMPLETE (2026-11-18) — awaiting approval for Phase 5

**Files created:**
- `src/lib/ai/uasAgentTools.ts` — typed, session-RBAC-checked tool registry covering all 11 tools across Navigation (`navigate_to_module`), Accounting (`query_account_balance`, `search_journal_entries`, `draft_journal_entry`, `draft_voucher`), Invoicing & Inventory (`draft_invoice`, `check_item_stock`, `verify_qr_document`), and Reports & Support (`generate_report_summary`, `diagnose_system_health`, `search_user_manual`). Enforces 5-level COA leaf account validation, strict `Sum(Debit) === Sum(Credit)` balance checks, and the Mandatory Confirmation Preview Card gate.
- `src/lib/ai/offlineAgentEngine.ts` — 3-tier hybrid reasoning engine (`Tier 1: Online Cloud LLM`, `Tier 2: Offline Local Ollama http://127.0.0.1:11434`, `Tier 3: Zero-Dependency Deterministic Bilingual NLP Engine`) with 4-step reasoning traces (`thought -> tool_call -> observation -> response`).
- `src/lib/ai/agentServerExecutor.ts` — server SQLite context builder (`buildServerAgentContext`) and confirmed write executor (`executeConfirmedAiAction`) recording `executed_by_ai: true` in `AuditLog` and `ImmutableAuditLog`.
- `src/app/api/ai/agent/route.ts` — `GET` and `POST /api/ai/agent` endpoint handling reasoning, tool execution, and explicit user confirmations (`confirmAction`).
- `src/components/UasAiCopilot.tsx` — unified floating Bilingual Voice (`ar-YE`/`ar-SA`/`en-US` Web Speech API + native Capacitor SpeechRecognition + optional TTS) + Text Reasoning Copilot, Live Diagnostics pane, Financial Confirmation Preview Cards (`"تأكيد وترحيل / Confirm & Execute"`), and searchable 7-chapter User Manual tab.
- `tests/aiAgent.test.ts` — comprehensive unit & SQLite integration tests proving bilingual reasoning, offline deterministic execution, balanced journal entry preview + confirmation gate, RBAC blocking, navigation deep links, and confirmed SQLite posting with `executed_by_ai: true`.

**Files modified:**
- `src/components/UasAppShell.tsx` — mounts `<UasAiCopilot />` globally across Login/Activation and workspace views.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 66/66 pass.

### Phase 5 — COMPLETE (2026-11-18) — All 5 Phases Verified & Packaged

**Files modified:**
- `scripts/verify-standalone-zero-db.mjs` — extended end-to-end standalone smoke verification to assert `200 OK` on `/api/support/chat` and `/api/ai/agent` alongside `200 OK` HTML, `200 OK` Tailwind CSS (`/_next/static/chunks/*.css`), `/api/licensing/status`, `/api/bootstrap`, `/api/public/verify`, zero `.exe`/`.apk` download buttons in HTML, and zero `P2021` errors.

**Production Artifacts Built & Verified:**
- `public/downloads/uas-latest.apk` & `dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk` (4.42 MB / 4,632,296 bytes) — rebuilt via `npm run build:mobile`, `npx cap sync android`, and Gradle (`BUILD SUCCESSFUL`). Verified zero `.exe`/`.apk` download buttons and zero nested `.apk`/`.exe` files inside mobile assets.
- `public/downloads/UAS-Setup-Win64.exe` & `release/UAS-Commercial-Dist/UAS-Setup-Win64.exe` (42.49 MB / 44,549,737 bytes) — rebuilt via `npm run release:build` with Inno Setup 6 (`ISCC.exe`), bundling `app/UAS.exe`, `app/runtime/node.exe`, `app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), `app/.next/static` CSS/JS chunks, and zero `.apk` files inside `release/UAS-Commercial-Dist/`.
- End-to-End Smoke Verification (`node scripts/verify-standalone-zero-db.mjs`): TEST A (bundled `runtime/node.exe` zero-DB self-healing) and TEST B (native `UAS.exe` first-launch `template.db` copy) both passed with `200 OK` across all endpoints.





### Phase 2 — COMPLETE (2026-11-18) — awaiting approval for Phase 3

**Files created:**
- `src/lib/licensing/seatService.ts` — single shared seat-binding service (`bindSeat`, `releaseSeat`, `getSeatUsage`, `MemorySeatStore`) normalizing `userEmail` with `.trim().toLowerCase()`, enforcing max 7 active users per license and max 1 Windows + 1 Android device per user, and updating `lastSeenAt` on re-activation.
- `src/lib/licensing/prismaSeatStore.ts` — SQLite/Prisma `LicenseDeviceBinding` store with transactional quota serialization.
- `src/lib/licensing/companyLock.ts` — company-name lock evaluator (`evaluateCompanyLock`, `checkProfileUpdateAgainstLock`, `companyMismatchMessage`).
- `src/lib/licensing/companyLockServer.ts` — Prisma `EnterpriseProfile` repository & cryptographically verified active locked license loader (`loadActiveLockedLicense`).
- `src/lib/licensing/activationPolicy.ts` — shared activation policy combining company lock adoption/verification with seat binding.
- `src/lib/licensing/licenseAuthority.ts` — stateless Ed25519 verification + stateful seat quota enforcement for the `https://qat.world/api/licensing/verify-key` cloud endpoint.
- `src/lib/licensing/seatContext.ts` — loopback vs remote device HWID resolution and explicit `SUPER_ADMIN` guard.
- `src/lib/licensing/seatClient.ts` — browser/Capacitor Android offline Ed25519 WebCrypto verifier, `LocalStorageSeatStore`, `LocalStorageProfileStore`, `activateOfflineClientLicense`, and `releaseOfflineClientSeat`.
- `src/app/api/licensing/verify-key/route.ts` — cloud license authority endpoint (`/api/licensing/verify-key`).
- `src/app/api/licensing/seats/route.ts` — seat usage inspection (`GET`) and session seat bind/refresh (`POST`).
- `src/app/api/licensing/seats/release/route.ts` — `SUPER_ADMIN` seat release endpoint (`POST`) with immutable audit trail logging.

**Files modified:**
- `src/app/api/licensing/activate/route.ts` — enforces company-name lock against `EnterpriseProfile` (auto-adopting when `isConfigured` is false, rejecting mismatches with exact bilingual error), binds user seat, and supports online verification against `https://qat.world/api/licensing/verify-key`.
- `src/app/api/licensing/status/route.ts` — exposes `company_name`, `company_locked`, `company_matches`, `seat_managed`, `max_users`, `per_user_devices`, and live `seats` counters.
- `src/app/api/system/branding/route.ts` — blocks changing `EnterpriseProfile.legalNameAr` / `legalNameEn` to an organization name that violates the active signed license.
- `src/lib/licensing/guard.ts` — checks `EnterpriseProfile` company lock inside `checkLicenseAndClock`.
- `src/lib/licensing/index.ts` — exports all browser-safe licensing modules.
- `src/components/LicenseActivationModal.tsx` — adds Company Name confirmation field, live seat usage indicator (`X / 7 Users`, Windows & Android slots), per-user device seat table, and `SUPER_ADMIN` **"إلغاء ربط الجهاز / Release Device Seat"** controls.
- `src/components/UasAppShell.tsx` — binds/refreshes user device seat on login and passes `currentUser` and `enterpriseProfile` to `LicenseActivationModal`.
- `tests/licensingV2.test.ts` — adds 7 comprehensive Phase 2 test suites across SQLite/Prisma, cloud `verify-key`, and Capacitor offline mode.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 54/54 pass.

### Phase 3 — COMPLETE (2026-11-18) — awaiting approval for Phase 4

**Files created:**
- `src/lib/uasSupportKnowledge.ts` — 7 comprehensive bilingual (Arabic + English) chapters covering: (1) First-Time Setup, Login & 7 RBAC Roles, (2) Company-Locked 7-User Licensing & Seat Management (`SUPER_ADMIN` seat release & resolving company mismatches), (3) Operating Modes (`Local Standalone`, `Office LAN Server 0.0.0.0:3000`, `Cloud qat.world`), (4) 5-Level Chart of Accounts & Double-Entry Journal Vouchers, (5) Receipts, Payment Vouchers & Cost Centers, (6) Sales/Purchase Invoicing, Inventory & Public QR Verification, and (7) Financial Reports (TB, P&L, BS) & SQLite Backup/Restore.
- `src/lib/localSupportEngine.ts` — zero-dependency browser/server offline support retrieval & live diagnostic engine with weighted BM25, Arabic normalization (`أ/إ/آ -> ا`, `ة -> ه`, `ى -> ي`), prefix/suffix stemming, 3-consonant broken-plural root matching, and live diagnostic analysis (`diagnoseLiveSystemState`, `answerSupportQuery`).
- `src/lib/supportDiagnosticsServer.ts` — server-side live SQLite & runtime diagnostic collector (`collectServerSupportDiagnostics`).
- `src/app/api/support/chat/route.ts` — `GET` and `POST /api/support/chat` endpoint combining manual retrieval with live system diagnostics.
- `tests/supportEngine.test.ts` — 7 unit & integration test suites verifying bilingual manual completeness, BM25 + Arabic root retrieval, and live offline diagnostics.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 61/61 pass.

### Phase 4 — COMPLETE (2026-11-18) — awaiting approval for Phase 5

**Files created:**
- `src/lib/ai/uasAgentTools.ts` — typed, session-RBAC-checked tool registry covering all 11 tools across Navigation (`navigate_to_module`), Accounting (`query_account_balance`, `search_journal_entries`, `draft_journal_entry`, `draft_voucher`), Invoicing & Inventory (`draft_invoice`, `check_item_stock`, `verify_qr_document`), and Reports & Support (`generate_report_summary`, `diagnose_system_health`, `search_user_manual`). Enforces 5-level COA leaf account validation, strict `Sum(Debit) === Sum(Credit)` balance checks, and the Mandatory Confirmation Preview Card gate.
- `src/lib/ai/offlineAgentEngine.ts` — 3-tier hybrid reasoning engine (`Tier 1: Online Cloud LLM`, `Tier 2: Offline Local Ollama http://127.0.0.1:11434`, `Tier 3: Zero-Dependency Deterministic Bilingual NLP Engine`) with 4-step reasoning traces (`thought -> tool_call -> observation -> response`).
- `src/lib/ai/agentServerExecutor.ts` — server SQLite context builder (`buildServerAgentContext`) and confirmed write executor (`executeConfirmedAiAction`) recording `executed_by_ai: true` in `AuditLog` and `ImmutableAuditLog`.
- `src/app/api/ai/agent/route.ts` — `GET` and `POST /api/ai/agent` endpoint handling reasoning, tool execution, and explicit user confirmations (`confirmAction`).
- `src/components/UasAiCopilot.tsx` — unified floating Bilingual Voice (`ar-YE`/`ar-SA`/`en-US` Web Speech API + native Capacitor SpeechRecognition + optional TTS) + Text Reasoning Copilot, Live Diagnostics pane, Financial Confirmation Preview Cards (`"تأكيد وترحيل / Confirm & Execute"`), and searchable 7-chapter User Manual tab.
- `tests/aiAgent.test.ts` — comprehensive unit & SQLite integration tests proving bilingual reasoning, offline deterministic execution, balanced journal entry preview + confirmation gate, RBAC blocking, navigation deep links, and confirmed SQLite posting with `executed_by_ai: true`.

**Files modified:**
- `src/components/UasAppShell.tsx` — mounts `<UasAiCopilot />` globally across Login/Activation and workspace views.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 66/66 pass.

### Phase 5 — COMPLETE (2026-11-18) — All 5 Phases Verified & Packaged

**Files modified:**
- `scripts/verify-standalone-zero-db.mjs` — extended end-to-end standalone smoke verification to assert `200 OK` on `/api/support/chat` and `/api/ai/agent` alongside `200 OK` HTML, `200 OK` Tailwind CSS (`/_next/static/chunks/*.css`), `/api/licensing/status`, `/api/bootstrap`, `/api/public/verify`, zero `.exe`/`.apk` download buttons in HTML, and zero `P2021` errors.

**Production Artifacts Built & Verified:**
- `public/downloads/uas-latest.apk` & `dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk` (4.42 MB / 4,632,296 bytes) — rebuilt via `npm run build:mobile`, `npx cap sync android`, and Gradle (`BUILD SUCCESSFUL`). Verified zero `.exe`/`.apk` download buttons and zero nested `.apk`/`.exe` files inside mobile assets.
- `public/downloads/UAS-Setup-Win64.exe` & `release/UAS-Commercial-Dist/UAS-Setup-Win64.exe` (42.49 MB / 44,549,737 bytes) — rebuilt via `npm run release:build` with Inno Setup 6 (`ISCC.exe`), bundling `app/UAS.exe`, `app/runtime/node.exe`, `app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), `app/.next/static` CSS/JS chunks, and zero `.apk` files inside `release/UAS-Commercial-Dist/`.
- End-to-End Smoke Verification (`node scripts/verify-standalone-zero-db.mjs`): TEST A (bundled `runtime/node.exe` zero-DB self-healing) and TEST B (native `UAS.exe` first-launch `template.db` copy) both passed with `200 OK` across all endpoints.




### Phase 3 — COMPLETE (2026-11-18) — awaiting approval for Phase 4

**Files created:**
- `src/lib/uasSupportKnowledge.ts` — 7 comprehensive bilingual (Arabic + English) chapters covering: (1) First-Time Setup, Login & 7 RBAC Roles, (2) Company-Locked 7-User Licensing & Seat Management (`SUPER_ADMIN` seat release & resolving company mismatches), (3) Operating Modes (`Local Standalone`, `Office LAN Server 0.0.0.0:3000`, `Cloud qat.world`), (4) 5-Level Chart of Accounts & Double-Entry Journal Vouchers, (5) Receipts, Payment Vouchers & Cost Centers, (6) Sales/Purchase Invoicing, Inventory & Public QR Verification, and (7) Financial Reports (TB, P&L, BS) & SQLite Backup/Restore.
- `src/lib/localSupportEngine.ts` — zero-dependency browser/server offline support retrieval & live diagnostic engine with weighted BM25, Arabic normalization (`أ/إ/آ -> ا`, `ة -> ه`, `ى -> ي`), prefix/suffix stemming, 3-consonant broken-plural root matching, and live diagnostic analysis (`diagnoseLiveSystemState`, `answerSupportQuery`).
- `src/lib/supportDiagnosticsServer.ts` — server-side live SQLite & runtime diagnostic collector (`collectServerSupportDiagnostics`).
- `src/app/api/support/chat/route.ts` — `GET` and `POST /api/support/chat` endpoint combining manual retrieval with live system diagnostics.
- `tests/supportEngine.test.ts` — 7 unit & integration test suites verifying bilingual manual completeness, BM25 + Arabic root retrieval, and live offline diagnostics.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 61/61 pass.

### Phase 4 — COMPLETE (2026-11-18) — awaiting approval for Phase 5

**Files created:**
- `src/lib/ai/uasAgentTools.ts` — typed, session-RBAC-checked tool registry covering all 11 tools across Navigation (`navigate_to_module`), Accounting (`query_account_balance`, `search_journal_entries`, `draft_journal_entry`, `draft_voucher`), Invoicing & Inventory (`draft_invoice`, `check_item_stock`, `verify_qr_document`), and Reports & Support (`generate_report_summary`, `diagnose_system_health`, `search_user_manual`). Enforces 5-level COA leaf account validation, strict `Sum(Debit) === Sum(Credit)` balance checks, and the Mandatory Confirmation Preview Card gate.
- `src/lib/ai/offlineAgentEngine.ts` — 3-tier hybrid reasoning engine (`Tier 1: Online Cloud LLM`, `Tier 2: Offline Local Ollama http://127.0.0.1:11434`, `Tier 3: Zero-Dependency Deterministic Bilingual NLP Engine`) with 4-step reasoning traces (`thought -> tool_call -> observation -> response`).
- `src/lib/ai/agentServerExecutor.ts` — server SQLite context builder (`buildServerAgentContext`) and confirmed write executor (`executeConfirmedAiAction`) recording `executed_by_ai: true` in `AuditLog` and `ImmutableAuditLog`.
- `src/app/api/ai/agent/route.ts` — `GET` and `POST /api/ai/agent` endpoint handling reasoning, tool execution, and explicit user confirmations (`confirmAction`).
- `src/components/UasAiCopilot.tsx` — unified floating Bilingual Voice (`ar-YE`/`ar-SA`/`en-US` Web Speech API + native Capacitor SpeechRecognition + optional TTS) + Text Reasoning Copilot, Live Diagnostics pane, Financial Confirmation Preview Cards (`"تأكيد وترحيل / Confirm & Execute"`), and searchable 7-chapter User Manual tab.
- `tests/aiAgent.test.ts` — comprehensive unit & SQLite integration tests proving bilingual reasoning, offline deterministic execution, balanced journal entry preview + confirmation gate, RBAC blocking, navigation deep links, and confirmed SQLite posting with `executed_by_ai: true`.

**Files modified:**
- `src/components/UasAppShell.tsx` — mounts `<UasAiCopilot />` globally across Login/Activation and workspace views.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 66/66 pass.

### Phase 5 — COMPLETE (2026-11-18) — All 5 Phases Verified & Packaged

**Files modified:**
- `scripts/verify-standalone-zero-db.mjs` — extended end-to-end standalone smoke verification to assert `200 OK` on `/api/support/chat` and `/api/ai/agent` alongside `200 OK` HTML, `200 OK` Tailwind CSS (`/_next/static/chunks/*.css`), `/api/licensing/status`, `/api/bootstrap`, `/api/public/verify`, zero `.exe`/`.apk` download buttons in HTML, and zero `P2021` errors.

**Production Artifacts Built & Verified:**
- `public/downloads/uas-latest.apk` & `dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk` (4.42 MB / 4,632,296 bytes) — rebuilt via `npm run build:mobile`, `npx cap sync android`, and Gradle (`BUILD SUCCESSFUL`). Verified zero `.exe`/`.apk` download buttons and zero nested `.apk`/`.exe` files inside mobile assets.
- `public/downloads/UAS-Setup-Win64.exe` & `release/UAS-Commercial-Dist/UAS-Setup-Win64.exe` (42.49 MB / 44,549,737 bytes) — rebuilt via `npm run release:build` with Inno Setup 6 (`ISCC.exe`), bundling `app/UAS.exe`, `app/runtime/node.exe`, `app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), `app/.next/static` CSS/JS chunks, and zero `.apk` files inside `release/UAS-Commercial-Dist/`.
- End-to-End Smoke Verification (`node scripts/verify-standalone-zero-db.mjs`): TEST A (bundled `runtime/node.exe` zero-DB self-healing) and TEST B (native `UAS.exe` first-launch `template.db` copy) both passed with `200 OK` across all endpoints.



### Phase 4 — COMPLETE (2026-11-18) — awaiting approval for Phase 5

**Files created:**
- `src/lib/ai/uasAgentTools.ts` — typed, session-RBAC-checked tool registry covering all 11 tools across Navigation (`navigate_to_module`), Accounting (`query_account_balance`, `search_journal_entries`, `draft_journal_entry`, `draft_voucher`), Invoicing & Inventory (`draft_invoice`, `check_item_stock`, `verify_qr_document`), and Reports & Support (`generate_report_summary`, `diagnose_system_health`, `search_user_manual`). Enforces 5-level COA leaf account validation, strict `Sum(Debit) === Sum(Credit)` balance checks, and the Mandatory Confirmation Preview Card gate.
- `src/lib/ai/offlineAgentEngine.ts` — 3-tier hybrid reasoning engine (`Tier 1: Online Cloud LLM`, `Tier 2: Offline Local Ollama http://127.0.0.1:11434`, `Tier 3: Zero-Dependency Deterministic Bilingual NLP Engine`) with 4-step reasoning traces (`thought -> tool_call -> observation -> response`).
- `src/lib/ai/agentServerExecutor.ts` — server SQLite context builder (`buildServerAgentContext`) and confirmed write executor (`executeConfirmedAiAction`) recording `executed_by_ai: true` in `AuditLog` and `ImmutableAuditLog`.
- `src/app/api/ai/agent/route.ts` — `GET` and `POST /api/ai/agent` endpoint handling reasoning, tool execution, and explicit user confirmations (`confirmAction`).
- `src/components/UasAiCopilot.tsx` — unified floating Bilingual Voice (`ar-YE`/`ar-SA`/`en-US` Web Speech API + native Capacitor SpeechRecognition + optional TTS) + Text Reasoning Copilot, Live Diagnostics pane, Financial Confirmation Preview Cards (`"تأكيد وترحيل / Confirm & Execute"`), and searchable 7-chapter User Manual tab.
- `tests/aiAgent.test.ts` — comprehensive unit & SQLite integration tests proving bilingual reasoning, offline deterministic execution, balanced journal entry preview + confirmation gate, RBAC blocking, navigation deep links, and confirmed SQLite posting with `executed_by_ai: true`.

**Files modified:**
- `src/components/UasAppShell.tsx` — mounts `<UasAiCopilot />` globally across Login/Activation and workspace views.

**Verification:** `npx tsc --noEmit` exit 0; `npm test` 66/66 pass.

### Phase 5 — COMPLETE (2026-11-18) — All 5 Phases Verified & Packaged

**Files modified:**
- `scripts/verify-standalone-zero-db.mjs` — extended end-to-end standalone smoke verification to assert `200 OK` on `/api/support/chat` and `/api/ai/agent` alongside `200 OK` HTML, `200 OK` Tailwind CSS (`/_next/static/chunks/*.css`), `/api/licensing/status`, `/api/bootstrap`, `/api/public/verify`, zero `.exe`/`.apk` download buttons in HTML, and zero `P2021` errors.

**Production Artifacts Built & Verified:**
- `public/downloads/uas-latest.apk` & `dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk` (4.42 MB / 4,632,296 bytes) — rebuilt via `npm run build:mobile`, `npx cap sync android`, and Gradle (`BUILD SUCCESSFUL`). Verified zero `.exe`/`.apk` download buttons and zero nested `.apk`/`.exe` files inside mobile assets.
- `public/downloads/UAS-Setup-Win64.exe` & `release/UAS-Commercial-Dist/UAS-Setup-Win64.exe` (42.49 MB / 44,549,737 bytes) — rebuilt via `npm run release:build` with Inno Setup 6 (`ISCC.exe`), bundling `app/UAS.exe`, `app/runtime/node.exe`, `app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), `app/.next/static` CSS/JS chunks, and zero `.apk` files inside `release/UAS-Commercial-Dist/`.
- End-to-End Smoke Verification (`node scripts/verify-standalone-zero-db.mjs`): TEST A (bundled `runtime/node.exe` zero-DB self-healing) and TEST B (native `UAS.exe` first-launch `template.db` copy) both passed with `200 OK` across all endpoints.


### Phase 5 — COMPLETE (2026-11-18) — All 5 Phases Verified & Packaged

**Files modified:**
- `scripts/verify-standalone-zero-db.mjs` — extended end-to-end standalone smoke verification to assert `200 OK` on `/api/support/chat` and `/api/ai/agent` alongside `200 OK` HTML, `200 OK` Tailwind CSS (`/_next/static/chunks/*.css`), `/api/licensing/status`, `/api/bootstrap`, `/api/public/verify`, zero `.exe`/`.apk` download buttons in HTML, and zero `P2021` errors.

**Production Artifacts Built & Verified:**
- `public/downloads/uas-latest.apk` & `dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk` (4.42 MB / 4,632,296 bytes) — rebuilt via `npm run build:mobile`, `npx cap sync android`, and Gradle (`BUILD SUCCESSFUL`). Verified zero `.exe`/`.apk` download buttons and zero nested `.apk`/`.exe` files inside mobile assets.
- `public/downloads/UAS-Setup-Win64.exe` & `release/UAS-Commercial-Dist/UAS-Setup-Win64.exe` (42.49 MB / 44,549,737 bytes) — rebuilt via `npm run release:build` with Inno Setup 6 (`ISCC.exe`), bundling `app/UAS.exe`, `app/runtime/node.exe`, `app/prisma/template.db` (35 tables incl. `LicenseDeviceBinding`), `app/.next/static` CSS/JS chunks, and zero `.apk` files inside `release/UAS-Commercial-Dist/`.
- End-to-End Smoke Verification (`node scripts/verify-standalone-zero-db.mjs`): TEST A (bundled `runtime/node.exe` zero-DB self-healing) and TEST B (native `UAS.exe` first-launch `template.db` copy) both passed with `200 OK` across all endpoints.