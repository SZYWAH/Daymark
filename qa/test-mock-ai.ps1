[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunDir
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedRunDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $RunDir))
$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "work\qa"))
if (-not $resolvedRunDir.StartsWith($qaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Mock evidence directory must stay inside work/qa."
}

New-Item -ItemType Directory -Force -Path $resolvedRunDir | Out-Null
$env:DAYMARK_QA_RUN_DIR = $resolvedRunDir
$stdout = Join-Path $resolvedRunDir "mock-ai.stdout.log"
$stderr = Join-Path $resolvedRunDir "mock-ai.stderr.log"
$node = (Get-Command node).Source
$process = Start-Process -FilePath $node -ArgumentList @("qa/mock-ai.mjs") -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

try {
  $ready = $false
  for ($index = 0; $index -lt 30; $index += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18888/v1/models" -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  if (-not $ready) { throw "Mock AI server did not become ready." }

  & $node (Join-Path $PSScriptRoot "mock-ai.selftest.mjs") | Tee-Object -FilePath (Join-Path $resolvedRunDir "mock-ai-selftest.json")
  if ($LASTEXITCODE -ne 0) { throw "Mock AI self-test failed." }

  $requestLog = Join-Path $resolvedRunDir "mock-ai-requests.jsonl"
  if (Select-String -LiteralPath $requestLog -Pattern "qa-sensitive-body|qa-synthetic-key" -Quiet) {
    throw "Mock AI metadata log leaked request content or the synthetic credential."
  }
  Write-Host "Mock AI protocols and privacy log passed."
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
}
