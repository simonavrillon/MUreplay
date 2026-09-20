"""Native OS file picker (AppleScript on macOS, tkinter elsewhere)."""

from __future__ import annotations

import subprocess
import sys

DIALOG_EXTENSIONS = ["npz", "json"]

TKINTER_DIALOG = """\
import sys
try:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    path = filedialog.askopenfilename(
        title='Select decomp NPZ or edited JSON',
        filetypes=[
            ('Decomp / log files', '*.npz *.json'),
            ('NPZ files', '*.npz'),
            ('JSON files', '*.json'),
            ('All files', '*'),
        ],
    )
    root.destroy()
    print(path or '', end='')
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"""


def _open_dialog_macos() -> str | None:
    """Open a native file chooser via AppleScript on macOS."""
    ext_list = "{" + ", ".join(f'".{e}"' for e in DIALOG_EXTENSIONS) + "}"
    script = (
        'tell application "System Events"\n'
        "  activate\n"
        f'  set f to choose file with prompt "Select decomp NPZ or edited JSON" '
        f"of type {ext_list}\n"
        "  return POSIX path of f\n"
        "end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    path = result.stdout.strip()
    return path if path else None


def _open_dialog_tkinter() -> str | None:
    """Open a native file chooser using tkinter in a subprocess."""
    kwargs: dict = {}
    if sys.platform == "win32":
        # Suppress the console window that would briefly flash on Windows
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run(
        [sys.executable, "-c", TKINTER_DIALOG],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        **kwargs,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "tkinter dialog failed")
    path = result.stdout.strip()
    return path if path else None


def open_native_dialog() -> str | None:
    """Open the platform-appropriate native file chooser."""
    if sys.platform == "darwin":
        path = _open_dialog_macos()
    else:
        path = _open_dialog_tkinter()
    return path
