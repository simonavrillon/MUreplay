"""MUedit2's ``update_filter`` refit (notch, bandpass, PCA, whitening, peel-off, k-means), mirrored."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, TypeAlias

import numpy as np
from numpy.typing import ArrayLike, DTypeLike
from scipy.cluster.vq import ClusterError, kmeans2
from scipy.fft import irfft, rfft
from scipy.linalg import eigh, inv
from scipy.signal import butter, filtfilt, find_peaks

from mureplay.errors import MureplayError

# Kept bit-identical to muedit.editing.operations.update_motor_unit_filter_window and the
# primitives it calls, so a replayed step lands on the session's result;
# tests/test_muedit2_parity.py fails when the two drift apart.

DEFAULT_NBEXTCHAN: int = 1000
DEFAULT_PEEL_OFF_WIN_SEC: float = 0.025
ComputeDtype: TypeAlias = Literal["float32", "float64"]
DEFAULT_COMPUTE_DTYPE: ComputeDtype = "float32"
#: Seconds cut from each end of the refit window: bandpass transients and the extension's padding.
EDGE_SEC = 0.1


def edge_samples(fsamp: float) -> int:
    """``EDGE_SEC`` in samples."""
    return int(round(EDGE_SEC * fsamp))


def spike_array(values: Any) -> np.ndarray:
    """Discharge times as sorted, unique, non-negative int32 sample indices."""
    arr = np.asarray(values if values is not None else [], dtype=np.int64).reshape(-1)
    arr = np.unique(arr[arr >= 0])
    if arr.size and arr[-1] > np.iinfo(np.int32).max:
        raise ValueError(f"spike time {int(arr[-1])} does not fit in int32")
    return arr.astype(np.int32)


# ── Session preprocessing ───────────────────────────────────────────────────

NOTCH_WINDOW_HZ: float = 50.0


def _bandpass_coefficients(fsamp: float, emg_type: int) -> tuple[np.ndarray, np.ndarray]:
    """Butterworth (b, a) for the surface (1) or intramuscular (2) bandpass."""
    if emg_type == 1:
        if fsamp <= 1000:
            raise MureplayError(
                f"Surface bandpass (20-500 Hz) requires fsamp > 1000 Hz; got {fsamp} Hz."
            )
        return butter(2, [20, 500], btype="bandpass", fs=fsamp)
    if fsamp <= 8800:
        raise MureplayError(
            f"Intramuscular bandpass (100-4400 Hz) requires fsamp > 8800 Hz; got {fsamp} Hz."
        )
    return butter(3, [100, 4400], btype="bandpass", fs=fsamp)


def bandpass_inplace(signal: np.ndarray, fsamp: float, emg_type: int = 1) -> None:
    """Zero-phase Butterworth bandpass of ``signal`` in place, row by row."""
    b, a = _bandpass_coefficients(fsamp, emg_type)
    for row in range(signal.shape[0]):
        signal[row] = filtfilt(b, a, signal[row])


def _notch_params(fsamp: float, n_samples: int) -> tuple[int, int]:
    """Harmonic half-width ``frad`` and median window, both in FFT bins."""
    frad = int(round(4 / (fsamp / n_samples)))
    window = max(1, int(round(NOTCH_WINDOW_HZ * n_samples / fsamp)))
    return frad, window


def _remove_line_interference(x: np.ndarray, frad: int, window: int) -> np.ndarray:
    """Remove interference from a single-channel signal, computed in float64."""
    x = np.asarray(x, dtype=np.float64)  # a float32 FFT would run in single precision
    n = x.size
    spectrum = rfft(x)
    magnitude = np.abs(spectrum)
    half = frad // 2

    # The thresholds come from segments of the two-sided magnitude. A segment starting more
    # than ``half`` bins past Nyquist only flags bins that are dropped, so it is not scanned.
    n_segments = min(len(range(0, n - window, window)), (n // 2 + half - 1) // window + 1)
    two_sided = np.concatenate([magnitude, magnitude[1 : n - n // 2][::-1]])
    segments = two_sided[1 : n_segments * window + 1].reshape(n_segments, window)
    threshold = np.median(segments, axis=1) + 5 * np.std(segments, axis=1)
    rows, cols = np.nonzero(segments > threshold[:, None])
    peaks = rows * window + cols + 1
    tstamp = (peaks[:, None] + np.arange(-half, half + 1)).ravel()
    tstamp = tstamp[(tstamp > 0) & (tstamp <= n // 2)]

    correction = np.zeros_like(spectrum)
    correction[tstamp] = spectrum[tstamp]
    return x - irfft(correction, n)


def notch_inplace(signal: np.ndarray, fsamp: float) -> None:
    """FFT notch of mains harmonics, without knowing the line frequency, written back row by row."""
    if signal.size == 0:
        return
    frad, window = _notch_params(fsamp, signal.shape[1])
    for row in range(signal.shape[0]):
        signal[row] = _remove_line_interference(signal[row], frad, window)


def emg_filter_inplace(signal: np.ndarray, fsamp: float, emg_type: int = 1) -> None:
    """The decomposition's filtering of one grid's rows (notch, then bandpass), written back."""
    # MUedit2's session filters a grid once, whole, before any update_filter step: the notch
    # is an FFT over the whole recording, so it cannot be applied to a view.
    notch_inplace(signal, fsamp)
    bandpass_inplace(signal, fsamp, emg_type)


# ── Extension, PCA and whitening ────────────────────────────────────────────

#: Columns per covariance/whitening chunk, so one float64 chunk stays near 32 MiB.
_CHUNK_BYTES = 32 * 1024 * 1024


def extension_factor(nbextchan: int, n_channels: int) -> int:
    """Delays per channel that bring ``n_channels`` closest to ``nbextchan`` extended channels."""
    return max(1, int(round(nbextchan / max(n_channels, 1))))


def extend_mask(mask: np.ndarray, ex_factor: int) -> np.ndarray:
    """Mask of the extended samples: sample ``t`` is masked if any of ``t - ex_factor + 1 .. t`` is."""
    out = np.array(mask, dtype=bool)
    for m in range(1, ex_factor):
        out[m:] |= mask[:-m]
    return out


def extend_signal(signal: np.ndarray, ex_factor: int, dtype: DTypeLike | None = None) -> np.ndarray:
    """Delay-embedding channel extension; channels-first output in ``dtype`` (or float64)."""
    out_dtype = np.result_type(signal.dtype, np.float64) if dtype is None else np.dtype(dtype)
    if ex_factor <= 1:
        return signal.astype(out_dtype, copy=True)

    rows, cols = signal.shape
    esample = np.zeros((rows * ex_factor, cols + ex_factor - 1), dtype=out_dtype)
    for m in range(ex_factor):
        esample[m * rows : (m + 1) * rows, m : cols + m] = signal
    return esample


def window_trim(n_samples: int, fsamp: float, edges_sec: float, ex_factor: int) -> int:
    """Columns cut from each end of an extended window: ``edges_sec``, and never the zero-padded ones."""
    # extend_signal zero-pads ex_factor - 1 columns at each end; they must never reach PCA.
    incomplete = max(0, ex_factor - 1)
    for trim in (max(int(round(fsamp * edges_sec)), incomplete), incomplete):
        if n_samples > 2 * trim:
            return trim
    return 0


def zeroed_matmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """``a @ b`` written into a zeroed output, so a stale buffer cannot leak NaNs."""
    out = np.zeros((*a.shape[:-1], b.shape[1]), dtype=np.result_type(a, b))
    return np.matmul(a, b, out=out)


def vec_mat(v: np.ndarray, m: np.ndarray) -> np.ndarray:
    """``v @ m`` in ``m``'s dtype, written into a zeroed output."""
    return zeroed_matmul(v.astype(m.dtype), m)


def _chunk_cols(n_rows: int) -> int:
    """Columns per chunk so one float64 chunk stays near ``_CHUNK_BYTES``."""
    return max(1, _CHUNK_BYTES // (8 * max(1, n_rows)))


def _column_chunks(
    n_cols: int, n_rows: int, columns: np.ndarray | None = None
) -> list[slice] | list[np.ndarray]:
    """Split all columns, or the given column indices, into memory-bounded chunks."""
    step = _chunk_cols(n_rows)
    if columns is None:
        return [slice(c, min(c + step, n_cols)) for c in range(0, n_cols, step)]
    return [columns[c : c + step] for c in range(0, columns.size, step)]


def covariance(signal: np.ndarray, columns: np.ndarray | None = None) -> np.ndarray:
    """Biased row covariance of ``signal`` (or of its ``columns``), built in float64 column chunks."""
    n_rows, n_cols = signal.shape
    chunks = _column_chunks(n_cols, n_rows, columns)
    n = n_cols if columns is None else columns.size
    if columns is None:
        mean = signal.mean(axis=1, dtype=np.float64)
    else:
        mean = np.zeros(n_rows)
        for cols in chunks:
            mean += signal[:, cols].sum(axis=1, dtype=np.float64)
        mean /= n
    cov = np.zeros((n_rows, n_rows))
    for cols in chunks:
        block = signal[:, cols] - mean[:, None]  # float64 even when ``signal`` is float32
        cov += block @ block.T
    cov /= n
    return cov


def pca_extended_signal(
    signal: np.ndarray, columns: np.ndarray | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Estimate PCA basis/eigenvalues for extended signal whitening."""
    eigenvalues, eigenvectors = eigh(covariance(signal, columns))

    idx = np.argsort(eigenvalues)[::-1]
    eigenvalues = eigenvalues[idx]
    eigenvectors = eigenvectors[:, idx]

    rank_tolerance = np.mean(eigenvalues[len(eigenvalues) // 2 :])
    max_last_eig = np.sum(eigenvalues > rank_tolerance)
    if 0 < max_last_eig < signal.shape[0]:
        lower_limit_value = (eigenvalues[max_last_eig - 1] + eigenvalues[max_last_eig]) / 2
    else:
        lower_limit_value = rank_tolerance

    mask = eigenvalues > max(lower_limit_value, 1e-10 * eigenvalues[0])
    if not mask.any():
        raise MureplayError(
            "Degenerate window: covariance has no positive eigenvalues (flat channels?)"
        )
    return eigenvectors[:, mask], np.diag(eigenvalues[mask])


def whiten_extended_signal(
    signal: np.ndarray, eigenvectors: np.ndarray, eigenvalues_diag: np.ndarray
) -> np.ndarray:
    """Whiten the extended signal in place, one column chunk at a time, computed in float64."""
    whiten_mat = eigenvectors @ inv(np.sqrt(eigenvalues_diag)) @ eigenvectors.T
    for cols in _column_chunks(signal.shape[1], signal.shape[0]):
        signal[:, cols] = whiten_mat @ signal[:, cols]
    return signal


def subtract_mu_waveforms(
    x: np.ndarray, spikes: np.ndarray, fsamp: float, peel_off_win: float
) -> None:
    """Subtract the mean MU waveform from ``x`` at every spike, in place."""
    window_l = int(np.round(peel_off_win * fsamp))
    spikes = np.asarray(spikes, dtype=int)
    valid_spikes = spikes[(spikes >= window_l) & (spikes < x.shape[1] - window_l)]
    if valid_spikes.size == 0:
        return

    # Summed window by window, in this order, as MUedit2 does: the float64 sum is order-sensitive.
    waveforms = np.zeros((x.shape[0], 2 * window_l + 1))
    for s in valid_spikes:
        waveforms += x[:, s - window_l : s + window_l + 1]
    waveforms /= valid_spikes.size

    for s in valid_spikes:
        x[:, s - window_l : s + window_l + 1] -= waveforms


# ── Spike detection ─────────────────────────────────────────────────────────

KMEANS_ITER: int = 10
POSTPROC_MIN_ISI_SEC: float = 0.005


def signed_square(x: np.ndarray) -> np.ndarray:
    """Signed-squared nonlinearity ``x * |x|`` used to build pulse trains."""
    return x * np.abs(x)


def find_refractory_peaks(signal: np.ndarray, fsamp: float, min_isi_sec: float) -> np.ndarray:
    """Peak picking with a refractory-distance constraint."""
    peaks, _ = find_peaks(signal, distance=int(np.round(fsamp * min_isi_sec)))
    return peaks


def split_by_amplitude(
    values: np.ndarray, peaks: np.ndarray, missing: str = "raise"
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split peak amplitudes into low/high clusters and return the high ones."""
    try:
        centroids, labels = kmeans2(
            values[peaks], 2, iter=KMEANS_ITER, minit="++", missing=missing, seed=0
        )
    except ClusterError:
        peak_vals = values[peaks]
        centroid = float(np.mean(peak_vals)) if peak_vals.size > 0 else 0.0
        centroids = np.array([centroid, centroid])
        labels = np.zeros(len(peaks), dtype=int)
    return peaks[labels == int(np.argmax(centroids))], centroids, labels


# ── Filter update ───────────────────────────────────────────────────────────

#: Samples around an original spike searched for its peak when ``lock_spikes`` is set.
_LOCK_RADIUS = 10


def _in_window(times: np.ndarray, lo: int, hi: int) -> np.ndarray:
    """``times`` inside ``[lo, hi)``, shifted to start at ``lo``."""
    return times[(times >= lo) & (times < hi)] - lo


def _whitened_window(
    window_emg: np.ndarray,
    fsamp: float,
    nbextchan: int,
    artifact_mask: np.ndarray | None,
    compute_dtype: ComputeDtype,
) -> np.ndarray:
    """The window extended and whitened; PCA skips the padded ends, the edges and artifacts."""
    ex_factor = extension_factor(nbextchan, window_emg.shape[0])
    e_sig = extend_signal(window_emg, ex_factor, dtype=compute_dtype)
    win_len = window_emg.shape[1]
    trim = window_trim(win_len, fsamp, EDGE_SEC, ex_factor)
    pca_keep = np.zeros(e_sig.shape[1], dtype=bool)
    pca_keep[trim : win_len - trim] = True
    if artifact_mask is not None:
        clean = pca_keep.copy()  # the padded tail is never kept, so the mask stops at win_len
        clean[:win_len] &= ~extend_mask(artifact_mask, ex_factor)
        if np.count_nonzero(clean) > e_sig.shape[0]:
            pca_keep = clean
    pca_cols = np.flatnonzero(pca_keep) if pca_keep.any() else None
    eigenvectors, eigenvalues_diag = pca_extended_signal(e_sig, pca_cols)
    return whiten_extended_signal(e_sig, eigenvectors, eigenvalues_diag)


def _realign(spikes: np.ndarray, peaks: np.ndarray, edge: int, n: int) -> np.ndarray:
    """Each spike moved to the nearest of ``peaks`` within ``_LOCK_RADIUS`` and the edges."""
    lo = np.maximum(edge, spikes - _LOCK_RADIUS)
    hi = np.minimum(n - edge, spikes + _LOCK_RADIUS + 1)
    j = np.searchsorted(peaks, spikes)
    left = peaks[np.maximum(j - 1, 0)]
    right = peaks[np.minimum(j, peaks.size - 1)]
    left_ok = (j > 0) & (left >= lo) & (left < hi)
    right_ok = (j < peaks.size) & (right >= lo) & (right < hi)
    # On a tie the earlier peak wins.
    take_left = left_ok & (~right_ok | (spikes - left <= right - spikes))
    return np.where(take_left, left, np.where(right_ok, right, spikes))


def _window_pulse_train(
    w_sig: np.ndarray, local: np.ndarray, win_len: int, edge: int, win_mask: np.ndarray | None
) -> np.ndarray:
    """The pulse train of the filter averaged over ``local``, zero at the edges and artifacts."""
    mu_filter = np.sum(w_sig[:, local], axis=1, dtype=np.float64)
    norm = float(np.linalg.norm(mu_filter))
    if norm > 0.0:
        mu_filter /= norm
    pulse_train: np.ndarray = vec_mat(mu_filter, w_sig).astype(np.float64)[:win_len]
    pulse_train[:edge] = 0
    pulse_train[-edge:] = 0
    pulse_train = signed_square(pulse_train)
    if win_mask is not None:
        pulse_train[win_mask] = 0.0
    return pulse_train


def _detect_in_window(
    pulse_train: np.ndarray,
    fsamp: float,
    local: np.ndarray,
    edge: int,
    win_mask: np.ndarray | None,
    lock_spikes: bool,
) -> np.ndarray | None:
    """The window's discharges in ``pulse_train``, or None when its peaks do not split in two."""
    peaks = find_refractory_peaks(pulse_train, fsamp, min_isi_sec=POSTPROC_MIN_ISI_SEC)
    if peaks.size <= 2:
        return None
    found, centroids, labels = split_by_amplitude(pulse_train, peaks, missing="warn")
    if len(np.unique(labels)) < 2:
        return None
    if win_mask is not None:
        found = found[~win_mask[found]]
    if lock_spikes:
        found = np.union1d(_realign(local, peaks, edge, pulse_train.size), found)
    return found[pulse_train[found] <= 3 * centroids[int(np.argmax(centroids))]]


def update_motor_unit_filter_window(
    emg: np.ndarray,
    discard_mask: np.ndarray,
    spike_times: ArrayLike,
    fsamp: float,
    start: int,
    end: int,
    nbextchan: int = DEFAULT_NBEXTCHAN,
    peel_off_spike_times: Sequence[ArrayLike] | None = None,
    peel_off_win: float = DEFAULT_PEEL_OFF_WIN_SEC,
    artifact_times: ArrayLike | None = None,
    lock_spikes: bool = False,
    artifact_mask: np.ndarray | None = None,
    compute_dtype: ComputeDtype = DEFAULT_COMPUTE_DTYPE,
) -> tuple[np.ndarray | None, np.ndarray]:
    """Refit an MU filter on the filtered EMG in ``[start, end)`` and redetect its spikes there."""
    spikes = spike_array(spike_times)
    edge = edge_samples(fsamp)
    win_len = end - start
    if win_len <= 2 * edge or start < 0 or end > emg.shape[1]:
        return None, spikes
    window_emg = np.asarray(emg[discard_mask == 0, start:end], dtype=float)
    local = _in_window(spikes, start + edge, end - edge) + edge
    if window_emg.size == 0 or local.size == 0:
        return None, spikes

    win_mask = None
    if artifact_mask is not None:
        wm = artifact_mask[start:end]
        win_mask = wm if wm.size == win_len and wm.any() else None
    w_sig = _whitened_window(window_emg, fsamp, nbextchan, win_mask, compute_dtype)

    subtracted = list(peel_off_spike_times or [])
    if artifact_times is not None:
        subtracted.append(artifact_times)
    for times in subtracted:
        inside = _in_window(spike_array(times), start + edge, end - edge) + edge
        if inside.size:
            subtract_mu_waveforms(w_sig, inside, fsamp, peel_off_win)

    pulse_train = _window_pulse_train(w_sig, local, win_len, edge, win_mask)
    found = _detect_in_window(pulse_train, fsamp, local, edge, win_mask, lock_spikes)
    if found is None:
        return None, spikes
    outside = spikes[(spikes < start + edge) | (spikes >= end - edge)]
    return pulse_train, spike_array(np.concatenate([outside, found + start]))
