-- ============================================================================
-- Unified Accounting System (UAS) — Supabase PostgreSQL Production Security
-- Ready-to-run SQL Script for Supabase SQL Editor
-- Run AFTER: `npx prisma db push` against your Supabase PostgreSQL database.
-- ============================================================================

BEGIN;

-- 1. Enforce Append-Only Immutability on "ImmutableAuditLog"
--    Blocks UPDATE and DELETE via both permissions and a database trigger.
REVOKE UPDATE, DELETE ON TABLE "ImmutableAuditLog" FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE "ImmutableAuditLog" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_immutable_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ImmutableAuditLog is append-only: % is forbidden.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_update_delete ON "ImmutableAuditLog";
CREATE TRIGGER trg_prevent_audit_update_delete
  BEFORE UPDATE OR DELETE ON "ImmutableAuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_immutable_audit_mutation();

-- 2. Enable Row-Level Security (RLS) on ALL 15 Prisma Tables
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

-- 3. Helper Function: Check if a HarvestCycle is unlocked
CREATE OR REPLACE FUNCTION public.is_harvest_unlocked(p_harvest_cycle_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT NOT hc."isLocked" FROM "HarvestCycle" hc WHERE hc."id" = p_harvest_cycle_id),
    true
  );
$$;

-- 4. Reference & Settings Policies (Authenticated Read)
DROP POLICY IF EXISTS "auth_read_settings" ON "SystemSettings";
CREATE POLICY "auth_read_settings"
  ON "SystemSettings" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_rates" ON "CurrencyRate";
CREATE POLICY "auth_read_rates"
  ON "CurrencyRate" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_treasury" ON "TreasuryAccount";
CREATE POLICY "auth_read_treasury"
  ON "TreasuryAccount" FOR SELECT TO authenticated USING (true);

-- 5. User Table Protection (Prevent exposing passwordHash to anon/other users)
REVOKE SELECT ("passwordHash") ON TABLE "User" FROM anon, authenticated;

DROP POLICY IF EXISTS "auth_read_own_user" ON "User";
CREATE POLICY "auth_read_own_user"
  ON "User" FOR SELECT TO authenticated
  USING (auth.uid()::text = "id");

-- 6. Projects & Harvest Cycles Policies
DROP POLICY IF EXISTS "auth_all_projects" ON "Project";
CREATE POLICY "auth_all_projects"
  ON "Project" FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_harvest_cycles" ON "HarvestCycle";
CREATE POLICY "auth_all_harvest_cycles"
  ON "HarvestCycle" FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 7. Customers & Workers Directory Policies
DROP POLICY IF EXISTS "auth_all_customers" ON "Customer";
CREATE POLICY "auth_all_customers"
  ON "Customer" FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_workers" ON "Worker";
CREATE POLICY "auth_all_workers"
  ON "Worker" FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 8. Harvest-Locked Operational Tables (Block writes when HarvestCycle.isLocked = true)
DROP POLICY IF EXISTS "auth_read_expenses" ON "OperatingExpense";
CREATE POLICY "auth_read_expenses"
  ON "OperatingExpense" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_unlocked_expenses" ON "OperatingExpense";
CREATE POLICY "auth_write_unlocked_expenses"
  ON "OperatingExpense" FOR INSERT TO authenticated
  WITH CHECK (public.is_harvest_unlocked("harvestCycleId"));

DROP POLICY IF EXISTS "auth_delete_unlocked_expenses" ON "OperatingExpense";
CREATE POLICY "auth_delete_unlocked_expenses"
  ON "OperatingExpense" FOR DELETE TO authenticated
  USING (public.is_harvest_unlocked("harvestCycleId"));

DROP POLICY IF EXISTS "auth_read_worker_wages" ON "WorkerWageEntry";
CREATE POLICY "auth_read_worker_wages"
  ON "WorkerWageEntry" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_unlocked_worker_wages" ON "WorkerWageEntry";
CREATE POLICY "auth_write_unlocked_worker_wages"
  ON "WorkerWageEntry" FOR ALL TO authenticated
  USING (public.is_harvest_unlocked("harvestCycleId"))
  WITH CHECK (public.is_harvest_unlocked("harvestCycleId"));

DROP POLICY IF EXISTS "auth_read_sales" ON "SaleTransaction";
CREATE POLICY "auth_read_sales"
  ON "SaleTransaction" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_unlocked_sales" ON "SaleTransaction";
CREATE POLICY "auth_write_unlocked_sales"
  ON "SaleTransaction" FOR ALL TO authenticated
  USING (public.is_harvest_unlocked("harvestCycleId"))
  WITH CHECK (public.is_harvest_unlocked("harvestCycleId"));

DROP POLICY IF EXISTS "auth_read_inventory" ON "HarvestInventoryBatch";
CREATE POLICY "auth_read_inventory"
  ON "HarvestInventoryBatch" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_unlocked_inventory" ON "HarvestInventoryBatch";
CREATE POLICY "auth_write_unlocked_inventory"
  ON "HarvestInventoryBatch" FOR ALL TO authenticated
  USING (public.is_harvest_unlocked("harvestCycleId"))
  WITH CHECK (public.is_harvest_unlocked("harvestCycleId"));

-- 9. Installment Vouchers & Adjustment Entries
DROP POLICY IF EXISTS "auth_all_installments" ON "InstallmentVoucher";
CREATE POLICY "auth_all_installments"
  ON "InstallmentVoucher" FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_adjustments" ON "AdjustmentEntry";
CREATE POLICY "auth_read_adjustments"
  ON "AdjustmentEntry" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_adjustments" ON "AdjustmentEntry";
CREATE POLICY "auth_insert_adjustments"
  ON "AdjustmentEntry" FOR INSERT TO authenticated WITH CHECK (true);

-- 10. Immutable Audit Log (Read + Insert only; Update/Delete blocked)
DROP POLICY IF EXISTS "auth_read_audit" ON "ImmutableAuditLog";
CREATE POLICY "auth_read_audit"
  ON "ImmutableAuditLog" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_audit" ON "ImmutableAuditLog";
CREATE POLICY "auth_insert_audit"
  ON "ImmutableAuditLog" FOR INSERT TO authenticated WITH CHECK (true);

COMMIT;
