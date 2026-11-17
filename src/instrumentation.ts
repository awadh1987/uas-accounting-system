export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureSqliteDatabaseReady } = await import("@/lib/sqliteBootstrap");
      await ensureSqliteDatabaseReady();
    } catch (error) {
      console.error("[UAS Instrumentation] Startup SQLite self-healing check failed:", error);
    }
  }
}
