; ==============================================================================
; Unified Accounting System (UAS Enterprise ERP) - Inno Setup 6 Script
; Generates: UAS-Setup-Win64.exe
; Targets: Windows 10, Windows 11, Windows Server 2019/2022/2025 (x64)
; ==============================================================================

#define MyAppName "UAS Accounting System"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "UAS ERP Enterprise"
#define MyAppURL "https://qat.world"
#define MyAppExeName "Start-UAS.bat"

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
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Copy compiled standalone Next.js app + node runtime
Source: "..\..\release\UAS-Commercial-Dist\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\release\UAS-Commercial-Dist\mobile\*"; DestDir: "{app}\mobile"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\release\UAS-Commercial-Dist\QUICK-START-AR-EN.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\release\UAS-Commercial-Dist\UAS-Setup.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\app\Start-UAS.bat"; WorkingDir: "{app}\app"
Name: "{autoprograms}\{#MyAppName}\UAS Local Standalone"; Filename: "{app}\app\Start-UAS-Local.bat"; WorkingDir: "{app}\app"
Name: "{autoprograms}\{#MyAppName}\UAS Office LAN Server"; Filename: "{app}\app\Start-UAS-LAN.bat"; WorkingDir: "{app}\app"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\app\Start-UAS.bat"; WorkingDir: "{app}\app"; Tasks: desktopicon

[Run]
; Initialize C:\UAS-Data and add Windows Firewall rule for LAN mode
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if (!(Test-Path 'C:\UAS-Data')) {{ New-Item -ItemType Directory -Path 'C:\UAS-Data' -Force }; if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) {{ New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any }"""; Flags: runhidden
Filename: "{app}\app\Start-UAS.bat"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent
