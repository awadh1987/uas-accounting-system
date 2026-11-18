; ==============================================================================
; Unified Accounting System (UAS Enterprise ERP) - Inno Setup 6 Script
; Generates: UAS-Setup-Win64.exe (100% Zero-Config, Offline-Capable Windows App)
; Targets: Windows 10, Windows 11, Windows Server 2019/2022/2025 (x64)
; ==============================================================================

#define MyAppName "UAS Accounting System"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "UAS ERP Enterprise"
#define MyAppURL "https://qat.world"
#define MyAppExeName "UAS.exe"

[Setup]
AppId={{E6F7A9C1-4D3B-4E28-8C91-72A8B3C4D5E6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\UAS
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\..\public\downloads
OutputBaseFilename=UAS-Setup-Win64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\..\public\uas-app.ico
UninstallDisplayIcon={app}\app\public\uas-app.ico
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Compiled desktop launcher installed directly at root {app}\UAS.exe
Source: "..\..\release\UAS-Commercial-Dist\UAS.exe"; DestDir: "{app}"; Flags: ignoreversion
; Self-contained Windows standalone Next.js runtime + bundled node.exe + Prisma engine + template.db + migrations
Source: "..\..\release\UAS-Commercial-Dist\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; Explicitly guarantee dot-directory .next (including .next\static CSS/JS chunks) is always packaged cleanly
Source: "..\..\release\UAS-Commercial-Dist\app\.next\*"; DestDir: "{app}\app\.next"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\release\UAS-Commercial-Dist\QUICK-START-AR-EN.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\release\UAS-Commercial-Dist\UAS-Setup.bat"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; Clean up stale compiled Next.js build artifacts, legacy launchers, and WebView2/UI browser caches before extracting new files
; (Preserves {app}\app\prisma\dev.db, C:\UAS-Data\uas-enterprise.db, license.uas, and all customer backups)
Type: filesandordirs; Name: "{app}\app\.next"
Type: files; Name: "{app}\app\UAS.exe"
Type: files; Name: "{app}\app\server.js"
Type: filesandordirs; Name: "{app}\UAS.exe.WebView2"
Type: filesandordirs; Name: "{localappdata}\UAS\EBWebView"
Type: filesandordirs; Name: "{localappdata}\UAS\ui-profile\Default\Cache"
Type: filesandordirs; Name: "{localappdata}\UAS\ui-profile\Default\Code Cache"
Type: filesandordirs; Name: "{localappdata}\UAS\ui-profile\Default\Service Worker"

[Icons]
Name: "{autoprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\UAS.exe"; IconFilename: "{app}\app\public\uas-app.ico"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\UAS Local Standalone"; Filename: "{app}\UAS.exe"; Parameters: "--local"; IconFilename: "{app}\app\public\uas-app.ico"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\UAS Office LAN Server"; Filename: "{app}\UAS.exe"; Parameters: "--lan"; IconFilename: "{app}\app\public\uas-app.ico"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\UAS.exe"; IconFilename: "{app}\app\public\uas-app.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Initialize C:\UAS-Data, copy pre-initialized template.db if customer DB does not exist, and configure Windows Firewall for LAN mode
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if (!(Test-Path 'C:\UAS-Data')) {{ New-Item -ItemType Directory -Path 'C:\UAS-Data' -Force | Out-Null }; if (!(Test-Path 'C:\UAS-Data\uas-enterprise.db') -and (Test-Path '{app}\app\prisma\template.db')) {{ Copy-Item '{app}\app\prisma\template.db' 'C:\UAS-Data\uas-enterprise.db' -Force }; if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) {{ New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any | Out-Null }"""; Flags: runhidden
Filename: "{app}\UAS.exe"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
procedure StopRunningUasProcesses();
var
  ResultCode: Integer;
  PsCmd: String;
begin
  { 1. Terminate any running UAS.exe launcher }
  Exec('taskkill.exe', '/F /IM UAS.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { 2. Terminate any node.exe listening on port 3000, any process running from *\UAS\*, and any msedgewebview2/edge/chrome process locked on UAS }
  PsCmd :=
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'try { Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq ''node'') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } } catch {}; ' +
    'try { Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -like ''*\UAS\*'') -or (($_.Name -in @(''msedgewebview2.exe'',''msedge.exe'',''chrome.exe'')) -and (($_.CommandLine -like ''*\UAS\*'') -or ($_.CommandLine -like ''*UAS.exe.WebView2*'') -or ($_.CommandLine -like ''*UAS\EBWebView*'') -or ($_.CommandLine -like ''*UAS\ui-profile*''))) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}"';
  Exec('powershell.exe', PsCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function InitializeSetup(): Boolean;
begin
  StopRunningUasProcesses();
  Sleep(500);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { Extra safeguard immediately before [InstallDelete] and file extraction }
  StopRunningUasProcesses();
  Sleep(400);
  Result := '';
end;
