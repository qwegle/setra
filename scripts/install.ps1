# Setra CLI Installer for Windows
# Usage: irm https://setra.sh/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "qwegle/setra"
$InstallDir = if ($env:SETRA_INSTALL_DIR) { $env:SETRA_INSTALL_DIR } else { "$env:LOCALAPPDATA\setra\bin" }
$Version = if ($env:SETRA_VERSION) { $env:SETRA_VERSION } else { "latest" }

function Write-Info($msg) { Write-Host "▸ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "⚡ Setra CLI Installer" -ForegroundColor White -Bold
Write-Host ""

# Detect architecture
$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Write-Info "Platform: windows-$Arch"

# Resolve version
if ($Version -eq "latest") {
    Write-Info "Fetching latest release..."
    $Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction SilentlyContinue
    $Version = $Release.tag_name -replace "^v", ""
    if (-not $Version) { Write-Err "Could not determine latest version" }
}
Write-Info "Version: $Version"

# Download
$BinaryName = "setra-windows-$Arch.exe"
$DownloadUrl = "https://github.com/$Repo/releases/download/v$Version/$BinaryName"

Write-Info "Downloading $BinaryName..."
$TempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
$TempFile = Join-Path $TempDir "setra.exe"

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing
} catch {
    Write-Err "Download failed: $_"
}

# Install
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Copy-Item $TempFile (Join-Path $InstallDir "setra.exe") -Force
Remove-Item $TempDir -Recurse -Force

# Add to PATH
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$InstallDir", "User")
    Write-Info "Added $InstallDir to PATH (restart terminal to apply)"
}

Write-Ok "Setra $Version installed to $InstallDir\setra.exe"
Write-Host ""
Write-Host "  Get started:"
Write-Host "    setra init        — Initialize in your project"
Write-Host "    setra start       — Launch the platform"
Write-Host "    setra status      — Check health"
Write-Host "    setra --help      — See all commands"
Write-Host ""
