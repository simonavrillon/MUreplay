# Test conventions

Rules for the pytest suite in `tests/`. The frontend suite is covered in `frontend/AGENTS.md`.
Tests are linted and type-checked like the package (`uv run ruff check .`, `uv run mypy`).

## Layout

- One file per source module: `test_<package>_<module>.py` (`test_io_bids.py`,
  `test_replay_artifact_mask.py`, `test_api_editing.py`). Add to the existing file before
  creating one.
- One suite crosses modules and is named for what it checks: `test_muedit2_parity.py`, which
  imports MUedit2 beside MUreplay and requires identical output, up to replaying MUedit2's
  sample session and landing on its saved file.
- Group tests for one function or behaviour in a `class TestThing:`; mark sections with
  `# ── name ───` dividers. Test names are sentences about behaviour:
  `test_a_padded_recording_is_clamped_to_its_declared_duration`.
- Single-line docstrings, as in the package.

## Shared helpers (reuse before writing new ones)

| Helper | For |
|---|---|
| `conftest.py` | `client` (`TestClient`), the sample-data fixtures (`sample_bids_root`, `muedit2_session`), `REPO_ROOT`, `MUEDIT2_ROOT`, `SAMPLE_ENTITY`, and the autouse `config_file` (a config file of the test's own, so no test reads or writes the user's) |
| `_api.py` | `API` prefix, envelope readers (`ok`, `error`) |

## Data

- Prefer synthetic data; CI has no recordings. CI runs `-m "not data"`.
- A test that needs a sample file takes one of the fixtures in `conftest.py: DATA_FIXTURES`,
  which gives it the `data` marker automatically. Add new sample fixtures to `DATA_FIXTURES`.
- `data/Test` (this repo) and MUedit2's `data/Test` hold MUedit2's sample session: raw BIDS EMG,
  the decomposition, the edited save and its edit log.
- Write files into `tmp_path`, never into the repo.

## The parity suite

- It finds MUedit2 at `../MUedit2`, or at `MUEDIT2_ROOT`; without a checkout it skips. CI checks
  MUedit2 out beside MUreplay so drift fails the build.
- Compare with `np.testing.assert_array_equal`: the mirror is exact, so a tolerance would hide
  a real divergence.
- MUedit2's imports pull in `h5py` and `xmltodict`, which MUreplay doesn't install; `_mu2` stubs
  them. Don't add them as dependencies.

## What to test

- API behaviour through `TestClient` and the real routes (status, envelope, `detail.field`);
  domain logic by calling the module directly.
- Test the fix or feature itself. Don't add speculative guard tests or tests that restate the
  implementation.
- Seed randomness (`np.random.default_rng(0)`), and use `pytest.approx` / `np.testing` for floats.

## Run

```bash
uv run pytest -m "not data"          # the CI tier
uv run pytest tests/test_x.py -k y   # one area
uv run pytest                        # everything, needs the sample data
```

`MUREPLAY_REQUIRE_DATA=1` turns a missing sample file into a failure instead of a skip.
