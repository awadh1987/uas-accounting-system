# 08 — Security, Multi-Tenancy, and Internal Control Audit

---

## 1. Authentication, Session & Credential Security (`CRITICAL` Failure)

| Control Area | Finding | Evidence | Risk Rating |
|---|---|---|---|
| **Server Session / Token Enforcement** | **MISSING.** `POST /api/auth/login` verifies password hash and returns JSON `{ user }`, issuing **no signed JWT, opaque session token, DB session record, or `Set-Cookie`**. `logout/route.ts` deletes cookie names (`uas_session`, `uas_token`, `uas_auth`, `uas_user`) that login never sets. Client stores `uas_user` in `localStorage`. | [login/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/auth/login/route.ts), [logout/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/auth/logout/route.ts), [UasAppShell.tsx](file:///e:/2026/uas-accounting-system/src/components/UasAppShell.tsx) | **CRITICAL** |
| **Actor Spoofing & Default Escalation to `SUPER_ADMIN`** | `extractActor()` reads client-provided `body.actor` or `x-uas-user-id`/`x-uas-role` headers and **falls back to `userId = "u1"` and `rawRole = "SUPER_ADMIN"`** when omitted. `resolveVerifiedActor()` checks DB if `userId` exists, **but if missing from DB (`!dbUser`), returns the unverified `actor` including spoofed `userRole`** (`apiHelpers.ts` L129). `system/reset/route.ts` and `treasury/dispatch/route.ts` inline `\|\| "SUPER_ADMIN"` directly. | [apiHelpers.ts:L33-130](file:///e:/2026/uas-accounting-system/src/lib/apiHelpers.ts#L33-L130), [system/reset/route.ts:L53-67](file:///e:/2026/uas-accounting-system/src/app/api/system/reset/route.ts#L53-L67), [treasury/dispatch/route.ts:L9-12](file:///e:/2026/uas-accounting-system/src/app/api/treasury/dispatch/route.ts#L9-L12) | **CRITICAL** |
| **Password Hashing & Seed Credentials** | Passwords hashed using **unsalted single-pass SHA-256** instead of `argon2id` / `bcrypt` / `scrypt`. Default owners seeded with `"123456"` (`seed.ts` `u1`, `tenantDbManager.ts` `admin`). Recover-admin resets password via license file/key only without email/MFA/challenge beyond company name match. | [serverBootstrap.ts:L47-48](file:///e:/2026/uas-accounting-system/src/lib/serverBootstrap.ts#L47-L48), [seed.ts](file:///e:/2026/uas-accounting-system/prisma/seed.ts) | **HIGH** |
| **Fail-Open License / Clock Guard** | `authorizeApiAction` wraps `checkLicenseAndClock()` in `try/catch` (`apiHelpers.ts` L167-169) and fails open if an exception occurs. | [apiHelpers.ts:L147-170](file:///e:/2026/uas-accounting-system/src/lib/apiHelpers.ts#L147-L170), [guard.ts](file:///e:/2026/uas-accounting-system/src/lib/licensing/guard.ts) | **MEDIUM** |

---

## 2. Full API Route Authorization & Tenant-Isolation Coverage (90 Routes Scanned)

An automated read-only scan of all **90** `route.ts` files in `src/app/api/` reveals:
- **`withTenantRoute` Present**: **23 / 90 routes (25.6%)** — **67 routes execute against the `default` database regardless of active tenant header/subdomain/cookie!**
- **`authorizeApiAction` / `requireSuperAdmin` / Vendor Bearer Token**: **36 / 90 routes (40.0%)**
- **`extractActor` ONLY (No permission check enforced!)**: **29 / 90 routes (32.2%)**
- **No Actor OR Auth Check At All**: **25 / 90 routes (27.8%)**
- **`withIdempotency` / `executeWithIdempotency` Guard**: **17 / 90 routes (18.9%)**

### High-Risk Unprotected & Non-Tenant Routes Breakdown

| Route Group | `withTenantRoute` | Auth Enforcement Gap |
|---|---|---|
| `src/app/api/accounting/journal/route.ts`, `coa`, `cost-centers`, `fiscal-years/*` | **False** (0 / 13 in `accounting/`) | Uses `authorizeApiAction` (spoofable `actor`), EXCEPT `fiscal-years/[id]/precheck` & all 4 `/accounting/reports/*` routes which have **zero auth checks**, and `currencies`, `exchange-rates`, `fx-revaluation` which call **`extractActor()` only** (anyone can run `fx-revaluation` bypassing `accounting.fx_revalue`!). |
| `src/app/api/procurement/*` (`vendors`, `pos`, `bills`, `payments`) | **False** (0 / 4) | Calls `authorizeApiAction` (spoofable actor), misses tenant isolation (`default` DB corruption); `payments` lacks `withIdempotency`. |
| `src/app/api/sales/*` (`route.ts`, `[id]`, `customers`, `invoices`, `receipts`) | **False** (0 / 5) | Calls `authorizeApiAction` (spoofable actor), misses tenant isolation; `invoices`, `receipts`, `[id]` lack `withIdempotency`. |
| `src/app/api/expenses/*`, `workers/*`, `projects/*`, `inventory/*` | **False** (0 / 14) | `inventory/items`, `inventory/movements`, `inventory/uom`, `inventory/warehouses`, `projects/harvests` use `extractActor` only (`inventory/categories` has **zero** auth checks). |
| `src/app/api/treasury/*` (`route.ts`, `transfer`, `reconcile`, `dispatch`, `batch-export`, `reconcile-import`, `webhook/[provider]`) | **False** (0 / 7) | `dispatch`, `batch-export`, `reconcile-import`, `webhook/[provider]` lack `authorizeApiAction`; `dispatch` defaults actor to `SUPER_ADMIN`; `webhook` verifies **zero** HMAC signature! |
| `src/app/api/approvals/*` & `src/app/api/drafts/*` | **False** (0 / 6) | `approvals`, `approvals/[id]/decide`, and all 3 `drafts/*` routes use `extractActor()` only (no `authorizeApiAction`). Only `approvals/rules` uses `authorizeApiAction`. |
| `src/app/api/audit/*` (`adjustments`, `lock`, `log`) | **False** (0 / 3) | All 3 call `extractActor()` only — any user (or anonymous POST) can lock/unlock harvest cycles (`lock`) or post GL cash adjustments (`adjustments`)! |
| `src/app/api/installments/route.ts` & `ai/agent/route.ts` | **False** (0 / 2) | `installments` calls `extractActor()` only; `ai/agent` has zero auth wrapper & non-tenant DB. |
| `src/app/api/system/reset/route.ts` & `system/lifecycle/route.ts` | **False** (0 / 2) | Both bypass `withTenantRoute`; `system/reset` hardcodes `userRole \|\| "SUPER_ADMIN"`; `system/lifecycle` uses `extractActor()` without `authorizeApiAction` (defaults to `SUPER_ADMIN`!). |
| Protected `withTenantRoute` Routes (23 routes) | **True** (23 / 23) | Covers `auth/login`, `bootstrap`, `users/*` (3), `system/settings`, `branding`, `backup`, `backups`, `restore`, `runtime`, `tenant/config`, `devices/*` (2), `notifications/*` (2), `sync/*` (3), `ai/extract-document/*` (2), `public/*` (2). Note: `system/backup`, `backups`, `restore`, `settings`, `users`, `users/[id]`, `users/[id]/reset-password`, `sync/pull` still rely on spoofable `extractActor` without `authorizeApiAction` or session verification! |

*(Verification note: `src/proxy.ts` resolves subdomain slug into `x-uas-resolved-tenant`, which is completely ineffective when 67 routes never execute inside `withTenantRoute()`! Also `users/me/password` & `users/me/profile` omit `withTenantRoute`.)*

---

## 3. Segregation of Duties (SoD), Approval Governance & Audit Trail Analysis

1. **Segregation of Duties (`permissions.ts` vs Runtime Reality)**:  
   - **Design**: [permissions.ts](file:///e:/2026/uas-accounting-system/src/lib/permissions.ts) defines 7 thoughtful roles (`SUPER_ADMIN`, `CHIEF_ACCOUNTANT`, `PROJECT_MANAGER`, `FIELD_ACCOUNTANT`, `SALES_AGENT`, `PROCUREMENT_AGENT`, `EXTERNAL_AUDITOR`) plus 18 granular overrides (`accounting.close_year`, `accounting.fx_revalue`, `approvals.decide`, `approvals.configure`, `drafts.manage_all`, `inventory.custom_uom`, `records.archive_delete`, `treasury.gateway_execute`, etc.).  
   - **Failure**: (a) Anyone can impersonate any role via `body.actor` / `x-uas-role` due to missing server sessions; (b) `approvalEngine.ts` blocks self-approval on `ApprovalRequest`, **but standard operational routes never create `ApprovalRequest`s** when `requireApprovalWorkflow = true` or `ApprovalRule` matches! (c) `updateJournalEntry()` lets anyone with GL edit access rewrite `POSTED` entries without reversal or dual approval.

2. **Immutable Audit Trail & Before/After Diff Integrity**:  
   - **Design**: [serverBootstrap.ts:L109-121](file:///e:/2026/uas-accounting-system/src/lib/serverBootstrap.ts#L109-L121) computes a `SHA256-` prefix hash per row in `ImmutableAuditLog`, and `recordAuditDiffTx()` logs before/after JSON into `AuditLog`.  
   - **Gaps**:  
     - `ImmutableAuditLog` hashes only `(timestamp|userDisplay|actionType|entityReference|details)` **without chaining the previous row's `sha256Hash`**, so deleting or injecting rows in SQLite/PostgreSQL cannot be cryptographically detected.  
     - `updateJournalEntry()` (`ledgerService.ts:L2910-2927`) records only `{ date, reference, narrationAr, lineCount }` in before/after diff—meaning account IDs, amounts, currencies, and cost center edits on `POSTED` journals leave zero line-level audit diff!  
     - Direct hard-delete routes silently destroy `JournalEntry` rows in `catch` blocks when reversal fails (`procurement/bills`, `payments`, `installments`).

3. **Monetary Limits & Exception Monitoring**:  
   - `TreasuryAccount.dailyLimit` / `dailyUsedAmount` are enforced only inside `executeBankOrWalletPayout()` ([bankWalletGateway.ts](file:///e:/2026/uas-accounting-system/src/lib/treasury/bankWalletGateway.ts)), **not** in `postVendorPayment()`, `transferBetweenTreasuries()`, `POST /api/expenses`, `POST /api/workers`, or `POST /api/installments`.
   - `Customer.creditLimit` is never enforced in invoicing/sales.
   - `Project` & `SubProject` budget limits trigger visual `isOverBudget` flags only—never blocking or requiring approval override.
