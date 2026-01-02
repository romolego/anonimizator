@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM pull_main: fetch -> checkout main -> reset --hard origin/main
REM (+ опционально clean -fd)
REM ============================================================

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git не найден в PATH для cmd.exe
  goto :END_FAIL
)

cd /d "%~dp0.." 2>nul
if errorlevel 1 (
  echo ERROR: Не удалось перейти в "%~dp0.."
  goto :END_FAIL
)

set "TOP="
for /f "delims=" %%T in ('git rev-parse --show-toplevel 2^>nul') do set "TOP=%%T"
if "%TOP%"=="" (
  echo ERROR: Не найден git repo root
  echo PATH: %CD%
  goto :END_FAIL
)

cd /d "%TOP%" 2>nul
if errorlevel 1 (
  echo ERROR: Не удалось перейти в корень репо: "%TOP%"
  goto :END_FAIL
)

echo === REPO: %CD%
echo.

REM стоп, если есть незакоммиченные изменения
set "DIRTY="
for /f "delims=" %%S in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  echo ERROR: Есть незакоммиченные изменения. Сначала commit/push или откати.
  echo.
  git status -sb
  goto :END_FAIL
)

echo === git fetch origin
git fetch origin
if errorlevel 1 (
  echo ERROR: git fetch завершился с ошибкой
  goto :END_FAIL
)

echo.
echo === git checkout main
git checkout main >nul 2>&1
if errorlevel 1 (
  echo main локально не найден. Создаю main от origin/main...
  git checkout -B main origin/main
  if errorlevel 1 (
    echo ERROR: не удалось создать/переключиться на main
    goto :END_FAIL
  )
)

echo.
echo === git reset --hard origin/main
git reset --hard origin/main
if errorlevel 1 (
  echo ERROR: git reset --hard завершился с ошибкой
  goto :END_FAIL
)

echo.
set "CLEAN="
set /p "CLEAN=Run git clean -fd (delete untracked files)? (y/N): "
if /i "%CLEAN%"=="y" (
  echo === git clean -fd
  git clean -fd
  if errorlevel 1 (
    echo ERROR: git clean -fd завершился с ошибкой
    goto :END_FAIL
  )
)

echo.
echo === git status -sb (after)
git status -sb
echo.
echo OK: main synced with origin/main
goto :END_OK

:END_FAIL
echo.
pause
exit /b 1

:END_OK
echo.
pause
exit /b 0
