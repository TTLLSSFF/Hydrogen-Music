$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$previousJava = $env:JAVA_HOME
$previousSdk = $env:ANDROID_HOME
try {
    if ($env:HYDROGEN_JAVA_HOME) {
        $env:JAVA_HOME = $env:HYDROGEN_JAVA_HOME
    } else {
        $jbr = Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'
        if (Test-Path "$jbr\bin\java.exe") { $env:JAVA_HOME = $jbr }
    }
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    }
    if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw 'Set HYDROGEN_JAVA_HOME to a JDK 21 installation.' }
    & "$env:JAVA_HOME\bin\java.exe" -version
    Push-Location $root
    try {
        & npm.cmd run build -- --mode android
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
        & npx.cmd cap sync android
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
        $gradle = "$root\android\gradlew.bat"
        if ($env:HYDROGEN_GRADLE_HOME) {
            $gradle = Join-Path $env:HYDROGEN_GRADLE_HOME 'bin\gradle.bat'
            if (-not (Test-Path $gradle)) { throw 'HYDROGEN_GRADLE_HOME must point to an installed Gradle distribution.' }
        }
        & $gradle -p "$root\android" assembleDebug --console=plain --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed.' }
        Write-Host 'Android validation build: android/app/build/outputs/apk/debug/app-debug.apk bundles local assets and calls the public HTTPS gateway. Login is allowed over HTTPS.'
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousSdk
}
