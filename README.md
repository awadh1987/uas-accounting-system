# Unified Accounting System (UAS) — النظام المحاسبي الموحد

A bilingual (Arabic RTL / English LTR), mobile-first, offline-capable agricultural project accounting system built with **Next.js 16 (App Router, TypeScript, Tailwind CSS)**, **Prisma ORM**, **IndexedDB (`Dexie.js`) + PWA**, and **Capacitor (Android & iOS)**.

Grounded in the domain model and formulas from [UAS.xlsx](./UAS.xlsx), [uas_coding_agent_prompt.md](./uas_coding_agent_prompt.md), and [unified_accounting_system_uas.html](./unified_accounting_system_uas.html).

---

## Repository Structure

```text
uas-accounting-system/
├── src/                        # Application Source (Frontend + Backend API)
│   ├── app/
│   │   ├── api/                # Backend: Atomic Prisma REST API Routes (17 endpoints)
│   │   ├── globals.css         # Themes (Emerald / Dark / Royal) & Mobile 412px Simulator
│   │   ├── layout.tsx          # RTL/LTR App Router root layout & PWA metadata
│   │   └── page.tsx            # Entry route rendering UasAppShell
│   ├── components/             # Frontend: Modular UI Components
│   │   ├── tabs/               # All 12 functional accounting & admin modules
│   │   ├── HeaderNav.tsx       # Sticky header, global filters, currency/theme/lang controls
│   │   ├── LoginModal.tsx      # User switching & password sign-in modal
│   │   ├── MobileBottomNav.tsx # Fixed 5-slot BottomAppBar + Floating '+' Quick-Action Sheet
│   │   ├── QrVerificationBlock.tsx # Deterministic SVG QR verification generator
│   │   ├── SvgAvatar.tsx       # SVG user badge avatar
│   │   ├── UasAppShell.tsx     # State coordinator, online/offline sync, modal host
│   │   └── VoucherModal.tsx    # Printable PDF & WhatsApp QR Voucher modal
│   ├── lib/                    # Shared Domain Formulas, Clients & Helpers
│   │   ├── agentPrompt.ts      # Coding agent master specification text
│   │   ├── apiClient.ts        # Online fetch + IndexedDB offline queue fallback
│   │   ├── apiHelpers.ts       # API actor extraction & HTTP error helpers
│   │   ├── excelExport.ts      # SheetJS (.xlsx) RTL multi-sheet workbook exporter
│   │   ├── formulas.ts         # Grounded UAS.xlsx accounting & QR formulas
│   │   ├── i18n.ts             # Arabic / English translation dictionary
│   │   ├── offlineDb.ts        # Dexie IndexedDB snapshot & mutation queue store
│   │   ├── prisma.ts           # Singleton PrismaClient instance
│   │   ├── seedFallback.ts     # First-launch offline initial dataset
│   │   └── serverBootstrap.ts  # Typed server bootstrap & Prisma mappers
│   └── types/
│       └── uas.ts              # Shared TypeScript domain interfaces
├── prisma/                     # Database Schema & Seed
│   ├── schema.prisma           # 15 relational accounting & audit models
│   └── seed.ts                 # Idempotent initial seed from UAS.xlsx
├── public/                     # PWA Static Assets
│   ├── icons/                  # 192x192, 512x512, maskable PNG & SVG icons
│   ├── manifest.webmanifest    # Installable RTL Arabic PWA manifest
│   ├── offline.html            # Offline fallback shell
│   └── sw.js                   # Service Worker (network-first navigation & API cache)
├── android/                    # Capacitor Android Native Project (.apk / .aab)
├── ios/                        # Capacitor iOS Native Project (.ipa)
├── scripts/
│   └── build-capacitor.mjs     # Static export generator (./out) & Capacitor sync
├── tests/                      # Automated Unit & Formula Tests
│   └── formulas.test.ts        # Tests for all UAS.xlsx formulas & QR hashing
├── docs/                       # Architecture, API, Database & Mobile Guides
│   ├── architecture.md
│   ├── api-reference.md
│   ├── database-schema.md
│   └── mobile-deployment.md
├── infra/                      # Deployment & Database Infrastructure
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   ├── env/
│   │   └── production.env.example
│   └── supabase/
│       └── rls-policies.sql    # PostgreSQL RLS & ImmutableAuditLog triggers/grants
├── .github/workflows/
│   └── ci.yml                  # CI Pipeline (Lint, Typecheck, Prisma, Tests, Build)
├── capacitor.config.ts         # Capacitor App Config (com.uas.accounting)
├── UAS.xlsx                    # Source spreadsheet specification
├── uas_coding_agent_prompt.md  # Master architecture prompt
└── unified_accounting_system_uas.html # Original single-file interactive prototype
```

---

## Quick Start

### 1. Environment & Dependencies

```bash
cp .env.example .env
npm install
```

### 2. Database Setup & Seed

```bash
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Available Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start Next.js development server |
| `npm run build` | Production build (Web + all atomic Prisma API routes) |
| `npm run start` | Start production Next.js server |
| `npm run lint` | Run ESLint with strict project config |
| `npm run typecheck` | Run TypeScript type check (`tsc --noEmit`) |
| `npm test` | Run unit tests via `tsx --test` |
| `npm run db:push` | Push `prisma/schema.prisma` to database |
| `npm run db:seed` | Seed initial dataset from `UAS.xlsx` |
| `npm run build:mobile` | Export static web bundle into `./out` and run `npx cap sync` |

---

## Documentation Index

- [System Architecture](./docs/architecture.md)
- [Database Schema & Formulas](./docs/database-schema.md)
- [API Reference](./docs/api-reference.md)
- [Mobile & PWA Deployment Guide](./docs/mobile-deployment.md)
- [Contributing Guidelines](./CONTRIBUTING.md)

