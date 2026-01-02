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

set "BRANCH="
for /f "delims=" %%B in ('git -C "%REPO%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo ERROR: cannot detect branch
  goto :END_FAIL
)

echo === REPO: %REPO%
echo === BRANCH: %BRANCH%
echo.

echo === git status -sb (before)
git -C "%REPO%" status -sb
if errorlevel 1 goto :END_FAIL
echo.

echo === git add -A
git -C "%REPO%" add -A
if errorlevel 1 goto :END_FAIL

REM commit if staged changes exist
git -C "%REPO%" diff --cached --quiet
if errorlevel 1 goto :DO_COMMIT
echo === nothing to commit (staged empty)
goto :SYNC_AND_PUSH

:DO_COMMIT
echo.
set "MSG="
set /p "MSG=Commit message (Enter=update): "
if "%MSG%"=="" set "MSG=update"

echo === git commit -m "!MSG!"
git -C "%REPO%" commit -m "!MSG!"
if errorlevel 1 goto :END_FAIL

:SYNC_AND_PUSH
echo.
echo === git fetch origin
git -C "%REPO%" fetch origin
if errorlevel 1 goto :END_FAIL

echo === git pull --rebase origin %BRANCH%
git -C "%REPO%" pull --rebase origin "%BRANCH%"
if errorlevel 1 (
  echo.
  echo ERROR: rebase failed. Resolve conflicts, then run:
  echo   git add -A
  echo   git rebase --continue
  echo After that, run this .bat again.
  goto :END_FAIL
)

echo.
echo === git push
git -C "%REPO%" push
if errorlevel 1 (
  echo.
  echo ERROR: git push failed.
  goto :END_FAIL
)

echo.
echo === git status -sb (after)
git -C "%REPO%" status -sb
echo.
echo === HEAD:
git -C "%REPO%" log --oneline --decorate -n 1
echo.
echo OK: done
goto :END_OK

:END_FAIL
echo.
pause
exit /b 1

:END_OK
echo.
pause
exit /b 0
