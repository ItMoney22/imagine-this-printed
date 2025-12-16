[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RequestParts
)

if (-not $RequestParts -or $RequestParts.Count -eq 0) {
  Write-Host "Usage: ./scout.ps1 ""your request here""" -ForegroundColor Yellow
  exit 1
}

$codexCmd = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codexCmd) {
  Write-Error "codex CLI not found on PATH. Install it, then re-run: ./scout.ps1 ""your request here"""
  exit 1
}

$request = ($RequestParts -join " ").Trim()
if ([string]::IsNullOrWhiteSpace($request)) {
  Write-Error "Request was empty."
  exit 1
}

& codex exec $request
exit $LASTEXITCODE

