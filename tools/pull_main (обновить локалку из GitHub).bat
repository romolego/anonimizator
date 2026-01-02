@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM pull_main (обновить локалку из GitHub).bat
REM Запускать ДВОЙНЫМ КЛИКОМ из папки tools.
REM Работает для репозитория на один уровень выше: ..\
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

REM На всякий случай показываем статус
echo === git status (before)
git status
echo.

REM Если есть незакоммиченные изменения — не трогаем, чтобы не потерять
git diff --quiet
if errorlevel 1 (
  echo ERROR: Есть незакоммиченные изменения (working tree dirty).
  echo Сначала закоммить/откати изменения, затем повтори pull.
  pause
  exit /b 1
)

REM Переключаемся на main
echo === checkout main
git checkout main
if errorlevel 1 (
  echo ERROR: Не удалось переключиться на main.
  pause
  exit /b 1
)

REM Подтягиваем изменения
echo.
echo === pull origin main
git pull origin main
if errorlevel 1 (
  echo ERROR: git pull завершился с ошибкой.
  pause
  exit /b 1
)

echo.
echo === git status (after)
git status
echo.
echo OK: Локальная папка синхронизирована с GitHub (main).
pause
endlocal
exit /b 0
