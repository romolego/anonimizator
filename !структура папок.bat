@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM !structure.bat
REM Назначение:
REM  - Снять "снимок" структуры папок/файлов проекта в !structure.txt
REM  - Удобно, чтобы быстро показать структуру в нейросети/документации
REM
REM Как работает:
REM  - Берёт корень как папку, где лежит этот .bat (а не текущий каталог)
REM  - Рекурсивно собирает директории и файлы (включая скрытые)
REM  - Пишет UTF-8 без BOM
REM ============================================================

set "OUT=!structure.txt"
set "PS1=%TEMP%\erknm_dump_%RANDOM%.ps1"

REM Корень = папка, где находится этот bat
set "ROOT=%~dp0"
REM убираем завершающий обратный слэш
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM Пишем временный PowerShell-скрипт (без кириллицы внутри файла)
> "%PS1%"  echo $ErrorActionPreference = 'Stop'
>> "%PS1%" echo $root = '%ROOT%'
>> "%PS1%" echo $outPath = Join-Path $root '%OUT%'
>> "%PS1%" echo $dirs  = Get-ChildItem -LiteralPath $root -Recurse -Force -Directory ^| Sort-Object FullName
>> "%PS1%" echo $files = Get-ChildItem -LiteralPath $root -Recurse -Force -File      ^| Sort-Object FullName
>> "%PS1%" echo $lines = New-Object System.Collections.Generic.List[string]
>> "%PS1%" echo $lines.Add('ROOT: ' + $root) ^| Out-Null
>> "%PS1%" echo $lines.Add('') ^| Out-Null
>> "%PS1%" echo $lines.Add('=== DIRECTORIES ===') ^| Out-Null
>> "%PS1%" echo foreach ($d in $dirs) { $lines.Add($d.FullName.Substring($root.Length + 1)) ^| Out-Null }
>> "%PS1%" echo $lines.Add('') ^| Out-Null
>> "%PS1%" echo $lines.Add('=== FILES ===') ^| Out-Null
>> "%PS1%" echo foreach ($f in $files) { $lines.Add($f.FullName.Substring($root.Length + 1)) ^| Out-Null }
>> "%PS1%" echo [System.IO.File]::WriteAllLines($outPath, $lines, [System.Text.UTF8Encoding]::new($false))

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%ERRORLEVEL%"

del "%PS1%" >nul 2>nul

if not "%RC%"=="0" (
  echo.
  echo ОШИБКА: PowerShell завершился с кодом %RC%
  pause
  exit /b %RC%
)

echo.
echo Готово. Файл "%OUT%" создан в корне проекта: %ROOT%
echo (UTF-8 без BOM)
pause
