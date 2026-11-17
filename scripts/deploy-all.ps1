param(
    [string]$TargetDomain = "qat.world",
    [string]$RemoteUser = "root",
    [string]$RemoteAppDir = "/var/www/uas-qat",
    [string]$LanServerIP = "",
    [switch]$SkipUsb,
    [switch]$SkipLan,
    [switch]$SkipCloud
)

$ErrorActionPreference = "Stop"

$ProjectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    throw "Invalid ProjectRoot resolved: $ProjectRoot"
}

$DistDir = Join-Path $ProjectRoot "release\UAS-Commercial-Dist"
$PublicDownloadsDir = Join-Path $ProjectRoot "public\downloads"

$InstallerLocal = Join-Path $PublicDownloadsDir "UAS-Setup-Win64.exe"
$ApkCanonicalLocal = Join-Path $PublicDownloadsDir "uas-latest.apk"
if (-not (Test-Path $ApkCanonicalLocal)) {
    $ApkCanonicalLocal = Join-Path $DistDir "mobile\UAS-Accounting.apk"
}

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "       UAS ENTERPRISE MULTI-TARGET DEPLOYMENT" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------
# [1/3] USB Flash Drive Deployment (BusType = USB)
# ---------------------------------------------------------
Write-Host "[1/3] Scanning for USB Flash Drive (BusType -eq 'USB')..." -ForegroundColor Yellow
if ($SkipUsb) {
    Write-Host "-> -SkipUsb specified. Skipping USB deployment." -ForegroundColor DarkGray
} else {
    $usbDisks = Get-Disk | Where-Object { $_.BusType -eq 'USB' -and $_.OperationalStatus -eq 'Online' }
    if (-not $usbDisks) {
        Write-Warning "No online USB disk detected (BusType = USB). Skipping USB deployment."
    } else {
        $copiedAnyUsb = $false
        foreach ($disk in $usbDisks) {
            $part = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue |
                    Where-Object { $_.Type -ne 'Reserved' } |
                    Select-Object -Last 1

            if ($part -and -not $part.DriveLetter) {
                try {
                    $part | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction Stop
                    $part = Get-Partition -DiskNumber $disk.Number | Where-Object { $_.DriveLetter } | Select-Object -First 1
                } catch {
                    Write-Warning "USB Disk $($disk.Number) ($($disk.FriendlyName)) has an unmounted partition; run PowerShell as Administrator to auto-assign a drive letter."
                }
            }

            if ($part -and $part.DriveLetter) {
                $usbRoot = "$($part.DriveLetter):\"
                Write-Host "-> Detected USB Drive: $($disk.FriendlyName) at $usbRoot" -ForegroundColor Green
                Copy-Item "$DistDir\*" $usbRoot -Recurse -Force
                Write-Host "-> Synced commercial bundle to $usbRoot" -ForegroundColor Green
                $copiedAnyUsb = $true
            } else {
                Write-Warning "USB Disk $($disk.Number) ($($disk.FriendlyName)) has no formatted partition/drive letter. Format or assign a letter first."
            }
        }
        if (-not $copiedAnyUsb) {
            Write-Warning "USB deployment skipped because no mounted USB volume was available."
        }
    }
}
Write-Host ""

# ---------------------------------------------------------
# [2/3] Office LAN Deployment
# ---------------------------------------------------------
Write-Host "[2/3] Office LAN Deployment..." -ForegroundColor Yellow
if ($SkipLan -or [string]::IsNullOrWhiteSpace($LanServerIP)) {
    Write-Host "-> No LAN server IP specified. Skipping LAN sync (use -LanServerIP 192.168.1.X)." -ForegroundColor DarkGray
} else {
    Write-Host "-> Syncing standalone release bundle to LAN server $LanServerIP..." -ForegroundColor Green
    $lanShare = "\\$LanServerIP\UAS-Deploy"
    if (Test-Path $lanShare) {
        Copy-Item "$DistDir\*" $lanShare -Recurse -Force
        Write-Host "-> LAN share $lanShare updated successfully." -ForegroundColor Green
    } else {
        Write-Warning "LAN share $lanShare is not reachable. Ensure SMB share 'UAS-Deploy' is enabled on $LanServerIP."
    }
}
Write-Host ""

# ---------------------------------------------------------
# [3/3] Cloud Production Server Deployment
# ---------------------------------------------------------
Write-Host "[3/3] Cloud Production Server Deployment..." -ForegroundColor Yellow
if ($SkipCloud) {
    Write-Host "-> -SkipCloud specified. Skipping cloud deployment." -ForegroundColor DarkGray
} else {
    if (-not (Test-Path $InstallerLocal)) {
        throw "Windows installer not found at $InstallerLocal. Run 'npm run release:build' first."
    }
    if (-not (Test-Path $ApkCanonicalLocal)) {
        throw "Signed Android APK not found at $ApkCanonicalLocal."
    }

    $RemoteDownloadsDir = "$RemoteAppDir/public/downloads"
    $TargetHost = "$RemoteUser@$TargetDomain"

    Write-Host "-> Connecting to target cloud host: $TargetHost ($RemoteDownloadsDir)..." -ForegroundColor Cyan
    ssh $TargetHost "mkdir -p '$RemoteDownloadsDir'"

    Write-Host "-> Uploading Windows installer (UAS-Setup-Win64.exe) to $TargetDomain..." -ForegroundColor Cyan
    scp $InstallerLocal "${TargetHost}:${RemoteDownloadsDir}/UAS-Setup-Win64.exe"

    Write-Host "-> Uploading signed Android APK to $TargetDomain..." -ForegroundColor Cyan
    scp $ApkCanonicalLocal "${TargetHost}:${RemoteDownloadsDir}/uas-latest.apk"

    Write-Host "-> Synchronizing all APK filenames, permissions, and restarting uas-qat.service..." -ForegroundColor Cyan
    $remoteCmd = "cp -f '$RemoteDownloadsDir/uas-latest.apk' '$RemoteDownloadsDir/UAS-Accounting.apk' && cp -f '$RemoteDownloadsDir/uas-latest.apk' '$RemoteDownloadsDir/UAS-Mobile-Release-qat.world.apk' && chown -R www-data:www-data '$RemoteDownloadsDir' && chmod 644 '$RemoteDownloadsDir'/* && systemctl restart uas-qat"
    ssh $TargetHost $remoteCmd

    Write-Host "-> Cloud server $TargetDomain successfully updated and synced!" -ForegroundColor Green
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "       DEPLOYMENT COMPLETED SUCCESSFULLY ACROSS ALL TARGETS" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
