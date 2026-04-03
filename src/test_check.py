import sys, os, subprocess

# Check ffmpeg
ffmpeg_path = 'ffmpeg.exe'
src_ffmpeg = os.path.join(os.path.dirname(__file__), 'ffmpeg.exe')
sys_ffmpeg = r'C:\ffmpeg\bin\ffmpeg.exe'

print(f"CWD: {os.getcwd()}")
print(f"src/ffmpeg.exe exists: {os.path.exists(src_ffmpeg)}")
print(f"C:\\ffmpeg\\bin\\ffmpeg.exe exists: {os.path.exists(sys_ffmpeg)}")

# Try running ffmpeg
for path in [ffmpeg_path, src_ffmpeg, sys_ffmpeg]:
    try:
        r = subprocess.run([path, '-version'], capture_output=True, text=True, timeout=5,
                         creationflags=subprocess.CREATE_NO_WINDOW)
        print(f"  {path}: OK (rc={r.returncode})")
    except Exception as e:
        print(f"  {path}: FAIL ({e})")

# Check config
from config import Config
try:
    c = Config()
    print(f"Config loaded OK: {c.to_dict()}")
except Exception as e:
    print(f"Config error: {e}")

# Check webview import
try:
    import webview
    print(f"webview version: {webview.__version__}")
except Exception as e:
    print(f"webview import error: {e}")

print("ALL CHECKS DONE")
