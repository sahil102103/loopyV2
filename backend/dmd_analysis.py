"""Warning-free Dynamic Mode Decomposition for FlowCLD histories.

The notebook imports this module instead of maintaining a private numerical
copy. Analysis is kept independent from plotting so it is reusable from tests,
API handlers, and interactive notebooks.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping, Sequence

import numpy as np
import pandas as pd


DMD_COLUMNS = (
    "mode",
    "mu_real",
    "mu_imag",
    "mu_abs",
    "lambda_re_per_qtr",
    "lambda_im_per_qtr",
    "amplitude",
    "period_quarters",
    "period_years",
    "freq_cycles_per_year",
    "oscillatory",
)


@dataclass(frozen=True)
class DMDResult:
    """Numerical DMD result with an explicitly reported effective rank."""

    table: pd.DataFrame
    discrete_eigenvalues: np.ndarray
    modes: np.ndarray
    effective_rank: int


def compute_dmd(
    history: Mapping[str, Sequence[float | None]],
    node_order: Sequence[str] | None = None,
    *,
    rank: int = 10,
    dt_quarters: float = 1.0,
    center: bool = True,
    singular_tolerance: float = 1e-12,
) -> DMDResult:
    """Compute DMD without real-log, eager-division, or rank-zero warnings."""

    selected_nodes = list(history) if node_order is None else list(node_order)
    if not selected_nodes:
        raise ValueError("DMD requires at least one node series")
    if len(selected_nodes) != len(set(selected_nodes)):
        raise ValueError("DMD node_order cannot contain duplicates")
    missing = [node for node in selected_nodes if node not in history]
    if missing:
        raise ValueError(f"DMD node_order references unknown nodes: {missing}")
    if isinstance(rank, bool) or not isinstance(rank, (int, np.integer)) or rank < 0:
        raise ValueError("DMD rank must be a non-negative integer")
    dt = float(dt_quarters)
    if not math.isfinite(dt) or dt <= 0.0:
        raise ValueError("dt_quarters must be a positive finite number")
    tolerance = float(singular_tolerance)
    if not math.isfinite(tolerance) or tolerance <= 0.0:
        raise ValueError("singular_tolerance must be a positive finite number")

    rows = [_clean_series(history[node], node) for node in selected_nodes]
    lengths = {row.size for row in rows}
    if len(lengths) != 1:
        raise ValueError("All DMD node series must have the same length")
    time_count = rows[0].size
    if time_count < 2:
        raise ValueError("DMD requires at least two timesteps")

    data = np.vstack(rows)
    if center:
        data = data - data.mean(axis=1, keepdims=True)
    if not np.all(np.isfinite(data)):
        raise ValueError("DMD input must remain finite after preprocessing")

    x1 = data[:, :-1]
    x2 = data[:, 1:]
    u, singular_values, vh = np.linalg.svd(x1, full_matrices=False)
    effective_rank = int(min(
        int(rank),
        int(np.sum(singular_values > tolerance)),
        x1.shape[0],
        x1.shape[1],
    ))
    if effective_rank == 0:
        return DMDResult(
            table=_empty_table(),
            discrete_eigenvalues=np.empty(0, dtype=np.complex128),
            modes=np.empty((len(selected_nodes), 0), dtype=np.complex128),
            effective_rank=0,
        )

    u_r = u[:, :effective_rank]
    s_r = singular_values[:effective_rank]
    v_r = vh.conj().T[:, :effective_rank]
    inverse_s = 1.0 / s_r

    reduced = (u_r.conj().T @ x2 @ v_r) * inverse_s
    mu, eigenvectors = np.linalg.eig(reduced)
    modes = ((x2 @ v_r) * inverse_s) @ eigenvectors

    mode_norms = np.linalg.norm(modes, axis=0)
    valid_modes = mode_norms > np.finfo(float).tiny
    modes[:, valid_modes] /= mode_norms[valid_modes]
    amplitudes, *_ = np.linalg.lstsq(modes, data[:, 0], rcond=None)

    mu = np.asarray(mu, dtype=np.complex128)
    continuous = np.full(mu.shape, complex(-np.inf, 0.0), dtype=np.complex128)
    nonzero = np.abs(mu) > np.finfo(float).tiny
    continuous[nonzero] = np.log(mu[nonzero]) / dt

    omega = np.abs(np.imag(continuous))
    oscillatory = np.isfinite(omega) & (omega > 1e-12)
    period_quarters = np.full(omega.shape, np.nan, dtype=float)
    period_quarters[oscillatory] = 2.0 * np.pi / omega[oscillatory]
    frequency_per_year = np.full(omega.shape, np.nan, dtype=float)
    finite_period = np.isfinite(period_quarters) & (period_quarters > 0.0)
    frequency_per_year[finite_period] = 4.0 / period_quarters[finite_period]

    table = pd.DataFrame({
        "mode": np.arange(mu.size),
        "mu_real": np.real(mu),
        "mu_imag": np.imag(mu),
        "mu_abs": np.abs(mu),
        "lambda_re_per_qtr": np.real(continuous),
        "lambda_im_per_qtr": np.imag(continuous),
        "amplitude": np.abs(amplitudes),
        "period_quarters": period_quarters,
        "period_years": period_quarters / 4.0,
        "freq_cycles_per_year": frequency_per_year,
        "oscillatory": oscillatory,
    })
    table = table.sort_values(
        ["oscillatory", "amplitude"], ascending=[False, False]
    ).reset_index(drop=True)
    return DMDResult(
        table=table,
        discrete_eigenvalues=mu,
        modes=modes,
        effective_rank=effective_rank,
    )


def dmd_from_history(
    history: Mapping[str, Sequence[float | None]],
    node_order: Sequence[str] | None = None,
    *,
    rank: int = 10,
    dt_quarters: float = 1.0,
    center: bool = True,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Notebook-compatible wrapper returning ``(table, eigenvalues)``."""

    result = compute_dmd(
        history,
        node_order,
        rank=rank,
        dt_quarters=dt_quarters,
        center=center,
    )
    return result.table, result.discrete_eigenvalues


def _clean_series(values: Sequence[float | None], node: str) -> np.ndarray:
    try:
        series = pd.Series(
            [np.nan if value is None else float(value) for value in values],
            dtype=float,
        )
    except (TypeError, ValueError) as error:
        raise ValueError(f"DMD series for {node} must be numeric") from error
    if series.empty:
        raise ValueError(f"DMD series for {node} cannot be empty")
    finite_or_missing = np.isfinite(series.to_numpy()) | series.isna().to_numpy()
    if not np.all(finite_or_missing):
        raise ValueError(f"DMD series for {node} contains infinity")
    filled = series.ffill().bfill()
    if filled.isna().any():
        raise ValueError(f"DMD series for {node} contains no numeric values")
    return filled.to_numpy(dtype=float)


def _empty_table() -> pd.DataFrame:
    return pd.DataFrame({
        column: pd.Series(dtype=(bool if column == "oscillatory" else float))
        for column in DMD_COLUMNS
    })
