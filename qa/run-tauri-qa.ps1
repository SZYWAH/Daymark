[CmdletBinding()]
param(
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $PSScriptRoot "tauri.qa.conf.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

if ($config.productName -ne "Daymark QA" -or $config.identifier -ne "com.szywah.daymark.qa") {
  throw "QA Tauri configuration identity check failed."
}

$qaWindow = @($config.app.windows)[0]
if ($qaWindow.title -ne "Daymark QA" -or -not $qaWindow.dataDirectory) {
  throw "QA window title or dataDirectory is not isolated."
}

# USERPROFILE and the Tauri identifier do not isolate Windows Credential Manager.
# Keep native QA hard-blocked until the application exposes a dedicated QA-only
# credential service instead of the production daymark.ai-api-key.v1 namespace.
$secretSourcePath = Join-Path $repoRoot "src-tauri\src\ai_secrets.rs"
$secretSource = Get-Content -LiteralPath $secretSourcePath -Raw
if ($secretSource -notmatch 'daymark\.qa\.ai-api-key\.v1') {
  throw "Native QA blocked: a dedicated daymark.qa.ai-api-key.v1 credential namespace is not implemented. Do not start Daymark QA against the production credential service."
}

$productionProcesses = @(Get-Process -Name "Daymark" -ErrorAction SilentlyContinue)
if ($productionProcesses.Count -gt 0) {
  throw "Production Daymark is running. Stop it before starting destructive QA scenarios."
}

$runRoot = Join-Path $repoRoot ("work\qa\" + $RunId)
$profileRoot = Join-Path $runRoot "profile"
New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $profileRoot ".codex") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $profileRoot ".claude") | Out-Null

$env:USERPROFILE = $profileRoot
$env:HOME = $profileRoot
$env:DAYMARK_QA_RUN_ID = $RunId
$env:DAYMARK_QA_RUN_DIR = $runRoot
$env:VITE_ENABLE_DEMO_SEED = "true"

Write-Host "Starting isolated Daymark QA run: $RunId"
Write-Host "QA profile: $profileRoot"
Push-Location $repoRoot
try {
  pnpm tauri dev --config $configPath
} finally {
  Pop-Location
}
