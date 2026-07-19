[CmdletBinding()]
param(
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss"),
  [string]$MockOrigin = "http://127.0.0.1:18888",
  [switch]$AllowDeepSeekSmoke,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$templateConfigPath = Join-Path $PSScriptRoot "tauri.qa.conf.json"
$templateConfig = Get-Content -LiteralPath $templateConfigPath -Raw | ConvertFrom-Json

if ($templateConfig.productName -ne "Daymark QA" -or $templateConfig.identifier -ne "com.szywah.daymark.qa") {
  throw "QA Tauri configuration identity check failed."
}

$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "work\qa"))
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $qaRoot $RunId))
if (-not $runRoot.StartsWith($qaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "QA run directory must stay inside work/qa."
}

$mockUri = $null
if (-not [System.Uri]::TryCreate($MockOrigin, [System.UriKind]::Absolute, [ref]$mockUri)) {
  throw "MockOrigin must be an absolute loopback origin."
}
if ($mockUri.Scheme -notin @("http", "https") -or
    $mockUri.Host -notin @("127.0.0.1", "localhost", "::1") -or
    $mockUri.AbsolutePath -ne "/" -or
    $mockUri.Query -or
    $mockUri.Fragment -or
    $mockUri.UserInfo) {
  throw "MockOrigin must be an exact http(s) loopback origin without path, query, fragment, or user info."
}
$normalizedMockOrigin = $mockUri.GetLeftPart([System.UriPartial]::Authority)

$productionProcesses = @(Get-Process -Name "Daymark" -ErrorAction SilentlyContinue)
if ($productionProcesses.Count -gt 0) {
  throw "Production Daymark is running. Stop it before starting destructive QA scenarios."
}

$profileRoot = Join-Path $runRoot "profile"
$webviewRoot = Join-Path $runRoot "webview-data"
$logsRoot = Join-Path $runRoot "native-logs"
New-Item -ItemType Directory -Force -Path $profileRoot, $webviewRoot, $logsRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $profileRoot ".codex"), (Join-Path $profileRoot ".claude") | Out-Null

$qaWindow = @($templateConfig.app.windows)[0]
if ($qaWindow.title -ne "Daymark QA") {
  throw "QA window title check failed."
}
$qaWindow.dataDirectory = $webviewRoot
$generatedConfigPath = Join-Path $runRoot "tauri.generated.conf.json"
$generatedConfigJson = $templateConfig | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText(
  $generatedConfigPath,
  $generatedConfigJson,
  (New-Object System.Text.UTF8Encoding($false))
)

# The security contract is verified by executable Rust and Node tests, not by
# searching source text for a credential-service literal. Neither check opens
# Credential Manager, starts Tauri, or sends a network request.
Push-Location $repoRoot
try {
  & cargo test --manifest-path src-tauri/Cargo.toml ai_security::tests --lib
  if ($LASTEXITCODE -ne 0) { throw "Rust QA security preflight failed." }
  & node qa/test-security-regression.mjs
  if ($LASTEXITCODE -ne 0) { throw "Playwright environment whitelist preflight failed." }
} finally {
  Pop-Location
}

$env:USERPROFILE = $profileRoot
$env:HOME = $profileRoot
$env:WEBVIEW2_USER_DATA_FOLDER = $webviewRoot
$env:DAYMARK_QA_RUN_ID = $RunId
$env:DAYMARK_QA_RUN_DIR = $runRoot
$env:DAYMARK_QA_MOCK_ORIGIN = $normalizedMockOrigin
$env:DAYMARK_QA_ALLOW_DEEPSEEK_SMOKE = if ($AllowDeepSeekSmoke) { "1" } else { "0" }
$env:VITE_ENABLE_DEMO_SEED = "true"

$stdout = Join-Path $logsRoot "tauri.stdout.log"
$stderr = Join-Path $logsRoot "tauri.stderr.log"
Write-Host "Starting isolated Daymark QA run: $RunId"
Write-Host "QA WebView data: $webviewRoot"
Write-Host "QA AI origin: $normalizedMockOrigin (DeepSeek smoke: $($AllowDeepSeekSmoke.IsPresent))"
if ($ValidateOnly) {
  Write-Host "QA preflight passed; Tauri was not started."
  exit 0
}

Push-Location $repoRoot
try {
  & pnpm.cmd tauri dev --config $generatedConfigPath 1> $stdout 2> $stderr
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
