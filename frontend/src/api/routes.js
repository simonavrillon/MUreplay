/**
 * Central API endpoint path table. Callers compose the full URL by
 * prepending API_BASE (injected via deps): `${API_BASE}${routes.health}`.
 */
export const routes = {
  health: "/health",
  config: "/config",
  loadPairedFromPath: "/load-paired-from-path",
  editUpdateFilter: "/edit/update-filter",
  dialogOpenFile: "/dialog/open-file",
};
