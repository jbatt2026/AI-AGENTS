# One-command setup for face-agent on Windows.
#
# Creates a virtual environment, installs the dependencies, downloads the face
# models, and runs the health check. Safe to re-run: it skips what is already
# in place.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Exe
#
#   -Exe      also build dist\face-agent.exe so it runs without Python
#   -Dlib     also install the dlib backend (needs cmake and a C++ compiler)
#   -NoVenv   install into the current Python instead of a .venv
#
# Options are read from $args instead of a param() block on purpose. With
# [CmdletBinding()] and [switch] parameters, launching this through
# `powershell -File` on Windows PowerShell 5.1 failed while binding
# parameters -- "Cannot convert value System.String to type
# System.Management.Automation.SwitchParameter" -- before the first line of
# the script ran, even with no arguments passed. Reading $args cannot fail
# that way. Do not reintroduce param() here.

$NoVenv = $args -contains '-NoVenv'
$Dlib = $args -contains '-Dlib'
$Exe = $args -contains '-Exe'

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $RepoRoot '.venv'
$Agent = Join-Path $RepoRoot 'scripts\face_agent.py'

function Write-Step($Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Fail($Message) { Write-Host "`nerror: $Message" -ForegroundColor Red; exit 1 }

# --- 1. Python ------------------------------------------------------------
Write-Step 'Checking Python'
$Python = $null
$VersionProbe = 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
# Each candidate is @(executable, extra args...). 'py' needs an explicit
# version selector so it cannot pick a Python 2 install.
foreach ($spec in 'python', 'python3', 'py -3') {
    $parts = $spec -split ' '
    $exe = $parts[0]
    $exeArgs = @($parts | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    & $exe @exeArgs -c $VersionProbe 2>$null
    if ($LASTEXITCODE -eq 0) { $Python = $parts; break }
}
if (-not $Python) {
    Write-Fail @'
need Python 3.10 or newer on PATH.
Install it from https://python.org/downloads and tick "Add Python to PATH"
during setup, then open a NEW terminal and re-run this script.
'@
}
$PythonCmd = $Python[0]
$PythonArgs = @($Python | Select-Object -Skip 1)
$version = (& $PythonCmd @PythonArgs --version) 2>&1
Write-Host "using $version"

# --- 2. Environment -------------------------------------------------------
if (-not $NoVenv) {
    Write-Step 'Creating the virtual environment'
    if (Test-Path $VenvDir) {
        Write-Host "$VenvDir already exists, reusing it"
    } else {
        & $PythonCmd @PythonArgs -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) { Write-Fail 'could not create a virtual environment' }
    }
    $PythonCmd = Join-Path $VenvDir 'Scripts\python.exe'
    $PythonArgs = @()
    if (-not (Test-Path $PythonCmd)) { Write-Fail "virtual environment looks broken: $PythonCmd is missing" }
}

# --- 3. Dependencies ------------------------------------------------------
Write-Step 'Installing dependencies'
& $PythonCmd @PythonArgs -m pip install --quiet --upgrade pip
& $PythonCmd @PythonArgs -m pip install --quiet -r (Join-Path $RepoRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Fail 'dependency install failed (see the pip output above)' }

if ($Dlib) {
    Write-Host 'installing the dlib backend - this compiles and can take several minutes'
    & $PythonCmd @PythonArgs -m pip install 'face_recognition>=1.3'
    if ($LASTEXITCODE -ne 0) {
        Write-Fail 'dlib install failed. It needs cmake and Visual C++ Build Tools; the default sface backend does not.'
    }
}
Write-Host 'done'

# --- 4. Models ------------------------------------------------------------
Write-Step 'Downloading the face models (~40 MB, once)'
& $PythonCmd @PythonArgs $Agent models --download
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'model download failed. Check your internet connection and re-run.'
}

# --- 5. Optional executable ----------------------------------------------
if ($Exe) {
    Write-Step 'Building dist\face-agent.exe'
    & $PythonCmd @PythonArgs -m pip install --quiet pyinstaller
    & $PythonCmd @PythonArgs (Join-Path $RepoRoot 'scripts\build_executable.py')
    if ($LASTEXITCODE -ne 0) { Write-Fail 'the PyInstaller build failed (see the output above)' }
}

# --- 6. Verify ------------------------------------------------------------
Write-Step 'Health check'
& $PythonCmd @PythonArgs $Agent doctor
$doctorStatus = $LASTEXITCODE

if ($doctorStatus -ne 0) {
    Write-Host "`nSetup finished but no backend is usable yet - see the report above." -ForegroundColor Yellow
    exit $doctorStatus
}

$run = "$PythonCmd `"$Agent`""
Write-Host "`nReady." -ForegroundColor Green
Write-Host @"

Run it with:

  $run enroll --name "Your Name" --camera --shots 5
  $run identify --camera
  $run list

Connect an AI agent over MCP:

  claude mcp add face-agent -- $PythonCmd "$Agent" mcp

Only enroll people who have agreed to it - face templates are biometric data.
"@
