@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM push_changes (закоммитить и запушить локальные изменения).bat
REM Запускать ДВОЙНЫМ КЛИКОМ из папки tools.
REM Работает для репозитория на один уровень выше: ..\
REM Делает: status -> add . -> commit -> push (текущая ветка)
REM ============================================================

cd /d "%~dp0.."
if errorlevel 1 (
  echo ERROR: Не удалось перейти в корень проекта: %~dp0..
  pause
  exit /b 1
)

REM Проверка что это git-репозиторий
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: Текущая папка не является git-репозиторием.
  echo PATH: %cd%
  pause
  exit /b 1
)

echo === CURRENT: %cd%
echo.

REM Покажем текущую ветку
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%B
if "%BRANCH%"=="" (
  echo ERROR: Не удалось определить текущую ветку.
  pause
  exit /b 1
)

echo === Branch: %BRANCH%
echo.

echo === git status (before)
git status
echo.

REM Если нет изменений — выходим
git diff --quiet
if not errorlevel 1 (
  git diff --cached --quiet
  if not errorlevel 1 (
    echo OK: Нет изменений для коммита.
    pause
    exit /b 0
  )
)

REM Добавляем всё
echo === git add .
git add .
if errorlevel 1 (
  echo ERROR: git add завершился с ошибкой.
  pause
  exit /b 1
)

REM Запрос сообщения коммита
echo.
set "MSG="
set /p MSG=Введите сообщение коммита (Enter = auto): 
if "%MSG%"=="" set "MSG=update"

echo.
echo === git commit -m "%MSG%"
git commit -m "%MSG%"
if errorlevel 1 (
  echo ERROR: git commit завершился с ошибкой (возможно, нечего коммитить).
  pause
  exit /b 1
)

REM Пушим текущую ветку
echo.
echo === git push -u origin %BRANCH%
git push -u origin %BRANCH%
if errorlevel 1 (
  echo ERROR: git push завершился с ошибкой.
  pause
  exit /b 1
)

echo.
echo === git status (after)
git status
echo.
echo OK: Изменения закоммичены и отправлены в GitHub. Ветка: %BRANCH%
pause
endlocal
exit /b 0
