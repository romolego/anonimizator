@echo off
chcp 65001 >nul
setlocal

set "REPO=%~dp0.."
for %%I in ("%REPO%") do set "REPO=%%~fI"

echo REPO=%REPO%
echo.

if not exist "%REPO%\.git\" (
  echo ERROR: .git not found. This .bat must be in REPO\tools\
  goto :END
)

cd /d "%REPO%" || (echo ERROR: cd failed & goto :END)

where git >nul 2>&1 || (echo ERROR: git not found in PATH & goto :END)

echo === git status -sb (before)
git status -sb
echo.

echo === git add -A
git add -A || (echo ERROR: git add failed & goto :END)

REM Если после add нет staged-изменений — коммит не делаем, но пуш всё равно делаем (на случай "ahead")
git diff --cached --quiet
if %errorlevel%==0 (
  echo No staged changes to commit.
) else (
  set "MSG="
  set /p MSG=Commit message (Enter=update): 
  if "%MSG%"=="" set "MSG=update"

  echo.
  echo === git commit -m "%MSG%"
  git commit -m "%MSG%" || (echo ERROR: git commit failed & goto :END)
)

echo.
echo === git push
git push
if errorlevel 1 (
  echo ERROR: git push failed.
  goto :END
)

echo.
echo === git status -sb (after)
git status -sb

:END
echo.
pause
endlocal
