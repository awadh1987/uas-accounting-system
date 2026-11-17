<#
.SYNOPSIS
UAS Accounting System - Multi-Target Deployment & Distribution Script
Deploys commercial deliverables and customer licenses to USB, LAN, and any Cloud target.
.DESCRIPTION
1. Detects connected USB flash drives and deploys retail packages & licenses.
2. Syncs/copies deliverables and licenses to an office LAN server via SMB.
3. Uploads and deploys updates to "any" custom cloud production server domain provided by the customer.
#>

param(
    [string]$LanServerIP = "",
    [string]$TargetDomain = "",          # e.g., "customerdomain.com" or "199.247.0.53"
    [string]$SshUser = "root",            # SSH username for remote server
    [int]$RemotePort = 3000,              # Target web application port
    [switch]$SkipCloud,
    [switch]$SkipLan,
    [switch]$SkipUsb
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$RootDir\release\UAS-Commercial-Dist")) {
    $RootDir = "E:\2026\uas-accounting-system"
}

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "       UAS ENTERPRISE MULTI-TARGET DEPLOYMENT          " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# TARGET 1: PHYSICAL USB FLASH DRIVE
# ---------------------------------------------------------------------------
if (-not $SkipUsb) {
    Write-Host "`n[1/3] Scanning for Removable USB Flash Drive..." -ForegroundColor Yellow
    $usbDrive = Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter -ne $null } | Select-Object -ExpandProperty DriveLetter -First 1

    if (-not $usbDrive) {
        Write-Warning "No removable USB drive detected. Skipping USB deployment."
    } else {
        $usbTarget = "${usbDrive}:\"
        Write-Host "-> Found USB Drive at: $usbTarget" -ForegroundColor Green

        Copy-Item -Path "$RootDir\release\UAS-Commercial-Dist\*" -Destination $usbTarget -Recurse -Force
        
        $usbIssued = "${usbTarget}issued-licenses"
        if (-not (Test-Path $usbIssued)) { New-Item -ItemType Directory -Path $usbIssued | Out-Null }
        Copy-Item -Path "$RootDir\issued\*.uas" -Destination $usbIssued -Force

        Write-Host "-> USB Flash Drive successfully updated!" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# TARGET 2: OFFICE LAN SERVER / CLIENT SHARE
# ---------------------------------------------------------------------------
if (-not $SkipLan) {
    Write-Host "`n[2/3] Office LAN Deployment..." -ForegroundColor Yellow
    if ([string]::IsNullOrEmpty($LanServerIP)) {
        Write-Host "-> No LAN server IP specified. Skipping LAN sync (use -LanServerIP 192.168.1.X)." -ForegroundColor DarkGray
    } else {
        Write-Host "-> Syncing release deliverables to LAN server at $LanServerIP..." -ForegroundColor Cyan
        $lanShare = "\\$LanServerIP\UAS-Share"
        if (Test-Path $lanShare) {
            Copy-Item -Path "$RootDir\release\UAS-Commercial-Dist\*" -Destination $lanShare -Recurse -Force
            Copy-Item -Path "$RootDir\issued\*.uas" -Destination "$lanShare\licenses" -Force
            Write-Host "-> Office LAN share successfully updated at $lanShare" -ForegroundColor Green
        } else {
            Write-Warning "LAN share path $lanShare is not accessible. Check network connectivity."
        }
    }
}

# ---------------------------------------------------------------------------
# TARGET 3: CUSTOM CLOUD PRODUCTION SERVER (Any Domain / IP)
# ---------------------------------------------------------------------------
if (-not $SkipCloud) {
    Write-Host "`n[3/3] Cloud Production Server Deployment..." -ForegroundColor Yellow
    if ([string]::IsNullOrEmpty($TargetDomain)) {
        Write-Host "-> No TargetDomain specified. Skipping cloud deployment (use -TargetDomain 'clientdomain.com')." -ForegroundColor DarkGray
    } else {
        $remoteTarget = "${SshUser}@${TargetDomain}"
        Write-Host "-> Connecting to target cloud host: $remoteTarget..." -ForegroundColor Cyan

        # 1. Ensure remote downloads directory exists and upload files
        Write-Host "-> Uploading Windows installer and Android APK to $TargetDomain..." -ForegroundColor Cyan
        ssh $remoteTarget "mkdir -p /var/www/uas-qat/public/downloads"
        scp "$RootDir\release\UAS-Commercial-Dist\UAS-Setup-Win64.exe" "${remoteTarget}:/var/www/uas-qat/public/downloads/UAS-Setup-Win64.exe"
        scp "$RootDir\release\UAS-Commercial-Dist\mobile\UAS-Accounting.apk" "${remoteTarget}:/var/www/uas-qat/public/downloads/uas-latest.apk"

        # 2. Set ownership and restart service
        Write-Host "-> Updating permissions and restarting remote service on $TargetDomain..." -ForegroundColor Cyan
        ssh $remoteTarget "chown -R www-data:www-data /var/www/uas-qat/public/downloads && systemctl restart uas-qat"

        Write-Host "-> Cloud server $TargetDomain successfully updated and synced!" -ForegroundColor Green
    }
}

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "       DEPLOYMENT COMPLETED SUCCESSFULLY ACROSS ALL TARGETS" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan