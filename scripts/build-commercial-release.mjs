import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

console.log("=================================================================");
console.log("   UAS ACCOUNTING SYSTEM - COMMERCIAL DISTRIBUTION PACKAGER     ");
console.log("=================================================================");

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

// 1. Ensure build output exists or trigger build
console.log("\n[Step 1/6] Verifying standalone production build...");
const standaloneDir = path.join(projectRoot, ".next", "standalone");
if (!fs.existsSync(standaloneDir)) {
  console.log("Running npm run build to produce Next.js standalone bundle...");
  execSync("npm run build", { stdio: "inherit", cwd: projectRoot });
} else {
  console.log("[OK] Standalone build found at .next/standalone");
}

// 2. Prepare release directory
const releaseRoot = path.join(projectRoot, "release", "UAS-Commercial-Dist");
const appDestDir = path.join(releaseRoot, "app");
const mobileDestDir = path.join(releaseRoot, "mobile");

console.log(`\n[Step 2/6] Preparing release directory: ${releaseRoot}`);
if (fs.existsSync(releaseRoot)) {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
}
fs.mkdirSync(releaseRoot, { recursive: true });
fs.mkdirSync(appDestDir, { recursive: true });
fs.mkdirSync(mobileDestDir, { recursive: true });

// 3. Copy standalone Next.js server + static assets + public folder
console.log("\n[Step 3/6] Packaging protected runtime (zero raw TypeScript source)...");
// Copy standalone app root files (server.js, node_modules, package.json, etc.)
copyRecursiveSync(standaloneDir, appDestDir);

// Static assets (Next.js requires .next/static inside standalone/.next/static)
const staticSrc = path.join(projectRoot, ".next", "static");
const staticDest = path.join(appDestDir, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyRecursiveSync(staticSrc, staticDest);
}

// Public folder (icons, assets, downloads)
const publicSrc = path.join(projectRoot, "public");
const publicDest = path.join(appDestDir, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursiveSync(publicSrc, publicDest);
}

// Prisma schema + engines + database initializer
const prismaSrc = path.join(projectRoot, "prisma");
const prismaDest = path.join(appDestDir, "prisma");
copyRecursiveSync(prismaSrc, prismaDest);

// Infra SQL policies
const infraSrc = path.join(projectRoot, "infra");
const infraDest = path.join(appDestDir, "infra");
copyRecursiveSync(infraSrc, infraDest);

// 4. Bundle Mobile APK
console.log("\n[Step 4/6] Bundling Android Mobile APK...");
const apkSource = path.join(projectRoot, "public", "downloads", "uas-latest.apk");
const apkDest = path.join(mobileDestDir, "UAS-Accounting.apk");
if (fs.existsSync(apkSource)) {
  fs.copyFileSync(apkSource, apkDest);
  console.log(`[OK] Bundled: ${apkDest} (${(fs.statSync(apkDest).size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  console.warn(`[WARN] Android APK not found at ${apkSource}`);
}

// 5. Generate Launcher Batch Scripts
console.log("\n[Step 5/6] Generating Local, LAN, and Setup Launchers...");

// Start-UAS.bat (Universal Launcher)
const startUasBat = `@echo off
title UAS Accounting System - Production Server
color 0A
cd /d "%~dp0"
set "NODE_ENV=production"
set "PORT=3000"
if not defined DATABASE_URL (
    if exist "C:\\UAS-Data" (
        set "DATABASE_URL=file:C:/UAS-Data/uas-enterprise.db"
    ) else (
        set "DATABASE_URL=file:./prisma/uas-enterprise.db"
    )
)
if exist "C:\\UAS-Data\\uas.runtime.json" (
    powershell -NoProfile -Command "try { $cfg = Get-Content 'C:\\UAS-Data\\uas.runtime.json' | ConvertFrom-Json; if ($cfg.mode -eq 'lan') { exit 2 } } catch {}"
    if errorlevel 2 goto start_lan
)
:start_local
echo Starting UAS Single-PC Standalone Mode...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call node server.js
exit /b 0

:start_lan
echo Starting UAS Office LAN Server Mode...
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call node server.js
exit /b 0
`;
fs.writeFileSync(path.join(appDestDir, "Start-UAS.bat"), startUasBat, "utf8");

// Start-UAS-Local.bat
const startUasLocalBat = `@echo off
title UAS Accounting System - Single PC Local Mode (127.0.0.1:3000)
color 0A
cd /d "%~dp0"
set "NODE_ENV=production"
set "PORT=3000"
set "HOST=127.0.0.1"
if exist "C:\\UAS-Data" (
    set "DATABASE_URL=file:C:/UAS-Data/uas-enterprise.db"
) else (
    set "DATABASE_URL=file:./prisma/uas-enterprise.db"
)
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node server.js
pause
`;
fs.writeFileSync(path.join(appDestDir, "Start-UAS-Local.bat"), startUasLocalBat, "utf8");

// Start-UAS-LAN.bat
const startUasLanBat = `@echo off
title UAS Accounting System - Office LAN Server (0.0.0.0:3000)
color 0B
cd /d "%~dp0"
set "NODE_ENV=production"
set "PORT=3000"
set "HOST=0.0.0.0"
if exist "C:\\UAS-Data" (
    set "DATABASE_URL=file:C:/UAS-Data/uas-enterprise.db"
) else (
    set "DATABASE_URL=file:./prisma/uas-enterprise.db"
)

rem Check / Configure Windows Firewall
netsh advfirewall firewall show rule name="UAS Accounting LAN" >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"UAS Accounting LAN\" dir=in action=allow protocol=TCP localport=3000' -Verb RunAs -WindowStyle Hidden" >nul 2>nul
)

set "LAN_IP=192.168.1.100"
for /f "usebackq delims=" %%I in (\`powershell -NoProfile -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { Write-Output $ip } else { Write-Output '127.0.0.1' }"\`) do set "LAN_IP=%%I"

echo ============================================================================
echo   UAS OFFICE LAN SERVER RUNNING ON: http://%LAN_IP%:3000
echo   Connect other office PCs and Android APK to this address!
echo ============================================================================
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node server.js
pause
`;
fs.writeFileSync(path.join(appDestDir, "Start-UAS-LAN.bat"), startUasLanBat, "utf8");

// 6. Generate UAS-Setup.bat for USB Flash Drive Buyers
const uasSetupBat = `@echo off
title UAS Accounting System - Enterprise Installation & Setup
color 0E

echo ============================================================================
echo    UNIFIED ACCOUNTING SYSTEM (UAS ERP) - COMMERCIAL INSTALLER
echo ============================================================================
echo.
echo Installing UAS Accounting System to: C:\\UAS
echo Initializing persistent enterprise data in: C:\\UAS-Data
echo (Keeping USB drive clean, safe, and reusable)
echo.

rem Check administrative elevation
net session >nul 2>nul
if errorlevel 1 (
    echo [INFO] Requesting Administrator Elevation for system configuration...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

rem 1. Create directories
if not exist "C:\\UAS" mkdir "C:\\UAS"
if not exist "C:\\UAS-Data" mkdir "C:\\UAS-Data"

rem 2. Copy application files from USB drive to C:\\UAS
echo [1/5] Copying runtime files to C:\\UAS...
xcopy "%~dp0app\\*" "C:\\UAS\\app\\" /E /I /Y /Q >nul

if exist "%~dp0mobile" (
    xcopy "%~dp0mobile\\*" "C:\\UAS\\mobile\\" /E /I /Y /Q >nul
)
if exist "%~dp0QUICK-START-AR-EN.md" (
    copy "%~dp0QUICK-START-AR-EN.md" "C:\\UAS\\" /Y >nul
)

rem 3. Copy license if present on USB stick
if exist "%~dp0license.uas" (
    echo [2/5] Installing license file to C:\\UAS-Data\\license.uas...
    copy "%~dp0license.uas" "C:\\UAS-Data\\license.uas" /Y >nul
)

rem 4. Configure Windows Firewall rule for LAN Mode (Port 3000)
echo [3/5] Configuring Windows Defender Firewall rule for port 3000...
powershell -NoProfile -Command "if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null }"

rem 5. Create Desktop and Start Menu Shortcuts
echo [4/5] Creating Desktop & Start Menu Shortcuts...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $d = [System.Environment]::GetFolderPath('CommonDesktopDirectory'); $s = $ws.CreateShortcut(\\"$d\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\app\\Start-UAS.bat'; $s.WorkingDirectory = 'C:\\UAS\\app'; $s.Save()"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $p = [System.Environment]::GetFolderPath('CommonPrograms'); $dir = \\"$p\\UAS Accounting\\"; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; $s = $ws.CreateShortcut(\\"$dir\\UAS Accounting System.lnk\\"); $s.TargetPath = 'C:\\UAS\\app\\Start-UAS.bat'; $s.WorkingDirectory = 'C:\\UAS\\app'; $s.Save(); $s2 = $ws.CreateShortcut(\\"$dir\\UAS Local Standalone.lnk\\"); $s2.TargetPath = 'C:\\UAS\\app\\Start-UAS-Local.bat'; $s2.WorkingDirectory = 'C:\\UAS\\app'; $s2.Save(); $s3 = $ws.CreateShortcut(\\"$dir\\UAS Office LAN Server.lnk\\"); $s3.TargetPath = 'C:\\UAS\\app\\Start-UAS-LAN.bat'; $s3.WorkingDirectory = 'C:\\UAS\\app'; $s3.Save()"

echo.
echo ============================================================================
echo   [5/5] INSTALLATION COMPLETED SUCCESSFULLY!
echo   UAS Accounting System is ready on your Desktop.
echo ============================================================================
echo.
set /p launchNow="Do you want to launch UAS Accounting System now? (Y/N): "
if /i "%launchNow%"=="Y" (
    start "" "C:\\UAS\\app\\Start-UAS.bat"
)
exit /b 0
`;
fs.writeFileSync(path.join(releaseRoot, "UAS-Setup.bat"), uasSetupBat, "utf8");

// 7. Compile Native Windows Installer UAS-Setup-Win64.exe
console.log("\n[Step 6/6] Compiling Native Windows Installer (UAS-Setup-Win64.exe)...");
const csharpInstallerSource = `
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

public class UasSetup
{
    public static void Main(string[] args)
    {
        Console.Title = "UAS Accounting System - Enterprise Installer (Win64)";
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("==================================================================");
        Console.WriteLine("      UAS ACCOUNTING SYSTEM - COMMERCIAL INSTALLER (WIN64)        ");
        Console.WriteLine("==================================================================");
        Console.ResetColor();
        Console.WriteLine();

        string currentDir = AppDomain.CurrentDomain.BaseDirectory;
        string targetAppDir = @"C:\\UAS";
        string targetDataDir = @"C:\\UAS-Data";

        try
        {
            Console.WriteLine("[1/5] Creating application directories: C:\\\\UAS and C:\\\\UAS-Data...");
            if (!Directory.Exists(targetAppDir)) Directory.CreateDirectory(targetAppDir);
            if (!Directory.Exists(targetDataDir)) Directory.CreateDirectory(targetDataDir);

            string appSourceDir = Path.Combine(currentDir, "app");
            if (Directory.Exists(appSourceDir))
            {
                Console.WriteLine("[2/5] Installing Next.js standalone runtime and assets to C:\\\\UAS\\\\app...");
                CopyDirectory(appSourceDir, Path.Combine(targetAppDir, "app"));
            }

            string mobileSourceDir = Path.Combine(currentDir, "mobile");
            if (Directory.Exists(mobileSourceDir))
            {
                CopyDirectory(mobileSourceDir, Path.Combine(targetAppDir, "mobile"));
            }

            string licenseSource = Path.Combine(currentDir, "license.uas");
            if (File.Exists(licenseSource))
            {
                File.Copy(licenseSource, Path.Combine(targetDataDir, "license.uas"), true);
                Console.WriteLine("[OK] Cryptographic license file bound to C:\\\\UAS-Data\\\\license.uas");
            }

            Console.WriteLine("[3/5] Configuring Windows Defender Firewall inbound rule (Port 3000)...");
            RunPowerShell("if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null }");

            Console.WriteLine("[4/5] Creating Desktop and Start Menu Shortcuts...");
            CreateShortcuts(targetAppDir);

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine();
            Console.WriteLine("==================================================================");
            Console.WriteLine("  INSTALLATION COMPLETE! UAS Accounting System is ready to run.   ");
            Console.WriteLine("==================================================================");
            Console.ResetColor();

            Console.Write("\\nLaunch UAS Accounting System now? (Y/N): ");
            string key = Console.ReadLine();
            if (key != null && key.Trim().Equals("Y", StringComparison.OrdinalIgnoreCase))
            {
                string launcher = Path.Combine(targetAppDir, "app", "Start-UAS.bat");
                if (File.Exists(launcher))
                {
                    Process.Start(new ProcessStartInfo(launcher) { WorkingDirectory = Path.Combine(targetAppDir, "app") });
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

    private static void CreateShortcuts(string targetAppDir)
    {
        string ps = @"
$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('CommonDesktopDirectory')
$s = $ws.CreateShortcut(\\""$desktop\\\\UAS Accounting System.lnk\\"")
$s.TargetPath = 'C:\\\\UAS\\\\app\\\\Start-UAS.bat'
$s.WorkingDirectory = 'C:\\\\UAS\\\\app'
$s.Save()

$programs = [System.Environment]::GetFolderPath('CommonPrograms')
$dir = \\""$programs\\\\UAS Accounting\\\\""
if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$s1 = $ws.CreateShortcut(\\""$dir\\\\UAS Accounting System.lnk\\"")
$s1.TargetPath = 'C:\\\\UAS\\\\app\\\\Start-UAS.bat'
$s1.WorkingDirectory = 'C:\\\\UAS\\\\app'
$s1.Save()
";
        RunPowerShell(ps);
    }
}
`;

const csTempPath = path.join(projectRoot, "scripts", "UasSetup.cs");
fs.writeFileSync(csTempPath, csharpInstallerSource, "utf8");

const exeReleasePath = path.join(releaseRoot, "UAS-Setup-Win64.exe");
const exeDownloadsPath = path.join(projectRoot, "public", "downloads", "UAS-Setup-Win64.exe");

try {
  const compileCmd = `powershell -NoProfile -Command "Add-Type -TypeDefinition (Get-Content '${csTempPath}' -Raw) -OutputAssembly '${exeReleasePath}' -OutputType ConsoleApplication"`;
  execSync(compileCmd, { stdio: "inherit" });
  fs.copyFileSync(exeReleasePath, exeDownloadsPath);
  console.log(`[OK] Native 64-bit installer compiled: ${exeReleasePath}`);
  console.log(`[OK] Copied installer to web downloads: ${exeDownloadsPath}`);
} catch (e) {
  console.error("[WARN] C# compiler failed:", e?.message);
} finally {
  if (fs.existsSync(csTempPath)) fs.unlinkSync(csTempPath);
}

// 8. Generate Bilingual QUICK-START-AR-EN.md
const quickStartMd = `# دليل البدء والتشغيل التجاري لمنظومة UAS المحاسبية
# UAS Commercial Distribution & Quick Start Guide (Arabic & English)

مرحباً بك في **منظومة الحسابات الموحدة (UAS Enterprise ERP)**.
يدعم هذا الإصدار التجاري كلاً من **مشتري وحدات الفلاش ميموري (USB Flash Drive)** و**التنزيل المباشر من منصة https://qat.world**.

---

## أولاً: التثبيت السريع على ويندوز (Windows Desktop & LAN Setup)

### 1. خطوات التثبيت (Installation Steps):
1. قم بتشغيل مثبت النظام:
   - اضغط مرتين على **\`UAS-Setup-Win64.exe\`** (أو قم بتشغيل **\`UAS-Setup.bat\`**).
2. سيقوم المثبت تلقائياً بـ:
   - نسخ المنظومة والمحرك إلى المجلد الدائم **\`C:\\UAS\`**.
   - تهيئة قاعدة البيانات والتراخيص في **\`C:\\UAS-Data\`** (للحفاظ على الفلاش ميموري USB للقراءة فقط وحمايتها).
   - إضافة استثناء بجدار حماية ويندوز (Windows Firewall) للمنفذ **3000**.
   - إنشاء اختصارات التشغيل على **سطح المكتب** وقائمة **ابدأ (Start Menu)**.

### 2. أوضاع التشغيل الثلاثة (3 Runtime Modes):
- **وضع الجهاز المستقل (Local Single PC):**
  - شغل **\`UAS Local Standalone\`** من سطح المكتب.
  - يعمل محلياً على \`http://localhost:3000\` بقاعدة بيانات محلية سريعة.
- **وضع خادم الشبكة المحلية (Office LAN Server):**
  - شغل **\`UAS Office LAN Server\`** على الجهاز الرئيسي بالشركة.
  - يربط جميع أجهزة الموظفين وتطبيقات الهواتف الميدانية عبر عنوان الشبكة (مثل \`http://192.168.1.50:3000\`).
- **الوضع السحابي (Cloud Hosted):**
  - الاتصال مباشرة بالنطاق السحابي للمؤسسة (\`https://qat.world\` أو الدومين المخصص).

---

## ثانياً: تفعيل الترخيص المشفر (Ed25519 Cryptographic Activation)

1. عند تشغيل المنظومة لأول مرة، ستظهر نافذة **تفعيل الترخيص وإدارة بيئة التشغيل**.
2. انسخ **رمز طلب الترخيص (Machine Request Code)** المكون من 16 حرفاً (\`REQ-XXXX-XXXX-XXXX-XXXX\`).
3. أرسل الرمز للبائع أو عبر رابط الواتساب المباشر في النافذة.
4. بمجرد استلام ملف الترخيص **\`license.uas\`**:
   - اضغط على **رفع ملف الترخيص (Upload .uas)**، أو انسخ ملف \`license.uas\` مباشرة إلى \`C:\\UAS-Data\\license.uas\`.
   - أو أدخل **المفتاح التسلسلي الرقمي** (\`UASKEY-...\`) واضغط **تفعيل**.

> [!NOTE]
> نظام الترخيص محمي ببصمة العتاد (Motherboard UUID + CPU + OS MachineGuid) وخوارزمية التشفير الرقمي Ed25519 مع قفل مانع للتلاعب بتاريخ وساعة النظام (Anti-Clock-Rollback Lock).

---

## ثالثاً: تطبيق الهاتف الذكي الميداني (Android Mobile APK)

1. الملف متوفر داخل مجلد **\`mobile/UAS-Accounting.apk\`** وعلى الموقع \`https://qat.world/downloads/uas-latest.apk\`.
2. ثبت التطبيق على هواتف مندوبي المبيعات والمحصلين.
3. في شاشة تسجيل الدخول بالتطبيق:
   - اضغط على **"وضع الاتصال بالخادم (LAN / Cloud)"**.
   - أدخل عنوان IP لخادم المكتب (مثل \`http://192.168.1.50:3000\`) أو اختر السحابة (\`https://qat.world\`).

---

## English Quick Start Summary

1. **Install:** Double-click \`UAS-Setup-Win64.exe\` or run \`UAS-Setup.bat\`. The system installs to \`C:\\UAS\` with persistent user data in \`C:\\UAS-Data\`.
2. **License Activation:** Launch the app, copy your 16-character **Machine Request Code** (\`REQ-XXXX-XXXX-XXXX-XXXX\`), and upload the received signed \`license.uas\` file or enter your activation key.
3. **Office LAN:** Run \`UAS Office LAN Server\` to allow colleagues and Android mobile apps to connect via \`http://<LAN-IP>:3000\`.
4. **Android APK:** Install \`mobile/UAS-Accounting.apk\` and configure your office LAN IP or cloud server in the login screen.
`;

fs.writeFileSync(path.join(releaseRoot, "QUICK-START-AR-EN.md"), quickStartMd, "utf8");

console.log("\n=================================================================");
console.log("   COMMERCIAL DISTRIBUTION BUNDLE READY IN:                     ");
console.log(`   ${releaseRoot}`);
console.log("=================================================================\n");
