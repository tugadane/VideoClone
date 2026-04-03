@echo off
title Clone Studio - Build
echo ============================================
echo   Clone Studio - Build Standalone EXE
echo ============================================
echo.

cd /d "%~dp0"

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

:: Check PyInstaller
python -c "import PyInstaller" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing PyInstaller...
    pip install pyinstaller --user
)

:: Check yt-dlp
python -c "import yt_dlp" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing yt-dlp...
    pip install yt-dlp --user
)

:: Check pywebview
python -c "import webview" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing pywebview...
    pip install pywebview --user
)

echo.
echo [BUILD] Building Clone Studio...
echo.

:: Clean previous build
if exist "dist\CloneStudio" rmdir /s /q "dist\CloneStudio"
if exist "build\CloneStudio" rmdir /s /q "build\CloneStudio"

:: Run PyInstaller
python -m PyInstaller CloneStudio.spec --noconfirm

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

:: Copy ffmpeg into the dist folder
echo.
echo [POST] Copying ffmpeg.exe...
if exist "src\ffmpeg.exe" (
    copy /y "src\ffmpeg.exe" "dist\CloneStudio\ffmpeg.exe"
    echo   - Copied from src\ffmpeg.exe
) else (
    where ffmpeg >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%i in ('where ffmpeg') do (
            copy /y "%%i" "dist\CloneStudio\ffmpeg.exe"
            echo   - Copied from %%i
            goto :ffprobe
        )
    ) else (
        echo   [WARN] ffmpeg.exe not found. User will need to provide it.
    )
)

:ffprobe
:: Copy ffprobe 
where ffprobe >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%i in ('where ffprobe') do (
        copy /y "%%i" "dist\CloneStudio\ffprobe.exe"
        echo   - Copied ffprobe.exe from %%i
        goto :postbuild
    )
)

:postbuild
:: Create default config.json
echo [POST] Creating default config.json...
echo { > "dist\CloneStudio\config.json"
echo   "ffmpeg_path": "ffmpeg.exe", >> "dist\CloneStudio\config.json"
echo   "default_clone_count": 10, >> "dist\CloneStudio\config.json"
echo   "default_format": "mp4", >> "dist\CloneStudio\config.json"
echo   "default_template": "{title}_clone{index}_{date}", >> "dist\CloneStudio\config.json"
echo   "default_output_folder": "hasil", >> "dist\CloneStudio\config.json"
echo   "default_method": "fast", >> "dist\CloneStudio\config.json"
echo   "notify_popup": true, >> "dist\CloneStudio\config.json"
echo   "notify_sound": true >> "dist\CloneStudio\config.json"
echo } >> "dist\CloneStudio\config.json"

:: Create hasil folder
mkdir "dist\CloneStudio\hasil" 2>nul

:: Create empty history
echo [] > "dist\CloneStudio\history.json"

echo.
echo ============================================
echo   BUILD COMPLETE!
echo ============================================
echo.
echo   Output: dist\CloneStudio\
echo   Main EXE: dist\CloneStudio\CloneStudio.exe
echo.
echo   To create an installer, install Inno Setup
echo   and compile: installer.iss
echo.
pause
