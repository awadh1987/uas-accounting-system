$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $RepoRoot) { $RepoRoot = "E:\2026\uas-accounting-system" }
Set-Location $RepoRoot

Write-Host "`n[1/5] Activating JDK 21 for Gradle..." -ForegroundColor Cyan
$jdk21 = (Get-ChildItem "C:\Program Files\Microsoft\jdk-21*", "C:\Program Files\Java\jdk-21*", "C:\Program Files\Eclipse Adoptium\jdk-21*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1).FullName
if (-not $jdk21) {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        $jdk21 = $env:JAVA_HOME
    }
}
if (-not $jdk21) { throw "JDK 21 not found. Please install Microsoft OpenJDK 21 first." }
$env:JAVA_HOME = $jdk21
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
cmd /c "java -version"

Write-Host "`n[2/5] Building Capacitor mobile bundle for https://qat.world..." -ForegroundColor Cyan
Get-ChildItem -Path (Join-Path $RepoRoot "out"), (Join-Path $RepoRoot "android\app\src\main\assets\public") -Filter "*.apk" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
$env:NEXT_PUBLIC_API_BASE_URL = "https://qat.world"
$env:CAPACITOR_SERVER_URL = "https://qat.world"
npm run build:mobile
if ($LASTEXITCODE -ne 0) { throw "npm run build:mobile failed." }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "npx cap sync android failed." }

Write-Host "`n[3/5] Compiling signed release APK..." -ForegroundColor Cyan
Set-Location (Join-Path $RepoRoot "android")
.\gradlew --stop
.\gradlew assembleRelease
if ($LASTEXITCODE -ne 0) {
    Set-Location $RepoRoot
    throw "Gradle assembleRelease failed."
}
Set-Location $RepoRoot

Write-Host "`n[4/5] Copying signed APK to Downloads & Web Endpoint..." -ForegroundColor Cyan
$releaseApk = Join-Path $RepoRoot "android\app\build\outputs\apk\release\app-release.apk"
$destApk = "$HOME\Downloads\UAS-Mobile-Release-qat.world.apk"
Copy-Item $releaseApk $destApk -Force
Write-Host "Saved to: $destApk" -ForegroundColor Green

# Update public/downloads/ endpoint for direct browser & mobile hub downloads
$pubDownloads = Join-Path $RepoRoot "public\downloads"
if (-not (Test-Path $pubDownloads)) { New-Item -ItemType Directory -Path $pubDownloads -Force | Out-Null }
$destPubApk = Join-Path $pubDownloads "uas-latest.apk"
Copy-Item $releaseApk $destPubApk -Force
$apkItem = Get-Item $destPubApk
$versionMeta = @{
    version = "1.0.0"
    versionCode = 1
    appName = "UAS Accounting"
    fileName = "uas-latest.apk"
    fileSize = $apkItem.Length
    fileSizeFormatted = ("{0:N2} MB" -f ($apkItem.Length / 1MB))
    updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    downloadUrl = "/downloads/uas-latest.apk"
} | ConvertTo-Json -Depth 2
Set-Content -Path (Join-Path $pubDownloads "version.json") -Value $versionMeta -Encoding utf8
Write-Host "Updated static endpoint: /downloads/uas-latest.apk ($("{0:N2} MB" -f ($apkItem.Length / 1MB)))" -ForegroundColor Green

Write-Host "`n[5/5] Verifying cryptographic APK signature..." -ForegroundColor Cyan
$apksigner = (Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools\*\apksigner.bat" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
if ($apksigner) {
    & $apksigner verify --verbose --print-certs $destApk
} else {
    Write-Warning "apksigner.bat not found under $env:LOCALAPPDATA\Android\Sdk\build-tools"
}

Start-Process "$HOME\Downloads"
