@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM check_git_auth (проверка git и авторизации GitHub).bat
REM Зачем нужен:
REM  - Проверить, что Git доступен в PATH
REM  - Проверить, что Git Credential Manager (GCM) установлен
REM  - Проверить, что включен credential.helper=manager (HTTPS auth GitHub)
REM
REM Использование:
REM  - Двойной клик (окно не закроется — в конце pause)
REM  - Или из PowerShell:
REM      cmd /k "D:\projects\anonimizator\tools\check_git_auth (проверка git и авторизации GitHub).bat"
REM ============================================================

echo === Git basic check
where git >nul 2>&1
if errorlevel 1 goto :NO_GIT
git --version
echo.

echo === Credential helper (global)
set "HELPER="
for /f "delims=" %%H in ('git config --global --get credential.helper 2^>nul') do set "HELPER=%%H"

if "%HELPER%"=="" goto :HELPER_EMPTY
echo credential.helper = %HELPER%
if /i "%HELPER%"=="manager" goto :HELPER_OK
echo WARN: helper НЕ manager. Рекомендуется:
echo   git config --global credential.helper manager
goto :CHECK_GCM

:HELPER_EMPTY
echo WARN: credential.helper не задан (global). Рекомендуется:
echo   git config --global credential.helper manager
goto :CHECK_GCM

:HELPER_OK
echo OK: helper = manager
goto :CHECK_GCM

:CHECK_GCM
echo.
echo === Git Credential Manager (GCM) check
git credential-manager --version >nul 2>&1
if errorlevel 1 goto :NO_GCM
for /f "delims=" %%V in ('git credential-manager --version 2^>nul') do set "GCM=%%V"
echo GCM version: %GCM%
goto :SUMMARY

:NO_GCM
echo WARN: git credential-manager не найден.
echo Решение: переустановить Git с включенным Git Credential Manager.
goto :SUMMARY

:NO_GIT
echo ERROR: git не найден в PATH для cmd.exe
echo Решение: переустановить Git с опцией "Add Git to PATH".
goto :SUMMARY

:SUMMARY
echo.
echo === Summary
echo OK когда:
echo  - Git есть
echo  - GCM есть
echo  - credential.helper = manager
echo Тогда push_changes/pull_main работают по HTTPS (при наличии доступа к репо).
echo.
pause
exit /b 0
