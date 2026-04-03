# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for Clone Studio

import os
import sys

block_cipher = None

# Paths
SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(SPEC)), 'src')
WEB_DIR = os.path.join(SRC_DIR, 'web')

a = Analysis(
    [os.path.join(SRC_DIR, 'main.py')],
    pathex=[SRC_DIR],
    binaries=[],
    datas=[
        (os.path.join(WEB_DIR, 'index.html'), 'web'),
        (os.path.join(WEB_DIR, 'app.js'), 'web'),
    ],
    hiddenimports=[
        'webview',
        'webview.platforms.edgechromium',
        'webview.platforms.winforms',
        'webview.platforms.mshtml',
        'clr',
        'clr_loader',
        'pythonnet',
        'System',
        'System.Windows.Forms',
        'System.Drawing',
        'System.Threading',
        'yt_dlp',
        'yt_dlp.extractor',
        'yt_dlp.extractor.lazy_extractors',
        'yt_dlp.downloader',
        'yt_dlp.postprocessor',
        'winsound',
        'http.cookiejar',
        'urllib.request',
        'urllib.parse',
        'json',
        'tempfile',
        'uuid',
        'threading',
        'subprocess',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
        'cv2',
        'test',
        'unittest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='CloneStudio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='CloneStudio',
)
