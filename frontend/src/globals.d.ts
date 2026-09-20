// Optional page globals (may be set in the browser console or by embedders)
// and the browser environment.
declare global {
  interface Window {
    /** Optional override for the backend API base URL. */
    MUREPLAY_API_BASE?: string;
    /** Set by the app container from the backend /config endpoint. */
    MUREPLAY_BIDS_ROOT?: string;
    MUREPLAY_NBEXTCHAN?: number | string;
  }
}

export {};
