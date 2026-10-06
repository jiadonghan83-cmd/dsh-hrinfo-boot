@echo off
REM Set or change the dsh-hrinfo-boot unlock code.
REM
REM Usage:
REM   set-code.cmd 7k2p        set the code
REM   set-code.cmd --status    is a code set?
REM   set-code.cmd --clear     turn the gate off
REM
REM The code is not stored in plaintext: this writes a PBKDF2-SHA512 record into
REM %DSH_HOME%\hrinfo-boot.json, which is the file the host half reads at startup.
REM DSH must be restarted for a change to take effect.
REM
REM DSH_HOME is honoured when it is already set, so this follows whichever home the
REM running DSH actually uses. It previously derived the path from USERPROFILE only,
REM which silently wrote to the default home instead of the intended one.

setlocal
if not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\.dsh"
set "CLI=%DSH_HOME%\profiles\web\node_modules\dsh-hrinfo-boot\src\set-code.mjs"

if not exist "%CLI%" (
  echo set-code: the plugin is not installed at:
  echo   %CLI%
  echo.
  echo Install it first, then run this again. If DSH uses a different home,
  echo set DSH_HOME before calling this script.
  exit /b 1
)

if "%~1"=="" (
  echo usage: set-code.cmd ^<4-character code^>
  echo        set-code.cmd --status
  echo        set-code.cmd --clear
  exit /b 1
)

node "%CLI%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" exit /b %RC%

echo.
echo Restart DSH for the change to take effect.
endlocal
