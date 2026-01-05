@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "REPO=D:\projects\anonimizator"

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git not found in PATH for cmd.exe
  goto :END_FAIL
)

if not exist "%REPO%\.git\" (
  echo ERROR: .git not found in REPO: %REPO%
  goto :END_FAIL
)

echo === REPO: %REPO%
echo.

REM Проверим, есть ли локальные изменения
set "DIRTY="
for /f "delims=" %%S in ('git -C "%REPO%" status --porcelain 2^>nul') do set "DIRTY=1"

if defined DIRTY (
  echo WARNING: Есть локальные изменения. Они будут УДАЛЕНЫ.
  echo.
  git -C "%REPO%" status -sb
  echo.
  set "CONFIRM="
  set /p "CONFIRM=Продолжить и перетереть локалку из GitHub? (y/N): "

  REM убираем пробелы (на всякий случай)
  set "CONFIRM=!CONFIRM: =!"

  if /i not "!CONFIRM!"=="y" (
    echo CANCELLED.
    goto :END_FAIL
  )
)

echo === git fetch origin
git -C "%REPO%" fetch origin
if errorlevel 1 goto :END_FAIL

echo.
echo === git checkout main
git -C "%REPO%" checkout main >nul 2>&1
if errorlevel 1 (
  echo main not found locally, creating from origin/main...
  git -C "%REPO%" checkout -B main origin/main
  if errorlevel 1 goto :END_FAIL
)

echo.
echo === git reset --hard origin/main
git -C "%REPO%" reset --hard origin/main
if errorlevel 1 goto :END_FAIL

echo.
echo === git clean -fd
git -C "%REPO%" clean -fd
if errorlevel 1 goto :END_FAIL

echo.
echo === git status -sb (after)
git -C "%REPO%" status -sb
echo.
echo OK: local main synced to origin/main (forced).
goto :END_OK

:END_FAIL
echo.
pause
exit /b 1

:END_OK
echo.
pause
exit /b 0
