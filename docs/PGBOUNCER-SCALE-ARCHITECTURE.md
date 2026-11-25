# UAS Unlimited Multi-Tenant Scale & PgBouncer Architecture (Phase 21)

## 1. Hybrid Tenant Isolation Modes (`tenants` Table in `uas_qat_prod`)
- **`DEDICATED_DB`**: Each legacy/enterprise tenant (`aljabri`, `alameri`, `yasser-albukli`, `uas-ye`, `checkout`, `xintai`) retains its own isolated PostgreSQL database (`uas_<slug>`) and SQLite file (`data/tenants/<slug>.db`).
- **`POOLED_RLS`**: Instant zero-DDL tenant onboarding for `1,000+` tenants in a shared PostgreSQL database protected by `tenantSlug` composite keys + PostgreSQL Row-Level Security (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on `ClientPortalAccount`, `ClientGoodsRequest`, `TenantPaymentChannel`, `ClientPaymentReceipt`, `Customer`, `SalesInvoice`, and `ReceiptVoucher`).
- **`SCHEMA`**: Legacy per-tenant PostgreSQL schema (`tenant_<slug>`).

## 2. Central `tenants` Registry + $O(1)$ In-Memory TTL Cache
- Tenant metadata is stored in the indexed `tenants` table (`uas_qat_prod`) and mirrored to `tenants_registry.json` for offline/SQLite compatibility.
- `tenantRegistry.ts` maintains an $O(1)$ `slugIndexMap` and TTL cache (`UAS_TENANT_REGISTRY_TTL_MS`, default `30000` ms) with instant invalidation on tenant writes (`registerTenant`, `ensureTenantRegistered`, `updateTenantMetadata`, `unregisterTenant`), eliminating per-request disk `statSync` / JSON parsing.

## 3. Bounded LRU Prisma Client Pooling (`tenantDbManager.ts`)
- `UAS_TENANT_PRISMA_MAX_CLIENTS` (default `64`): Hard LRU cap on active cached `PrismaClient` instances; least-recently-used non-`default` clients are evicted and `$disconnect()`ed cleanly.
- `UAS_TENANT_PRISMA_IDLE_MS` (default `600000` = 10 minutes): Idle clients are evicted automatically.

## 4. PgBouncer (`pool_mode = transaction`) Readiness
Set the following environment variables in `.env.production` when fronting PostgreSQL with PgBouncer on port `6432`:
```env
UAS_PGBOUNCER_ENABLED="true"
UAS_PGBOUNCER_URL="postgresql://uas_admin:<password>@127.0.0.1:6432/uas_qat_prod?schema=public&pgbouncer=true"
UAS_PRISMA_CONNECTION_LIMIT=3
```
Recommended `/etc/pgbouncer/pgbouncer.ini`:
```ini
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = scram-sha-256
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 25
reserve_pool_size = 10
ignore_startup_parameters = extra_float_digits
```
Transaction-local RLS context uses `setTenantRlsContextTx(tx, tenantSlug)` -> `SELECT set_config('app.current_tenant', $1, true)`, which is strictly scoped to the active transaction and safe under `pool_mode = transaction`.
