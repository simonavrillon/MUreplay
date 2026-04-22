const API_BASE = String(window.MUREPLAY_API_BASE || "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export async function postJson(url, payload) {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchConfig() {
  const r = await fetch(apiUrl("/api/config"));
  if (!r.ok) return null;
  return r.json();
}

export async function waitForBackend(healthUrl, { intervalMs = 500, timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function openDialogPath() {
  const res = await fetch(apiUrl("/api/open-dialog"));
  if (!res.ok) throw new Error(await res.text());
  const { path } = await res.json();
  return path;
}
