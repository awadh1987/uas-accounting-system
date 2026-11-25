# UAS Bulk & Partial Goods Trading Platform — Complete Project View, Architecture, Documentation & Agent Execution Guide

> **Baseline:** Forked from `UAS Accounting System` (`git@github.com:awadh1987/uas-accounting-system.git`) into an **independent repository** (e.g., `git@github.com:awadh1987/uas-bulk-trade.git`) and isolated deployment environment so `uas-accounting-system` (`/var/www/uas-qat`, `uas-qat.service`) remains completely untouched.

---

## Table of Contents
1. [Project View: Client-Core Bulk/Partial Trading Platform](#1-project-view-client-core-bulkpartial-trading-platform)
2. [System Architecture](#2-system-architecture)
3. [Core Project Documents (Baseline Suite)](#3-core-project-documents-baseline-suite)
4. [Coding Agent Execution Prompt (Phases 1–6)](#4-coding-agent-execution-prompt-phases-16)

---

## 1. Project View: Client-Core Bulk/Partial Trading Platform

### 1.1 Product Identity & Isolation
- Lives in its own repository (e.g., `uas-bulk-trade` / `qat-trade` under `awadh1987`) and separate deployment path/service from `/var/www/uas-qat` (`uas-qat.service`), with its own `.env`, database(s), and backup namespace so UAS Accounting System is never disrupted.
- Preserves UAS strengths: multi-tenant slug routing (`https://<slug>.qat.world` or dedicated trade domain), offline-first mobile/desktop capability, multi-unit stock (`كرتون / ربطة / حبة / وزن`), and double-entry accounting postings.

### 1.2 Core 1 — External Client ("End User") Portal & Self-Service Order/Registration
- End users (shops, groceries, sub-dealers, bulk buyers) log in or submit self-registered goods requests/orders (`طلب بضاعة / تسجيل أصناف`) with **bulk (`جملة / كرتون / ربطة`)** and **partial (`تجزئة / حبة / كسر وحدة`)** quantities.
- Supports **client-initiated goods registration/submission** (where a client submits desired items, quantities, preferred delivery/pickup window, or custom/requested goods for review/pricing/confirmation) alongside live catalog ordering.
- Tracks every client submission through clear workflow states: `submitted` -> `under_review` -> `confirmed_order` -> `allocated_outbound` -> `dispatched` -> `delivered` / `settled`.

### 1.3 Core 2 — Supply, Warehouse & Dispatch Engine
- **Vendors:** Supplier directory, purchase/supply orders, vendor bills, and payable balances.
- **Inventory:** Multi-unit stock balances (`available`, `reserved_for_client`, `in_outbound`, `damaged/variance`), unit conversion factors, and batch/lot/category tracking.
- **Inbound:** Goods receipts (`GRN`), supplier deliveries, quality/quantity checks, and stock-in postings.
- **Outbound:** Order picking, packing, bulk-to-partial unit breakdown/allocation, and shipment staging.
- **Dispatch:** Trip/route assignment, driver/vehicle handoff, dispatch manifests, proof of delivery (`POD`), and delivery status updates synced back to the End User view.

### 1.4 Accounting, UX & Governance Bridge
- Translates confirmed orders, inbound receipts, outbound dispatches, payments/receipts, and credit/cash settlements into auditable ledger entries (`draft` -> `confirm` workflow where appropriate), per-tenant data isolation, device/session governance, and GFS backups.
- Enforces consistent Arabic RTL ergonomics across all screens: `dd / mm / yyyy` date formatting, real `تحديث` data refreshes with loading/timestamp feedback, Arabic RTL `PDF` / `Print` / `Excel` exports, `⋮` three-dots menus for secondary/destructive actions with confirmation, and safe bottom padding so floating widgets never overlap action buttons or tables.

---

## 2. System Architecture

### 2.1 Logical Two-Core + Accounting Architecture

```text
+-----------------------------------------------------------------------+
|               CORE 1: EXTERNAL CLIENT ("END USER") PORTAL             |
|  - Hybrid Web / Android APK / Windows EXE Client App                  |
|  - Catalog Browsing (Bulk Units & Partial/Split Units)                |
|  - Client Goods Registration & Submission ("تسجيل وتقديم البضائع")    |
|  - Live Order Timeline, Dispatch Tracking, Statements & POD Confirm   |
+-----------------------------------+-----------------------------------+
                                    | HTTPS / REST / Sync Queue (Tenant + Client Scoped)
                                    v
+-----------------------------------------------------------------------+
|             APPLICATION & WORKFLOW ORCHESTRATION LAYER                |
|  - Tenant Resolver (<slug> -> Per-Tenant DB / Schema / Branding)      |
|  - Submission Triage & Pricing Engine (Bulk vs. Partial Pricing)      |
|  - Multi-Unit Stock Reservation & Allocation Engine                   |
|  - Dispatch Routing & Double-Entry Accounting Posting Bridge          |
+-----------------+-----------------------------------+-----------------+
                  |                                   |
                  v                                   v
+-----------------------------------+ +---------------------------------+
|   CORE 2: SUPPLY, STOCK & DISPATCH| |  SHARED UAS ACCOUNTING & OPS    |
|  - Vendors & Purchase Orders      | |  - Chart of Accounts & Ledger   |
|  - Multi-Unit Inventory Pool      | |  - Cashboxes, Banks & Credit    |
|  - Inbound (GRN & QC Receiving)   | |  - Device & Session Governance  |
|  - Outbound (Pick / Pack / Split) | |  - GFS Backups & Disk Alerts    |
|  - Dispatch (Trips & Manifests)   | |  - Arabic RTL PDF / Print / XLS |
+-----------------+-----------------+ +---------------------------------+
                  |
                  v
+-----------------------------------------------------------------------+
|                PERSISTENCE & FILE STORAGE (PER-TENANT)                |
|  - PostgreSQL (Production Tenants) / SQLite (Local / Offline Cache)   |
|  - Tenant Attachment Store (Client Lists, GRNs, Manifests, PODs)      |
+-----------------------------------------------------------------------+

```

### 2.2 Personas & Access Boundaries

| Persona | Core Access | Scope & Restrictions |
| --- | --- | --- |
| **End User (External Client)** | Core 1 (Client Portal) | Scoped strictly to `tenantSlug` + `clientId`. Can browse catalog, register/submit bulk or partial goods requests, view approved prices, track dispatch status, and view own account statement. |
| **Sales / Order Reviewer** | Core 1 Triage + Core 2 Outbound View | Reviews client submissions, maps custom submitted items to SKUs, confirms bulk/partial pricing, and approves orders (triggering stock reservation). |
| **Warehouse Operator** | Core 2 (Inventory, Inbound, Outbound) | Executes supplier `GRN` inbound receiving, manages multi-unit stock (`كرتون / ربطة / حبة`), and performs outbound picking, packing, and bulk-to-partial unit splitting. |
| **Dispatch Coordinator** | Core 2 (Dispatch) | Groups confirmed outbound orders into dispatch trips, assigns driver/vehicle, generates dispatch manifests, and records delivery/POD or partial returns. |
| **Purchasing / Vendor Officer** | Core 2 (Vendors & Inbound) | Manages supplier directory, purchase orders (`PO`), vendor bills, and inbound schedules. |
| **Accountant / Tenant Admin** | Accounting + Full Tenant Ops | Manages Chart of Accounts, customer credit limits, receipts/payments, device governance, tenant settings, and backups within `tenantSlug`. |

### 2.3 Key Domain Entities, Multi-Unit Math & State Transitions

1. **Multi-Unit Product & Bulk/Partial Pricing:**

* Every item supports a canonical base unit (`baseUnit`, e.g., `حبة` / `قطعة` / `كجم`) plus packaging tiers (`units[]`) with `unitCode`, `unitName`, `multiplierToBase`, `allowBulk`, `allowPartial`, `bulkUnitPrice`, and `partialUnitPrice`.
* Normalize quantities to `baseQty = qty * multiplierToBase` while displaying clear unit breakdowns (e.g., `12 كرتون + 6 حبة`).

1. **Inventory Balance Buckets (Per Item / Warehouse / Tenant):**

* `onHandBaseQty`: Physical stock inside the warehouse.
* `reservedBaseQty`: Stock locked by confirmed client orders awaiting outbound picking.
* `outboundStagedBaseQty`: Stock picked/packed and staged for dispatch.
* `availableBaseQty`: `onHandBaseQty - reservedBaseQty - outboundStagedBaseQty`.

1. **Client Goods Submission / Order (`ClientSubmission`):**

* Fields: `id`, `tenantSlug`, `clientId`, `submissionNumber`, `submissionType` (`catalog_order` | `client_goods_registration`), `fulfillmentPreference` (`delivery` | `branch_pickup`), `requestedDeliveryDate`, `status`, `currency`, `lines[]` (`lineId`, `itemId`, `submittedItemName`, `unitCode`, `multiplierToBase`, `saleMode` (`bulk` | `partial`), `requestedQty`, `approvedQty`, `unitPrice`, `lineTotal`, `lineStatus`), `clientNotes`, `reviewerNotes`, `createdAt`, `updatedAt`.
* State machine: `draft` -> `submitted` -> `under_review` -> `confirmed` -> `outbound_picking` -> `dispatched` -> `delivered` (or `partially_delivered` / `cancelled`).

1. **Core 2 Operational State Machines:**

* **Inbound (`Vendor` -> `PO` -> `GRN` -> `Inventory`):** `po_draft` -> `po_sent` -> `grn_receiving` -> `grn_posted` (increases `onHandBaseQty` and creates inventory/payable accounting entries).
* **Outbound (`Confirmed Submission` -> `Pick List` -> `Pack/Split` -> `Ready for Dispatch`):** `pending_pick` -> `picking` -> `packed_staged` (supports bulk-to-partial unit splitting, transitions `reservedBaseQty` -> `outboundStagedBaseQty`, and flags short-picks).
* **Dispatch (`Staged Outbound` -> `Dispatch Trip` -> `POD` -> `Settlement`):** `trip_planned` -> `in_transit` -> `delivered` / `partial_return` (deducts `outboundStagedBaseQty` and `onHandBaseQty` on handoff, posts receivable/cash settlement on delivery confirmation, and syncs live status to Core 1).

### 2.4 Security & Multi-Tenant Boundaries

* Every query, API route, attachment, and sync batch is strictly scoped by `tenantSlug` (and `clientId` for End Users).
* Zero superadmin/platform-admin routes, controls, or secrets in End User, mobile (`./out`), or desktop builds (`LEAK_CHECK=0`, `ADMIN_CHECK=0`).

---

## 3. Core Project Documents (Baseline Suite)

Maintain these four documents inside `docs/` in the new repository as your canonical specification:

1. **`docs/01-PRD-Client-Core-Bulk-Trading.md` (Product Requirements):**

* Personas: `End User (Bulk/Partial Buyer)`, `Sales/Order Reviewer`, `Warehouse/Inbound-Outbound Operator`, `Dispatch Coordinator`, `Vendor/Purchasing Officer`, `Accountant / Tenant Admin`.
* User stories for client goods registration & submission, bulk + partial unit ordering, order approval/pricing, GRN inbound, outbound picking/packing, dispatch trips, customer statements, and Arabic RTL UX standards.

1. **`docs/02-Architecture-And-Data-Model.md` (Technical Architecture):**

* Fork baseline from UAS Accounting System (`Next.js` / `TypeScript` / `PostgreSQL` + `SQLite` / sync & backup patterns).
* Multi-tenant routing, database/schema isolation, base-unit vs. packaging-unit stock math, reservation/inbound/outbound/dispatch state machines, and accounting journal hooks.

1. **`docs/03-Workflows-And-API-Contract.md` (Operational Flows & Endpoints):**

* End-to-end flows:
* *Flow A:* End User registers/submits goods -> Staff reviews & prices/confirms -> Stock reserved -> Outbound pick/pack -> Dispatch trip -> Delivery & accounting entry.
* *Flow B:* Vendor purchase -> Inbound GRN -> Inventory increase -> Client bulk/partial fulfillment.

* API contracts (`/api/portal/submissions`, `/api/portal/catalog`, `/api/portal/orders/[id]`, `/api/portal/statement`, `/api/ops/inbound`, `/api/ops/outbound`, `/api/ops/dispatch`, etc.), payload schemas, and role permissions.

1. **`docs/04-Fork-Deployment-And-Runbook.md` (Repo Fork, Server & Release Runbook):**

* Creating the new GitHub repository, cloning/forking from UAS safely, isolating ports/services/directories/databases on the server, `.env.production` setup, running tests/builds, GFS backup configuration, and keeping `uas-accounting-system` untouched.

---
