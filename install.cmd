@echo off
REM ============================================================================
REM  dsh-hrinfo-boot installer
REM
REM  Installs the HRINFO boot splash + unlock gate into the current user's DSH
REM  "web" profile, then tells you what to do next.
REM
REM  Prerequisites on this machine:
REM    - DSH installed and working   (dsh --version)
REM    - pnpm on PATH                (dsh plugin uses it under the hood)
REM    - Node.js 20 or newer
REM
REM  Usage:
REM    install.cmd                     install, and prompt for an unlock code
REM    install.cmd 7k2p                install, and set this unlock code
REM    install.cmd 7k2p 3099           ...and run DSH on a non-default port
REM    install.cmd --no-code           install with the gate left OFF
REM
REM  Everything runs as the current user. Nothing is written outside DSH_HOME.
REM ============================================================================

setlocal EnableDelayedExpansion
set "HERE=%~dp0"
set "TGZ=%HERE%dsh-hrinfo-boot-0.1.3.tgz"
set "DSH_HOME=%USERPROFILE%\.dsh"
set "PROFILE_DIR=%DSH_HOME%\profiles\web"
set "PLUGIN=%PROFILE_DIR%\node_modules\dsh-hrinfo-boot"
set "CODE=%~1"
set "PORT=%~2"
if "%PORT%"=="" set "PORT=3080"

echo.
echo ============================================================
echo   dsh-hrinfo-boot installer
echo ============================================================
echo.

REM ---------- 1. preflight -----------------------------------------------------

echo [1/5] Checking prerequisites...

if not exist "%TGZ%" (
  echo   [warn] no tarball next to this script - packing this folder with npm pack
  if not exist "%~dp0package.json" (
    echo   [X] there is neither a tarball nor a package.json next to this script:
    echo       %TGZ%
    echo       Put install.cmd inside the plugin folder, or put the .tgz next to it.
    exit /b 1
  )
  where npm >nul 2>&1
  if errorlevel 1 (
    echo   [X] npm is not on PATH, so this folder cannot be packed.
    echo       Install Node.js 20+ ^(which brings npm^), or put the .tgz next to this script.
    exit /b 1
  )
  set "PACKED="
  pushd "%~dp0"
  for /f "delims=" %%f in ('npm pack --silent 2^>nul') do set "PACKED=%%f"
  popd
  if not defined PACKED (
    echo   [X] npm pack did not report a tarball name - cannot continue.
    exit /b 1
  )
  set "TGZ=%~dp0!PACKED!"
  echo   [ok] packed: !TGZ!
)
if not exist "%TGZ%" (
  echo   [X] package not found: %TGZ%
  exit /b 1
)
echo   [ok] package found

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] node is not on PATH. Install Node.js 20 or newer.
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODEV=%%v"
echo   [ok] node !NODEV!

where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [warn] pnpm is not on PATH, and "dsh plugin" needs it.
  where npm >nul 2>&1
  if errorlevel 1 (
    echo   [X] npm is not on PATH either. Install Node.js 20+ first, then rerun this script.
    exit /b 1
  )
  echo.
  echo   pnpm can be installed now ^(runs: npm install -g pnpm^),
  echo   or install it yourself in another window and rerun this script.
  echo.
  set "ANS="
  set /p "ANS=  Install pnpm now? [Y/N] "
  if /i not "!ANS!"=="Y" (
    echo   [X] pnpm is required by "dsh plugin". Install it with:  npm install -g pnpm
    exit /b 1
  )
  call npm install -g pnpm
  where pnpm >nul 2>&1
  if errorlevel 1 (
    echo   [X] pnpm was installed but this window cannot see it yet.
    echo       Close this window, open a NEW Command Prompt, and run this script again.
    exit /b 1
  )
  echo   [ok] pnpm installed
)
for /f "delims=" %%v in ('pnpm --version') do set "PNPMV=%%v"
echo   [ok] pnpm !PNPMV!

REM dsh.ps1 is blocked by the default PowerShell execution policy, so the CLI is
REM invoked through node directly, exactly as dsh.cmd does.
set "DSH_BIN=%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
if not exist "%DSH_BIN%" (
  echo   [X] DSH not found. Install it first:  npm install -g @deepseek-ai/dsh
  exit /b 1
)
for /f "delims=" %%v in ('node -e "console.log(require(String.raw`%APPDATA%`) + '')" 2^>nul') do set "IGNORED=%%v"
for /f "delims=" %%v in ('node "%~dp0read-dsh-version.mjs"') do set "DSHV=%%v"
echo   [ok] dsh !DSHV!
echo   [ok] DSH_HOME: %DSH_HOME%

REM ---------- 2. install -------------------------------------------------------

echo.
echo [2/5] Installing the plugin into the "web" profile.
echo       A profile is created if this is a first run.
echo.

node "%DSH_BIN%" plugin --profile web add "%TGZ%"
if errorlevel 1 (
  echo.
  echo   [X] installation failed. Notes:
  echo       - if pnpm reported a version incompatibility, run the
  echo         "dsh plugin allow-version ..." line it printed, then retry
  echo       - if pnpm was missing, install it and retry
  exit /b 1
)

REM ---------- 3. unlock code ---------------------------------------------------

echo.
echo [3/5] Unlock code...

if /i "%CODE%"=="--no-code" (
  echo   [--] skipped. The gate stays OFF and the splash plays straight through.
  echo        Set one later with:  "%HERE%set-code.cmd" 7k2p
  goto :verify
)

if "!CODE!"=="" (
  echo   Choose a 4-character code - letters and digits only.
  echo   Press Enter with nothing typed to keep the gate OFF.
  echo.
  set /p "CODE=  code: "
)

if "!CODE!"=="" (
  echo   [--] none given. The gate stays OFF.
  echo        Set one later with:  "%HERE%set-code.cmd" 7k2p
  goto :verify
)

set "DSH_HOME=%DSH_HOME%" & node "%PLUGIN%\src\set-code.mjs" "!CODE!"
if errorlevel 1 (
  echo   [X] that code was rejected: it must be exactly 4 characters from [0-9A-Za-z].
  exit /b 1
)

:verify
echo.
echo [4/5] Verifying the install...
node "%~dp0verify-install.mjs" "%PROFILE_DIR%"
if errorlevel 1 (
  echo.
  echo   [X] the install is on disk but not usable. See the reason above.
  exit /b 1
)
node "%PLUGIN%\src\set-code.mjs" --status

echo.
echo [5/5] Done.
echo.
echo ============================================================
echo   NEXT: start DSH, then open the URL it prints
echo ============================================================
echo.
echo   Start it in a new window:
echo       node "%DSH_BIN%" --profile web --port %PORT%
echo.
echo   The boot splash plays, then the 4-cell panel appears. It takes
echo   focus on its own - type the code and it unlocks by itself.
echo.
echo   Useful commands, all in this folder:
echo       set-code.cmd --status     is a code set?
echo       set-code.cmd 9x4m         change the code
echo       set-code.cmd --clear      turn the gate off
echo.
echo   DSH reads the plugin tree and the unlock code only at STARTUP,
echo   so a change to either one needs a restart.
echo.

endlocal
exit /b 0
