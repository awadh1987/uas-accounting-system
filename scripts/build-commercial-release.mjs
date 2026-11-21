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
  for (const stray of ["android", "ios"]) {
    const strayPath = path.join(standaloneDir, stray);
    if (fs.existsSync(strayPath)) {
      fs.rmSync(strayPath, { recursive: true, force: true });
    }
  }
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

console.log(`\n[Step 3/7] Assembling clean self-contained runtime in: ${releaseRoot}`);
if (fs.existsSync(releaseRoot)) {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
}
fs.mkdirSync(appDestDir, { recursive: true });

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

// Copy .next/static assets explicitly (required by Next.js standalone to serve CSS & JS chunks)
const staticSrc = path.join(projectRoot, ".next", "static");
const staticDest = path.join(appDestDir, ".next", "static");
if (!fs.existsSync(staticSrc)) {
  console.error(`[ERROR] Missing Next.js static assets directory: ${staticSrc}`);
  process.exit(1);
}
copyRecursiveSync(staticSrc, staticDest);

// Verify .next/static contains compiled CSS & JS chunks before packaging
function collectFilesRecursive(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFilesRecursive(full, results);
    else results.push(full);
  }
  return results;
}
const staticFiles = collectFilesRecursive(staticDest);
const cssFiles = staticFiles.filter((f) => f.endsWith(".css"));
const jsFiles = staticFiles.filter((f) => f.endsWith(".js"));
if (cssFiles.length === 0 || jsFiles.length === 0) {
  console.error(
    `[ERROR] ${staticDest} is incomplete (css=${cssFiles.length}, js=${jsFiles.length}). Aborting build.`
  );
  process.exit(1);
}
console.log(
  `[OK] Verified .next/static assets bundled (${cssFiles.length} CSS file(s), ${jsFiles.length} JS chunk(s))`
);

// Copy public assets and remove public/downloads so zero .apk or .exe files enter the Windows bundle
const publicSrc = path.join(projectRoot, "public");
const publicDest = path.join(appDestDir, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursiveSync(publicSrc, publicDest);
  const publicDownloadsDir = path.join(publicDest, "downloads");
  if (fs.existsSync(publicDownloadsDir)) {
    fs.rmSync(publicDownloadsDir, { recursive: true, force: true });
    console.log("[OK] Removed app/public/downloads from Windows release bundle (zero .apk/.exe bloat)");
  }
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

// Bundle admin recovery CLI script
const scriptsDest = path.join(appDestDir, "scripts");
fs.mkdirSync(scriptsDest, { recursive: true });
fs.copyFileSync(
  path.join(projectRoot, "scripts", "reset-admin-password.mjs"),
  path.join(scriptsDest, "reset-admin-password.mjs")
);
console.log("[OK] Bundled scripts/reset-admin-password.mjs for offline emergency recovery");

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
// STEP 5: Compile Native Self-Contained Launcher UAS.exe (Zero CLI / Zero npx)
// ---------------------------------------------------------------------------
console.log("\n[Step 5/7] Compiling Native Self-Contained Launcher (UAS.exe)...");
const uasLauncherCs = `
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;

public class UasLauncher
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    public static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\');
        string appDir = (Directory.Exists(Path.Combine(baseDir, "app")) && File.Exists(Path.Combine(baseDir, "app", "server.js")))
            ? Path.Combine(baseDir, "app")
            : baseDir;
        string dataDir = @"C:\\UAS-Data";
        if (!baseDir.StartsWith(@"C:\\UAS", StringComparison.OrdinalIgnoreCase) && !Directory.Exists(dataDir))
        {
            string parentDir = Directory.GetParent(baseDir) != null ? Directory.GetParent(baseDir).FullName : baseDir;
            dataDir = Path.Combine(parentDir, "UAS-Data");
        }

        try
        {
            if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);
        }
        catch
        {
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UAS-Data");
            if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);
        }

        string logDir = Path.Combine(dataDir, "logs");
        if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir);
        string serverLogPath = Path.Combine(logDir, "uas-server.log");
        string crashLogPath = Path.Combine(logDir, "uas-crash.log");

        try
        {
            string serverJs = Path.Combine(appDir, "server.js");
            if (!File.Exists(serverJs))
            {
                MessageBoxW(IntPtr.Zero, "Runtime file missing: " + serverJs, "UAS Accounting System", 0x10);
                return 1;
            }

            // 1. Copy pre-migrated template.db into C:\\UAS-Data\\uas-enterprise.db on first launch
            string activeDbPath = Path.Combine(dataDir, "uas-enterprise.db");
            string templateDbPath = Path.Combine(appDir, "prisma", "template.db");
            bool needsTemplateCopy = !File.Exists(activeDbPath) || (new FileInfo(activeDbPath).Length == 0);
            if (needsTemplateCopy && File.Exists(templateDbPath))
            {
                File.Copy(templateDbPath, activeDbPath, true);
            }

            // 2. Parse mode & flags (--local, --lan, --port, --no-browser, --browser)
            string mode = "local";
            int port = 3000;
            bool noBrowser = false;
            bool browserTabMode = false;

            string runtimeJsonPath = Path.Combine(dataDir, "uas.runtime.json");
            if (File.Exists(runtimeJsonPath))
            {
                try
                {
                    string normalized = File.ReadAllText(runtimeJsonPath).Replace(" ", "").Replace("\\t", "").Replace("\\r", "").Replace("\\n", "");
                    if (normalized.IndexOf("\\"mode\\":\\"lan\\"", StringComparison.OrdinalIgnoreCase) >= 0) mode = "lan";
                }
                catch { }
            }

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].Trim().ToLowerInvariant();
                if (a == "--lan") mode = "lan";
                else if (a == "--local") mode = "local";
                else if (a == "--no-browser") noBrowser = true;
                else if (a == "--browser") browserTabMode = true;
                else if (a == "--port" && i + 1 < args.Length)
                {
                    int parsedPort;
                    if (int.TryParse(args[i + 1], out parsedPort) && parsedPort > 0) port = parsedPort;
                    i++;
                }
            }

            string host = (mode == "lan") ? "0.0.0.0" : "127.0.0.1";
            string localUrl = "http://127.0.0.1:" + port;

            // 3. If server is already running on this port, open the desktop app window immediately
            if (IsServerHealthy(port))
            {
                if (!noBrowser) OpenAppWindow(localUrl, browserTabMode);
                return 0;
            }

            // 4. Start bundled Node.js standalone server silently in background
            string bundledNode = Path.Combine(appDir, "runtime", "node.exe");
            string nodeExe = File.Exists(bundledNode) ? bundledNode : "node.exe";
            string dbUrl = "file:" + activeDbPath.Replace("\\\\", "/");
            string licensePath = Path.Combine(dataDir, "license.uas");

            File.AppendAllText(serverLogPath, "[" + DateTime.Now.ToString("s") + "] Starting UAS (" + mode + " on " + host + ":" + port + ")..." + Environment.NewLine);

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\\"" + serverJs + "\\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["PORT"] = port.ToString();
            psi.EnvironmentVariables["HOSTNAME"] = host;
            psi.EnvironmentVariables["DATABASE_URL"] = dbUrl;
            psi.EnvironmentVariables["UAS_LICENSE_PATH"] = licensePath;

            Process serverProc = new Process();
            serverProc.StartInfo = psi;
            object logLock = new object();
            serverProc.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    lock (logLock) { File.AppendAllText(serverLogPath, e.Data + Environment.NewLine); }
                }
            };
            serverProc.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    lock (logLock) { File.AppendAllText(serverLogPath, "[ERR] " + e.Data + Environment.NewLine); }
                }
            };

            if (!serverProc.Start())
            {
                MessageBoxW(IntPtr.Zero, "Failed to launch Node runtime: " + nodeExe, "UAS Accounting System", 0x10);
                return 1;
            }
            serverProc.BeginOutputReadLine();
            serverProc.BeginErrorReadLine();

            if (!noBrowser)
            {
                WaitForServerAndOpenAppWindow(port, localUrl, browserTabMode);
            }

            serverProc.WaitForExit();
            return serverProc.ExitCode;
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(crashLogPath, "[" + DateTime.Now.ToString("s") + "] " + ex.ToString() + Environment.NewLine); } catch { }
            MessageBoxW(IntPtr.Zero, "UAS Startup Error:\\n" + ex.Message + "\\n\\nLog: " + crashLogPath, "UAS Accounting System", 0x10);
            return 1;
        }
    }

    private static bool IsServerHealthy(int port)
    {
        string healthUrl = "http://127.0.0.1:" + port + "/api/public/verify";
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(healthUrl);
            req.Method = "GET";
            req.Timeout = 1000;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            {
                return ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 500);
            }
        }
        catch
        {
            return false;
        }
    }

    private static Process WaitForServerAndOpenAppWindow(int port, string url, bool browserTabMode)
    {
        for (int attempt = 0; attempt < 50; attempt++)
        {
            if (IsServerHealthy(port)) break;
            Thread.Sleep(400);
        }
        return OpenAppWindow(url, browserTabMode);
    }

    private static Process OpenAppWindow(string url, bool browserTabMode)
    {
        if (!browserTabMode)
        {
            string uiProfileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"UAS\\ui-profile");
            if (!Directory.Exists(uiProfileDir)) Directory.CreateDirectory(uiProfileDir);

            string[] shellCandidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\\Chrome\\Application\\chrome.exe")
            };

            foreach (string exe in shellCandidates)
            {
                if (File.Exists(exe))
                {
                    try
                    {
                        ProcessStartInfo appPsi = new ProcessStartInfo();
                        appPsi.FileName = exe;
                        appPsi.Arguments = "--app=\\"" + url + "\\" --user-data-dir=\\"" + uiProfileDir + "\\" --no-first-run --no-default-browser-check --disable-extensions --disable-component-extensions-with-background-pages --disable-features=Translate --window-size=1366,840";
                        appPsi.UseShellExecute = false;
                        return Process.Start(appPsi);
                    }
                    catch { }
                }
            }
        }

        try
        {
            return Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            return null;
        }
    }
}
`;
const uasLauncherCsPath = path.join(projectRoot, "scripts", ".tmp-UasLauncher.cs");
const uasExePath = path.join(releaseRoot, "UAS.exe");
const legacyAppExePath = path.join(appDestDir, "UAS.exe");
if (fs.existsSync(legacyAppExePath)) {
  try { fs.unlinkSync(legacyAppExePath); } catch {}
}
fs.writeFileSync(uasLauncherCsPath, uasLauncherCs, "utf8");

const iconWinPath = path.join(projectRoot, "public", "uas-app.ico");
const cscCandidates = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];
const cscExe = cscCandidates.find((p) => fs.existsSync(p));

try {
  if (cscExe) {
    const iconArg = fs.existsSync(iconWinPath) ? `/win32icon:"${iconWinPath}"` : "";
    execSync(
      `"${cscExe}" /nologo /optimize+ /target:winexe ${iconArg} /out:"${uasExePath}" "${uasLauncherCsPath}"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(
      `powershell -NoProfile -Command "Add-Type -TypeDefinition (Get-Content '${uasLauncherCsPath}' -Raw) -OutputAssembly '${uasExePath}' -OutputType WindowsApplication"`,
      { stdio: "inherit" }
    );
  }
  console.log(`[OK] Compiled silent GUI launcher with brand icon: ${uasExePath}`);
} finally {
  if (fs.existsSync(uasLauncherCsPath)) fs.unlinkSync(uasLauncherCsPath);
}

// ---------------------------------------------------------------------------
// STEP 7: Generate Zero-CLI Batch Launchers (Using UAS.exe & bundled node.exe)
// ---------------------------------------------------------------------------
console.log("\n[Step 7/8] Generating zero-CLI batch launchers (zero npx)...");

// Root launchers pointing to UAS.exe at release root (C:\UAS\UAS.exe)
fs.writeFileSync(
  path.join(releaseRoot, "Start-UAS.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" %*\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(releaseRoot, "Start-UAS-Local.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" --local %*\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(releaseRoot, "Start-UAS-LAN.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0UAS.exe" --lan %*\r\n`,
  "utf8"
);

// Fallback launchers inside app\ subfolder
fs.writeFileSync(
  path.join(appDestDir, "Start-UAS.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\nif exist "%~dp0..\\UAS.exe" ("%~dp0..\\UAS.exe" %*) else ("%~dp0UAS.exe" %*)\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(appDestDir, "Start-UAS-Local.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\nif exist "%~dp0..\\UAS.exe" ("%~dp0..\\UAS.exe" --local %*) else ("%~dp0UAS.exe" --local %*)\r\n`,
  "utf8"
);

fs.writeFileSync(
  path.join(appDestDir, "Start-UAS-LAN.bat"),
  `@echo off\r\ncd /d "%~dp0"\r\nif exist "%~dp0..\\UAS.exe" ("%~dp0..\\UAS.exe" --lan %*) else ("%~dp0UAS.exe" --lan %*)\r\n`,
  "utf8"
);

const uasSetupBat = `@echo off
title UAS Accounting System - Zero-Config Commercial Installer
color 0E

echo ============================================================================
echo    UNIFIED ACCOUNTING SYSTEM (UAS ERP) - ZERO-CONFIG INSTALLER
echo ============================================================================
echo.
echo Installing self-contained runtime to : C:\\UAS
echo Initializing persistent data dir     : C:\\UAS-Data
echo (100%% Offline-Capable - No Node.js, No Prisma CLI, No npx required)
echo.

net session >nul 2>nul
if errorlevel 1 (
    echo [INFO] Requesting Administrator elevation for firewall & shortcuts...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

echo [INFO] Terminating any running UAS processes before upgrade...
taskkill /F /IM UAS.exe >nul 2>nul
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } } catch {}; try { Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -like '*\\UAS\\*') -or (($_.Name -in @('msedgewebview2.exe','msedge.exe','chrome.exe')) -and (($_.CommandLine -like '*\\UAS\\*') -or ($_.CommandLine -like '*UAS.exe.WebView2*') -or ($_.CommandLine -like '*UAS\\EBWebView*') -or ($_.CommandLine -like '*UAS\\ui-profile*'))) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}" >nul 2>nul

if not exist "C:\\UAS" mkdir "C:\\UAS"
if not exist "C:\\UAS\\app" mkdir "C:\\UAS\\app"
if not exist "C:\\UAS-Data" mkdir "C:\\UAS-Data"

echo [1/5] Cleaning stale .next bundle and WebView2 caches, then copying runtime to C:\\UAS...
if exist "C:\\UAS\\app\\.next" rmdir /s /q "C:\\UAS\\app\\.next" >nul 2>nul
if exist "C:\\UAS\\app\\UAS.exe" del /f /q "C:\\UAS\\app\\UAS.exe" >nul 2>nul
if exist "C:\\UAS\\app\\server.js" del /f /q "C:\\UAS\\app\\server.js" >nul 2>nul
if exist "C:\\UAS\\UAS.exe.WebView2" rmdir /s /q "C:\\UAS\\UAS.exe.WebView2" >nul 2>nul
if exist "%LOCALAPPDATA%\\UAS\\EBWebView" rmdir /s /q "%LOCALAPPDATA%\\UAS\\EBWebView" >nul 2>nul
if exist "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Cache" rmdir /s /q "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Cache" >nul 2>nul
if exist "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Code Cache" rmdir /s /q "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Code Cache" >nul 2>nul
if exist "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Service Worker" rmdir /s /q "%LOCALAPPDATA%\\UAS\\ui-profile\\Default\\Service Worker" >nul 2>nul

if exist "%~dp0UAS.exe" (
    copy "%~dp0UAS.exe" "C:\\UAS\\UAS.exe" /Y >nul
)

xcopy "%~dp0app\\*" "C:\\UAS\\app\\" /E /I /Y /Q >nul

if exist "%~dp0QUICK-START-AR-EN.md" (
    copy "%~dp0QUICK-START-AR-EN.md" "C:\\UAS\\" /Y >nul
)
if exist "%~dp0Start-UAS.bat" (
    copy "%~dp0Start-UAS*.bat" "C:\\UAS\\" /Y >nul
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

echo [4/5] Creating Desktop & Start Menu shortcuts pointing to C:\\UAS\\UAS.exe...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $d = [System.Environment]::GetFolderPath('CommonDesktopDirectory'); $s = $ws.CreateShortcut(\\"$d\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\UAS.exe'; $s.WorkingDirectory = 'C:\\UAS'; $s.Save()"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $p = [System.Environment]::GetFolderPath('CommonPrograms'); $dir = \\"$p\\UAS Accounting\\"; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; $s = $ws.CreateShortcut(\\"$dir\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\UAS.exe'; $s.WorkingDirectory = 'C:\\UAS'; $s.Save(); $s2 = $ws.CreateShortcut(\\"$dir\\UAS Local Standalone.lnk\\"); $s2.TargetPath = 'C:\\UAS\\UAS.exe'; $s2.Arguments = '--local'; $s2.WorkingDirectory = 'C:\\UAS'; $s2.Save(); $s3 = $ws.CreateShortcut(\\"$dir\\UAS Office LAN Server.lnk\\"); $s3.TargetPath = 'C:\\UAS\\UAS.exe'; $s3.Arguments = '--lan'; $s3.WorkingDirectory = 'C:\\UAS'; $s3.Save()"

echo.
echo ============================================================================
echo   [5/5] INSTALLATION COMPLETED SUCCESSFULLY!
echo   Double-click \"UAS Accounting System\" on your Desktop to start.
echo ============================================================================
echo.
set /p launchNow="Launch UAS Accounting System now? (Y/N): "
if /i "%launchNow%"=="Y" (
    start "" "C:\\UAS\\UAS.exe"
)
exit /b 0
`;
fs.writeFileSync(path.join(releaseRoot, "UAS-Setup.bat"), uasSetupBat, "utf8");

// ---------------------------------------------------------------------------
// Write clean bilingual QUICK-START-AR-EN.md BEFORE compiling Inno Setup
// ---------------------------------------------------------------------------
const quickStartMd = `# دليل البدء والتشغيل التجاري لمنظومة UAS المحاسبية
# UAS Commercial Distribution & Quick Start Guide (Arabic & English)

مرحباً بك في **منظومة الحسابات الموحدة (UAS Enterprise ERP)**.
هذا الإصدار التجاري يعمل **بشكل مستقل 100% دون الحاجة لتثبيت Node.js أو أي أوامر برمجية أو اتصال بالإنترنت**.

---

## أولاً: التثبيت السريع على ويندوز (Zero-Config Windows Setup)

1. اضغط مرتين على **\`UAS-Setup-Win64.exe\`** (أو **\`UAS-Setup.bat\`**).
2. يقوم المثبت تلقائياً بـ:
   - نسخ المحرك المستقل ومشغل الواجهة المباشر إلى **\`C:\\UAS\\UAS.exe\`** ومحرك التشغيل إلى **\`C:\\UAS\\app\`**.
   - تهيئة قاعدة البيانات الجاهزة مسبقاً (\`template.db\`) في **\`C:\\UAS-Data\\uas-enterprise.db\`** دون المساس ببياناتك السابقة عند التحديث.
   - فتح المنفذ **3000** في جدار حماية ويندوز للشبكة المحلية.
   - إنشاء اختصارات التشغيل المباشر لـ **\`C:\\UAS\\UAS.exe\`** على سطح المكتب وقائمة ابدأ.
3. حتى في حال حذف ملف قاعدة البيانات، تقوم المنظومة تلقائياً بالتهيئة الذاتية (Self-Healing SQLite Bootstrap) عند التشغيل بدون أي أخطاء \`P2021\`.

---

## ثانياً: أوضاع التشغيل الثلاثة (3 Runtime Modes)

- **الجهاز المستقل (Local Standalone):** شغل **\`UAS Accounting System\`** (أو \`UAS.exe --local\`) ← يعمل على \`http://127.0.0.1:3000\`.
- **خادم الشبكة المكتبية (Office LAN Server):** شغل **\`UAS Office LAN Server\`** (أو \`UAS.exe --lan\`) ← يتيح الاتصال من جميع أجهزة الموظفين والهواتف الميدانية عبر \`http://<LAN-IP>:3000\`.
- **السحابي (Cloud):** اتصل مباشرة بـ \`https://qat.world\` أو نطاق شركتك المخصص.

---

## ثالثاً: تفعيل الترخيص المشفر (Ed25519 Activation)

1. عند فتح النظام، انسخ **رمز طلب الترخيص (Machine Request Code)**: \`REQ-XXXX-XXXX-XXXX-XXXX\`.
2. ارفع ملف **\`license.uas\`** مباشرة (تفعيل 100% دون إنترنت) أو أدخل المفتاح التسلسلي (يتحقق عبر \`https://qat.world\`).

---

## English Quick Start Summary

1. **Zero-Config Install:** Double-click \`UAS-Setup-Win64.exe\` (or \`UAS-Setup.bat\`). No Node.js, no Prisma CLI, no \`npx\`, and no internet required.
2. **Pre-Initialized & Self-Healing DB:** A clean, pre-migrated SQLite database (\`template.db\`) is installed to \`C:\\UAS-Data\\uas-enterprise.db\` on first launch. If deleted, the runtime automatically recreates all tables and baseline records on startup with zero \`P2021\` errors.
3. **Launch:** Double-click \`UAS Accounting System\` on the Desktop (\`C:\\UAS\\UAS.exe\`). The standalone desktop window opens directly to Login & Activation.
`;
fs.writeFileSync(path.join(releaseRoot, "QUICK-START-AR-EN.md"), quickStartMd, "utf8");

// Pre-packaging audit gate: ZERO .apk files allowed inside Windows release bundle
const allReleaseFiles = collectFilesRecursive(releaseRoot);
const leakedApks = allReleaseFiles.filter((f) => f.toLowerCase().endsWith(".apk"));
if (leakedApks.length > 0) {
  console.error("[ERROR] Found leaked .apk file(s) inside Windows release bundle:", leakedApks);
  process.exit(1);
}
console.log("[OK] Pre-installer audit passed: zero .apk files inside release/UAS-Commercial-Dist");

// STEP 7: Compile Native Windows Installer (UAS-Setup-Win64.exe)
// ---------------------------------------------------------------------------
console.log("\n[Step 7/7] Compiling Native Windows Installer (UAS-Setup-Win64.exe)...");

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

            // Cleanly terminate running UAS.exe, port 3000 node.exe, or locked WebView2/Edge processes before copying
            RunPowerShell("Stop-Process -Name 'UAS' -Force -ErrorAction SilentlyContinue");
            RunPowerShell("try { Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } } catch {}");
            RunPowerShell("Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -like '*\\\\UAS\\\\*') -or (($_.Name -in @('msedgewebview2.exe','msedge.exe','chrome.exe')) -and (($_.CommandLine -like '*\\\\UAS\\\\*') -or ($_.CommandLine -like '*UAS.exe.WebView2*') -or ($_.CommandLine -like '*UAS\\\\EBWebView*') -or ($_.CommandLine -like '*UAS\\\\ui-profile*'))) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");

            // Remove stale .next bundle, legacy app/UAS.exe, server.js, and WebView2 caches (preserving prisma/dev.db & C:\\UAS-Data)
            string staleNextDir = Path.Combine(targetAppDir, "app", ".next");
            if (Directory.Exists(staleNextDir)) { try { Directory.Delete(staleNextDir, true); } catch { } }
            string staleServerJs = Path.Combine(targetAppDir, "app", "server.js");
            if (File.Exists(staleServerJs)) { try { File.Delete(staleServerJs); } catch { } }
            string staleWebView2 = Path.Combine(targetAppDir, "UAS.exe.WebView2");
            if (Directory.Exists(staleWebView2)) { try { Directory.Delete(staleWebView2, true); } catch { } }
            string localUasDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UAS");
            string staleEbWebView = Path.Combine(localUasDir, "EBWebView");
            if (Directory.Exists(staleEbWebView)) { try { Directory.Delete(staleEbWebView, true); } catch { } }

            string appSourceDir = Path.Combine(currentDir, "app");
            if (Directory.Exists(appSourceDir))
            {
                Console.WriteLine("[2/5] Installing self-contained runtime, Node engine, and Prisma DB engine...");
                CopyDirectory(appSourceDir, Path.Combine(targetAppDir, "app"));
            }

            // Copy root UAS.exe to C:\\UAS\\UAS.exe and remove legacy C:\\UAS\\app\\UAS.exe
            string rootUasExe = Path.Combine(currentDir, "UAS.exe");
            if (File.Exists(rootUasExe))
            {
                File.Copy(rootUasExe, Path.Combine(targetAppDir, "UAS.exe"), true);
            }
            string legacyAppUasExe = Path.Combine(targetAppDir, "app", "UAS.exe");
            if (File.Exists(legacyAppUasExe))
            {
                try { File.Delete(legacyAppUasExe); } catch { }
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

            Console.WriteLine("[4/5] Creating Desktop and Start Menu shortcuts for C:\\\\UAS\\\\UAS.exe...");
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
                string launcher = Path.Combine(targetAppDir, "UAS.exe");
                if (!File.Exists(launcher)) launcher = Path.Combine(targetAppDir, "app", "UAS.exe");
                if (File.Exists(launcher))
                {
                    Process.Start(new ProcessStartInfo(launcher) { WorkingDirectory = targetAppDir, UseShellExecute = true });
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
            "$s.TargetPath = 'C:\\\\UAS\\\\UAS.exe'; " +
            "$s.WorkingDirectory = 'C:\\\\UAS'; " +
            "$s.Save(); " +
            "$programs = [System.Environment]::GetFolderPath('CommonPrograms'); " +
            "$dir = $programs + '\\\\UAS Accounting'; " +
            "if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; " +
            "$s1 = $ws.CreateShortcut($dir + '\\\\UAS Accounting System.lnk'); " +
            "$s1.TargetPath = 'C:\\\\UAS\\\\UAS.exe'; " +
            "$s1.WorkingDirectory = 'C:\\\\UAS'; " +
            "$s1.Save(); " +
            "$s2 = $ws.CreateShortcut($dir + '\\\\UAS Local Standalone.lnk'); " +
            "$s2.TargetPath = 'C:\\\\UAS\\\\UAS.exe'; " +
            "$s2.Arguments = '--local'; " +
            "$s2.WorkingDirectory = 'C:\\\\UAS'; " +
            "$s2.Save(); " +
            "$s3 = $ws.CreateShortcut($dir + '\\\\UAS Office LAN Server.lnk'); " +
            "$s3.TargetPath = 'C:\\\\UAS\\\\UAS.exe'; " +
            "$s3.Arguments = '--lan'; " +
            "$s3.WorkingDirectory = 'C:\\\\UAS'; " +
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

console.log("\n=================================================================");
console.log("   SELF-CONTAINED WINDOWS DESKTOP BUNDLE READY IN:");
console.log(`   ${releaseRoot}`);
console.log("   - UAS.exe (Silent GUI native launcher at root)");
console.log("   - app/.next/static (Verified CSS & JS chunks)");
console.log("   - app/runtime/node.exe (Bundled Node.js engine)");
console.log("   - app/prisma/template.db (Pre-migrated & seeded SQLite DB)");
console.log("   - app/prisma/migrations/ (SQLite DDL migrations)");
console.log("   - app/node_modules/.prisma/client/query_engine-windows.dll.node");
console.log("   - UAS-Setup-Win64.exe & UAS-Setup.bat (Zero .apk files bundled)");
console.log("=================================================================\n");
