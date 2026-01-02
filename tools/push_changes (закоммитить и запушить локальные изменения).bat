@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM === НАСТРОЙКА: путь к репозиторию ===
set "REPO=D:\projects\anonimizator"

REM --- проверки ---
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git not found in PATH for cmd.exe
  goto :END_FAIL
)

if not exist "%REPO%\.git\" (
  echo ERROR: .git not found in REPO: %REPO%
  goto :END_FAIL
)

REM --- branch ---
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

REM --- staged? ---
git -C "%REPO%" diff --cached --quiet
if errorlevel 1 goto :DO_COMMIT

echo.
echo === nothing to commit (staged empty)
goto :DO_PUSH

:DO_COMMIT
echo.
set "MSG="
set /p "MSG=Commit message (Enter=update): "
if "%MSG%"=="" set "MSG=update"

echo === git commit -m "!MSG!"
git -C "%REPO%" commit -m "!MSG!"
if errorlevel 1 goto :END_FAIL

:DO_PUSH
echo.
echo === git push
set "TMP=%TEMP%\git_push_%RANDOM%.log"
git -C "%REPO%" push > "%TMP%" 2>&1
if errorlevel 1 goto :PUSH_FAILED

goto :PUSH_OK

:PUSH_FAILED
REM Если нет upstream — повторяем с -u origin <branch>
findstr /i /c:"has no upstream branch" "%TMP%" >nul 2>&1
if not errorlevel 1 (
  echo === no upstream, running: git push -u origin %BRANCH%
  git -C "%REPO%" push -u origin "%BRANCH%"
  if errorlevel 1 goto :PUSH_SHOW_ERROR
  goto :PUSH_OK
)

:PUSH_SHOW_ERROR
echo ERROR: git push failed:
type "%TMP%"
goto :END_FAIL

:PUSH_OK
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
