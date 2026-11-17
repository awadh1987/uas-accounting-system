import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

console.log("=================================================================");
console.log("   UAS ACCOUNTING SYSTEM - SELF-CONTAINED COMMERCIAL PACKAGER    ");
console.log("   (Zero-Config | Offline-Capable | Pinned Prisma 6.19.3)        ");
console.log("=================================================================");

function copyRecursiveSync(src, dest, topLevelExcludes = new Set(), isRoot = true) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const child of fs.readdirSync(src)) {
      if (isRoot && topLevelExcludes.has(child)) continue;
      copyRecursiveSync(path.join(src, child), path.join(dest, child), topLevelExcludes, false);
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

// ---------------------------------------------------------------------------
// STEP 1: Generate Authoritative SQLite Migration SQL (Pinned Prisma 6.19.3)
// ---------------------------------------------------------------------------
console.log("\n[Step 1/8] Refreshing authoritative SQLite migration & embedded fallback...");
execFileSync(process.execPath, [path.join(projectRoot, "scripts", "generate-sqlite-migration.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

// Ensure Prisma Client is freshly generated with pinned 6.19.3 CLI (never `npx prisma`!)
const prismaEntrypoint = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
execFileSync(process.execPath, [prismaEntrypoint, "generate"], {
  cwd: projectRoot,
  stdio: "inherit",
});

// ---------------------------------------------------------------------------
// STEP 2: Fresh Production Build (Next.js Standalone)
// ---------------------------------------------------------------------------
console.log("\n[Step 2/8] Building Next.js standalone production bundle (zero raw TS source)...");
const skipBuild = process.argv.includes("--skip-build");
const standaloneDir = path.join(projectRoot, ".next", "standalone");

if (!skipBuild || !fs.existsSync(standaloneDir)) {
  execSync("npm run build", { stdio: "inherit", cwd: projectRoot });
} else {
  console.log("[OK] Using existing standalone build (--skip-build).");
}

if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  console.error("[ERROR] Next.js standalone build did not produce server.js!");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// STEP 3: Prepare Release Directory & Copy Clean Runtime
// ---------------------------------------------------------------------------
const releaseRoot = path.join(projectRoot, "release", "UAS-Commercial-Dist");
const appDestDir = path.join(releaseRoot, "app");
const mobileDestDir = path.join(releaseRoot, "mobile");

console.log(`\n[Step 3/8] Assembling clean self-contained runtime in: ${releaseRoot}`);
if (fs.existsSync(releaseRoot)) {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
}
fs.mkdirSync(appDestDir, { recursive: true });
fs.mkdirSync(mobileDestDir, { recursive: true });

// Copy ONLY runtime essentials from .next/standalone (exclude raw source, keys, dev scripts, docs)
const standaloneExcludes = new Set([
  "src",
  "tests",
  "android",
  "ios",
  "keys",
  "dist",
  "release",
  "out",
  "docs",
  "deploy",
  "issued",
  "scripts",
  "prisma",
  ".env",
  ".env.local",
  "license.uas",
  "uas.runtime.json",
  "tsconfig.json",
  "tsconfig.tsbuildinfo",
  "next.config.ts",
  "capacitor.config.ts",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "build-apk.ps1",
  "build-release-apk.ps1",
  "UAS.xlsx",
  "uas_coding_agent_prompt.md",
  "unified_accounting_system_uas.html",
  "README.md",
  "CONTRIBUTING.md",
  "QUICK-START.md",
  "package-lock.json",
]);

copyRecursiveSync(standaloneDir, appDestDir, standaloneExcludes);

// Copy .next/static assets (required by Next.js standalone)
const staticSrc = path.join(projectRoot, ".next", "static");
const staticDest = path.join(appDestDir, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyRecursiveSync(staticSrc, staticDest);
}

// Copy public assets (exclude large installer binary inside app/public/downloads to prevent recursive bloat)
const publicSrc = path.join(projectRoot, "public");
const publicDest = path.join(appDestDir, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursiveSync(publicSrc, publicDest);
  const nestedExe = path.join(publicDest, "downloads", "UAS-Setup-Win64.exe");
  if (fs.existsSync(nestedExe)) fs.unlinkSync(nestedExe);
}

// Copy Prisma schema + SQLite migrations (exclude dev.db!)
const prismaDest = path.join(appDestDir, "prisma");
fs.mkdirSync(prismaDest, { recursive: true });
fs.copyFileSync(
  path.join(projectRoot, "prisma", "schema.prisma"),
  path.join(prismaDest, "schema.prisma")
);
copyRecursiveSync(
  path.join(projectRoot, "prisma", "migrations"),
  path.join(prismaDest, "migrations")
);

// Copy SQL RLS policy reference
copyRecursiveSync(path.join(projectRoot, "infra"), path.join(appDestDir, "infra"));

// Explicitly guarantee Prisma Client & Windows Query Engine Binary (.node) are bundled
console.log("[OK] Verifying Prisma 6.19.3 Windows Query Engine binary...");
const prismaClientSrc = path.join(projectRoot, "node_modules", ".prisma", "client");
const prismaClientDest = path.join(appDestDir, "node_modules", ".prisma", "client");
fs.mkdirSync(prismaClientDest, { recursive: true });

for (const file of fs.readdirSync(prismaClientSrc)) {
  // Skip temporary lock/tmp files
  if (file.includes(".tmp")) continue;
  const fullSrc = path.join(prismaClientSrc, file);
  const fullDest = path.join(prismaClientDest, file);
  if (fs.statSync(fullSrc).isFile()) {
    fs.copyFileSync(fullSrc, fullDest);
  }
}

const queryEngineDest = path.join(prismaClientDest, "query_engine-windows.dll.node");
if (!fs.existsSync(queryEngineDest)) {
  // Fallback from @prisma/engines if needed
  const fallbackEngine = path.join(
    projectRoot,
    "node_modules",
    "@prisma",
    "engines",
    "query_engine-windows.dll.node"
  );
  if (fs.existsSync(fallbackEngine)) {
    fs.copyFileSync(fallbackEngine, queryEngineDest);
  } else {
    console.error("[ERROR] Missing query_engine-windows.dll.node!");
    process.exit(1);
  }
}
console.log(
  `[OK] Bundled query_engine-windows.dll.node (${(fs.statSync(queryEngineDest).size / 1024 / 1024).toFixed(2)} MB)`
);

// Explicitly copy @prisma/client wrapper package
copyRecursiveSync(
  path.join(projectRoot, "node_modules", "@prisma", "client"),
  path.join(appDestDir, "node_modules", "@prisma", "client")
);

// Explicitly bundle portable Node.js binary so fresh Windows PCs need ZERO Node.js installed
const runtimeDir = path.join(appDestDir, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
const bundledNodePath = path.join(runtimeDir, "node.exe");
fs.copyFileSync(process.execPath, bundledNodePath);
console.log(
  `[OK] Bundled self-contained Node.js runtime: runtime/node.exe (${(fs.statSync(bundledNodePath).size / 1024 / 1024).toFixed(2)} MB)`
);

// ---------------------------------------------------------------------------
// STEP 4: Generate Pre-Initialized Template SQLite Database (template.db)
// ---------------------------------------------------------------------------
console.log("\n[Step 4/8] Generating clean pre-migrated & seeded template.db...");
const templateDbDest = path.join(prismaDest, "template.db");
execFileSync(
  process.execPath,
  [path.join(projectRoot, "scripts", "build-template-db.mjs"), templateDbDest],
  {
    cwd: projectRoot,
    stdio: "inherit",
  }
);

// ---------------------------------------------------------------------------
// STEP 5: Bundle Android Mobile APK
// ---------------------------------------------------------------------------
console.log("\n[Step 5/8] Bundling Android Mobile APK...");
const apkSource = path.join(projectRoot, "public", "downloads", "uas-latest.apk");
const apkDest = path.join(mobileDestDir, "UAS-Accounting.apk");
if (fs.existsSync(apkSource)) {
  fs.copyFileSync(apkSource, apkDest);
  console.log(`[OK] Bundled: ${apkDest} (${(fs.statSync(apkDest).size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  console.warn(`[WARN] Android APK not found at ${apkSource}`);
}

// ---------------------------------------------------------------------------
// STEP 6: Compile Native Self-Contained Launcher UAS.exe (Zero CLI / Zero npx)
// ---------------------------------------------------------------------------
console.log("\n[Step 6/8] Compiling Native Self-Contained Launcher (app/UAS.exe)...");
const uasLauncherCs = `
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public class UasLauncher
{
    public static int Main(string[] args)
    {
        Console.Title = "UAS Accounting System - Unified Enterprise ERP";
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("==================================================================");
        Console.WriteLine("       UNIFIED ACCOUNTING SYSTEM (UAS ENTERPRISE ERP)             ");
        Console.WriteLine("       Zero-Config Self-Contained Windows Runtime                 ");
        Console.WriteLine("==================================================================");
        Console.ResetColor();

        string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\');
        string serverJs = Path.Combine(appDir, "server.js");
        if (!File.Exists(serverJs))
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("[ERROR] server.js not found in: " + appDir);
            Console.ResetColor();
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
            return 1;
        }

        // Determine persistent customer data directory (C:\\UAS-Data when installed, or sibling UAS-Data for portable mode)
        string dataDir = @"C:\\UAS-Data";
        if (!appDir.StartsWith(@"C:\\UAS", StringComparison.OrdinalIgnoreCase) && !Directory.Exists(dataDir))
        {
            string parentDir = Directory.GetParent(appDir) != null ? Directory.GetParent(appDir).FullName : appDir;
            dataDir = Path.Combine(parentDir, "UAS-Data");
        }

        try
        {
            if (!Directory.Exists(dataDir))
            {
                Directory.CreateDirectory(dataDir);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("[WARN] Could not create " + dataDir + " (" + ex.Message + "). Falling back to local app data.");
            dataDir = Path.Combine(appDir, "data");
            Directory.CreateDirectory(dataDir);
        }

        // 1. Copy pre-initialized template.db into customer data directory on first launch
        string activeDbPath = Path.Combine(dataDir, "uas-enterprise.db");
        string templateDbPath = Path.Combine(appDir, "prisma", "template.db");

        bool needsTemplateCopy = !File.Exists(activeDbPath);
        if (!needsTemplateCopy)
        {
            try
            {
                FileInfo fi = new FileInfo(activeDbPath);
                if (fi.Length == 0) needsTemplateCopy = true;
            }
            catch { }
        }

        if (needsTemplateCopy && File.Exists(templateDbPath))
        {
            try
            {
                Console.WriteLine("[INIT] First launch detected. Installing clean pre-migrated database to:");
                Console.WriteLine("       " + activeDbPath);
                File.Copy(templateDbPath, activeDbPath, true);
                Console.WriteLine("[OK] Database initialized cleanly (zero CLI required).");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WARN] Template copy skipped (" + ex.Message + "); runtime self-healing will initialize DB.");
            }
        }

        // 2. Determine runtime mode (local vs lan) and port
        string mode = "local";
        int port = 3000;

        // Read uas.runtime.json if present
        string runtimeJsonPath = Path.Combine(dataDir, "uas.runtime.json");
        if (File.Exists(runtimeJsonPath))
        {
            try
            {
                string json = File.ReadAllText(runtimeJsonPath);
                string normalized = json.Replace(" ", "").Replace("\\t", "").Replace("\\r", "").Replace("\\n", "");
                if (normalized.IndexOf("\\"mode\\":\\"lan\\"", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    mode = "lan";
                }
            }
            catch { }
        }

        // CLI argument overrides (--local, --lan, --port XXXX, --no-browser)
        bool noBrowser = false;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i].Trim().ToLowerInvariant();
            if (a == "--lan") mode = "lan";
            else if (a == "--local") mode = "local";
            else if (a == "--no-browser") noBrowser = true;
            else if (a == "--port" && i + 1 < args.Length)
            {
                int parsedPort;
                if (int.TryParse(args[i + 1], out parsedPort) && parsedPort > 0) port = parsedPort;
                i++;
            }
        }

        string host = (mode == "lan") ? "0.0.0.0" : "127.0.0.1";

        // 3. Locate bundled portable node.exe first (100% self-contained without system Node.js)
        string bundledNode = Path.Combine(appDir, "runtime", "node.exe");
        string nodeExe = File.Exists(bundledNode) ? bundledNode : "node.exe";

        string dbUrl = "file:" + activeDbPath.Replace("\\\\", "/");
        string licensePath = Path.Combine(dataDir, "license.uas");
        string localUrl = "http://localhost:" + port;

        Console.WriteLine();
        Console.WriteLine("  Runtime Mode   : " + mode.ToUpperInvariant() + " (" + host + ":" + port + ")");
        Console.WriteLine("  Data Directory : " + dataDir);
        Console.WriteLine("  Database       : " + activeDbPath);
        Console.WriteLine("  Node Engine    : " + nodeExe);
        if (mode == "lan")
        {
            string lanIp = GetPrimaryLanIp();
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("  Office LAN URL : http://" + lanIp + ":" + port);
            Console.ResetColor();
        }
        Console.WriteLine("  Local URL      : " + localUrl);
        Console.WriteLine();
        Console.WriteLine("  Keep this window open while using UAS. Press Ctrl+C to stop.");
        Console.WriteLine("==================================================================");
        Console.WriteLine();

        // 4. Launch browser automatically once health endpoint responds
        if (!noBrowser)
        {
            Thread browserThread = new Thread(delegate()
            {
                WaitForServerAndOpenBrowser(port, localUrl);
            });
            browserThread.IsBackground = true;
            browserThread.Start();
        }

        // 5. Start Next.js standalone server directly (ZERO npx / ZERO Prisma CLI)
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\\"" + serverJs + "\\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["PORT"] = port.ToString();
            psi.EnvironmentVariables["HOSTNAME"] = host;
            psi.EnvironmentVariables["DATABASE_URL"] = dbUrl;
            psi.EnvironmentVariables["UAS_LICENSE_PATH"] = licensePath;

            Process proc = Process.Start(psi);
            if (proc != null)
            {
                proc.WaitForExit();
                return proc.ExitCode;
            }
            return 1;
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("[ERROR] Failed to start UAS server: " + ex.Message);
            Console.ResetColor();
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
            return 1;
        }
    }

    private static void WaitForServerAndOpenBrowser(int port, string url)
    {
        string healthUrl = "http://127.0.0.1:" + port + "/api/public/verify";
        for (int attempt = 0; attempt < 40; attempt++)
        {
            Thread.Sleep(500);
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(healthUrl);
                req.Method = "GET";
                req.Timeout = 1500;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 500)
                    {
                        break;
                    }
                }
            }
            catch
            {
                // Still booting
            }
        }

        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { }
    }

    private static string GetPrimaryLanIp()
    {
        try
        {
            IPHostEntry host = Dns.GetHostEntry(Dns.GetHostName());
            foreach (IPAddress ip in host.AddressList)
            {
                if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                {
                    string s = ip.ToString();
                    if (!s.StartsWith("169.254.")) return s;
                }
            }
        }
        catch { }
        return "127.0.0.1";
    }
}
`;

const uasLauncherCsPath = path.join(projectRoot, "scripts", ".tmp-UasLauncher.cs");
const uasExePath = path.join(appDestDir, "UAS.exe");
fs.writeFileSync(uasLauncherCsPath, uasLauncherCs, "utf8");

try {
  execSync(
    `powershell -NoProfile -Command "Add-Type -TypeDefinition (Get-Content '${uasLauncherCsPath}' -Raw) -OutputAssembly '${uasExePath}' -OutputType ConsoleApplication"`,
    { stdio: "inherit" }
  );
  console.log(`[OK] Compiled self-contained launcher: ${uasExePath}`);
} finally {
  if (fs.existsSync(uasLauncherCsPath)) fs.unlinkSync(uasLauncherCsPath);
}

// ---------------------------------------------------------------------------
// STEP 7: Generate Zero-CLI Batch Launchers (Using UAS.exe & bundled node.exe)
// ---------------------------------------------------------------------------
console.log("\n[Step 7/8] Generating zero-CLI batch launchers (zero npx)...");

fs.writeFileSync(
  path.join(appDestDir, "Start-UAS.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" %*\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(appDestDir, "Start-UAS-Local.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" --local %*\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(appDestDir, "Start-UAS-LAN.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" --lan %*\r\n`,
  "utf8"
);

const uasSetupBat = `@echo off
title UAS Accounting System - Zero-Config Commercial Installer
color 0E

echo ============================================================================
echo    UNIFIED ACCOUNTING SYSTEM (UAS ERP) - ZERO-CONFIG INSTALLER
echo ============================================================================
echo.
echo Installing self-contained runtime to : C:\\UAS\\app
echo Initializing persistent data dir     : C:\\UAS-Data
echo (100%% Offline-Capable - No Node.js, No Prisma CLI, No npx required)
echo.

net session >nul 2>nul
if errorlevel 1 (
    echo [INFO] Requesting Administrator elevation for firewall & shortcuts...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

if not exist "C:\\UAS\\app" mkdir "C:\\UAS\\app"
if not exist "C:\\UAS-Data" mkdir "C:\\UAS-Data"

echo [1/5] Copying self-contained runtime to C:\\UAS\\app...
xcopy "%~dp0app\\*" "C:\\UAS\\app\\" /E /I /Y /Q >nul

if exist "%~dp0mobile" (
    xcopy "%~dp0mobile\\*" "C:\\UAS\\mobile\\" /E /I /Y /Q >nul
)
if exist "%~dp0QUICK-START-AR-EN.md" (
    copy "%~dp0QUICK-START-AR-EN.md" "C:\\UAS\\" /Y >nul
)

echo [2/5] Preparing clean pre-migrated SQLite database...
if not exist "C:\\UAS-Data\\uas-enterprise.db" (
    if exist "C:\\UAS\\app\\prisma\\template.db" (
        copy "C:\\UAS\\app\\prisma\\template.db" "C:\\UAS-Data\\uas-enterprise.db" /Y >nul
        echo [OK] Pre-initialized database installed to C:\\UAS-Data\\uas-enterprise.db
    )
) else (
    echo [OK] Existing customer database preserved at C:\\UAS-Data\\uas-enterprise.db
)

if exist "%~dp0license.uas" (
    copy "%~dp0license.uas" "C:\\UAS-Data\\license.uas" /Y >nul
    echo [OK] License bound to C:\\UAS-Data\\license.uas
)

echo [3/5] Configuring Windows Defender Firewall rule (TCP Port 3000)...
powershell -NoProfile -Command "if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null }"

echo [4/5] Creating Desktop & Start Menu shortcuts pointing to UAS.exe...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $d = [System.Environment]::GetFolderPath('CommonDesktopDirectory'); $s = $ws.CreateShortcut(\\"$d\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\app\\UAS.exe'; $s.WorkingDirectory = 'C:\\UAS\\app'; $s.Save()"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $p = [System.Environment]::GetFolderPath('CommonPrograms'); $dir = \\"$p\\UAS Accounting\\"; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; $s = $ws.CreateShortcut(\\"$dir\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\app\\UAS.exe'; $s.WorkingDirectory = 'C:\\UAS\\app'; $s.Save(); $s2 = $ws.CreateShortcut(\\"$dir\\UAS Local Standalone.lnk\\"); $s2.TargetPath = 'C:\\UAS\\app\\UAS.exe'; $s2.Arguments = '--local'; $s2.WorkingDirectory = 'C:\\UAS\\app'; $s2.Save(); $s3 = $ws.CreateShortcut(\\"$dir\\UAS Office LAN Server.lnk\\"); $s3.TargetPath = 'C:\\UAS\\app\\UAS.exe'; $s3.Arguments = '--lan'; $s3.WorkingDirectory = 'C:\\UAS\\app'; $s3.Save()"

echo.
echo ============================================================================
echo   [5/5] INSTALLATION COMPLETED SUCCESSFULLY!
echo   Double-click "UAS Accounting System" on your Desktop to start.
echo ============================================================================
echo.
set /p launchNow="Launch UAS Accounting System now? (Y/N): "
if /i "%launchNow%"=="Y" (
    start "" "C:\\UAS\\app\\UAS.exe"
)
exit /b 0
`;
fs.writeFileSync(path.join(releaseRoot, "UAS-Setup.bat"), uasSetupBat, "utf8");

// ---------------------------------------------------------------------------
// STEP 8: Compile Native Windows Installer (UAS-Setup-Win64.exe)
// ---------------------------------------------------------------------------
console.log("\n[Step 8/8] Compiling Native Windows Installer (UAS-Setup-Win64.exe)...");

const csharpInstallerSource = `
using System;
using System.Diagnostics;
using System.IO;

public class UasSetup
{
    public static void Main(string[] args)
    {
        Console.Title = "UAS Accounting System - Zero-Config Installer (Win64)";
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("==================================================================");
        Console.WriteLine("      UAS ACCOUNTING SYSTEM - COMMERCIAL INSTALLER (WIN64)        ");
        Console.WriteLine("      100% Offline-Capable | Zero CLI | Self-Contained            ");
        Console.WriteLine("==================================================================");
        Console.ResetColor();
        Console.WriteLine();

        string currentDir = AppDomain.CurrentDomain.BaseDirectory;
        string targetAppDir = @"C:\\UAS";
        string targetDataDir = @"C:\\UAS-Data";

        try
        {
            Console.WriteLine("[1/5] Creating directories: C:\\\\UAS and C:\\\\UAS-Data...");
            if (!Directory.Exists(targetAppDir)) Directory.CreateDirectory(targetAppDir);
            if (!Directory.Exists(targetDataDir)) Directory.CreateDirectory(targetDataDir);

            string appSourceDir = Path.Combine(currentDir, "app");
            if (Directory.Exists(appSourceDir))
            {
                Console.WriteLine("[2/5] Installing self-contained runtime, Node engine, and Prisma DB engine...");
                CopyDirectory(appSourceDir, Path.Combine(targetAppDir, "app"));
            }

            string mobileSourceDir = Path.Combine(currentDir, "mobile");
            if (Directory.Exists(mobileSourceDir))
            {
                CopyDirectory(mobileSourceDir, Path.Combine(targetAppDir, "mobile"));
            }

            // Copy pre-initialized template.db into C:\\UAS-Data\\uas-enterprise.db on fresh install
            string activeDb = Path.Combine(targetDataDir, "uas-enterprise.db");
            string templateDb = Path.Combine(targetAppDir, "app", "prisma", "template.db");
            if (!File.Exists(activeDb) && File.Exists(templateDb))
            {
                File.Copy(templateDb, activeDb, true);
                Console.WriteLine("[OK] Pre-migrated enterprise SQLite database initialized at C:\\\\UAS-Data\\\\uas-enterprise.db");
            }
            else if (File.Exists(activeDb))
            {
                Console.WriteLine("[OK] Existing customer database preserved at C:\\\\UAS-Data\\\\uas-enterprise.db");
            }

            string licenseSource = Path.Combine(currentDir, "license.uas");
            if (File.Exists(licenseSource))
            {
                File.Copy(licenseSource, Path.Combine(targetDataDir, "license.uas"), true);
                Console.WriteLine("[OK] Cryptographic license file bound to C:\\\\UAS-Data\\\\license.uas");
            }

            Console.WriteLine("[3/5] Configuring Windows Defender Firewall inbound rule (Port 3000)...");
            RunPowerShell("if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null }");

            Console.WriteLine("[4/5] Creating Desktop and Start Menu shortcuts for UAS.exe...");
            CreateShortcuts();

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine();
            Console.WriteLine("==================================================================");
            Console.WriteLine("  [5/5] INSTALLATION COMPLETE! UAS Accounting System is ready.    ");
            Console.WriteLine("==================================================================");
            Console.ResetColor();

            Console.Write("\\nLaunch UAS Accounting System now? (Y/N): ");
            string key = Console.ReadLine();
            if (key != null && key.Trim().Equals("Y", StringComparison.OrdinalIgnoreCase))
            {
                string launcher = Path.Combine(targetAppDir, "app", "UAS.exe");
                if (File.Exists(launcher))
                {
                    Process.Start(new ProcessStartInfo(launcher) { WorkingDirectory = Path.Combine(targetAppDir, "app"), UseShellExecute = true });
                }
            }
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("\\n[ERROR] Installation failed: " + ex.Message);
            Console.ResetColor();
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
        }
    }

    private static void CopyDirectory(string sourceDir, string targetDir)
    {
        if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);
        foreach (string file in Directory.GetFiles(sourceDir))
        {
            string dest = Path.Combine(targetDir, Path.GetFileName(file));
            File.Copy(file, dest, true);
        }
        foreach (string dir in Directory.GetDirectories(sourceDir))
        {
            string dest = Path.Combine(targetDir, Path.GetFileName(dir));
            CopyDirectory(dir, dest);
        }
    }

    private static void RunPowerShell(string script)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \\"" + script + "\\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            };
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(5000);
        }
        catch { }
    }

    private static void CreateShortcuts()
    {
        string ps =
            "$ws = New-Object -ComObject WScript.Shell; " +
            "$desktop = [System.Environment]::GetFolderPath('CommonDesktopDirectory'); " +
            "$s = $ws.CreateShortcut($desktop + '\\\\UAS Accounting System.lnk'); " +
            "$s.TargetPath = 'C:\\\\UAS\\\\app\\\\UAS.exe'; " +
            "$s.WorkingDirectory = 'C:\\\\UAS\\\\app'; " +
            "$s.Save(); " +
            "$programs = [System.Environment]::GetFolderPath('CommonPrograms'); " +
            "$dir = $programs + '\\\\UAS Accounting'; " +
            "if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; " +
            "$s1 = $ws.CreateShortcut($dir + '\\\\UAS Accounting System.lnk'); " +
            "$s1.TargetPath = 'C:\\\\UAS\\\\app\\\\UAS.exe'; " +
            "$s1.WorkingDirectory = 'C:\\\\UAS\\\\app'; " +
            "$s1.Save(); " +
            "$s2 = $ws.CreateShortcut($dir + '\\\\UAS Local Standalone.lnk'); " +
            "$s2.TargetPath = 'C:\\\\UAS\\\\app\\\\UAS.exe'; " +
            "$s2.Arguments = '--local'; " +
            "$s2.WorkingDirectory = 'C:\\\\UAS\\\\app'; " +
            "$s2.Save(); " +
            "$s3 = $ws.CreateShortcut($dir + '\\\\UAS Office LAN Server.lnk'); " +
            "$s3.TargetPath = 'C:\\\\UAS\\\\app\\\\UAS.exe'; " +
            "$s3.Arguments = '--lan'; " +
            "$s3.WorkingDirectory = 'C:\\\\UAS\\\\app'; " +
            "$s3.Save();";
        RunPowerShell(ps);
    }
}
`;

const csTempPath = path.join(projectRoot, "scripts", ".tmp-UasSetup.cs");
fs.writeFileSync(csTempPath, csharpInstallerSource, "utf8");

const exeReleasePath = path.join(releaseRoot, "UAS-Setup-Win64.exe");
const exeDownloadsPath = path.join(projectRoot, "public", "downloads", "UAS-Setup-Win64.exe");
const issScriptPath = path.join(projectRoot, "deploy", "windows", "uas-installer.iss");

const isccCandidates = [
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe") : "",
  process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe") : "",
  process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Inno Setup 6", "ISCC.exe") : "",
].filter(Boolean);

const isccExe = isccCandidates.find((p) => fs.existsSync(p));

try {
  fs.mkdirSync(path.dirname(exeDownloadsPath), { recursive: true });

  if (isccExe && fs.existsSync(issScriptPath)) {
    console.log(`[INFO] Found Inno Setup 6 compiler: ${isccExe}`);
    execSync(`"${isccExe}" "${issScriptPath}"`, { stdio: "inherit" });
    if (fs.existsSync(exeDownloadsPath)) {
      fs.copyFileSync(exeDownloadsPath, exeReleasePath);
    } else if (fs.existsSync(exeReleasePath)) {
      fs.copyFileSync(exeReleasePath, exeDownloadsPath);
    }
    console.log(`[OK] Full Inno Setup self-extracting installer compiled: ${exeDownloadsPath}`);
    console.log(`[OK] Synced full installer to release bundle: ${exeReleasePath}`);
  } else {
    console.warn("[WARN] Inno Setup 6 (ISCC.exe) not found; falling back to lightweight C# stub installer.");
    execSync(
      `powershell -NoProfile -Command "Add-Type -TypeDefinition (Get-Content '${csTempPath}' -Raw) -OutputAssembly '${exeReleasePath}' -OutputType ConsoleApplication"`,
      { stdio: "inherit" }
    );
    fs.copyFileSync(exeReleasePath, exeDownloadsPath);
    console.log(`[OK] Native 64-bit stub installer compiled: ${exeReleasePath}`);
    console.log(`[OK] Copied installer to web downloads: ${exeDownloadsPath}`);
  }
} finally {
  if (fs.existsSync(csTempPath)) fs.unlinkSync(csTempPath);
}

// Write updated bilingual QUICK-START-AR-EN.md
const quickStartMd = `# ط¯ظ„ظٹظ„ ط§ظ„ط¨ط¯ط، ظˆط§ظ„طھط´ط؛ظٹظ„ ط§ظ„طھط¬ط§ط±ظٹ ظ„ظ…ظ†ط¸ظˆظ…ط© UAS ط§ظ„ظ…ط­ط§ط³ط¨ظٹط©
# UAS Commercial Distribution & Quick Start Guide (Arabic & English)

ظ…ط±ط­ط¨ط§ظ‹ ط¨ظƒ ظپظٹ **ظ…ظ†ط¸ظˆظ…ط© ط§ظ„ط­ط³ط§ط¨ط§طھ ط§ظ„ظ…ظˆط­ط¯ط© (UAS Enterprise ERP)**.
ظ‡ط°ط§ ط§ظ„ط¥طµط¯ط§ط± ط§ظ„طھط¬ط§ط±ظٹ ظٹط¹ظ…ظ„ **ط¨ط´ظƒظ„ ظ…ط³طھظ‚ظ„ 100% ط¯ظˆظ† ط§ظ„ط­ط§ط¬ط© ظ„طھط«ط¨ظٹطھ Node.js ط£ظˆ ط£ظٹ ط£ظˆط§ظ…ط± ط¨ط±ظ…ط¬ظٹط© ط£ظˆ ط§طھطµط§ظ„ ط¨ط§ظ„ط¥ظ†طھط±ظ†طھ**.

---

## ط£ظˆظ„ط§ظ‹: ط§ظ„طھط«ط¨ظٹطھ ط§ظ„ط³ط±ظٹط¹ ط¹ظ„ظ‰ ظˆظٹظ†ط¯ظˆط² (Zero-Config Windows Setup)

1. ط§ط¶ط؛ط· ظ…ط±طھظٹظ† ط¹ظ„ظ‰ **\`UAS-Setup-Win64.exe\`** (ط£ظˆ **\`UAS-Setup.bat\`**).
2. ظٹظ‚ظˆظ… ط§ظ„ظ…ط«ط¨طھ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¨ظ€:
   - ظ†ط³ط® ط§ظ„ظ…ط­ط±ظƒ ط§ظ„ظ…ط³طھظ‚ظ„ ط§ظ„ظ…ط¯ظ…ط¬ (\`UAS.exe\` + \`runtime/node.exe\` + ظ…ط­ط±ظƒ Prisma 6.19.3) ط¥ظ„ظ‰ **\`C:\\UAS\\app\`**.
   - طھظ‡ظٹط¦ط© ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¬ط§ظ‡ط²ط© ظ…ط³ط¨ظ‚ط§ظ‹ (\`template.db\`) ظپظٹ **\`C:\\UAS-Data\\uas-enterprise.db\`** ط¯ظˆظ† ط§ظ„ظ…ط³ط§ط³ ط¨ط¨ظٹط§ظ†ط§طھظƒ ط§ظ„ط³ط§ط¨ظ‚ط© ط¹ظ†ط¯ ط§ظ„طھط­ط¯ظٹط«.
   - ظپطھط­ ط§ظ„ظ…ظ†ظپط° **3000** ظپظٹ ط¬ط¯ط§ط± ط­ظ…ط§ظٹط© ظˆظٹظ†ط¯ظˆط² ظ„ظ„ط´ط¨ظƒط© ط§ظ„ظ…ط­ظ„ظٹط©.
   - ط¥ظ†ط´ط§ط، ط§ط®طھطµط§ط±ط§طھ ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ظ…ط¨ط§ط´ط± ظ„ظ€ **\`UAS.exe\`** ط¹ظ„ظ‰ ط³ط·ط­ ط§ظ„ظ…ظƒطھط¨ ظˆظ‚ط§ط¦ظ…ط© ط§ط¨ط¯ط£.
3. ط­طھظ‰ ظپظٹ ط­ط§ظ„ ط­ط°ظپ ظ…ظ„ظپ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھطŒ طھظ‚ظˆظ… ط§ظ„ظ…ظ†ط¸ظˆظ…ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¨ط§ظ„طھظ‡ظٹط¦ط© ط§ظ„ط°ط§طھظٹط© (Self-Healing SQLite Bootstrap) ط¹ظ†ط¯ ط§ظ„طھط´ط؛ظٹظ„ ط¨ط¯ظˆظ† ط£ظٹ ط£ط®ط·ط§ط، \`P2021\`.

---

## ط«ط§ظ†ظٹط§ظ‹: ط£ظˆط¶ط§ط¹ ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ط«ظ„ط§ط«ط© (3 Runtime Modes)

- **ط§ظ„ط¬ظ‡ط§ط² ط§ظ„ظ…ط³طھظ‚ظ„ (Local Standalone):** ط´ط؛ظ„ **\`UAS Accounting System\`** (ط£ظˆ \`UAS.exe --local\`) â†’ ظٹط¹ظ…ظ„ ط¹ظ„ظ‰ \`http://localhost:3000\`.
- **ط®ط§ط¯ظ… ط§ظ„ط´ط¨ظƒط© ط§ظ„ظ…ظƒطھط¨ظٹط© (Office LAN Server):** ط´ط؛ظ„ **\`UAS Office LAN Server\`** (ط£ظˆ \`UAS.exe --lan\`) â†’ ظٹطھظٹط­ ط§ظ„ط§طھطµط§ظ„ ظ…ظ† ط¬ظ…ظٹط¹ ط£ط¬ظ‡ط²ط© ط§ظ„ظ…ظˆط¸ظپظٹظ† ظˆط§ظ„ظ‡ظˆط§طھظپ ط§ظ„ظ…ظٹط¯ط§ظ†ظٹط© ط¹ط¨ط± \`http://<LAN-IP>:3000\`.
- **ط§ظ„ط³ط­ط§ط¨ظٹ (Cloud):** ط§طھطµظ„ ظ…ط¨ط§ط´ط±ط© ط¨ظ€ \`https://qat.world\` ط£ظˆ ظ†ط·ط§ظ‚ ط´ط±ظƒطھظƒ ط§ظ„ظ…ط®طµطµ.

---

## ط«ط§ظ„ط«ط§ظ‹: طھظپط¹ظٹظ„ ط§ظ„طھط±ط®ظٹطµ ط§ظ„ظ…ط´ظپط± (Ed25519 Activation)

1. ط¹ظ†ط¯ ظپطھط­ ط§ظ„ظ†ط¸ط§ظ…طŒ ط§ظ†ط³ط® **ط±ظ…ط² ط·ظ„ط¨ ط§ظ„طھط±ط®ظٹطµ (Machine Request Code)**: \`REQ-XXXX-XXXX-XXXX-XXXX\`.
2. ط§ط±ظپط¹ ظ…ظ„ظپ **\`license.uas\`** ظ…ط¨ط§ط´ط±ط© (طھظپط¹ظٹظ„ 100% ط¯ظˆظ† ط¥ظ†طھط±ظ†طھ) ط£ظˆ ط£ط¯ط®ظ„ ط§ظ„ظ…ظپطھط§ط­ ط§ظ„طھط³ظ„ط³ظ„ظٹ \`UASKEY-...\`.

---

## English Quick Start Summary

1. **Zero-Config Install:** Double-click \`UAS-Setup-Win64.exe\` (or \`UAS-Setup.bat\`). No Node.js, no Prisma CLI, no \`npx\`, and no internet required.
2. **Pre-Initialized & Self-Healing DB:** A clean, pre-migrated SQLite database (\`template.db\`) is installed to \`C:\\UAS-Data\\uas-enterprise.db\` on first launch. If deleted, the runtime automatically recreates all tables and baseline records on startup with zero \`P2021\` errors.
3. **Launch:** Double-click \`UAS Accounting System\` on the Desktop (\`C:\\UAS\\app\\UAS.exe\`). Your browser opens automatically to \`http://localhost:3000\`.
4. **Android APK:** Install \`mobile/UAS-Accounting.apk\` and choose your Office LAN IP or Cloud URL on the login screen.
`;

fs.writeFileSync(path.join(releaseRoot, "QUICK-START-AR-EN.md"), quickStartMd, "utf8");

console.log("\n=================================================================");
console.log("   SELF-CONTAINED COMMERCIAL BUNDLE READY IN:");
console.log(`   ${releaseRoot}`);
console.log("   - app/UAS.exe (Zero-config native launcher)");
console.log("   - app/runtime/node.exe (Bundled Node.js engine)");
console.log("   - app/prisma/template.db (Pre-migrated & seeded SQLite DB)");
console.log("   - app/prisma/migrations/ (SQLite DDL migrations)");
console.log("   - app/node_modules/.prisma/client/query_engine-windows.dll.node");
console.log("   - mobile/UAS-Accounting.apk");
console.log("   - UAS-Setup-Win64.exe & UAS-Setup.bat");
console.log("=================================================================\n");
