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
; Clean up any legacy {app}\app\UAS.exe binary from older installs so two .exe launchers can never coexist
Type: files; Name: "{app}\app\UAS.exe"

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
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  { Cleanly terminate any running UAS.exe or background node.exe process before copying files }
  Exec('taskkill.exe', '/F /IM UAS.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like ''*\\UAS\\*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Extra safeguard immediately before file extraction }
  Exec('taskkill.exe', '/F /IM UAS.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(300);
  Result := '';
end;
