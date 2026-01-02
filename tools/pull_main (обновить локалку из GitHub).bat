@echo off
setlocal EnableExtensions
chcp 65001 >nul

call :MAIN
set "EC=%errorlevel%"
echo.
echo === Exit code: %EC%
pause
exit /b %EC%

:MAIN
set "SCRIPT_DIR=%~dp0"

for /f "delims=" %%R in ('git -C "%SCRIPT_DIR%" rev-parse --show-toplevel 2^>nul') do set "REPO=%%R"
if not defined REPO (
  echo ERROR: Cannot find git repo root from: %SCRIPT_DIR%
  exit /b 1
)

echo === Repo: %REPO%
echo.

REM --- refuse if working tree dirty
for /f "delims=" %%S in ('git -C "%REPO%" status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  echo ERROR: Working tree has local changes. Commit/push or discard them first.
  echo Run: push_changes.bat OR revert changes manually.
  exit /b 1
)

echo Choose mode:
echo   1 = Safe update (fast-forward only)
echo   2 = FORCE sync main to origin/main (discard local main commits)
set "MODE="
set /p MODE=Enter 1 or 2: 
if "%MODE%"=="" set "MODE=1"

echo.
echo === git fetch origin
git -C "%REPO%" fetch origin
if errorlevel 1 (
  echo ERROR: git fetch failed.
  exit /b 1
)

REM --- switch to main
echo === git checkout main
git -C "%REPO%" checkout main
if errorlevel 1 (
  echo ERROR: cannot checkout main.
  exit /b 1
)

if "%MODE%"=="2" goto :FORCE

echo.
echo === SAFE: git pull --ff-only origin main
git -C "%REPO%" pull --ff-only origin main
if errorlevel 1 (
  echo ERROR: fast-forward is not possible (local main has extra commits or diverged).
  echo If you want to overwrite local main with origin/main, rerun and choose mode 2.
  exit /b 1
)

goto :DONE

:FORCE
echo.
echo === FORCE: reset local main to origin/main
git -C "%REPO%" reset --hard origin/main
if errorlevel 1 (
  echo ERROR: git reset --hard failed.
  exit /b 1
)

:DONE
echo.
echo === git status (after)
git -C "%REPO%" status -sb
echo.
echo OK: local main updated from GitHub.
exit /b 0
