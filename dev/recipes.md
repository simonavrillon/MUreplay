# Recipes

Checklists for the changes this repo sees most. Each ends with how to check the change. Read
[architecture.md](architecture.md) first if the layer names are new to you.

## Follow a MUedit2 change

When `tests/test_muedit2_parity.py` fails, MUedit2 has changed something MUreplay mirrors.

1. **Find it**: the failing test names the function. `git log -p` in MUedit2 on that function's
   file shows what moved: a renamed argument, a new step in the refit, a different order of
   operations.
2. **Port it as it is**: copy MUedit2's code into `replay/filter_update.py` (or the module the
   [parity table](contracts.md#parity-with-muedit2) names), keeping its names and its order of
   float operations. Don't tidy it: the comparison is exact.
3. **Follow the caller**: if MUedit2's `EditSession.update_filter` changed what it passes (which
   MUs it peels off, the bandpass, the mask), change `ReplaySession._refit` in
   `replay/session.py` the same way. If MUedit2's session, store or budget changed shape
   (`storage.py`, `api/memory.py`), port that as it is too.
4. **Update the parity test** only where MUedit2's signature changed; never loosen a comparison.

Check: `uv run pytest tests/test_muedit2_parity.py` with the end-to-end replay included (it needs
MUedit2's `data/Test`), then the whole suite.

## Replay a new step type

A new edit in MUedit2 logs a new step `type`.

1. **Replay it**: if it carries a diff MUreplay can apply, extend
   `ReplaySession._apply_logged_diff` in `replay/session.py`, which both applies a step and
   rewinds it; the undo stack restores whatever it changed. A spike edit also belongs in
   `frontend/src/replay/operations.js: isSpikeEditStep`, which groups it on the timeline. If it changes which MUs are live, extend
   `replay/operations.py: inactive_mus_before` and the marks in `replay-service.js: logMarks`.
2. **Timeline colour**: `groupColorKind` in `replay-service.js`, with a token in
   `css/tokens.css` if it needs a new colour.
3. **Docs**: the step type in `docs/user-guide.md` (what each step type does, its colour) and in
   `docs/file-formats.md` (the edit log).

Check: a forward-and-back round trip in `tests/test_replay_session.py`, then `uv run pytest`
and `npm run check`.

## Add an API route

1. **Route**: in `api/routes/<area>.py`, `APIRouter(prefix="/api/v1")`, a plain `def`. Keep it
   thin: parse, call a service, return `success_payload(...)`, or `frame_response(...)` when it
   sends arrays. A route that reads a replay session takes `Depends(request_session)`.
2. **Request model**: a Pydantic model in `api/schemas.py` (no free-form dicts).
3. **Logic**: in `api/services/<area>_service.py`, or in a domain package if it isn't HTTP work.
   Raise `MureplayError` (or `NotFoundError`) with `field=` for anything the user can fix.
4. **Register** a new router in `api/routes/__init__.py: include_routers`.
5. **Frontend**: the path in `frontend/src/api/routes.js`, a method in `api/client.js`, and a
   normaliser in `api/payloads.js` if the response needs typing (a decoder in
   `api/binary-payloads.js` for a frame).
6. **Tests**: through `TestClient` in `tests/test_api_<area>.py` (helpers in `tests/_api.py`);
   `test_api_app.py` already checks that `routes.js` names only served paths.
7. **Docs**: the route in [contracts.md](contracts.md#http).

Check: `uv run pytest tests/test_api_app.py tests/test_api_<area>.py`, `npm run check`.

## Add a canvas colour

1. A token in `frontend/css/tokens.css` (under the canvas section), named `--plot-…`.
2. Its `COLOR_TOKENS` entry in `frontend/src/config.js`; draw with `COLORS.<name>`.

Check: `npm run check` (`tests/config.test.js` fails on a key whose token is missing), then
look at the plot.
