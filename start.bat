@echo off
title Clone Studio
color 0A

echo.
echo   =============================================
echo        Clone Studio - Launcher
echo   =============================================
echo.

:: ---- Check Python ----
python --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo   [ERROR] Python belum terinstall!
    echo.
    echo   Silakan download dan install Python dari:
    echo   https://www.python.org/downloads/
    echo.
    echo   PENTING: Centang "Add Python to PATH" saat install!
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo   [OK] Python %PYVER% ditemukan
echo.

:: ---- Install dependencies jika belum ada ----
echo   Memeriksa dependencies...

python -c "import webview" >nul 2>&1
if errorlevel 1 (
    echo   [INSTALL] Menginstall pywebview...
    pip install pywebview --quiet --disable-pip-version-check
)

python -c "import yt_dlp" >nul 2>&1
if errorlevel 1 (
    echo   [INSTALL] Menginstall yt-dlp...
    pip install yt-dlp --quiet --disable-pip-version-check
)

python -c "import requests" >nul 2>&1
if errorlevel 1 (
    echo   [INSTALL] Menginstall requests...
    pip install requests --quiet --disable-pip-version-check
)

echo   [OK] Semua dependencies sudah siap
echo.

:: ---- Check FFmpeg ----
where ffmpeg >nul 2>&1
if errorlevel 1 (
    if exist "%~dp0src\ffmpeg.exe" (
        echo   [OK] FFmpeg ditemukan di folder src
    ) else if exist "%~dp0ffmpeg.exe" (
        echo   [OK] FFmpeg ditemukan di root folder
    ) else (
        color 0E
        echo   [WARNING] FFmpeg tidak ditemukan!
        echo   Fitur cloning tidak akan berjalan tanpa FFmpeg.
        echo   Download dari: https://ffmpeg.org/download.html
        echo   Lalu taruh ffmpeg.exe di folder src\
        echo.
        color 0A
    )
) else (
    echo   [OK] FFmpeg ditemukan di PATH
)

echo.
echo   Memulai Clone Studio...
echo   =============================================
echo.

cd /d "%~dp0src"
python main.py

if errorlevel 1 (
    echo.
    color 0C
    echo   [ERROR] Aplikasi berhenti karena error.
    echo   Periksa pesan error di atas.
    echo.
    pause
)
