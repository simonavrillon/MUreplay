"""The BIDS projects under the data folder, as the tree the settings rail browses."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mureplay.io.bids import entity_pairs

_EDIT_LOG_SUFFIX = "_edited.json"


def _is_dataset(folder: Path) -> bool:
    """Whether ``folder`` is a BIDS dataset: it holds a ``dataset_description.json``."""
    return (folder / "dataset_description.json").is_file()


def _subjects(dataset: Path) -> list[dict[str, Any]]:
    """The dataset's edit logs, grouped by subject then session, each level sorted by name."""
    tree: dict[str, dict[str, list[dict[str, str]]]] = {}
    for log in dataset.rglob(f"*{_EDIT_LOG_SUFFIX}"):
        if any(part.startswith(".") for part in log.relative_to(dataset).parts):
            continue
        entity_label = log.name[: -len(_EDIT_LOG_SUFFIX)]
        entities = entity_pairs(entity_label)
        if "sub" not in entities:
            continue
        # A trial is named by the entities below the session: task, acq, run.
        trial = "_".join(
            part for part in entity_label.split("_") if not part.startswith(("sub-", "ses-"))
        )
        sessions = tree.setdefault(f"sub-{entities['sub']}", {})
        session = f"ses-{entities['ses']}" if "ses" in entities else ""
        sessions.setdefault(session, []).append({"name": trial or entity_label, "path": str(log)})
    return [
        {
            "name": subject,
            "sessions": [
                {"name": session, "trials": sorted(trials, key=lambda t: t["name"])}
                for session, trials in sorted(sessions.items())
            ],
        }
        for subject, sessions in sorted(tree.items())
    ]


def list_projects(root: Path) -> list[dict[str, Any]]:
    """The BIDS datasets in ``root`` (or ``root`` itself, when it is one) with their trials."""
    if _is_dataset(root):
        datasets = [root]
    elif root.is_dir():
        datasets = sorted(
            folder
            for folder in root.iterdir()
            if not folder.name.startswith(".") and _is_dataset(folder)
        )
    else:
        datasets = []
    return [{"name": folder.name, "subjects": _subjects(folder)} for folder in datasets]
