[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Qa1Installer,
  [Parameter(Mandatory = $true)]
  [string]$Qa2Installer,
  [string]$RunId = ("installed-lifecycle-" + (Get-Date -Format "yyyyMMdd-HHmmss")),
  [string]$MockOrigin = "http://127.0.0.1:18888"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Installed lifecycle QA requires PowerShell 7 or newer."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "work\qa"))
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $qaRoot $RunId))
if (-not $runRoot.StartsWith($qaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "QA lifecycle run directory must stay inside work/qa."
}

$qa1 = [System.IO.Path]::GetFullPath($Qa1Installer)
$qa2 = [System.IO.Path]::GetFullPath($Qa2Installer)
foreach ($installer in @($qa1, $qa2)) {
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "QA installer is missing."
  }
}

$mockUri = [System.Uri]$MockOrigin
if ($mockUri.Scheme -notin @("http", "https") -or
    $mockUri.Host -notin @("127.0.0.1", "localhost", "::1") -or
    $mockUri.AbsolutePath -ne "/" -or $mockUri.Query -or $mockUri.Fragment -or $mockUri.UserInfo) {
  throw "MockOrigin must be an exact loopback origin."
}
$normalizedMockOrigin = $mockUri.GetLeftPart([System.UriPartial]::Authority)

$existingDaymark = @(Get-Process -Name "daymark" -ErrorAction SilentlyContinue)
if ($existingDaymark.Count -gt 0) {
  throw "A Daymark process is running. Stop it before installed lifecycle QA."
}

$installRoot = Join-Path $runRoot "installed\Daymark QA"
$profilesRoot = Join-Path $runRoot "profiles"
$evidenceRoot = Join-Path $runRoot "evidence"
$logsRoot = Join-Path $runRoot "logs"
$mockRoot = Join-Path $runRoot "mock"
New-Item -ItemType Directory -Force -Path $profilesRoot, $evidenceRoot, $logsRoot, $mockRoot | Out-Null

function Get-ProductionMetadata {
  $candidates = @(
    @{ label = "roaming-app-data"; path = (Join-Path $env:APPDATA "com.szywah.daymark") },
    @{ label = "local-app-data"; path = (Join-Path $env:LOCALAPPDATA "com.szywah.daymark") }
  )
  return @($candidates | ForEach-Object {
    $exists = Test-Path -LiteralPath $_.path
    $item = if ($exists) { Get-Item -LiteralPath $_.path } else { $null }
    [ordered]@{
      label = $_.label
      exists = $exists
      lastWriteUtc = if ($item) { $item.LastWriteTimeUtc.ToString("o") } else { $null }
    }
  })
}

function Assert-ProductionMetadataUnchanged($before, $after) {
  if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
    throw "Production Daymark data-directory metadata changed during QA."
  }
}

function Invoke-SilentInstaller([string]$installer, [string]$expectedVersion) {
  $process = Start-Process -FilePath $installer `
    -ArgumentList @("/S", "/D=$installRoot") `
    -WindowStyle Hidden `
    -PassThru
  if (-not $process.WaitForExit(180000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "QA installer timed out."
  }
  if ($process.ExitCode -ne 0) { throw "QA installer failed with exit code $($process.ExitCode)." }

  $app = Get-ChildItem -LiteralPath $installRoot -Filter "*.exe" -File |
    Where-Object { $_.Name -notmatch "(?i)uninstall" } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if (-not $app) { throw "Installed Daymark QA executable was not found." }
  $version = $app.VersionInfo.ProductVersion
  if ($version -notlike "*$expectedVersion*") {
    throw "Installed Daymark QA version mismatch: expected $expectedVersion, got $version."
  }
  return $app
}

function Get-QaUninstallEntry {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  $matches = foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
      $entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      $displayName = $entry.PSObject.Properties["DisplayName"]
      if ($displayName -and [string]$displayName.Value -eq "Daymark QA") {
        $displayVersion = $entry.PSObject.Properties["DisplayVersion"]
        $uninstallString = $entry.PSObject.Properties["UninstallString"]
        [ordered]@{
          key = $_.PSChildName
          displayVersion = if ($displayVersion) { [string]$displayVersion.Value } else { "" }
          uninstallStringPresent = $uninstallString -and -not [string]::IsNullOrWhiteSpace([string]$uninstallString.Value)
        }
      }
    }
  }
  return @($matches)
}

function Wait-LoopbackPort([int]$port) {
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $task = $client.ConnectAsync("127.0.0.1", $port)
      if ($task.Wait(250) -and $client.Connected) { return }
    } catch {
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 100
  }
  throw "QA mock service did not start."
}

function Invoke-QaScenario(
  [System.IO.FileInfo]$app,
  [string]$scenario,
  [string]$profileName,
  [bool]$requireStartupThreshold
) {
  $profile = Join-Path $profilesRoot $profileName
  $scenarioDir = Join-Path $evidenceRoot $profileName
  New-Item -ItemType Directory -Force -Path $profile, $scenarioDir | Out-Null
  $evidencePath = Join-Path $scenarioDir "$scenario.jsonl"
  $stdout = Join-Path $logsRoot "$profileName-$scenario.stdout.log"
  $stderr = Join-Path $logsRoot "$profileName-$scenario.stderr.log"
  $childEnvironment = @{
    DAYMARK_QA_AUTOMATION = "1"
    DAYMARK_QA_RUN_DIR = $runRoot
    DAYMARK_QA_SCENARIO = $scenario
    DAYMARK_QA_EVIDENCE_PATH = $evidencePath
    DAYMARK_QA_MOCK_ORIGIN = $normalizedMockOrigin
    DAYMARK_QA_ALLOW_DEEPSEEK_SMOKE = "0"
    WEBVIEW2_USER_DATA_FOLDER = $profile
    USERPROFILE = (Join-Path $runRoot "synthetic-user")
    HOME = (Join-Path $runRoot "synthetic-user")
  }
  New-Item -ItemType Directory -Force -Path $childEnvironment.USERPROFILE | Out-Null

  $process = Start-Process -FilePath $app.FullName `
    -WorkingDirectory $installRoot `
    -Environment $childEnvironment `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  if (-not $process.WaitForExit(45000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit()
  }
  if ($requireStartupThreshold) {
    $assessmentJson = & node (Join-Path $repoRoot "qa/evaluate-startup-probe.mjs") $evidencePath $process.ExitCode
    if ($LASTEXITCODE -ne 0) { throw "Unable to evaluate QA startup evidence." }
    $assessment = $assessmentJson | ConvertFrom-Json
    $events = if (Test-Path -LiteralPath $evidencePath) {
      @(Get-Content -LiteralPath $evidencePath -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json })
    } else { @() }
    $settled = @($events | Where-Object { $_.stage -in @("dashboard-ready", "dashboard-failed") }) | Select-Object -First 1
    return [ordered]@{
      scenario = $scenario
      profile = $profileName
      exitCode = $process.ExitCode
      dashboardStage = if ($settled) { $settled.stage } else { $null }
      dashboardProcessElapsedMs = if ($settled) { [int64]$settled.processElapsedMs } else { $null }
      startupWithinThreshold = [bool]$assessment.passed
      result = [string]$assessment.reason
      completed = [bool]$assessment.passed
    }
  }

  if ($process.ExitCode -ne 0) { throw "QA scenario $scenario failed with exit code $($process.ExitCode)." }
  if (-not (Test-Path -LiteralPath $evidencePath)) { throw "QA scenario evidence is missing." }

  $events = @(Get-Content -LiteralPath $evidencePath -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json })
  $completed = @($events | Where-Object { $_.stage -eq "completed" -and $_.outcome -eq "pass" })
  $failed = @($events | Where-Object { $_.outcome -eq "fail" })
  if ($completed.Count -ne 1 -or $failed.Count -gt 0) {
    throw "QA scenario $scenario did not complete cleanly."
  }
  $settled = @($events | Where-Object { $_.stage -in @("dashboard-ready", "dashboard-failed") }) | Select-Object -First 1
  if (-not $settled) { throw "QA scenario $scenario did not record dashboard settlement." }
  return [ordered]@{
    scenario = $scenario
    profile = $profileName
    exitCode = $process.ExitCode
    dashboardStage = $settled.stage
    dashboardProcessElapsedMs = [int64]$settled.processElapsedMs
    startupWithinThreshold = $true
    completed = $true
  }
}

function Remove-VerifiedQaPath([string]$path) {
  $resolved = [System.IO.Path]::GetFullPath($path)
  if (-not $resolved.StartsWith($runRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside the QA run directory."
  }
  if (Test-Path -LiteralPath $resolved) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

$productionBefore = Get-ProductionMetadata
$mockProcess = $null
$results = [System.Collections.Generic.List[object]]::new()
$lifecycleSucceeded = $false
$failureMessage = $null
$installDirectoryRemoved = $false
$uninstallRegistrationRemoved = $false
$profilesRemoved = $false
$productionMetadataUnchanged = $false
$qaCredentialCleared = $false
$currentStage = "preflight"
$failedStage = $null
$preflightRegistrationCount = -1

try {
  $preflightRegistrationCount = @(Get-QaUninstallEntry).Count
  if ($preflightRegistrationCount -ne 0) {
    throw "A pre-existing Daymark QA installation is registered. Remove it before lifecycle QA."
  }
  $currentStage = "mock-start"
  $mockEnvironment = @{
    DAYMARK_QA_RUN_DIR = $mockRoot
    DAYMARK_QA_MOCK_PORT = ([System.Uri]$normalizedMockOrigin).Port.ToString()
  }
  $mockProcess = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @("qa/mock-ai.mjs") `
    -WorkingDirectory $repoRoot `
    -Environment $mockEnvironment `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsRoot "mock.stdout.log") `
    -RedirectStandardError (Join-Path $logsRoot "mock.stderr.log") `
    -PassThru
  Wait-LoopbackPort ([System.Uri]$normalizedMockOrigin).Port

  $currentStage = "qa1-install"
  $qa1App = Invoke-SilentInstaller $qa1 "0.1.0-qa.1"
  $currentStage = "qa1-registration"
  if (@(Get-QaUninstallEntry).Count -ne 1) { throw "qa.1 uninstall registration was not found or was ambiguous." }
  $currentStage = "seed-upgrade"
  $results.Add((Invoke-QaScenario $qa1App "seed-upgrade" "upgrade-profile" $false))

  $currentStage = "qa2-install"
  $qa2App = Invoke-SilentInstaller $qa2 "0.1.0-qa.2"
  $currentStage = "qa2-registration"
  $uninstallAfterUpgrade = @(Get-QaUninstallEntry)
  if ($uninstallAfterUpgrade.Count -ne 1 -or $uninstallAfterUpgrade[0].displayVersion -notlike "*0.1.0-qa.2*") {
    throw "qa.2 uninstall registration did not replace qa.1."
  }
  $currentStage = "verify-upgrade"
  $results.Add((Invoke-QaScenario $qa2App "verify-upgrade" "upgrade-profile" $false))
  $currentStage = "verify-credential-cleared"
  $results.Add((Invoke-QaScenario $qa2App "verify-credential-cleared" "upgrade-profile" $false))

  $currentStage = "cold-starts"
  1..3 | ForEach-Object {
    $results.Add((Invoke-QaScenario $qa2App "startup-probe" "cold-$($_)" $true))
  }
  $coldStarts = @($results | Where-Object { $_.scenario -eq "startup-probe" })
  if ($coldStarts.Count -ne 3 -or @($coldStarts | Where-Object { -not $_.startupWithinThreshold }).Count -gt 0) {
    throw "One or more installed cold starts exceeded the 5000 ms acceptance threshold."
  }

  $currentStage = "mock-log-privacy"
  $mockRequestLog = Join-Path $mockRoot "mock-ai-requests.jsonl"
  if (-not (Test-Path -LiteralPath $mockRequestLog)) { throw "Mock request log is missing." }
  $mockLogText = Get-Content -LiteralPath $mockRequestLog -Raw -Encoding UTF8
  foreach ($forbidden in @("daymark-qa-synthetic-key-v1", "Synthetic Daymark installer QA.", "Synthetic archive upgrade sentinel")) {
    if ($mockLogText.Contains($forbidden, [System.StringComparison]::Ordinal)) {
      throw "Mock request log contains forbidden request or credential text."
    }
  }

  $qaCredentialCleared = $true
} catch {
  $failureMessage = $_.Exception.Message
  $failedStage = $currentStage
} finally {
  if ($mockProcess -and -not $mockProcess.HasExited) {
    Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
  }

  try {
    if (Test-Path -LiteralPath $installRoot) {
      $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "*uninstall*.exe" -File | Select-Object -First 1
      if (-not $uninstaller) { throw "Daymark QA uninstaller was not found during cleanup." }
      $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @("/S") -WindowStyle Hidden -PassThru
      if (-not $uninstall.WaitForExit(120000)) {
        Stop-Process -Id $uninstall.Id -Force -ErrorAction SilentlyContinue
        throw "Daymark QA uninstaller timed out during cleanup."
      }
      if ($uninstall.ExitCode -ne 0) { throw "Daymark QA uninstaller failed during cleanup." }
      $deadline = [DateTime]::UtcNow.AddSeconds(15)
      while (((Test-Path -LiteralPath $installRoot) -or @(Get-QaUninstallEntry).Count -ne 0) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
      }
    }
    $installDirectoryRemoved = -not (Test-Path -LiteralPath $installRoot)
    $uninstallRegistrationRemoved = @(Get-QaUninstallEntry).Count -eq 0
    if (-not $installDirectoryRemoved -or -not $uninstallRegistrationRemoved) {
      throw "Daymark QA installation was not completely removed."
    }
  } catch {
    if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
  }

  try {
    Remove-VerifiedQaPath $profilesRoot
    $profilesRemoved = -not (Test-Path -LiteralPath $profilesRoot)
    if (-not $profilesRemoved) { throw "QA WebView profiles were not removed." }
  } catch {
    if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
  }

  try {
    Assert-ProductionMetadataUnchanged $productionBefore (Get-ProductionMetadata)
    $productionMetadataUnchanged = $true
  } catch {
    if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
  }
}

$lifecycleSucceeded = -not $failureMessage `
  -and $qaCredentialCleared `
  -and $installDirectoryRemoved `
  -and $uninstallRegistrationRemoved `
  -and $profilesRemoved `
  -and $productionMetadataUnchanged
$summary = [ordered]@{
  schema = "daymark.qa-installed-lifecycle.v1"
  runId = $RunId
  success = $lifecycleSucceeded
  qa1Sha256 = (Get-FileHash -LiteralPath $qa1 -Algorithm SHA256).Hash
  qa2Sha256 = (Get-FileHash -LiteralPath $qa2 -Algorithm SHA256).Hash
  scenarios = @($results)
  productionMetadataUnchanged = $productionMetadataUnchanged
  qaCredentialCleared = $qaCredentialCleared
  installDirectoryRemoved = $installDirectoryRemoved
  uninstallRegistrationRemoved = $uninstallRegistrationRemoved
  profilesRemoved = $profilesRemoved
  failure = if ($failureMessage) { "lifecycle-failed" } else { $null }
  failedStage = $failedStage
  preflightRegistrationCount = $preflightRegistrationCount
  realAi = "UNVERIFIED"
  completedAt = [DateTime]::UtcNow.ToString("o")
}
$summaryPath = Join-Path $runRoot "installed-lifecycle-summary.json"
[System.IO.File]::WriteAllText(
  $summaryPath,
  ($summary | ConvertTo-Json -Depth 10),
  [System.Text.UTF8Encoding]::new($false)
)
$summary | ConvertTo-Json -Depth 10
if (-not $lifecycleSucceeded) {
  throw "Installed lifecycle QA failed; see the sanitized summary and logs in the QA run directory."
}
