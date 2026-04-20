export function buildMuUids(muGridIndex) {
  const counts = {};
  return muGridIndex.map((gridIdx) => {
    const k = Number(gridIdx) || 0;
    const n = counts[k] || 0;
    counts[k] = n + 1;
    return `g${k}_mu${n}`;
  });
}

export function toOptionalInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseMaybeList(raw) {
  const txt = String(raw).trim();
  if (!txt) return [];
  const clean = txt.replace(/^\[/, "").replace(/\]$/, "");
  return clean
    .split(/[;|\s]+|,/)
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n));
}

export function asNumberArray(value) {
  if (Array.isArray(value)) return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (typeof value === "string" && value.trim()) return parseMaybeList(value);
  return [];
}

export function inferEntityLabel(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  return base.replace(/_edited$/i, "").replace(/_decomp$/i, "");
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
