"""The data folder picked in the native OS folder chooser: AppleScript on macOS, tkinter elsewhere."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from mureplay.errors import MureplayError
from mureplay.paths import DATA_ROOT_ENV, data_root, data_root_override, save_data_root

_PROMPT = "Select the data folder: a BIDS dataset, or a folder of them"
#: Seconds the dialog may stay open before the request gives up.
_TIMEOUT_SEC = 120

# The prompt and the starting folder go in as arguments, so no path is ever quoted into the script.
_APPLESCRIPT = """\
on run argv
  set start to POSIX file (item 2 of argv)
  tell application "System Events"
    activate
    set f to choose folder with prompt (item 1 of argv) default location start
  end tell
  return POSIX path of f
end run
"""

# Python snippet for tkinter — run in a subprocess so it owns the main thread,
# which is required on Linux/Windows. Its argv: the prompt, then the starting folder.
_TKINTER_SCRIPT = """\
import sys
try:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    path = filedialog.askdirectory(title=sys.argv[1], initialdir=sys.argv[2], mustexist=True)
    root.destroy()
    print(path or '', end='')
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"""


def _open_dialog_macos(start: Path) -> str | None:
    """Open a native folder chooser via AppleScript on macOS."""
    result = subprocess.run(
        ["osascript", "-e", _APPLESCRIPT, _PROMPT, str(start)],
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SEC,
        check=False,
    )
    path = result.stdout.strip()
    return path if path else None


def _open_dialog_tkinter(start: Path) -> str | None:
    """Open a native folder chooser using tkinter in a subprocess."""
    kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        # Suppress the console window that would briefly flash on Windows.
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run(
        [sys.executable, "-c", _TKINTER_SCRIPT, _PROMPT, str(start)],
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


def choose_folder(start: Path) -> Path | None:
    """The folder the user picks in the native dialog, opened on ``start``; None when cancelled."""
    # The dialog cannot open on a folder that is gone.
    start = start if start.is_dir() else Path.home()
    path = _open_dialog_macos(start) if sys.platform == "darwin" else _open_dialog_tkinter(start)
    return Path(path) if path else None


def choose_data_folder() -> Path | None:
    """Make the folder picked in the native dialog the data folder; None when cancelled."""
    if data_root_override() is not None:
        raise MureplayError(
            f"The data folder is set by {DATA_ROOT_ENV}. Unset it and relaunch MUreplay "
            "to choose one here."
        )
    folder = choose_folder(data_root())
    if folder is not None:
        save_data_root(folder)
    return folder
