export const masterAgentPromptText = `You are a Senior Full-Stack Architect. Build the production Unified Accounting System (UAS) - النظام المحاسبي الموحد based on UAS.xlsx:

1. STACK:
   - Frontend: Next.js 14+ (App Router, TypeScript), Tailwind CSS (RTL/LTR), shadcn/ui, Chart.js / Recharts.
   - Backend & DB: PostgreSQL + Prisma ORM, NextAuth RBAC (Admin, Project Manager, Accountant, Auditor).
   - Export: SheetJS (xlsx) for Excel exports & @react-pdf/renderer for Arabic RTL PDF Vouchers & Reports.

2. CORE MODULES & FORMULAS (FROM UAS.xlsx):
   - Projects & Hierarchy: Main Project (مشروع رئيسي) & Sub-Project (مشروع فرعي), Estimated Value (قيمة المشروع), Harvest/Spray Cycles (عدد القطفات/مرشات: القطفة الأولى، القطفة الثانية، القطفة الثالثة).
   - Operating Expenses (مصروفات تشغيلية):
     * Fuel (وقود/محروقات): Liters * UnitPrice = Total
     * Meals (وجبات غذائية): Breakfast/Lunch/Other
     * Groceries (مواد غذائية): Water/Empty Bags/Biscuits/Juice/Other
     * Transport (أجور نقل): Worker transport from/to
     * Other (أخرى)
   - Worker Wages & Account Report (أجور عمال):
     * TotalWage = DailyWage * DaysWorked (=F*G)
     * WorkerDebitRemaining = TotalWage - WorkerCreditPaid (=H-I)
     * Seed Workers: بلال (5000*10=50000, Credit 10000, Debit 40000), معاذ (4000*5=20000, Credit 10000, Debit 10000), فواز (3000*20=60000, Credit 10000, Debit 50000).
   - Sales & Customer Account Report (إيرادات/مبيعات):
     * Grades: رقم 1, رقم 2, رقم 3, روس, بزغة
     * TotalSale = BundlesCount * UnitPrice (=P*Q)
     * CustomerDebitBalance = TotalSale - CustomerCreditPaid (=R-S)
     * Seed Customers: فواز الجابري (100*2000=200000, Credit 50000, Debit 150000), يوسف الجابري (100*150=15000, Credit 10000, Debit 5000).
     * Actions: Issue Credit/Debit Voucher (اصدار سند دائن/مدين) & PDF Report (اصدار تقرير PDF).
   - Projects Dashboard & Summary (8 Core Capabilities):
     1. Total project value per harvest/spray (Excel/PDF export)
     2. Profit & Loss statement (Excel/PDF export)
     3. Comprehensive summary across all projects (Excel/PDF export)
     4. Interactive Charts (رسوم بيانية)
     5. Detailed reports (Excel/PDF export)
     6. Global Excel & PDF export
     7. Customer filtering & statement export
     8. Worker filtering & statement export
   - System Dashboard:
     * System Logo, Users Control Panel, Settings, Themes, Main List, User Profile, User Roles, Profile Picture, Password Reset, Login/Logout, Bilingual Arabic/English toggle.
   - Enterprise Upgrades:
     * Multi-Currency Treasury & Wallets (Cash Box, Kuraimi Bank, Jawali, Jeeb; YER/SAR/USD)
     * Split Installment Receipt & Payout Vouchers (InstallmentVoucher linked to Sales & Workers)
     * Harvest Inventory & Bundle Grading Reconciliation (Harvested vs. Sold vs. Shrinkage)
     * Harvest Period Locking & Append-Only Immutable Audit Log with Adjustment Entries
     * SVG QR-Code Voucher Verification & 1-Click WhatsApp Receipt Dispatch
     * Offline-First PWA Field Queue & Cloud Sync`;

