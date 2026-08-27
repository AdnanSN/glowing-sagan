@echo off
REM Double-click this to set up NAS file links on this PC.
REM
REM It reads the share root from nas-root.txt sitting next to it, so
REM there is nothing to type. Whoever puts this folder on the share
REM fills that file in once.
REM
REM Nothing here needs administrator rights.
REM
REM Anything typed after install.cmd is passed straight through, so
REM   install.cmd -DryRun      shows what would happen, changes nothing
REM   install.cmd -FromShare   runs the handler from the share instead
REM                            of copying it to this PC

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*

echo.
pause
