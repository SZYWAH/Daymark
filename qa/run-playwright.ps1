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
  throw "Playwright evidence directory must stay inside work/qa."
}

New-Item -ItemType Directory -Force -Path $resolvedRunDir | Out-Null
$env:DAYMARK_QA_RUN_DIR = $resolvedRunDir
$stdout = Join-Path $resolvedRunDir "qa-web.stdout.log"
$stderr = Join-Path $resolvedRunDir "qa-web.stderr.log"
$exitFile = Join-Path $resolvedRunDir "qa-web.exit"
Remove-Item -LiteralPath $exitFile -ErrorAction SilentlyContinue

Push-Location $repoRoot
try {
  $ErrorActionPreference = "Continue"
  & pnpm.cmd qa:web 1> $stdout 2> $stderr
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  Set-Content -LiteralPath $exitFile -Value $exitCode -Encoding ascii
  exit $exitCode
} finally {
  Pop-Location
}
