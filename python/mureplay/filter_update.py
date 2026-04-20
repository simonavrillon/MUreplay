from __future__ import annotations

import numpy as np
from scipy.cluster.vq import kmeans2
from scipy.linalg import eigh, inv
from scipy.signal import butter, filtfilt, find_peaks


def bandpass_signals(signal: np.ndarray, fsamp: float, emg_type: int = 1) -> np.ndarray:
    if emg_type == 1:
        b, a = butter(2, [20, 500], btype="bandpass", fs=fsamp)
    else:
        b, a = butter(3, [100, 4400], btype="bandpass", fs=fsamp)
    return filtfilt(b, a, signal, axis=-1)


def extend_signal(signal: np.ndarray, exfactor: int) -> np.ndarray:
    rows, cols = signal.shape
    esample = np.zeros((rows * exfactor, cols + exfactor - 1))
    for m in range(exfactor):
        esample[m * rows : (m + 1) * rows, m : cols + m] = signal
    return esample


def pca_extended_signal(signal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    cov_matrix = np.cov(signal, bias=True)
    eigenvalues, eigenvectors = eigh(cov_matrix)
    idx = np.argsort(eigenvalues)[::-1]
    eigenvalues = eigenvalues[idx]
    eigenvectors = eigenvectors[:, idx]
    n_eigs = len(eigenvalues)
    rank_tol = max(np.mean(eigenvalues[n_eigs // 2 :]), 0)
    max_last = np.sum(eigenvalues > rank_tol)
    if 0 < max_last < signal.shape[0]:
        lower = (eigenvalues[max_last - 1] + eigenvalues[max_last]) / 2
    else:
        lower = rank_tol
    mask = eigenvalues > lower
    return eigenvectors[:, mask], np.diag(eigenvalues[mask])


def whiten_extended_signal(
    signal: np.ndarray, eigenvectors: np.ndarray, eigenvalues_diag: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    sqrt_d = np.sqrt(eigenvalues_diag)
    inv_sqrt_d = inv(sqrt_d)
    w = eigenvectors @ inv_sqrt_d @ eigenvectors.T
    v = eigenvectors @ sqrt_d @ eigenvectors.T
    return w @ signal, w, v


def _remove_high_amplitude_outliers(pulse_train: np.ndarray, spike_indices: np.ndarray) -> np.ndarray:
    if spike_indices.size == 0:
        return spike_indices
    threshold = np.mean(pulse_train[spike_indices]) + 3 * np.std(pulse_train[spike_indices])
    return spike_indices[pulse_train[spike_indices] <= threshold]


def update_motor_unit_filter_window(
    emg: np.ndarray,
    emg_mask: np.ndarray,
    spike_times: list[int],
    fsamp: float,
    start: int,
    end: int,
    nbextchan: int = 1000,
    emg_offset: int = 0,
) -> tuple[np.ndarray | None, list[int]]:
    emg_sel = emg[emg_mask == 0, :] if emg_mask.size else emg
    if emg_sel.size == 0 or start >= end:
        return None, spike_times

    edge = int(round(0.1 * fsamp))
    win_len = end - start
    if win_len <= 2 * edge:
        return None, spike_times

    window_emg = emg_sel[:, start - emg_offset : end - emg_offset]
    window_emg = bandpass_signals(window_emg, fsamp)

    spikes_arr = np.asarray(spike_times, dtype=int)
    spikes1 = spikes_arr[(spikes_arr >= start + edge) & (spikes_arr < end - edge)]
    if spikes1.size == 0:
        return None, spike_times

    spikes2 = spikes1 - start
    ex_factor = int(round(nbextchan / max(window_emg.shape[0], 1)))
    ex_factor = max(1, ex_factor)
    e_sig = extend_signal(window_emg, ex_factor)
    eigenvectors, eigenvalues_diag = pca_extended_signal(e_sig)
    w_sig, _, _ = whiten_extended_signal(e_sig, eigenvectors, eigenvalues_diag)

    mu_filters = np.sum(w_sig[:, spikes2], axis=1)
    norm = float(np.linalg.norm(mu_filters))
    if norm > 0:
        mu_filters = mu_filters / norm

    pt = mu_filters.T @ w_sig
    pt = pt[: window_emg.shape[1]]
    pt[:edge] = 0
    pt[-edge:] = 0
    pt = pt * np.abs(pt)

    peaks, _ = find_peaks(pt, distance=int(round(fsamp * 0.005)))
    if peaks.size <= 2:
        return None, spike_times

    try:
        centroids, labels = kmeans2(
            pt[peaks],
            2,
            iter=10,
            minit="++",
            missing="raise",
            rng=np.random.default_rng(0),
        )
    except TypeError:
        np.random.seed(0)
        centroids, labels = kmeans2(pt[peaks], 2, iter=10, minit="++", missing="raise")

    idx2 = int(np.argmax(centroids))
    spikes_new = peaks[labels == idx2]
    spikes_new = _remove_high_amplitude_outliers(pt, spikes_new).astype(int)

    updated = [s for s in spike_times if s < start + edge or s > end - edge]
    updated.extend((spikes_new + start).tolist())
    updated = sorted({int(x) for x in updated if int(x) >= 0})
    return pt, updated
