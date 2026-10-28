"""Native OS file chooser: AppleScript on macOS, tkinter in a subprocess elsewhere."""

from __future__ import annotations

import subprocess
import sys
from typing import Any

#: The files the replay opens: a decomposition, or the edit log beside it.
_EXTENSIONS = ["npz", "json"]
_PROMPT = "Select a decomposition (.npz) or its edit log (.json)"
#: Seconds the dialog may stay open before the request gives up.
_TIMEOUT_SEC = 120

# Python snippet for tkinter — run in a subprocess so it owns the main thread,
# which is required on Linux/Windows. Its argv: the prompt, then the extensions.
_TKINTER_SCRIPT = """\
import sys
try:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    patterns = ' '.join('*.' + e for e in sys.argv[2:])
    path = filedialog.askopenfilename(
        title=sys.argv[1],
        filetypes=[('Decomposition or edit log', patterns), ('All files', '*')],
    )
    root.destroy()
    print(path or '', end='')
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"""


def _open_dialog_macos() -> str | None:
    """Open a native file chooser via AppleScript on macOS."""
    ext_list = "{" + ", ".join(f'".{e}"' for e in _EXTENSIONS) + "}"
    script = (
        'tell application "System Events"\n'
        "  activate\n"
        f'  set f to choose file with prompt "{_PROMPT}" of type {ext_list}\n'
        "  return POSIX path of f\n"
        "end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SEC,
        check=False,
    )
    path = result.stdout.strip()
    return path if path else None


def _open_dialog_tkinter() -> str | None:
    """Open a native file chooser using tkinter in a subprocess."""
    kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        # Suppress the console window that would briefly flash on Windows.
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run(
        [sys.executable, "-c", _TKINTER_SCRIPT, _PROMPT, *_EXTENSIONS],
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SEC,
        check=False,
        **kwargs,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "tkinter dialog failed")
    path = result.stdout.strip()
    return path if path else None


def choose_file() -> str | None:
    """The path the user picks in the native open dialog, or ``None`` when cancelled."""
    return _open_dialog_macos() if sys.platform == "darwin" else _open_dialog_tkinter()
