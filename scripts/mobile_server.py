"""Run the exported app and API on the same local origin."""
import argparse
import getpass
import os
import sys
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

root = Path(__file__).resolve().parent
if not (root / 'backend').is_dir():
    root = root.parent
parser = argparse.ArgumentParser()
parser.add_argument('--phone', action='store_true')
parser.add_argument('--no-browser', action='store_true')
args = parser.parse_args()
load_dotenv(root / 'backend' / '.env', encoding='utf-8-sig', interpolate=False, override=True)
if args.phone:
    password = os.getenv('GROWAI_ACCESS_PASSWORD') or getpass.getpass('设置本次手机登录密码（至少 12 位）：')
    if len(password) < 12:
        sys.exit('手机登录密码至少需要 12 位')
    os.environ['GROWAI_ACCESS_PASSWORD'] = password
    for key, prompt in [('GROWAI_DAILY_BUDGET_FEN', '每日最高预算（分）'),
                        ('GROWAI_CALL_CEILING_FEN', '按供应商合同填写单次调用费用上界（分）')]:
        value = os.getenv(key) or input(prompt + '：').strip()
        if not value.isascii() or not value.isdigit() or int(value) < 1:
            sys.exit('预算和单次上界均需为正整数')
        os.environ[key] = value
sys.path.insert(0, str(root / 'backend'))
os.environ['GROWAI_WEB_DIR'] = str(root / ('web' if (root / 'web').is_dir() else 'dist'))
if not args.no_browser:
    import threading
    threading.Timer(1.5, lambda: webbrowser.open('http://localhost:8081/coach')).start()
uvicorn.run('app.main:app', host='127.0.0.1', port=8081, access_log=False, proxy_headers=False)
