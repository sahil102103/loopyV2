"""Vercel-compatible entrypoint for the Flask application.

Render uses ``app:app`` directly; this wrapper keeps the checked-in Vercel
configuration valid without maintaining a second backend implementation.
"""

from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app  # noqa: E402,F401
