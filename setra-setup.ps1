# setra-setup.ps1 — Windows installer for setra CLI
# Usage (run in PowerShell as Administrator or normal user):
#   iwr https://setra.sh/install.ps1 | iex
#   or:
#   .\setra-setup.ps1 [-Version 0.1.0] [-InstallDir "$env:LOCALAPPDATA\setra"]
#
param(
  [string]$Version   = "0.1.0",
  [string]$InstallDir = "$env:LOCALAPPDATA\setra\bin"
)

$ErrorActionPreference = "Stop"

function Write-Info    { Write-Host "  [•] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "  [✔] $args" -ForegroundColor Green }
function Write-Warning { Write-Host "  [⚠] $args" -ForegroundColor Yellow }
function Write-Err     { Write-Host "  [✖] $args" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  setra — Run AI coding agents anywhere, remember everything." -ForegroundColor White
Write-Host "  version $Version"
Write-Host ""

# ─── Detect arch ─────────────────────────────────────────────────────────────
$arch = if ([System.Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else { "x86" }

Write-Info "Platform: windows/$arch"

# ─── Check for Node / npm ────────────────────────────────────────────────────
$useNpm = $false
try {
  $npmVersion = (npm --version 2>$null)
  if ($npmVersion) { $useNpm = $true }
} catch {}

if ($useNpm) {
  Write-Info "Installing via npm..."
  npm install -g "@setra/cli@$Version" --silent
  Write-Success "Installed via npm"
} else {
  # Download pre-built binary from GitHub Releases
  $repoBase  = "https://github.com/nitikeshq/setra/releases/download"
  $tarball   = "setra-$Version-win32-$arch.zip"
  $url       = "$repoBase/v$Version/$tarball"
  $tmpDir    = [System.IO.Path]::GetTempPath() + "setra_install"

  Write-Info "Downloading binary from GitHub Releases..."
  Write-Info "URL: $url"

  if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }

  try {
    Invoke-WebRequest -Uri $url -OutFile "$tmpDir\setra.zip" -UseBasicParsing
  } catch {
    Write-Err "Download failed. Check https://github.com/nitikeshq/setra/releases for available versions."
  }

  # Extract
  if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
  Expand-Archive -Path "$tmpDir\setra.zip" -DestinationPath $InstallDir -Force
  Remove-Item -Recurse -Force $tmpDir

  Write-Success "Binary extracted to $InstallDir"

  # Add to user PATH
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$InstallDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
    Write-Warning "Added $InstallDir to your user PATH."
    Write-Warning "Restart your terminal for PATH changes to take effect."
  }
}

# ─── Winget / Scoop (informational) ──────────────────────────────────────────
Write-Host ""
Write-Host "  Alternative install methods:" -ForegroundColor DarkGray
Write-Host "    winget install setra       (once published to winget-pkgs)"  -ForegroundColor DarkGray
Write-Host "    scoop install setra        (once published to scoop bucket)"  -ForegroundColor DarkGray
Write-Host ""

# ─── Verify ──────────────────────────────────────────────────────────────────
try {
  $installedVer = (setra --version 2>$null)
  Write-Success "setra $installedVer is ready!"
} catch {
  Write-Warning "setra not found in current PATH. Restart your terminal and run: setra --help"
}

Write-Host ""
Write-Host "  Quick start:"
Write-Host "    setra tui           — launch interactive TUI"
Write-Host "    setra run           — run an AI agent on current repo"
Write-Host "    setra --help        — show all commands"
Write-Host ""
Write-Host "  Docs: https://setra.sh/docs"
Write-Host "  GitHub: https://github.com/nitikeshq/setra"
Write-Host ""
