@echo off
rem Double-click this file to rebuild data, commit, and push to GitHub.
rem You can also run it from a terminal with arguments, for example:
rem   update-repo.cmd -Message "add M4A1 scheme 3"
rem   update-repo.cmd -SkipTest -NoPush
rem   update-repo.cmd -DryRun
rem
rem All real output comes from tools\update-repo.ps1 (Chinese UI).
rem This launcher itself is ASCII-only on purpose: cmd.exe would otherwise
rem mis-render Chinese text before chcp takes effect.
chcp 65001 >nul

set "PSEXE=powershell"
where pwsh >nul 2>nul && set "PSEXE=pwsh"

rem Make sure update-repo.ps1 is saved as UTF-8 with BOM (Windows PowerShell 5.1
rem needs the BOM to read the Chinese messages correctly). Silent, self-healing.
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-encoding.ps1" >nul 2>nul

"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-repo.ps1" %*

echo.
pause
