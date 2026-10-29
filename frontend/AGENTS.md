# Frontend conventions

Rules for `frontend/`. ESLint, Prettier and `tsc --checkJs` (`npm run check`) already enforce
formatting, kebab-case filenames, unused names and types; this file covers what they can't.
Architecture: [dev/architecture.md](../dev/architecture.md#frontend-shape). Wire formats:
[dev/contracts.md](../dev/contracts.md).

## Shape

- Vanilla ES modules, no framework, no bundler, no runtime dependencies. The browser loads
  `app.js` directly; don't add a build step.
- Every feature function takes the `app` context (`@param {App} app`) and destructures what it
  uses. A member goes on `app` (and on its typedef in `app/context.js`) only when another module
  calls it through `app`; everything else is imported where it's used.
- A service factory reads only `state`, `els` and `api` while it is constructed. Other services
  are reached as `app.x()` inside function bodies (the renderer too: `app.renderAll()`).
- Service methods are typed from `context.js`: `/** @type {ReplayService["name"]} */`. Only
  private helpers carry their own `@param`s.
- Type parameters as what callers should pass. When a function guards against missing input,
  write `T | null | undefined` and keep the guard. `unknown` is only for caught errors and
  validators of raw input. Name a shape next to the code that owns it (state shapes in
  `state/state.js`, cross-module ones in `context.js`); single-use bags stay inline.

## State and DOM

- Change state only through the setters in `state/actions.js`; read with `state/selectors.js`
  where a selector exists. A newly opened session replaces the old one through
  `state/transitions.js: beginSession`.
- The server holds the replay; the page holds a window of it. Never fetch or keep a
  full-length array: the pulse train on screen is `state.pulseView`, fetched for the view and
  the MU's version (`ensurePulseView`), and a seek's change frame carries only the MUs it moved.
- Every scripted element has a typed handle in `app/dom.js`, used as `app.els.x`. Element ids
  in `index.html` are referenced by the docs, so rename them with care.
- Hide elements with the `hidden` attribute (`el.hidden = true`); `css/base.css` makes it win
  over any `display` a class sets. There is no `.hidden` class.
- View modules (`view/`) only draw the state they're given; input handling lives in the stages
  (`app/stages/`).
- Colours are CSS tokens in `css/tokens.css`. Canvases read them through `COLORS` in
  `config.js`: a new canvas colour is a token plus a `COLOR_TOKENS` entry, never a literal.

## Backend calls

- Paths live only in `api/routes.js`; calls only in `api/client.js`. `tests/test_api_app.py`
  fails if `routes.js` names a path the backend doesn't serve.
- Backend JSON is `JsonObject` until it is normalised at the boundary (`api/payloads.js`).
  Arrays arrive as MUB1 frames, decoded in `api/binary-payloads.js` into typed-array views.
- Every request carries the tab's session id (`api/http.js: apiFetch`).
- Branch on `ApiError.field` / `.status`, never on message text. Report failures with
  `handleError(err, setReplayStatus, label)` (`app/services/error-service.js`).

## Style

- Each module opens with a comment stating its role and its rules (see
  `app/services/replay-service.js`). Elsewhere, comment only what the code can't say.
- Reuse the names the backend, MUedit2 and other modules use for the same concept (`fsamp`,
  `gridNames`, `muGridIndex`, `muUids`, `spikeTimes`).
- Write the simplest change that does the job.

## Tests

`node --test tests/*.test.js`, laid out like the pytest suite (`tests/AGENTS.md`):

- One file per source module: `<package>-<module>.test.js` (`api-payloads.test.js` for
  `src/api/payloads.js`). Under `app/`, the `services/` and `stages/` folders and the `-service`
  suffix drop: `app-replay.test.js` is `app/services/replay-service.js`. Add to the existing
  file before creating one.
- One `describe` per function or behaviour; test names are sentences about behaviour.
- Test what the user would notice, or what the other side of a contract relies on; no guards
  for input the backend never sends.
- Tests are type-checked too (`tsconfig.test.json`), so a fake that drifts from what it stands
  in for fails the build.

| Helper       | For                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_dom.js`    | `installDom` (window, document, `getComputedStyle` over the real `css/tokens.css`), `fakeElement`, `fakeSelect`, `fakeCanvas` (records its 2D calls) |
| `_frames.js` | `encodeFrame`: a MUB1 frame built as the backend's `pack_frame` builds it                                                                            |

Call `installDom()` before running code that reads the page: `config.js` reads the tokens
through `getComputedStyle`, and the replay service creates `<option>` elements.

## Before you finish

`npm run check` (eslint, prettier --check, tsc, node --test). For UI changes, run the app and
look. Update `docs/user-guide.md` for any label, control or shortcut you changed.
