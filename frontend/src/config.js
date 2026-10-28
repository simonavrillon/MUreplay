// The CSS tokens canvases draw with.

/** @type {Map<string, string>} */
const tokenCache = new Map();

/**
 * A custom property of `:root`, as css/tokens.css defines it.
 *
 * @param {string} name
 */
function cssToken(name) {
  let value = tokenCache.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    // Empty until tokens.css applies: a draw that early must not fix it for good.
    if (value) tokenCache.set(name, value);
  }
  return value;
}

const COLOR_TOKENS = {
  muted: "--muted",
  discharge: "--mu-4",
  artifactMarker: "--artifact",
  pulseTrain: "--plot-trace-2",
  artifactWindowFill: "--plot-artifact-fill",
  artifactWindowStroke: "--plot-artifact-stroke",
  selectionFill: "--plot-selection-fill",
  selectionStroke: "--plot-selection-stroke",
  stepAddedFill: "--plot-step-added-fill",
  stepAddedStroke: "--plot-step-added-stroke",
  stepRemovedFill: "--plot-step-removed-fill",
  stepRemovedStroke: "--plot-step-removed-stroke",
  gridline: "--plot-gridline",
  axis: "--plot-axis",
  markerOutline: "--plot-marker-outline",
  timelineTrack: "--plot-timeline-track",
  timelineAdded: "--plot-timeline-added",
  timelineRemoved: "--plot-timeline-removed",
  timelineSpikes: "--plot-timeline-spikes",
  timelineViewFill: "--plot-timeline-view-fill",
  timelineViewStroke: "--plot-timeline-view-stroke",
};

/**
 * Canvas colours, read from css/tokens.css on first use.
 *
 * @type {{ readonly [K in keyof typeof COLOR_TOKENS]: string }}
 */
export const COLORS = /** @type {any} */ ({});
for (const [key, name] of Object.entries(COLOR_TOKENS)) {
  Object.defineProperty(COLORS, key, { get: () => cssToken(name) });
}

/** @type {string | undefined} */
let fontCache;

/** Canvas text: the page's font at its small size. */
export function canvasFont() {
  if (fontCache) return fontCache;
  // Canvas text is drawn in pixels, so the rem token is resolved against the root size.
  const rootPx = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const size = cssToken("--fs-xs");
  const family = cssToken("--font");
  const font = `${parseFloat(size) * (rootPx || 16)}px ${family}`;
  if (size && family) fontCache = font;
  return font;
}
