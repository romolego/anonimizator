@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM push_changes (закоммитить и запушить локальные изменения).bat
REM Запускать ДВОЙНЫМ КЛИКОМ из папки tools.
REM 1) Находит корень git-репозитория (на уровень выше tools)
REM 2) Если есть изменения -> add -A -> commit
REM 3) Если нет изменений, но есть непушенные коммиты -> push
REM 4) Показывает итог и НЕ закрывается молча
REM ============================================================

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\.." >nul 2>&1
if errorlevel 1 (
  echo ERROR: Не удалось перейти в корень проекта: "%SCRIPT_DIR%\.."
  echo.
  pause
  exit /b 1
)

REM Проверка, что это git-репозиторий
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: Текущая папка не является git-репозиторием.
  echo PATH: %CD%
  echo.
  pause
  exit /b 1
)

REM На всякий случай получим реальный корень репо и перейдём туда
for /f "delims=" %%T in ('git rev-parse --show-toplevel 2^>nul') do set "TOP=%%T"
if not "%TOP%"=="" (
  popd >nul 2>&1
  pushd "%TOP%" >nul 2>&1
)

echo === REPO: %CD%
echo.

REM Текущая ветка
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo ERROR: Не удалось определить текущую ветку.
  echo.
  pause
  exit /b 1
)
echo === Branch: %BRANCH%
echo.

echo === git status -sb (before)
git status -sb
echo.

REM Проверяем: есть ли изменения в рабочем дереве/индексе
set "HAS_CHANGES=0"
for /f "delims=" %%S in ('git status --porcelain 2^>nul') do (
  set "HAS_CHANGES=1"
  goto :CHANGES_DONE
)
:CHANGES_DONE

REM Определяем upstream (если есть)
set "UPSTREAM="
for /f "delims=" %%U in ('git rev-parse --abbrev-ref --symbolic-full-name @{u} 2^>nul') do set "UPSTREAM=%%U"

REM Считаем, сколько коммитов локально не запушено (ahead)
set "AHEAD=0"
if not "%UPSTREAM%"=="" (
  for /f "delims=" %%A in ('git rev-list --count %UPSTREAM%..HEAD 2^>nul') do set "AHEAD=%%A"
)

REM Если есть изменения -> коммитим
if "%HAS_CHANGES%"=="1" (
  echo === git add -A
  git add -A
  if errorlevel 1 (
    echo ERROR: git add завершился с ошибкой.
    echo.
    pause
    exit /b 1
  )

  echo.
  set "MSG="
  set /p MSG=Введите сообщение коммита (Enter = update): 
  if "%MSG%"=="" set "MSG=update"

  echo.
  echo === git commit -m "%MSG%"
  git commit -m "%MSG%"
  if errorlevel 1 (
    echo ERROR: git commit завершился с ошибкой.
    echo (Если пишет "nothing to commit" — значит изменений не было.)
    echo.
    pause
    exit /b 1
  )
) else (
  echo === Нет незакоммиченных изменений в рабочей папке.
)

REM После возможного коммита пересчитаем AHEAD (мог измениться)
set "UPSTREAM="
for /f "delims=" %%U in ('git rev-parse --abbrev-ref --symbolic-full-name @{u} 2^>nul') do set "UPSTREAM=%%U"
set "AHEAD=0"
if not "%UPSTREAM%"=="" (
  for /f "delims=" %%A in ('git rev-list --count %UPSTREAM%..HEAD 2^>nul') do set "AHEAD=%%A"
)

REM Если upstream не настроен, но remote origin есть — будем пушить с -u
set "HAS_ORIGIN=0"
git remote get-url origin >nul 2>&1 && set "HAS_ORIGIN=1"

REM Решаем, надо ли пушить:
REM - если был коммит (HAS_CHANGES=1) -> пушим
REM - если изменений не было, но AHEAD>0 -> пушим
set "NEED_PUSH=0"
if "%HAS_CHANGES%"=="1" set "NEED_PUSH=1"
if not "%AHEAD%"=="0" set "NEED_PUSH=1"

if "%NEED_PUSH%"=="0" (
  echo.
  echo OK: Нечего пушить. (Нет изменений и нет непушенных коммитов.)
  echo.
  pause
  exit /b 0
)

if "%HAS_ORIGIN%"=="0" (
  echo ERROR: remote "origin" не найден. Добавь origin и повтори.
  echo.
  pause
  exit /b 1
)

echo.
if "%UPSTREAM%"=="" (
  echo === git push -u origin %BRANCH%
  git push -u origin %BRANCH%
) else (
  echo === git push
  git push
)

if errorlevel 1 (
  echo ERROR: git push завершился с ошибкой.
  echo.
  pause
  exit /b 1
)

echo.
echo === git status -sb (after)
git status -sb
echo.

for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "HEADHASH=%%H"
echo === HEAD: %HEADHASH%
echo === Files in last commit:
git show --name-only --pretty="" HEAD

echo.
echo OK: Готово. Изменения отправлены в GitHub.
echo.
pause
endlocal
exit /b 0
