[CmdletBinding()]
param(
  [ValidatePattern('^qa\.\d+$')]
  [string]$Qualifier = "qa.2",
  [string]$RunId = ("installer-" + (Get-Date -Format "yyyyMMdd-HHmmss")),
  [string]$SourceRoot,
  [string]$BaseCommit,
  [string]$ProbeOverlayCommit
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = if ($SourceRoot) {
  [System.IO.Path]::GetFullPath($SourceRoot)
} else {
  $repoRoot
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot "src-tauri\tauri.conf.json"))) {
  throw "SourceRoot is not a Daymark checkout: $buildRoot"
}
$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "work\qa"))
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $qaRoot $RunId))
if (-not $runRoot.StartsWith($qaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "QA build evidence directory must stay inside work/qa."
}

New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
$probeOverlaySha256 = $null
$probeOverlayVerified = $false
if ($ProbeOverlayCommit) {
  if (-not $BaseCommit) { throw "BaseCommit is required when ProbeOverlayCommit is used." }
  $headCommit = (& git -C $buildRoot rev-parse HEAD).Trim()
  $resolvedBaseCommit = (& git -C $repoRoot rev-parse $BaseCommit).Trim()
  if ($LASTEXITCODE -ne 0 -or $headCommit -ne $resolvedBaseCommit) {
    throw "QA probe overlay source must be checked out at BaseCommit."
  }
  if (& git -C $buildRoot status --porcelain) {
    throw "QA probe overlay source worktree must be clean."
  }
  $resolvedProbeCommit = (& git -C $repoRoot rev-parse $ProbeOverlayCommit).Trim()
  if ($LASTEXITCODE -ne 0) { throw "ProbeOverlayCommit cannot be resolved." }
  $probePaths = @(
    "qa/tauri.qa.conf.json",
    "src/main.tsx",
    "src/qa/automation.ts",
    "src-tauri/src/qa_automation.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/main_window_state.rs",
    "src-tauri/src/ai_security.rs"
  )
  $overlayPatch = Join-Path $runRoot "qa-probe-overlay.patch"
  & git -C $repoRoot diff --binary "--output=$overlayPatch" "$resolvedProbeCommit^" $resolvedProbeCommit -- @probePaths
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $overlayPatch) -or (Get-Item $overlayPatch).Length -eq 0) {
    throw "QA probe overlay patch could not be generated."
  }
  $probeOverlaySha256 = (Get-FileHash -LiteralPath $overlayPatch -Algorithm SHA256).Hash
  & git -C $buildRoot apply --index $overlayPatch
  if ($LASTEXITCODE -ne 0) { throw "QA probe overlay could not be applied to BaseCommit." }
  $actualPatch = Join-Path $runRoot "qa-probe-overlay.applied.patch"
  & git -C $buildRoot diff --cached --binary "--output=$actualPatch" HEAD -- @probePaths
  if ($LASTEXITCODE -ne 0) { throw "Applied QA probe overlay could not be inspected." }
  $actualOverlaySha256 = (Get-FileHash -LiteralPath $actualPatch -Algorithm SHA256).Hash
  $probeOverlayVerified = $actualOverlaySha256 -eq $probeOverlaySha256
  if (-not $probeOverlayVerified) { throw "Applied QA probe overlay differs from the recorded patch." }
}

$baseConfigPath = Join-Path $buildRoot "qa\tauri.qa.conf.json"
$generatedConfigPath = Join-Path $runRoot "tauri.qa.build.conf.json"
$version = "0.1.0-$Qualifier"
$config = Get-Content -LiteralPath $baseConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$config | Add-Member -NotePropertyName version -NotePropertyValue $version -Force
$configJson = $config | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($generatedConfigPath, $configJson, [System.Text.UTF8Encoding]::new($false))

Push-Location $buildRoot
try {
  & pnpm.cmd tauri build --config $generatedConfigPath
  if ($LASTEXITCODE -ne 0) { throw "QA Tauri build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$installer = Get-ChildItem -LiteralPath (Join-Path $buildRoot "src-tauri\target\release\bundle\nsis") -Filter "Daymark QA_${version}_x64-setup.exe" |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $installer) { throw "QA NSIS installer was not found for $version." }
$evidenceInstallerPath = Join-Path $runRoot $installer.Name
Copy-Item -LiteralPath $installer.FullName -Destination $evidenceInstallerPath -Force
$evidenceInstaller = Get-Item -LiteralPath $evidenceInstallerPath
$null = & git -C $buildRoot diff --quiet
$unstagedDirty = $LASTEXITCODE -ne 0
$null = & git -C $buildRoot diff --cached --quiet
$stagedDirty = $LASTEXITCODE -ne 0
$untrackedFiles = @(& git -C $buildRoot ls-files --others --exclude-standard)
$unexpectedDirty = $unstagedDirty -or $untrackedFiles.Count -gt 0 -or ($stagedDirty -and -not $probeOverlayVerified)

$manifest = [ordered]@{
  schema = "daymark.qa-installer-build.v1"
  qualifier = $Qualifier
  version = $version
  commit = (& git -C $buildRoot rev-parse HEAD).Trim()
  dirty = $unexpectedDirty
  baseCommit = if ($BaseCommit) { (& git -C $repoRoot rev-parse $BaseCommit).Trim() } else { $null }
  probeOverlayCommit = if ($ProbeOverlayCommit) { (& git -C $repoRoot rev-parse $ProbeOverlayCommit).Trim() } else { $null }
  probeOverlaySha256 = $probeOverlaySha256
  sourceRoot = $buildRoot
  installerPath = $evidenceInstaller.FullName
  bytes = $evidenceInstaller.Length
  sha256 = (Get-FileHash -LiteralPath $evidenceInstaller.FullName -Algorithm SHA256).Hash
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
}
$manifestPath = Join-Path $runRoot "qa-installer-build.json"
[System.IO.File]::WriteAllText(
  $manifestPath,
  ($manifest | ConvertTo-Json -Depth 5),
  [System.Text.UTF8Encoding]::new($false)
)
$manifest | ConvertTo-Json -Depth 5
