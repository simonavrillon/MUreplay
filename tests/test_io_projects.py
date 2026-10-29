"""The project tree: the BIDS datasets under the data folder, down to their edit logs."""

from __future__ import annotations

from pathlib import Path

from mureplay.io.projects import list_projects


def _touch(path: Path) -> None:
    """Create an empty file at ``path``, with its folders."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def _dataset(root: Path) -> Path:
    """An empty BIDS dataset at ``root``."""
    _touch(root / "dataset_description.json")
    return root


# ── list_projects ───────────────────────────────────────────────────────────


class TestListProjects:
    def test_edit_logs_are_grouped_by_subject_and_session(self, tmp_path: Path) -> None:
        project = _dataset(tmp_path / "Study")
        decomp = project / "derivatives" / "muedit" / "sub-2" / "ses-1" / "decomp"
        _touch(decomp / "sub-2_ses-1_task-b_run-1_edited.json")
        _touch(decomp / "sub-2_ses-1_task-a_run-1_edited.json")
        _touch(decomp / "sub-2_ses-1_task-a_run-1_decomp.npz")
        # The older layout, with no session folder or entity.
        _touch(project / "sub-1" / "decomp" / "sub-1_task-a_edited.json")

        [study] = list_projects(tmp_path)
        assert study["name"] == "Study"
        sub1, sub2 = study["subjects"]
        assert sub1["name"] == "sub-1"
        assert [s["name"] for s in sub1["sessions"]] == [""]
        assert sub2["sessions"][0]["name"] == "ses-1"
        trials = sub2["sessions"][0]["trials"]
        assert [t["name"] for t in trials] == ["task-a_run-1", "task-b_run-1"]
        assert trials[0]["path"] == str(decomp / "sub-2_ses-1_task-a_run-1_edited.json")

    def test_only_folders_holding_a_dataset_are_projects(self, tmp_path: Path) -> None:
        _dataset(tmp_path / "B")
        _dataset(tmp_path / "A")
        (tmp_path / "notes").mkdir()
        _dataset(tmp_path / ".hidden")
        assert [p["name"] for p in list_projects(tmp_path)] == ["A", "B"]

    def test_a_data_folder_that_is_a_dataset_is_the_one_project(self, tmp_path: Path) -> None:
        _touch(_dataset(tmp_path / "Study") / "sub-1" / "decomp" / "sub-1_task-a_edited.json")
        [study] = list_projects(tmp_path / "Study")
        assert study["subjects"][0]["name"] == "sub-1"

    def test_a_missing_data_folder_has_no_projects(self, tmp_path: Path) -> None:
        assert list_projects(tmp_path / "missing") == []
