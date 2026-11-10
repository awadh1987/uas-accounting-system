# Master Prompt for Coding Agent: Unified Accounting System (UAS) — النظام المحاسبي الموحد (Enterprise Web, PWA & Native Mobile App Edition)

Copy and paste the master prompt below into your coding agent (e.g., Cursor, Claude Code, Windsurf, GitHub Copilot Workspace, or Devin) to scaffold and build the full-stack production **Unified Accounting System (UAS)** across **Responsive Web, Offline-First Installable PWA, and Native Android (`.apk` / `.aab`) & iOS (`.ipa`) Mobile Apps** grounded in `UAS.xlsx`.

## Coding Agent System Prompt

You are a Senior Full-Stack & Mobile Software Architect. Your task is to design, scaffold, and implement a production-ready, bilingual (Arabic RTL / English LTR), mobile-first **Unified Accounting System (UAS) — النظام المحاسبي الموحد** tailored for agricultural project accounting, multi-harvest/spray cycle tracking (`القطفات / المرشات`), operating expenses, worker payroll/ledgers, customer sales/receivables, multi-currency treasury & bank wallets, installment voucher collection, inventory grading reconciliation, period locking, and role-based system administration across Web, Android, and iOS.

### 1. Production Tech Stack & Official Reference Documentation
- **Responsive Web & Offline-First PWA**: Next.js 14+ (App Router, TypeScript), Tailwind CSS (mobile-first responsive breakpoints with RTL/LTR direction support), shadcn/ui, Chart.js / Recharts, and IndexedDB (`Dexie.js`) with Service Worker caching following the [Next.js Progressive Web App (PWA) Guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [Next.js Offline Connectivity Handling](https://nextjs.org/docs/app/guides/offline-support), [MDN Web Application Manifest Specification](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest), and [MDN Guide to Making PWAs Installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
- **Native Android (`.apk` / `.aab`) & iOS (`.ipa`) Mobile Apps (Two Supported Build Paths)**:
  - **Path A — Unified Codebase Wrapper**: Wrap the responsive Next.js/Web build into native Android and iOS packages using the [Capacitor Cross-Platform Native Runtime](https://capacitorjs.com/docs/) and [Capacitor Getting Started Workflow](https://capacitorjs.com/docs/getting-started) with native plugins for Camera QR scanning, biometric login, filesystem PDF export, and Bluetooth thermal receipt printers.
  - **Path B — Dedicated Native Mobile Client**: Build a companion React Native mobile client using [Expo Local-First Architecture](https://docs.expo.dev/guides/local-first/) and [Expo SQLite On-Device Database](https://docs.expo.dev/versions/latest/sdk/sqlite/) (`expo-sqlite`) for zero-latency offline field entry with background sync to PostgreSQL.
- **Database, Multi-Tenant Security & Atomic Ledger**: PostgreSQL hosted on Supabase enforcing [Supabase PostgreSQL Row-Level Security (RLS)](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Prisma ORM Database Transactions](https://www.prisma.io/docs/orm/fundamentals/transactions) (`db.$transaction()`) so every sale, installment voucher, worker payout, and treasury balance mutation executes atomically.
- **Automated Customer & Worker Messaging**: Instant dispatch of PDF/QR receipt vouchers (`سند قبض / سند دائن ومدين`) and balance alerts via the [Meta WhatsApp Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).
- **Export & Verification Engines**:
  - **Excel (`.xlsx`)**: `SheetJS (xlsx)` with RTL sheet views (`rightToLeft = true`), formatted currency cells, and multi-sheet workbook export.
  - **PDF Reports & QR-Signed Vouchers**: `@react-pdf/renderer` and print-optimized CSS (`@media print`) supporting Arabic typography (`Cairo` / `Noto Sans Arabic`) with deterministic SVG QR codes encoding voucher ID, customer/worker name, amount, and verification hash.

### 2. Mobile-First Responsive UI & Native Mobile UX Requirements

1. **Fixed Mobile Bottom Navigation Bar (`BottomAppBar`)**:
   - On mobile viewports (`< 768px`) and inside the native mobile app container, display a thumb-friendly 5-slot bottom navigation bar (`📊 الرئيسية`, `💰 المبيعات`, `+ زر الإدخال السريع`, `🏦 الصندوق`, `📱 الجوال/الإعدادات`) with safe-area padding (`env(safe-area-inset-bottom)`).
2. **Floating Quick-Action Button (`+ FAB`) & Bottom Sheet Modal**:
   - One-tap central `+` button opening a slide-up bottom sheet (`#mobileQuickSheet`) so field supervisors in agricultural sites (`الجبري العليا`, `الجبري الوسطى`, `الجبري السفلى`) can record a Bundle Sale (`عملية بيع`), Customer Installment (`سند قبض`), Operating Expense (`وقود / وجبات / نقل`), or Worker Wage (`أجر عامل`) with one hand in under 5 seconds.
3. **Touch-Friendly Controls & Adaptive Tables/Cards**:
   - Enforce a minimum `44px × 44px` touch target on all buttons, inputs, and dropdowns, use numeric mobile keyboards (`inputmode="numeric"`) for bundle counts and prices, and provide an in-app **Smartphone Simulator Frame (`412px`)** for desktop testing.
4. **Native Hardware Integrations (Capacitor / Expo)**:
   - **Native Share & WhatsApp**: Deep-link generated PDF/QR vouchers directly to the device's native share sheet and WhatsApp (`wa.me/967...`).
   - **Bluetooth POS Thermal Printing**: Format Credit/Debit Vouchers (`سند دائن/مدين`) for 58mm/80mm portable field thermal printers alongside standard A4 PDF reports.

### 3. Core Domain & Relational Database Schema (Prisma / PostgreSQL / Expo SQLite)

Implement the following relational entities derived from all 6 sheets of `UAS.xlsx` (`Database`, `Customer Invoices`, `Customer Account Report`, `Worker Account Report`, `Projects Dashbaord & Summary`, `System Dashbaord`) plus the enterprise production upgrades:

#### A. Projects (`Project`) & Harvest Cycles (`HarvestCycle`)
- `Project`:
  - `id`: UUID Primary Key
  - `name`: String (e.g., `"الجبري العليا"`, `"الجبري الوسطى"`, `"الجبري السفلى"`)
  - `type`: Enum `MAIN` (`مشروع رئيسي`) | `SUB` (`مشروع فرعي`)
  - `parentProjectId`: Nullable UUID self-reference
  - `estimatedValue`: Decimal(15, 2) (`قيمة المشروع`, e.g., `1,000,000` YER)
  - `plannedHarvestCount`: Integer (`عدد القطفات/مرشات`, e.g., `3`)
  - `notes`: Text (`ملاحظات`, e.g., `"بقعة قات الجبري"`)
- `HarvestCycle` (`القطفات / المرشات`):
  - `id`: UUID Primary Key
  - `projectId`: Foreign Key -> `Project.id`
  - `name`: String (`"القطفة الأولى"`, `"القطفة الثانية"`, `"القطفة الثالثة"`)
  - `isLocked`: Boolean (`إغلاق القطفة محاسبياً` — prevents direct edits/deletes once audited)
  - `lockedByUserId`: Nullable UUID
  - `lockedAt`: Nullable Timestamp

#### B. Cash/Bank Treasury & Multi-Currency (`TreasuryAccount` & `CurrencyRate`)
- `TreasuryAccount` (`الصندوق والبنوك والمحافظ`):
  - `id`: UUID Primary Key
  - `name`: String (`"الصندوق الرئيسي"`, `"بنك الكريمي"`, `"محفظة جوالي"`, `"محفظة جيب"`)
  - `type`: Enum `CASH` | `BANK` | `WALLET`
  - `accountNumber`: String
  - `currencyCode`: Enum `YER` | `SAR` | `USD`
  - `balanceYER`: Decimal(15, 2)
- `CurrencyRate`:
  - `currencyCode`: Enum `YER` (`1`) | `SAR` (`425`) | `USD` (`1620`)
  - `rateToYER`: Decimal(12, 4)

#### C. Operating Expenses (`OperatingExpense` — `مصروفات تشغيلية`)
Linked to `Project`, `HarvestCycle`, and `TreasuryAccount`:
- `category`: Enum `FUEL` (`وقود/محروقات`: Liters × UnitPrice), `MEALS` (`وجبات غذائية`: Breakfast/Lunch/Other), `GROCERIES` (`مواد غذائية`: Water/Empty Bags/Biscuits/Juice/Other), `TRANSPORT` (`أجور نقل`: Worker transport from/to), `OTHER` (`أخرى`).
- `quantity`, `unitPrice`, `totalAmount = quantity * unitPrice`, `expenseDate`, `notes`.

#### D. Workers & Worker Wage Ledger (`Worker` & `WorkerWageEntry` — `أجور عمال`)
- `Worker`: `id`, `name` (`"بلال"`, `"معاذ"`, `"فواز"`), `phone`, `defaultDailyWage`.
- `WorkerWageEntry`:
  - `dailyWage` (`الأجر اليومي`), `daysWorked` (`عدد الأيام`)
  - `totalWage`: Computed `dailyWage * daysWorked` (`=F*G`)
  - `creditAmount`: Decimal (`دائن` — cumulative amount paid to worker)
  - `debitBalance`: Computed `totalWage - creditAmount` (`=H-I` — remaining payable balance owed to worker)

#### E. Customers, Sales Invoices & Split Installment Vouchers (`Customer`, `SaleTransaction`, `InstallmentVoucher`)
- `SaleTransaction` (`إيرادات/مبيعات`):
  - `saleBatchLabel`: String (`"عملية بيع 1"`, `"عملية بيع 2"`, `"عملية بيع 3"`)
  - `customerId`: Foreign Key -> `Customer.id` (`"فواز الجابري"`, `"يوسف الجابري"`, Phone: `"783118231"`)
  - `productGrade`: Enum (`"رقم 1"`, `"رقم 2"`, `"رقم 3"`, `"روس"`, `"بزغة"`, `"رقم 1/رقم 2/رقم 3/ روس/بزغة"`)
  - `bundlesCount`: Integer (`عدد العلاقيات`)
  - `unitPrice`: Decimal (`السعر`)
  - `totalAmount`: Computed `bundlesCount * unitPrice` (`=P*Q`)
  - `creditPaid`: Decimal (`دائن` — sum of initial + subsequent installment receipts)
  - `debitReceivable`: Computed `totalAmount - creditPaid` (`=R-S`)
  - `receiptVoucherNo`: String (`رقم سند القبض`)
- `InstallmentVoucher` (`سندات القبض والصرف المتعددة`):
  - Decouples subsequent customer collections and worker payouts from the initial invoice/wage row.
  - `voucherNo`: String Unique (`RV-INST-...` or `PV-INST-...`)
  - `type`: Enum `CUSTOMER_RECEIPT` | `WORKER_PAYOUT`
  - `saleTransactionId`: Nullable FK -> `SaleTransaction.id`
  - `workerWageEntryId`: Nullable FK -> `WorkerWageEntry.id`
  - `treasuryAccountId`: FK -> `TreasuryAccount.id`
  - `amountYER`: Decimal(15, 2)
  - `qrVerificationHash`: String
  - `paymentDate`, `notes`

#### F. Harvest Inventory & Bundle Grading Reconciliation (`HarvestInventoryBatch`)
- Tracks field production per harvest and grade (`harvestedBundles`, `shrinkageBundles`) and reconciles automatically against `SUM(SaleTransaction.bundlesCount)` to compute `remainingStock = harvestedBundles - soldBundles - shrinkageBundles`.

#### G. Immutable Audit Log & Adjustment Entries (`ImmutableAuditLog` & `AdjustmentEntry`)
- `ImmutableAuditLog`: Append-only table (`REVOKE UPDATE, DELETE` in PostgreSQL) recording `timestamp`, `userId`, `userRole`, `actionType`, `entityReference`, `details`, and `sha256Hash`.
- `AdjustmentEntry`: Formal accounting adjustment required whenever modifying figures tied to a locked `HarvestCycle` (`isLocked = true`).

### 4. Mobile & Web Build Commands (Capacitor Android/iOS + Next.js PWA)

```bash
# 1. Install Capacitor Native Runtime & Platforms
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "UAS Accounting" "com.uas.accounting" --web-dir=out

# 2. Export static/hybrid bundle and sync to Android & iOS
npm run build
npx cap add android
npx cap add ios
npx cap sync

# 3. Open Android Studio (to build signed APK/AAB) or Xcode (to build iOS IPA)
npx cap open android
npx cap open ios
```

### 5. Initial Seed Data (Grounded in `UAS.xlsx`)
- **Projects**: `الجبري العليا` (`1,000,000` YER, 3 Harvests, `"بقعة قات الجبري"`), `الجبري الوسطى` (`750,000` YER), `الجبري السفلى` (`500,000` YER).
- **Workers (`الجبري العليا` - `القطفة الأولى`)**:
  - `بلال`: `5,000` × `10` = `50,000` | Credit: `10,000` | Debit: `40,000`
  - `معاذ`: `4,000` × `5` = `20,000` | Credit: `10,000` | Debit: `10,000`
  - `فواز`: `3,000` × `20` = `60,000` | Credit: `10,000` | Debit: `50,000`
- **Sales (`الجبري العليا` - `القطفة الأولى`, Sale 1 & Sale 2)**:
  - `فواز الجابري` (`783118231`): `100` bundles × `2,000` = `200,000` | Credit: `50,000` | Debit: `150,000` (in both Sale 1 & Sale 2)
  - `يوسف الجابري` (`783118231`): `100` bundles × `150` = `15,000` | Credit: `10,000` | Debit: `5,000` (in both Sale 1 & Sale 2)
