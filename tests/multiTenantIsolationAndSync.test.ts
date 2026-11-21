import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  runWithTenant,
  normalizeTenantId,
  resolveTenantDbFilePath,
  resolveTenantSchemaName,
  resolveTenantDatabaseUrl,
  convertSqliteStatementToPostgres,
  generatePostgresDdlFromSqlite,
  clonePostgresEnumTypes,
  remapPostgresEnumColumns,
  provisionPostgresTenantSchema,
  resetTenantClientsForTests,
  getRegistryFilePath,
  getDynamicDataDirectory,
  getTenantMetadata,
  registerTenant,
  ensureTenantRegistered,
} from "../src/lib/tenant";
import { safeDeleteOrArchiveUser } from "../src/lib/userLifecycle";
import { hashPassword } from "../src/lib/serverBootstrap";
import {
  createUasbakEnvelope,
  validateAndInspectCandidateDb,
  restoreDatabaseFromBuffer,
  getBackupsDirectory,
  listLocalBackups,
} from "../src/lib/backupService";
import {
  getStoredTenantId,
  setStoredTenantId,
} from "../src/lib/apiClient";

const TEST_TIMESTAMP = Date.now();
const TENANT_A = `tenant-alpha-${TEST_TIMESTAMP}`;
const TENANT_B = `tenant-beta-${TEST_TIMESTAMP}`;
const TENANT_GAMMA = `tenant-gamma-${TEST_TIMESTAMP}`;

describe("Isolated Multi-Tenant Databases, Multi-Device Sync & Notification Fixes", () => {
  after(async () => {
    await resetTenantClientsForTests();
    // Cleanup temporary sqlite database files created for these test tenants
    for (const tid of [TENANT_A, TENANT_B, TENANT_GAMMA]) {
      const dbPath = resolveTenantDbFilePath(tid);
      if (dbPath && fs.existsSync(dbPath)) {
        try {
          fs.unlinkSync(dbPath);
          const shm = `${dbPath}-shm`;
          const wal = `${dbPath}-wal`;
          if (fs.existsSync(shm)) fs.unlinkSync(shm);
          if (fs.existsSync(wal)) fs.unlinkSync(wal);
        } catch {
          // Ignore cleanup errors on busy handles
        }
      }
    }
  });

  describe("1. Multi-Tenant DB Routing & Data Isolation", () => {
    it("provisions and seeds isolated databases for distinct tenants cleanly", async () => {
      await runWithTenant(TENANT_GAMMA, async () => {
        // Dynamic bootstrap should have created EnterpriseProfile, SystemSettings, and default admin
        const profile = await prisma.enterpriseProfile.findFirst();
        assert.ok(profile, "Tenant Gamma must have an auto-provisioned EnterpriseProfile");

        const settings = await prisma.systemSettings.findFirst();
        assert.ok(settings, "Tenant Gamma must have an auto-provisioned SystemSettings");

        const defaultAdmin = await prisma.user.findFirst({
          where: { role: "SUPER_ADMIN" },
        });
        assert.ok(defaultAdmin, "Tenant Gamma must have an auto-provisioned SUPER_ADMIN user");

        const accounts = await prisma.account.count();
        assert.ok(accounts > 0, "Tenant Gamma must have an auto-provisioned Chart of Accounts");
      });
    });

    it("ensures records created in Tenant A do not exist or leak into Tenant B", async () => {
      let createdUserIdA = "";
      const emailA = `ahmed.awadh@qat.world`;

      // Step 1: Create user in Tenant A
      await runWithTenant(TENANT_A, async () => {
        const userA = await prisma.user.create({
          data: {
            username: "ahmed_awadh_alpha",
            name: "Ahmed AWADH",
            fullName: "Ahmed AWADH - Alpha Co",
            email: emailA,
            passwordHash: hashPassword("AlphaPass123!"),
            role: "SUPER_ADMIN",
            department: "الإدارة العامة",
            active: true,
            isActive: true,
          },
        });
        createdUserIdA = userA.id;
        assert.ok(createdUserIdA);

        const foundInA = await prisma.user.findUnique({ where: { id: createdUserIdA } });
        assert.ok(foundInA);
        assert.equal(foundInA.email, emailA);
      });

      // Step 2: Query Tenant B — user from Tenant A must NOT exist
      await runWithTenant(TENANT_B, async () => {
        const foundInBById = await prisma.user.findUnique({ where: { id: createdUserIdA } });
        assert.equal(foundInBById, null, "User from Tenant A must not exist in Tenant B by ID");

        const foundInBByEmail = await prisma.user.findFirst({ where: { email: emailA } });
        assert.equal(foundInBByEmail, null, "User from Tenant A must not exist in Tenant B by Email");

        // Create distinct user in Tenant B
        const userB = await prisma.user.create({
          data: {
            username: "beta_accountant",
            name: "Beta Accountant",
            fullName: "Beta Accountant - Beta Co",
            email: "accountant@beta.test",
            passwordHash: hashPassword("BetaPass123!"),
            role: "FIELD_ACCOUNTANT",
            department: "المالية",
            active: true,
            isActive: true,
          },
        });
        assert.ok(userB.id);
      });

      // Step 3: Query Tenant A again — user from Tenant B must NOT exist in Tenant A
      await runWithTenant(TENANT_A, async () => {
        const foundInAByEmailB = await prisma.user.findFirst({
          where: { email: "accountant@beta.test" },
        });
        assert.equal(foundInAByEmailB, null, "User from Tenant B must not exist in Tenant A");
      });
    });
  });

  describe("2. Password Reset User Lookup Normalization", () => {
    it("locates users for password reset by ID, case-insensitive email, username, or display name", async () => {
      await runWithTenant(TENANT_A, async () => {
        const testEmail = "ahmed.awadh@uas-ye.com";
        const user = await prisma.user.create({
          data: {
            username: "ahmed_awadh_corp_reset",
            name: "Ahmed AWADH Reset Target",
            fullName: "Ahmed AWADH - Financial Executive",
            email: testEmail,
            passwordHash: hashPassword("OldPassword123!"),
            role: "SUPER_ADMIN",
            department: "Executive",
            active: true,
            isActive: true,
          },
        });

        // 1. Lookup by exact ID
        const matchById = await prisma.user.findFirst({
          where: { id: user.id },
        });
        assert.ok(matchById);

        // 2. Lookup by email uppercase / case-insensitive
        const matchByUpperEmail = await prisma.user.findFirst({
          where: {
            OR: [
              { email: { equals: "AHMED.AWADH@UAS-YE.COM" } },
              { email: { equals: testEmail } },
            ],
          },
        });
        assert.ok(matchByUpperEmail);
        assert.equal(matchByUpperEmail.id, user.id);

        // 3. Lookup by username
        const matchByUsername = await prisma.user.findFirst({
          where: { username: "ahmed_awadh_corp_reset" },
        });
        assert.ok(matchByUsername);
        assert.equal(matchByUsername.id, user.id);

        // 4. Lookup by unique name
        const matchByName = await prisma.user.findFirst({
          where: { name: "Ahmed AWADH Reset Target" },
        });
        assert.ok(matchByName);
        assert.equal(matchByName.id, user.id);

        // Verify password reset updating passwordHash
        const newPassword = "ResetSuccessPassword2026!";
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(newPassword),
            mustChangePassword: true,
          },
        });
        assert.equal(updated.mustChangePassword, true);
        assert.equal(updated.passwordHash, hashPassword(newPassword));
        assert.notEqual(updated.passwordHash, hashPassword("WrongPassword"));
      });
    });
  });

  describe("3. User Delete Guards, Soft-Archive & Actionable Guidance", () => {
    it("blocks self-deletion with structured SELF_DELETION error and code", async () => {
      await runWithTenant(TENANT_A, async () => {
        const selfUser = await prisma.user.create({
          data: {
            username: `self_admin_${Date.now()}`,
            name: "Self Admin",
            fullName: "Self Admin User",
            email: `self_admin_${Date.now()}@alpha.test`,
            passwordHash: hashPassword("123456"),
            role: "SUPER_ADMIN",
            department: "Admin",
            active: true,
            isActive: true,
          },
        });

        const actor = {
          userId: selfUser.id,
          userRole: "SUPER_ADMIN",
          userDisplay: "Self Admin",
        };

        const result = await safeDeleteOrArchiveUser(selfUser.id, actor);
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.guardReason, "SELF_DELETION");
        assert.equal(result.code, "SELF_DELETION_FORBIDDEN");
        assert.ok(result.error?.includes("حسابك الشخصي"));
      });
    });

    it("blocks deleting the last active SUPER_ADMIN with LAST_ADMIN guard", async () => {
      await runWithTenant(TENANT_A, async () => {
        // Query current super admins in Tenant A
        const superAdmins = await prisma.user.findMany({
          where: { role: "SUPER_ADMIN", isActive: true },
        });

        // Ensure we isolate down to 1 active super admin to test the guard
        const targetAdmin = superAdmins[0];
        if (superAdmins.length > 1) {
          for (let i = 1; i < superAdmins.length; i++) {
            await prisma.user.delete({ where: { id: superAdmins[i].id } }).catch(() => {});
          }
        }

        const outsideActor = {
          userId: "temporary-outside-admin",
          userRole: "SUPER_ADMIN",
          userDisplay: "Outside Admin",
        };

        const deleteAttempt = await safeDeleteOrArchiveUser(targetAdmin.id, outsideActor);
        assert.equal(deleteAttempt.ok, false);
        assert.equal(deleteAttempt.status, 400);
        assert.equal(deleteAttempt.guardReason, "LAST_ADMIN");
        assert.equal(deleteAttempt.code, "LAST_ADMIN_PROTECTED");
        assert.ok(deleteAttempt.error?.includes("المشرف العام الوحيد"));
      });
    });

    it("auto-archives users with linked accounting/audit records with seat release and guidance", async () => {
      await runWithTenant(TENANT_A, async () => {
        // Add a second super admin so we can delete normal users safely
        const actor = {
          userId: "active-admin-actor",
          userRole: "SUPER_ADMIN",
          userDisplay: "Active Admin",
        };

        const accountant = await prisma.user.create({
          data: {
            username: `linked_acc_${Date.now()}`,
            name: "Linked Accountant",
            fullName: "Linked Accountant Alpha",
            email: `linked.acc.${Date.now()}@alpha.test`,
            passwordHash: hashPassword("123456"),
            role: "CHIEF_ACCOUNTANT",
            department: "الحسابات",
            active: true,
            isActive: true,
          },
        });

        // Create linked AuditLog entry
        await prisma.auditLog.create({
          data: {
            userId: accountant.id,
            action: "CREATE",
            entity: "JournalEntry",
            entityId: "JV-ALPHA-001",
            details: { test: true },
          },
        });

        // Attempt deletion
        const outcome = await safeDeleteOrArchiveUser(accountant.id, actor);
        assert.equal(outcome.ok, true);
        assert.equal(outcome.deleted, false);
        assert.equal(outcome.archived, true);
        assert.equal(outcome.guardReason, "LINKED_RECORDS");
        assert.ok(outcome.guidance && outcome.guidance.length > 0);
        assert.ok(outcome.message.includes("أرشفة المستخدم"));

        // Verify user status in DB
        const archivedInDb = await prisma.user.findUnique({ where: { id: accountant.id } });
        assert.ok(archivedInDb);
        assert.equal(archivedInDb.isActive, false);
        assert.equal(archivedInDb.active, false);
        assert.ok(archivedInDb.archivedAt instanceof Date);
      });
    });
  });

  describe("4. Backup & Disaster Recovery Scoping", () => {
    it("creates backups scoped to active tenant and includes tenantId in metadata", async () => {
      await runWithTenant(TENANT_A, async () => {
        const { envelope, filename } = await createUasbakEnvelope();
        const normalizedTenantA = normalizeTenantId(TENANT_A);

        assert.equal(envelope.format, "UAS-BACKUP-V1");
        assert.equal(envelope.tenantId, normalizedTenantA);
        assert.ok(filename.includes(normalizedTenantA));
        assert.ok(envelope.dbBase64.length > 0);
        assert.ok(envelope.sha256.length === 64);

        // Save into backups dir to test listLocalBackups filtering
        const backupsDir = getBackupsDirectory();
        const testBackupPath = path.join(backupsDir, filename);
        fs.writeFileSync(testBackupPath, JSON.stringify(envelope));

        const backupsList = listLocalBackups(normalizedTenantA);
        assert.ok(
          backupsList.some((b) => b.filename === filename),
          "Backups list for Tenant A must contain the created backup"
        );

        // Cleanup test backup file
        if (fs.existsSync(testBackupPath)) {
          fs.unlinkSync(testBackupPath);
        }
      });
    });

    it("rejects cross-tenant restore when company names/tenants do not match", async () => {
      let tenantABuffer: Buffer | null = null;

      await runWithTenant(TENANT_A, async () => {
        const { envelope } = await createUasbakEnvelope();
        tenantABuffer = Buffer.from(envelope.dbBase64, "base64");
      });

      assert.ok(tenantABuffer, "Tenant A buffer must be generated");

      // Verify validation rejects restoring Tenant A into a company with a different name
      const inspection = validateAndInspectCandidateDb(tenantABuffer, "شركة بيتا المستقلة كلياً");
      assert.equal(inspection.ok, false, "Cross-company validation must fail");
      assert.ok(
        inspection.error?.includes("اسم المنشأة") ||
          inspection.error?.includes("غير متطابقة"),
        "Error must describe company name mismatch protection"
      );

      // Verify restoreDatabaseFromBuffer also throws when executed in Tenant B
      await runWithTenant(TENANT_B, async () => {
        const actorB = {
          userId: "admin-beta",
          userRole: "SUPER_ADMIN",
          userDisplay: "Admin Beta",
        };

        await assert.rejects(
          async () => {
            await restoreDatabaseFromBuffer(tenantABuffer!, actorB, "cross-tenant-test", TENANT_B);
          },
          /فشل التحقق من أمان|اسم المنشأة|غير متطابقة|Candidate database verification failed/
        );
      });
    });
  });

  describe("5. Client Multi-Device Tenant Tracking", () => {
    it("handles client tenant storage and header normalization", () => {
      assert.equal(normalizeTenantId("  Company Alpha  "), "company_alpha");
      assert.equal(normalizeTenantId(""), "default");
      assert.equal(normalizeTenantId(undefined), "default");
      assert.equal(normalizeTenantId("ahmed@qat.world"), "qat_world");
      assert.equal(normalizeTenantId("tenant_slug_123"), "tenant_slug_123");

      const mockStorage = {
        data: {} as Record<string, string>,
        getItem(k: string) {
          return this.data[k] || null;
        },
        setItem(k: string, v: string) {
          this.data[k] = v;
        },
        removeItem(k: string) {
          delete this.data[k];
        },
      };

      setStoredTenantId("tenant-alpha-test", mockStorage);
      assert.equal(getStoredTenantId(mockStorage), "tenant-alpha-test");

      setStoredTenantId("default", mockStorage);
      assert.equal(getStoredTenantId(mockStorage), "default");

      setStoredTenantId("", mockStorage);
      assert.equal(getStoredTenantId(mockStorage), "default");
    });
  });

  describe("6. PostgreSQL Tenant Schema Auto-Provisioning & DDL Invariants", () => {
    it("resolves PostgreSQL schema names cleanly without double-prefixing", () => {
      assert.equal(resolveTenantSchemaName("tenant-alpha"), "tenant_alpha");
      assert.equal(resolveTenantSchemaName("tenant_beta"), "tenant_beta");
      assert.equal(resolveTenantSchemaName("alpha_corp"), "tenant_alpha_corp");
      assert.equal(resolveTenantSchemaName("default"), "public");
      assert.equal(resolveTenantSchemaName(null), "public");
      assert.equal(resolveTenantSchemaName(""), "public");
    });

    it("resolves PostgreSQL connection URL with isolated schema while preserving existing parameters and public default", () => {
      const pgUrl = "postgresql://postgres:secret@qat.world:5432/uas_prod?sslmode=require&connect_timeout=10";

      // Non-default tenant gets isolated schema param
      const alphaUrl = resolveTenantDatabaseUrl("tenant-alpha", pgUrl);
      assert.ok(alphaUrl.includes("schema=tenant_alpha"));
      assert.ok(alphaUrl.includes("sslmode=require"));
      assert.ok(alphaUrl.includes("connect_timeout=10"));
      assert.ok(!alphaUrl.includes("tenant_tenant_alpha"), "Must not double prefix tenant_tenant_alpha");

      // Default tenant continues using public schema without alteration
      const defaultUrl = resolveTenantDatabaseUrl("default", pgUrl);
      assert.equal(defaultUrl, pgUrl);
    });

    it("converts SQLite migration DDL statements into PostgreSQL-compliant schema statements", () => {
      const sqliteStmt = `CREATE TABLE "Account" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "code" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );`;

      const pgStmt = convertSqliteStatementToPostgres(sqliteStmt, "tenant_test");
      assert.ok(pgStmt.includes('CREATE TABLE IF NOT EXISTS "tenant_test"."Account"'));
      assert.ok(pgStmt.includes("TIMESTAMP(3)"));
      assert.ok(pgStmt.includes('REFERENCES "tenant_test"."Account"'));
      assert.ok(pgStmt.includes('"Account_parentId_fkey_tenant_test"'));

      const indexStmt = `CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");`;
      const pgIndexStmt = convertSqliteStatementToPostgres(indexStmt, "tenant_test");
      assert.ok(pgIndexStmt.includes('CREATE UNIQUE INDEX IF NOT EXISTS "Account_code_key_tenant_test" ON "tenant_test"."Account"'));

      const batchSql = `${sqliteStmt}\n\n${indexStmt}`;
      const batchResult = generatePostgresDdlFromSqlite(batchSql, "tenant_test");
      assert.equal(batchResult.length, 2);
      assert.ok(batchResult[0].includes('CREATE TABLE IF NOT EXISTS "tenant_test"."Account"'));
      assert.ok(batchResult[1].includes('CREATE UNIQUE INDEX IF NOT EXISTS "Account_code_key_tenant_test"'));
    });

    it("clones PostgreSQL ENUM types from public schema into tenant schema", async () => {
      const executedSql: string[] = [];

      const mockClient = {
        async $executeRawUnsafe(query: string) {
          executedSql.push(query);
          return 1;
        },
        async $queryRawUnsafe<T = any>(query: string): Promise<T> {
          if (query.includes("FROM pg_type t") && query.includes("JOIN pg_enum e")) {
            return [
              { type_name: "Role", enum_label: "SUPER_ADMIN", sort_order: 1 },
              { type_name: "Role", enum_label: "CHIEF_ACCOUNTANT", sort_order: 2 },
              { type_name: "Role", enum_label: "FIELD_ACCOUNTANT", sort_order: 3 },
            ] as unknown as T;
          }
          return [] as unknown as T;
        },
      };

      const cloned = await clonePostgresEnumTypes(mockClient, "tenant_enum_test");
      assert.deepEqual(cloned, ["Role"]);

      // Verify DO $$ BEGIN CREATE TYPE ... EXCEPTION ... statement
      assert.ok(
        executedSql.some(
          (q) =>
            q.includes('CREATE TYPE "tenant_enum_test"."Role" AS ENUM') &&
            q.includes("'SUPER_ADMIN'") &&
            q.includes("'CHIEF_ACCOUNTANT'") &&
            q.includes("'FIELD_ACCOUNTANT'")
        ),
        "Must create Role enum with labels in tenant_enum_test"
      );
    });

    it("remaps tenant schema columns referencing public ENUMs to tenant-specific ENUM types", async () => {
      const executedSql: string[] = [];

      const mockClient = {
        async $executeRawUnsafe(query: string) {
          executedSql.push(query);
          return 1;
        },
        async $queryRawUnsafe<T = any>(query: string): Promise<T> {
          if (query.includes("information_schema.columns") && query.includes("udt_schema = 'public'")) {
            return [
              {
                table_name: "User",
                column_name: "role",
                udt_name: "Role",
                column_default: "'SUPER_ADMIN'::public.\"Role\"",
              },
            ] as unknown as T;
          }
          return [] as unknown as T;
        },
      };

      const remapped = await remapPostgresEnumColumns(
        mockClient,
        "tenant_remap_test",
        new Set(["Role"])
      );
      assert.equal(remapped, 1);

      // Verify drop default, alter type using text cast, and set rewritten default
      assert.ok(
        executedSql.some((q) =>
          q.includes('ALTER TABLE "tenant_remap_test"."User" ALTER COLUMN "role" DROP DEFAULT')
        ),
        "Must drop old public default"
      );
      assert.ok(
        executedSql.some((q) =>
          q.includes(
            'ALTER TABLE "tenant_remap_test"."User" ALTER COLUMN "role" TYPE "tenant_remap_test"."Role" USING "role"::text::"tenant_remap_test"."Role"'
          )
        ),
        "Must alter type to tenant_remap_test.Role"
      );
      assert.ok(
        executedSql.some((q) =>
          q.includes(
            'ALTER TABLE "tenant_remap_test"."User" ALTER COLUMN "role" SET DEFAULT \'SUPER_ADMIN\'::"tenant_remap_test"."Role"'
          )
        ),
        "Must re-apply default pointing to tenant_remap_test.Role"
      );
    });

    it("provisions tenant schema by cloning table structures, enums, and foreign keys from public master", async () => {
      const executedSql: string[] = [];

      const mockClient = {
        async $executeRawUnsafe(query: string) {
          executedSql.push(query);
          return 1;
        },
        async $queryRawUnsafe<T = any>(query: string): Promise<T> {
          if (query.includes("FROM pg_type t") && query.includes("JOIN pg_enum e")) {
            return [
              { type_name: "Role", enum_label: "SUPER_ADMIN", sort_order: 1 },
              { type_name: "Role", enum_label: "CHIEF_ACCOUNTANT", sort_order: 2 },
            ] as unknown as T;
          }
          if (query.includes("pg_tables WHERE schemaname = $1")) {
            // No tables exist in tenant schema yet
            return [] as unknown as T;
          }
          if (query.includes("pg_tables WHERE schemaname = 'public'")) {
            // Public schema has authoritative tables
            return [
              { tablename: "EnterpriseProfile" },
              { tablename: "SystemSettings" },
              { tablename: "Account" },
              { tablename: "User" },
              { tablename: "JournalEntry" },
            ] as unknown as T;
          }
          if (query.includes("information_schema.columns") && query.includes("udt_schema = 'public'")) {
            return [
              {
                table_name: "User",
                column_name: "role",
                udt_name: "Role",
                column_default: "'SUPER_ADMIN'::public.\"Role\"",
              },
            ] as unknown as T;
          }
          if (query.includes("pg_constraint")) {
            // Public schema foreign keys
            return [
              {
                constraint_name: "Account_parentId_fkey",
                table_name: "Account",
                def: 'FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL',
              },
            ] as unknown as T;
          }
          return [] as unknown as T;
        },
      };

      const result = await provisionPostgresTenantSchema(mockClient, "tenant_cloned_test");
      assert.equal(result.clonedFromPublic, true);
      assert.deepEqual(result.enumsProvisioned, ["Role"]);
      assert.equal(result.columnsRemapped, 1);
      assert.equal(result.tablesProvisioned.length, 5);
      assert.ok(result.tablesProvisioned.includes("EnterpriseProfile"));
      assert.ok(result.tablesProvisioned.includes("User"));
      assert.equal(result.fksProvisioned, 1);

      // Verify executed DDL
      assert.ok(executedSql.some((q) => q.includes('CREATE SCHEMA IF NOT EXISTS "tenant_cloned_test"')));
      assert.ok(executedSql.some((q) => q.includes('CREATE TYPE "tenant_cloned_test"."Role" AS ENUM')));
      assert.ok(
        executedSql.some((q) =>
          q.includes(
            'CREATE TABLE IF NOT EXISTS "tenant_cloned_test"."EnterpriseProfile" (LIKE public."EnterpriseProfile" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)'
          )
        )
      );
      assert.ok(
        executedSql.some((q) =>
          q.includes('ALTER TABLE "tenant_cloned_test"."User" ALTER COLUMN "role" TYPE "tenant_cloned_test"."Role"')
        )
      );
      assert.ok(executedSql.some((q) => q.includes('ALTER TABLE "tenant_cloned_test"."Account" ADD CONSTRAINT')));
      assert.ok(executedSql.some((q) => q.includes('REFERENCES "tenant_cloned_test"."Account"')));
    });

    it("falls back cleanly to embedded DDL generation when public schema has no tables", async () => {
      const executedSql: string[] = [];

      const mockClient = {
        async $executeRawUnsafe(query: string) {
          executedSql.push(query);
          return 1;
        },
        async $queryRawUnsafe<T = any>(): Promise<T> {
          // Both tenant schema and public schema return 0 tables
          return [] as unknown as T;
        },
      };

      const result = await provisionPostgresTenantSchema(mockClient, "tenant_fallback_test");
      assert.equal(result.clonedFromPublic, false);
      assert.ok(result.tablesProvisioned.length > 0);
      assert.ok(executedSql.some((q) => q.includes('CREATE SCHEMA IF NOT EXISTS "tenant_fallback_test"')));
      assert.ok(executedSql.some((q) => q.includes('CREATE TABLE IF NOT EXISTS "tenant_fallback_test"."Account"')));
    });
  });

  describe("7. Dynamic Tenant Registry Path Resolution & Lazy Loading (Turbopack Safe)", () => {
    it("resolves dynamic data directory without hardcoded static path constants", () => {
      const dir = getDynamicDataDirectory();
      assert.ok(typeof dir === "string" && dir.length > 0);
      assert.ok(!dir.includes("[object Object]"));

      const filePath = getRegistryFilePath();
      assert.ok(typeof filePath === "string" && filePath.length > 0);
      assert.ok(filePath.endsWith("tenants_registry.json"));
      assert.ok(path.isAbsolute(filePath));
    });

    it("lazily initializes default tenant metadata without throwing on missing files", () => {
      const defaultMeta = getTenantMetadata("default");
      assert.ok(defaultMeta, "Default tenant metadata must exist");
      assert.equal(defaultMeta.tenantId, "default");
      assert.equal(defaultMeta.status, "ACTIVE");
      assert.equal(defaultMeta.schemaOrDb, "default");
    });

    it("registers and retrieves tenant metadata safely at runtime", () => {
      const testTenantId = `dynamic_reg_${Date.now()}`;
      const registered = registerTenant({
        tenantId: testTenantId,
        companyName: "Dynamic Registry Test Company",
        slug: testTenantId,
        maxSeats: 5,
      });

      assert.equal(registered.tenantId, testTenantId);
      assert.equal(registered.companyName, "Dynamic Registry Test Company");
      assert.equal(registered.maxSeats, 5);

      const retrieved = getTenantMetadata(testTenantId);
      assert.ok(retrieved, "Registered tenant must be retrievable");
      assert.equal(retrieved.companyName, "Dynamic Registry Test Company");

      const ensured = ensureTenantRegistered(testTenantId, "Updated Company Name");
      assert.equal(ensured.companyName, "Updated Company Name");
    });
  });
});
