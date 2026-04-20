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


def open_native_dialog() -> str | None:
    if sys.platform == "darwin":
        ext_list = "{" + ", ".join(f'".{e}"' for e in DIALOG_EXTENSIONS) + "}"
        script = (
            'tell application "System Events"\n'
            '  activate\n'
            f'  set f to choose file with prompt "Select decomp NPZ or edited JSON" '
            f'of type {ext_list}\n'
            '  return POSIX path of f\n'
            'end tell'
        )
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
        path = result.stdout.strip()
        return path if path else None

    kwargs: dict[str, object] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    result = subprocess.run(
        [sys.executable, "-c", TKINTER_DIALOG],
        capture_output=True,
        text=True,
        timeout=120,
        **kwargs,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "tkinter dialog failed")
    path = result.stdout.strip()
    return path if path else None
