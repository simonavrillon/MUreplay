# Backend conventions

Rules for `python/src/mureplay/`. Ruff and mypy (config in `pyproject.toml`) already enforce
formatting, imports, annotations and the bug-finder rules; this file covers what they can't.
Architecture: [dev/architecture.md](../../../dev/architecture.md). Wire formats:
[dev/contracts.md](../../../dev/contracts.md).

## Layers

- Imports flow one way: `api` → `io` → `replay`, all over `errors` and `paths`. Never import
  `mureplay.api` from `io` or `replay`; `replay` imports no other first-party package.
- Routes stay thin: parse, call a service, return `success_payload(...)`. Logic goes in
  `api/services/`, or in a domain package when it isn't HTTP work.
- Routes are plain `def`, so FastAPI runs them in its thread pool: the refit, the loaders and
  the file dialog block.
- `mureplay/__init__.py` exports only `installed_version()`; import from the sub-package.

## The MUedit2 mirror

- `replay/filter_update.py` mirrors MUedit2's refit (`muedit.editing.operations.
  update_motor_unit_filter_window` and the primitives it calls) **bit for bit**: same names,
  same arguments, same order of float operations. A replayed step must land on the session's
  saved result, and `tests/test_muedit2_parity.py` compares them with exact equality.
- Change it only to follow MUedit2, by porting MUedit2's code as it is. An improvement made
  here alone breaks the replay.
- `api/services/filter_service.py` stands in for MUedit2's `EditSession.update_filter`: the
  grid filtered once, whole; peel-off over the grid's other live MUs; the grid's bandpass from
  `INTRAMUSCULAR_GRIDS`.

## Errors and logging

- Raise a `MureplayError` subclass (`mureplay/errors.py`) for anything the user can fix, with
  `field=` naming the request field at fault. Its message reaches the user verbatim, so make it
  specific. Any other exception is a bug and becomes a generic 500.
- Don't catch exceptions to return error dicts; let `api/errors.py` answer.
- A broad `except Exception` needs `# noqa: BLE001` and a reason in parentheses, and must log.
- A user error is an INFO line. A bug is an ERROR with its traceback.

## Style

- Single-line docstrings on every module, class and function. Comment only what the code can't
  say: a spec rule (BIDS), a unit fact, an ordering constraint, why a constant has its value.
- Reuse the codebase's name for a concept, and MUedit2's where it has one: `fsamp`,
  `grid_names`, `mu_grid_index`, `spike_times`, `discard_mask`, `peel_off_spike_times`,
  `peel_off_win`. Grep first.
- Write the simplest change that does the job: no new abstraction layers or speculative options.
- Request models are Pydantic, in `api/schemas.py` only.
- Constants are module-level `UPPER_CASE`, with a `#:` comment when the value needs a reason;
  environment variable names are `*_ENV` constants beside their default.
- Private helpers start with `_`.

## Before you finish

`uv run ruff check . && uv run ruff format .`, `uv run mypy`, `uv run pytest -m "not data"`.
Update the doc that owns anything user-visible you changed (see the root `AGENTS.md`).
