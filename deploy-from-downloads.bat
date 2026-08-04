@echo off
rem ============================================================
rem  One-click "unzip + deploy" from browser download folder
rem  Usage: copy to Desktop and double-click
rem  Prereq: dc installed globally (npm link), download folder
rem          configured via dc init
rem  NOTE: keep this file ASCII-only. cmd.exe parses .bat with
rem        the system ANSI codepage (GBK on Chinese Windows);
rem        UTF-8 Chinese bytes become mojibake that can contain
rem        special chars like & and |, splitting the command
rem        line and making cmd execute garbage as commands.
rem ============================================================

rem Check dc is available (npm link creates dc.cmd shim in PATH)
where dc >nul 2>nul
if errorlevel 1 (
    echo [ERROR] dc command not found. Run "npm link" in deploy-cli first.
    pause
    exit /b 1
)

rem Switch to the browser default download folder (/d handles drive changes)
cd /d "%USERPROFILE%\Downloads"
if errorlevel 1 (
    echo [ERROR] Cannot enter download folder: %USERPROFILE%\Downloads
    pause
    exit /b 1
)
echo [INFO] Current folder: %CD%
echo.

echo ============ Step 1: unzip (dc unzip) ============
rem Extract the downloaded archive (default ./<distname>.zip) into the product dir
call dc unzip
if errorlevel 1 goto :fail

echo.
echo ============ Step 2: deploy (dc deploy) ============
call dc deploy
if errorlevel 1 goto :fail

echo.
echo ============ All done ============
pause
exit /b 0

:fail
echo.
echo ============ FAILED - see messages above ============
pause
exit /b 1
