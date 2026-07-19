[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[A-Za-z0-9._-]+$")]
  [string]$RunId
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "work\qa"))
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $qaRoot $RunId))
$target = [System.IO.Path]::GetFullPath((Join-Path $runRoot "playwright"))

if (-not $runRoot.StartsWith($qaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Run directory escaped work/qa."
}
if (-not $target.StartsWith($runRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Playwright directory escaped the selected run."
}
if ((Split-Path -Leaf $target) -ne "playwright") {
  throw "Unexpected cleanup target."
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
Get-ChildItem -LiteralPath $runRoot -Filter "qa-web*" -File -ErrorAction SilentlyContinue | Remove-Item -Force
Write-Host "Removed Playwright artifacts for $RunId"
