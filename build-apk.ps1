# ==============================================================================
# UAS Enterprise Accounting System — Android APK Builder (`build-apk.ps1`)
# ==============================================================================
# Builds the Capacitor Android APK (Release if keystore.properties exists,
# otherwise Debug) and copies it into:
#   dist/UAS-USB-Package/Android-Mobile/UAS-Mobile-App.apk
# If local Android SDK platform jars are missing, automatically falls back to
# downloading the compiled APK artifact from GitHub Actions.
# ==============================================================================

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $RepoRoot "android\gradlew.bat"))) {
    $RepoRoot = Resolve-Path (Join-Path $RepoRoot "..\..\..")
}

Set-Location $RepoRoot
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  UAS Android APK Build Automation" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Auto-detect JAVA_HOME (JDK 17+)
$jdkCandidates = @(
    $env:JAVA_HOME,
    "C:\Program Files\Android\Android Studio\jbr"
)
foreach ($pattern in @("C:\Program Files\Microsoft\jdk*", "C:\Program Files\Eclipse Adoptium\jdk*", "C:\Program Files\Java\jdk*")) {
    $found = Get-ChildItem -Path $pattern -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    foreach ($d in $found) { $jdkCandidates += $d.FullName }
}
foreach ($candidate in $jdkCandidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate "bin\java.exe"))) {
        $env:JAVA_HOME = $candidate
        $env:Path = "$candidate\bin;$env:Path"
        break
    }
}

if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    Write-Error "JDK 17+ not found. Please install Microsoft OpenJDK 17 or Android Studio."
    exit 1
}
Write-Host "[OK] Using JAVA_HOME: $env:JAVA_HOME" -ForegroundColor Green

# 2. Check Android SDK & platform android.jar
$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    "$env:LOCALAPPDATA\Android\Sdk",
    "C:\Android\Sdk"
)
foreach ($candidate in $sdkCandidates) {
    if ($candidate -and (Test-Path $candidate)) {
        $env:ANDROID_HOME = $candidate
        $env:ANDROID_SDK_ROOT = $candidate
        break
    }
}

$destDir = Join-Path $RepoRoot "dist\UAS-USB-Package\Android-Mobile"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$destApk = Join-Path $destDir "UAS-Mobile-App.apk"

$hasLocalAndroidJar = $false
if ($env:ANDROID_HOME) {
    $jars = Get-ChildItem -Path (Join-Path $env:ANDROID_HOME "platforms") -Filter "android.jar" -Recurse -ErrorAction SilentlyContinue
    if ($jars) { $hasLocalAndroidJar = $true }
}

if ($hasLocalAndroidJar) {
    Write-Host "[OK] Using Local Android SDK: $env:ANDROID_HOME" -ForegroundColor Green
    $escapedSdk = $env:ANDROID_HOME.Replace("\", "\\").Replace(":", "\:")
    Set-Content -Path (Join-Path $RepoRoot "android\local.properties") -Value "sdk.dir=$escapedSdk" -Encoding UTF8

    Write-Host "`n[1/3] Building Next.js mobile bundle and syncing Capacitor..." -ForegroundColor Yellow
    npm run build:mobile

    Write-Host "`n[2/3] Compiling Android APK via Gradle..." -ForegroundColor Yellow
    Push-Location (Join-Path $RepoRoot "android")
    try {
        if (Test-Path "keystore.properties") {
            .\gradlew.bat assembleRelease --no-daemon
            $apkSource = "app\build\outputs\apk\release\app-release.apk"
        } else {
            .\gradlew.bat assembleDebug --no-daemon
            $apkSource = "app\build\outputs\apk\debug\app-debug.apk"
        }
    } finally {
        Pop-Location
    }

    $fullApkPath = Join-Path $RepoRoot "android\$apkSource"
    Copy-Item -Path $fullApkPath -Destination $destApk -Force
    Write-Host "`n[3/3] APK built locally and copied to: $destApk" -ForegroundColor Green
} else {
    Write-Host "[INFO] Local Android SDK platform (android.jar) is not installed locally." -ForegroundColor Yellow
    Write-Host "[INFO] Downloading latest compiled APK from GitHub Actions cloud build..." -ForegroundColor Cyan

    $credOutput = "protocol=https`nhost=github.com`n`n" | git credential fill
    $tokenLine = ($credOutput -split "`n" | Where-Object { $_ -match "^password=" })
    if (-not $tokenLine) {
        Write-Error "No GitHub credential token found to download cloud APK artifact."
        exit 1
    }
    $token = ($tokenLine -replace "^password=", "").Trim()
    $headers = @{
        Authorization = "Bearer $token"
        Accept = "application/vnd.github+json"
        "User-Agent" = "UAS-Release-Agent"
    }

    $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/awadh1987/uas-accounting-system/actions/runs?status=success&per_page=10" -Headers $headers
    $apkRun = $runs.workflow_runs | Where-Object { $_.name -eq "Build Android APK" -and $_.conclusion -eq "success" } | Select-Object -First 1
    if (-not $apkRun) {
        Write-Error "No completed 'Build Android APK' workflow run found on GitHub Actions."
        exit 1
    }

    Write-Host "[INFO] Found GitHub Actions Run #$($apkRun.id) (commit $($apkRun.head_sha.Substring(0,7)))" -ForegroundColor Cyan
    $artifacts = Invoke-RestMethod -Uri $apkRun.artifacts_url -Headers $headers
    $apkArtifact = $artifacts.artifacts | Where-Object { $_.name -eq "uas-android-debug-apk" } | Select-Object -First 1
    if (-not $apkArtifact) {
        Write-Error "Artifact 'uas-android-debug-apk' not found on Run #$($apkRun.id)."
        exit 1
    }

    $zipTemp = Join-Path $env:TEMP "uas-android-debug-apk.zip"
    $extractTemp = Join-Path $env:TEMP "uas-android-debug-apk-extracted"
    if (Test-Path $zipTemp) { Remove-Item $zipTemp -Force }
    if (Test-Path $extractTemp) { Remove-Item $extractTemp -Recurse -Force }

    Invoke-WebRequest -Uri $apkArtifact.archive_download_url -Headers $headers -OutFile $zipTemp
    Expand-Archive -Path $zipTemp -DestinationPath $extractTemp -Force
    $extractedApk = Get-ChildItem -Path $extractTemp -Filter "*.apk" -Recurse | Select-Object -First 1
    if (-not $extractedApk) {
        Write-Error "No .apk file found inside downloaded artifact archive."
        exit 1
    }

    Copy-Item -Path $extractedApk.FullName -Destination $destApk -Force
    $sizeMb = [Math]::Round((Get-Item $destApk).Length / 1MB, 2)
    Write-Host "[OK] Downloaded compiled Android APK ($sizeMb MB) to: $destApk" -ForegroundColor Green
}
