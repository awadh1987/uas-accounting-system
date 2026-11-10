-- Unified Accounting System (UAS) — Supabase PostgreSQL Security & Audit Immutability
-- Apply after running `prisma db push` / `prisma migrate deploy` against PostgreSQL.

-- 1. Enforce append-only ImmutableAuditLog (prevent UPDATE / DELETE)
REVOKE UPDATE, DELETE ON TABLE "ImmutableAuditLog" FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE "ImmutableAuditLog" FROM anon, authenticated;

-- 2. Enable Row-Level Security (RLS) across all domain tables
ALTER TABLE "SystemSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HarvestCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreasuryAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CurrencyRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatingExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Worker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerWageEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstallmentVoucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HarvestInventoryBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImmutableAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdjustmentEntry" ENABLE ROW LEVEL SECURITY;

-- 3. Service-role / authenticated baseline policies (refine per tenant/role in production)
CREATE POLICY "authenticated_read_projects"
  ON "Project" FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_audit"
  ON "ImmutableAuditLog" FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_audit"
  ON "ImmutableAuditLog" FOR INSERT TO authenticated WITH CHECK (true);

