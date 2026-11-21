#!/usr/bin/env python3
"""
Garment Vision, Cutout, Back-Synthesis & PBR Normal-Map Pipeline
================================================================
Pure Python stdlib + Pillow (PIL) + NumPy implementation (zero scipy/cv2/rembg).

Generates four precision assets per input garment:
  1. <prefix>-front-cutout.png : Clean RGBA cutout (CIELAB flood-fill, 3% top collar anchor,
                                 1.5px anti-aliased feather, edge color decontamination)
  2. <prefix>-back-cutout.png  : Un-mirrored crew-neck back-of-garment RGBA with chest print
                                 & inner neck label seamlessly replaced by drape-shaded fabric
  3. <prefix>-normal.png       : Tangent-space PBR normal map (ink-attenuated soft fold relief
                                 + procedural cotton jersey micro-weave, #8080FF neutral outside)
  4. <prefix>-meta.json        : Extracted palette (dominantHex, accentHex), aspect ratio & QA metrics
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# Color Space Utilities (Vectorized sRGB <-> CIELAB D65)
# ---------------------------------------------------------------------------

def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert float64 sRGB [0..255] array (..., 3) to perceptual CIELAB (L*, a*, b*)."""
    v = np.clip(rgb, 0.0, 255.0) / 255.0
    lin = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

    x = (lin[..., 0] * 0.4124564 + lin[..., 1] * 0.3575761 + lin[..., 2] * 0.1804375) / 0.95047
    y = (lin[..., 0] * 0.2126729 + lin[..., 1] * 0.7151522 + lin[..., 2] * 0.0721750) / 1.00000
    z = (lin[..., 0] * 0.0193339 + lin[..., 1] * 0.1191920 + lin[..., 2] * 0.9503041) / 1.08883

    eps = 216.0 / 24389.0
    kap = 24389.0 / 27.0

    fx = np.where(x > eps, np.cbrt(np.maximum(x, 0.0)), (kap * x + 16.0) / 116.0)
    fy = np.where(y > eps, np.cbrt(np.maximum(y, 0.0)), (kap * y + 16.0) / 116.0)
    fz = np.where(z > eps, np.cbrt(np.maximum(z, 0.0)), (kap * z + 16.0) / 116.0)

    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1)


def rgb_to_hex(rgb_triplet: np.ndarray) -> str:
    vals = [int(np.clip(round(float(c)), 0, 255)) for c in rgb_triplet[:3]]
    return f"#{vals[0]:02X}{vals[1]:02X}{vals[2]:02X}"


# ---------------------------------------------------------------------------
# Exact Float64 Separable Gaussian & Morphological Helpers (Zero Quantization!)
# ---------------------------------------------------------------------------

def gaussian_kernel_1d(sigma: float) -> np.ndarray:
    if sigma <= 0.05:
        return np.array([1.0], dtype=np.float64)
    radius = max(1, min(96, int(math.ceil(2.85 * sigma))))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / np.sum(k)


def _box_blur_axis0(arr: np.ndarray, r: int) -> np.ndarray:
    h = arr.shape[0]
    extra_pad = () if arr.ndim == 2 else ((0, 0),)
    padded = np.pad(arr, ((r + 1, r), (0, 0)) + extra_pad, mode="edge")
    padded[0] = 0.0
    cs = np.cumsum(padded, axis=0, dtype=np.float64)
    return (cs[2 * r + 1:2 * r + 1 + h] - cs[0:h]) / float(2 * r + 1)


def blur_float(arr: np.ndarray, radius: float) -> np.ndarray:
    """Exact 64-bit float separable Gaussian blur for (H, W) or (H, W, C) arrays."""
    if radius <= 0.05:
        return arr.astype(np.float64, copy=True)

    # O(1) 3-pass cumulative-sum box blur for wide radii (> 4.0px)
    if radius > 4.0:
        box_r = max(1, int(round(float(radius) * 0.85)))
        cur = arr.astype(np.float64, copy=True)
        for _ in range(3):
            cur = _box_blur_axis0(cur, box_r)
            cur = np.swapaxes(_box_blur_axis0(np.swapaxes(cur, 0, 1), box_r), 0, 1)
        return cur

    k = gaussian_kernel_1d(float(radius))
    r = len(k) // 2
    h, w = arr.shape[:2]
    extra_pad = () if arr.ndim == 2 else ((0, 0),)

    px = np.pad(arr.astype(np.float64, copy=False), ((0, 0), (r, r)) + extra_pad, mode="edge")
    out_x = np.zeros_like(arr, dtype=np.float64)
    for i, wk in enumerate(k):
        out_x += wk * px[:, i:i + w]

    py = np.pad(out_x, ((r, r), (0, 0)) + extra_pad, mode="edge")
    out_y = np.zeros_like(arr, dtype=np.float64)
    for i, wk in enumerate(k):
        out_y += wk * py[i:i + h, :]

    return out_y


def erode_mask(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """4-connected binary erosion with outside-image treated as False."""
    out = mask.astype(bool, copy=True)
    for _ in range(iterations):
        nxt = out.copy()
        nxt[1:, :] &= out[:-1, :]
        nxt[:-1, :] &= out[1:, :]
        nxt[:, 1:] &= out[:, :-1]
        nxt[:, :-1] &= out[:, 1:]
        nxt[0, :] = False
        nxt[-1, :] = False
        nxt[:, 0] = False
        nxt[:, -1] = False
        out = nxt
    return out


def dilate_mask(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """4-connected binary dilation."""
    out = mask.astype(bool, copy=True)
    for _ in range(iterations):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
        out = nxt
    return out


def flood_fill_borders(passable: np.ndarray) -> np.ndarray:
    """Fast BFS flood-fill seeded from all 4 outer image borders."""
    h, w = passable.shape
    visited = np.zeros((h, w), dtype=bool)
    q: deque[Tuple[int, int]] = deque()

    for x in range(w):
        if passable[0, x] and not visited[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if passable[h - 1, x] and not visited[h - 1, x]:
            visited[h - 1, x] = True
            q.append((h - 1, x))

    for y in range(1, h - 1):
        if passable[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if passable[y, w - 1] and not visited[y, w - 1]:
            visited[y, w - 1] = True
            q.append((y, w - 1))

    while q:
        cy, cx = q.popleft()
        if cy > 0 and passable[cy - 1, cx] and not visited[cy - 1, cx]:
            visited[cy - 1, cx] = True
            q.append((cy - 1, cx))
        if cy + 1 < h and passable[cy + 1, cx] and not visited[cy + 1, cx]:
            visited[cy + 1, cx] = True
            q.append((cy + 1, cx))
        if cx > 0 and passable[cy, cx - 1] and not visited[cy, cx - 1]:
            visited[cy, cx - 1] = True
            q.append((cy, cx - 1))
        if cx + 1 < w and passable[cy, cx + 1] and not visited[cy, cx + 1]:
            visited[cy, cx + 1] = True
            q.append((cy, cx + 1))

    return visited


def fill_interior_pinholes(fg_mask: np.ndarray, max_hole_area_ratio: float = 0.08) -> np.ndarray:
    """Fill interior pinholes enclosed by foreground."""
    h, w = fg_mask.shape
    exterior_bg = flood_fill_borders(~fg_mask)
    holes = (~fg_mask) & (~exterior_bg)
    if not np.any(holes):
        return fg_mask.copy()

    max_area = int(h * w * max_hole_area_ratio)
    visited = np.zeros((h, w), dtype=bool)
    out = fg_mask.copy()
    ys, xs = np.where(holes)

    for idx in range(len(ys)):
        sy, sx = int(ys[idx]), int(xs[idx])
        if visited[sy, sx]:
            continue
        q: deque[Tuple[int, int]] = deque([(sy, sx)])
        visited[sy, sx] = True
        comp_y = [sy]
        comp_x = [sx]
        while q:
            cy, cx = q.popleft()
            if cy > 0 and holes[cy - 1, cx] and not visited[cy - 1, cx]:
                visited[cy - 1, cx] = True
                q.append((cy - 1, cx))
                comp_y.append(cy - 1)
                comp_x.append(cx)
            if cy + 1 < h and holes[cy + 1, cx] and not visited[cy + 1, cx]:
                visited[cy + 1, cx] = True
                q.append((cy + 1, cx))
                comp_y.append(cy + 1)
                comp_x.append(cx)
            if cx > 0 and holes[cy, cx - 1] and not visited[cy, cx - 1]:
                visited[cy, cx - 1] = True
                q.append((cy, cx - 1))
                comp_y.append(cy)
                comp_x.append(cx - 1)
            if cx + 1 < w and holes[cy, cx + 1] and not visited[cy, cx + 1]:
                visited[cy, cx + 1] = True
                q.append((cy, cx + 1))
                comp_y.append(cy)
                comp_x.append(cx + 1)
        if len(comp_y) <= max_area:
            out[comp_y, comp_x] = True

    return out


def largest_connected_component(mask: np.ndarray) -> np.ndarray:
    """Keep only the largest 4-connected foreground component (removes floating specks)."""
    h, w = mask.shape
    visited = np.zeros((h, w), dtype=bool)
    best_y: List[int] = []
    best_x: List[int] = []
    ys, xs = np.where(mask)

    for idx in range(len(ys)):
        sy, sx = int(ys[idx]), int(xs[idx])
        if visited[sy, sx]:
            continue
        q: deque[Tuple[int, int]] = deque([(sy, sx)])
        visited[sy, sx] = True
        comp_y = [sy]
        comp_x = [sx]
        while q:
            cy, cx = q.popleft()
            if cy > 0 and mask[cy - 1, cx] and not visited[cy - 1, cx]:
                visited[cy - 1, cx] = True
                q.append((cy - 1, cx))
                comp_y.append(cy - 1)
                comp_x.append(cx)
            if cy + 1 < h and mask[cy + 1, cx] and not visited[cy + 1, cx]:
                visited[cy + 1, cx] = True
                q.append((cy + 1, cx))
                comp_y.append(cy + 1)
                comp_x.append(cx)
            if cx > 0 and mask[cy, cx - 1] and not visited[cy, cx - 1]:
                visited[cy, cx - 1] = True
                q.append((cy, cx - 1))
                comp_y.append(cy)
                comp_x.append(cx - 1)
            if cx + 1 < w and mask[cy, cx + 1] and not visited[cy, cx + 1]:
                visited[cy, cx + 1] = True
                q.append((cy, cx + 1))
                comp_y.append(cy)
                comp_x.append(cx + 1)
        if len(comp_y) > len(best_y):
            best_y = comp_y
            best_x = comp_x

    out = np.zeros((h, w), dtype=bool)
    if best_y:
        out[best_y, best_x] = True
    return out


def propagate_interior_rgb(rgb: np.ndarray, known_mask: np.ndarray, iterations: int = 10) -> np.ndarray:
    """Propagate clean interior foreground RGB outward into boundary band for halo-free unmixing."""
    h, w, _ = rgb.shape
    ref = rgb.copy()
    known = known_mask.copy()
    for _ in range(iterations):
        acc = np.zeros_like(ref)
        cnt = np.zeros((h, w, 1), dtype=np.float64)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                sy = slice(max(0, -dy), h - max(0, dy))
                dy_s = slice(max(0, dy), h - max(0, -dy))
                sx = slice(max(0, -dx), w - max(0, dx))
                dx_s = slice(max(0, dx), w - max(0, -dx))
                m = known[sy, sx][..., None]
                acc[dy_s, dx_s] += ref[sy, sx] * m
                cnt[dy_s, dx_s] += m
        target = (~known) & (cnt[..., 0] > 0)
        if not np.any(target):
            break
        ref[target] = acc[target] / cnt[target]
        known |= target
    return ref


def sobel_xy(field: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Compute 3x3 Sobel X and Y derivatives in pure vectorized NumPy."""
    p = np.pad(field, ((1, 1), (1, 1)), mode="edge")
    gx = (
        (p[:-2, 2:] + 2.0 * p[1:-1, 2:] + p[2:, 2:])
        - (p[:-2, :-2] + 2.0 * p[1:-1, :-2] + p[2:, :-2])
    ) / 8.0
    gy = (
        (p[2:, :-2] + 2.0 * p[2:, 1:-1] + p[2:, 2:])
        - (p[:-2, :-2] + 2.0 * p[:-2, 1:-1] + p[:-2, 2:])
    ) / 8.0
    return gx, gy


# ---------------------------------------------------------------------------
# Stage 1: Perceptual CIELAB Cutout, Edge Decontamination & 3% Collar Framing
# ---------------------------------------------------------------------------

def compute_front_cutout(
    im: Image.Image,
    tolerance: float = 20.0,
    collar_top_pct: float = 0.03,
) -> Tuple[np.ndarray, np.ndarray, Dict[str, object]]:
    """
    Perform corner-sampled CIELAB flood-fill cutout (or refine existing alpha if RGBA),
    apply 1.5px anti-aliased feather + edge color decontamination, and normalize canvas
    framing so the topmost opaque collar pixels sit at exactly 3% from the top.
    """
    rgba_in = im.convert("RGBA")
    raw_rgba = np.asarray(rgba_in, dtype=np.float64)
    rgb = raw_rgba[..., :3]
    in_alpha = raw_rgba[..., 3] / 255.0
    h, w, _ = rgb.shape

    patch = max(4, min(12, h // 16, w // 16))
    corner_alpha = np.concatenate([
        in_alpha[:patch, :patch].ravel(),
        in_alpha[:patch, -patch:].ravel(),
        in_alpha[-patch:, :patch].ravel(),
        in_alpha[-patch:, -patch:].ravel(),
    ])

    corners_rgb = np.concatenate([
        rgb[:patch, :patch].reshape(-1, 3),
        rgb[:patch, -patch:].reshape(-1, 3),
        rgb[-patch:, :patch].reshape(-1, 3),
        rgb[-patch:, -patch:].reshape(-1, 3),
    ], axis=0)
    bg_rgb = np.median(corners_rgb, axis=0)

    if float(np.median(corner_alpha)) < 0.15:
        fg_clean = largest_connected_component(in_alpha >= 0.5)
        alpha = in_alpha.copy()
        out_rgb = rgb.copy()
    else:
        lab = rgb_to_lab(rgb)
        bg_lab = rgb_to_lab(bg_rgb.reshape(1, 1, 3))[0, 0]

        dL = lab[..., 0] - bg_lab[0]
        da = lab[..., 1] - bg_lab[1]
        db = lab[..., 2] - bg_lab[2]

        bg_chroma = float(math.hypot(float(bg_lab[1]), float(bg_lab[2])))
        if bg_chroma < 8.0:
            light_w = 1.55
            chroma_w = 10.8
        else:
            light_w = 2.10
            chroma_w = 4.20

        gx_L, gy_L = sobel_xy(lab[..., 0])
        grad_L = np.hypot(gx_L, gy_L)
        grad_barrier = np.clip(grad_L - 1.5, 0.0, 12.0) * 1.35

        dE_eff = np.sqrt((dL * light_w) ** 2 + (da ** 2 + db ** 2) * (chroma_w ** 2)) + grad_barrier

        bg_flood = flood_fill_borders(dE_eff < float(tolerance))
        fg_raw = fill_interior_pinholes(~bg_flood)

        # Morphological opening removes 1-3px JPEG DCT ringing burrs & stray islands
        core = largest_connected_component(erode_mask(fg_raw, 2))
        if not np.any(core):
            core = largest_connected_component(fg_raw)
        fg_open = fill_interior_pinholes(dilate_mask(core, 2) & fg_raw)

        # Remove bright JPEG 4:2:0 chroma-ringing bumps sticking out outside dark cuffs/collars
        deep_trim_seed = erode_mask(fg_open, 10)
        if np.any(deep_trim_seed):
            trim_ref_rgb = propagate_interior_rgb(rgb, deep_trim_seed, iterations=14)
            trim_ref_L = rgb_to_lab(trim_ref_rgb)[..., 0]
            outer_9 = fg_open & (~deep_trim_seed)
            bright_halo_on_dark_trim = (
                outer_9
                & ((bg_lab[0] - trim_ref_L) > 15.0)
                & (lab[..., 0] > (bg_lab[0] - 8.0))
            )
            if np.any(bright_halo_on_dark_trim):
                fg_open = fill_interior_pinholes(
                    largest_connected_component(fg_open & (~bright_halo_on_dark_trim))
                )

        # Level-set contour smoothing removes 8x8 JPEG macroblock stair-steps & trims 0.7px outer fringe
        sdf = blur_float(fg_open.astype(np.float64), radius=2.2)
        fg_clean = fill_interior_pinholes(largest_connected_component(sdf > 0.56))

        # Propagate clean interior RGB (eroded 5px) outward for exact optical unmixing
        deep_interior = erode_mask(fg_clean, 5)
        if not np.any(deep_interior):
            deep_interior = erode_mask(fg_clean, 2)
        ref_rgb = propagate_interior_rgb(rgb, deep_interior, iterations=9)

        # 1.5px smooth anti-aliased alpha feather + optical alpha refinement on high-contrast edges
        alpha = blur_float(fg_clean.astype(np.float64), radius=1.45)
        boundary_band = dilate_mask(fg_clean, 2) & (~erode_mask(fg_clean, 3))
        diff_fg_bg = ref_rgb - bg_rgb
        denom = np.sum(diff_fg_bg ** 2, axis=-1) + 1e-4
        opt_alpha = np.clip(np.sum((rgb - bg_rgb) * diff_fg_bg, axis=-1) / denom, 0.0, 1.0)
        contrast_w = np.clip((np.sqrt(denom) - 20.0) / 35.0, 0.0, 1.0)
        alpha[boundary_band] = np.minimum(
            alpha[boundary_band],
            opt_alpha[boundary_band] * contrast_w[boundary_band]
            + alpha[boundary_band] * (1.0 - contrast_w[boundary_band]),
        )
        alpha = blur_float(alpha, radius=0.55)
        alpha[erode_mask(fg_clean, 3)] = 1.0
        alpha[alpha < 0.025] = 0.0

        # Edge color decontamination: unmix background RGB from semi-transparent border pixels
        out_rgb = rgb.copy()
        edge = (alpha > 0.0) & (alpha < 0.995)
        a_safe = np.maximum(alpha[edge][..., None], 0.42)
        unmixed = np.clip((rgb[edge] - (1.0 - alpha[edge][..., None]) * bg_rgb) / a_safe, 0.0, 255.0)
        w_ref = np.clip(1.20 - alpha[edge][..., None], 0.22, 0.94)
        out_rgb[edge] = unmixed * (1.0 - w_ref) + ref_rgb[edge] * w_ref
        out_rgb[alpha == 0.0] = 0.0

    # QA metrics on source frame before normalizing canvas
    opaque = alpha >= 0.5
    ys, xs = np.where(opaque)
    if len(ys) == 0:
        raise ValueError("Cutout produced an empty foreground mask; lower tolerance.")

    y_min, y_max = int(ys.min()), int(ys.max())
    x_min, x_max = int(xs.min()), int(xs.max())
    fg_h = y_max - y_min + 1
    fg_w = x_max - x_min + 1

    torso_y0 = y_min + int(0.18 * fg_h)
    torso_y1 = y_min + int(0.92 * fg_h)
    torso_x0 = x_min + int(0.28 * fg_w)
    torso_x1 = x_min + int(0.72 * fg_w)
    torso_retention = float(opaque[torso_y0:torso_y1, torso_x0:torso_x1].mean() * 100.0)

    outer_zone = np.ones((h, w), dtype=bool)
    outer_zone[max(0, y_min - 4):min(h, y_max + 5), max(0, x_min - 4):min(w, x_max + 5)] = False
    bg_removal_outer = float((alpha[outer_zone] < 0.02).mean() * 100.0) if np.any(outer_zone) else 100.0

    # -----------------------------------------------------------------------
    # CRITICAL: Auto-trim & normalize canvas framing so topmost opaque collar
    # sits at EXACTLY collar_top_pct (3.0%) from the top and horizontally centered!
    # -----------------------------------------------------------------------
    collar_band_y1 = y_min + max(6, int(0.08 * fg_h))
    _, collar_xs = np.where(opaque[y_min:collar_band_y1, :])
    if len(collar_xs) > 0:
        collar_cx = 0.5 * (float(collar_xs.min()) + float(collar_xs.max()))
    else:
        collar_cx = 0.5 * (x_min + x_max)

    bbox_cx = 0.5 * (x_min + x_max)
    center_x = 0.75 * collar_cx + 0.25 * bbox_cx

    bottom_pct = 0.035
    out_h = max(64, int(round(fg_h / (1.0 - collar_top_pct - bottom_pct))))
    pad_top = max(2, int(round(collar_top_pct * out_h)))
    exact_out_h = int(round(pad_top / collar_top_pct))
    if exact_out_h >= fg_h + pad_top + 6:
        out_h = exact_out_h

    pad_x = max(8, int(round(0.035 * fg_w)))
    half_w = int(math.ceil(max(center_x - x_min, x_max - center_x))) + pad_x
    out_w = max(64, 2 * half_w)

    norm_rgb = np.zeros((out_h, out_w, 3), dtype=np.float64)
    norm_alpha = np.zeros((out_h, out_w), dtype=np.float64)

    shift_y = pad_top - y_min
    shift_x = int(round(out_w * 0.5 - center_x))

    src_y0 = max(0, -shift_y)
    src_y1 = min(h, out_h - shift_y)
    src_x0 = max(0, -shift_x)
    src_x1 = min(w, out_w - shift_x)

    dst_y0 = src_y0 + shift_y
    dst_y1 = src_y1 + shift_y
    dst_x0 = src_x0 + shift_x
    dst_x1 = src_x1 + shift_x

    norm_rgb[dst_y0:dst_y1, dst_x0:dst_x1] = out_rgb[src_y0:src_y1, src_x0:src_x1]
    norm_alpha[dst_y0:dst_y1, dst_x0:dst_x1] = alpha[src_y0:src_y1, src_x0:src_x1]

    norm_ys, _ = np.where(norm_alpha >= 0.5)
    actual_collar_pct = float(norm_ys.min()) / float(out_h) * 100.0
    palette_info = extract_garment_palette(norm_rgb, norm_alpha)

    metrics: Dict[str, object] = {
        "width": int(out_w),
        "height": int(out_h),
        "aspect": round(float(out_w) / float(out_h), 4),
        "collarTopRow": int(norm_ys.min()),
        "collarTopPct": round(actual_collar_pct, 2),
        "torsoRetentionPct": round(torso_retention, 2),
        "outerBgRemovalPct": round(bg_removal_outer, 2),
        "dominantHex": palette_info["dominantHex"],
        "accentHex": palette_info["accentHex"],
    }
    return norm_rgb, norm_alpha, metrics


def extract_garment_palette(rgb: np.ndarray, alpha: np.ndarray) -> Dict[str, str]:
    """Extract dominant torso base fabric hex and highest-chroma trim/graphic accent hex."""
    h, w, _ = rgb.shape
    opaque = erode_mask(alpha >= 0.75, 4)
    ys, xs = np.where(opaque)
    if len(ys) == 0:
        return {"dominantHex": "#F3EFE6", "accentHex": "#547049"}

    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    fh = max(1, y1 - y0)
    fw = max(1, x1 - x0)

    yy, xx = np.indices((h, w))
    flank_or_hem = (
        opaque
        & (yy >= y0 + int(0.22 * fh))
        & (yy <= y0 + int(0.92 * fh))
        & (
            ((xx >= x0 + int(0.18 * fw)) & (xx <= x0 + int(0.33 * fw)))
            | ((xx >= x0 + int(0.67 * fw)) & (xx <= x0 + int(0.82 * fw)))
            | (yy >= y0 + int(0.74 * fh))
        )
    )
    sample_mask = flank_or_hem if np.sum(flank_or_hem) > 100 else opaque
    dom_rgb = np.median(rgb[sample_mask], axis=0)

    fg_pixels = rgb[opaque]
    max_c = fg_pixels.max(axis=-1)
    min_c = fg_pixels.min(axis=-1)
    sat = np.where(max_c > 35.0, (max_c - min_c) / np.maximum(max_c, 1.0), 0.0)
    vivid = (sat > 0.14) & (max_c > 45.0) & (min_c < 215.0)
    if np.sum(vivid) > 30:
        acc_rgb = np.median(fg_pixels[vivid], axis=0)
    else:
        acc_rgb = np.clip(dom_rgb * 0.65, 0.0, 255.0)

    return {
        "dominantHex": rgb_to_hex(dom_rgb),
        "accentHex": rgb_to_hex(acc_rgb),
    }


# ---------------------------------------------------------------------------
# Stage 2: Clean Un-Mirrored Back-of-Garment Synthesis
# ---------------------------------------------------------------------------

def synthesize_back_cutout(
    front_rgb: np.ndarray,
    front_alpha: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Synthesize a photorealistic, un-mirrored back-of-garment RGBA from the front cutout:
      1. Preserves exact sleeve cuffs, bottom hem, shoulder seams, and silhouette.
      2. Replaces central chest graphic/print/placket + inner neck tag + lower front scoop
         collar loop with surrounding base fabric RGB + real vertical drape fold shading +
         subtle cotton jersey micro-grain (using exact float64 normalized convolution!).
      3. Reconstructs a clean, continuous raised crew-neck back collar rib band across the
         top of the neck opening from left shoulder corner to right shoulder corner.
    Also returns `clean_body_rgb` (graphic-removed front fabric field) for normal map generation.
    """
    h, w, _ = front_rgb.shape
    opaque = front_alpha >= 0.5
    ys, xs = np.where(opaque)
    if len(ys) == 0:
        return front_rgb.copy(), front_alpha.copy(), front_rgb.copy()

    y_min, y_max = int(ys.min()), int(ys.max())
    x_min, x_max = int(xs.min()), int(xs.max())
    fh = max(1, y_max - y_min + 1)
    fw = max(1, x_max - x_min + 1)

    # 1. Estimate dominant base fabric RGB & LAB from unprinted side flanks + lower torso
    yy, xx = np.indices((h, w))
    interior = erode_mask(opaque, 6)
    clean_torso_zone = (
        interior
        & (yy >= y_min + int(0.20 * fh))
        & (yy <= y_min + int(0.92 * fh))
        & (
            ((xx >= x_min + int(0.20 * fw)) & (xx <= x_min + int(0.32 * fw)))
            | ((xx >= x_min + int(0.68 * fw)) & (xx <= x_min + int(0.80 * fw)))
            | ((yy >= y_min + int(0.75 * fh)) & (xx >= x_min + int(0.25 * fw)) & (xx <= x_min + int(0.75 * fw)))
        )
    )
    if np.sum(clean_torso_zone) < 80:
        clean_torso_zone = interior

    base_rgb = np.median(front_rgb[clean_torso_zone], axis=0)
    lab = rgb_to_lab(front_rgb)
    base_lab = rgb_to_lab(base_rgb.reshape(1, 1, 3))[0, 0]
    dE_from_base = np.sqrt(
        (lab[..., 0] - base_lab[0]) ** 2
        + (lab[..., 1] - base_lab[1]) ** 2 * 2.2
        + (lab[..., 2] - base_lab[2]) ** 2 * 2.2
    )

    # 2. Locate the top collar shoulder corners (left & right peaks near y_min)
    top_band_xs = np.where(np.any(opaque[y_min:y_min + max(4, int(0.02 * fh)), :], axis=0))[0]
    if len(top_band_xs) >= 2:
        col_x_left = int(top_band_xs.min())
        col_x_right = int(top_band_xs.max())
    else:
        col_x_left = int(0.5 * (x_min + x_max) - 0.10 * fw)
        col_x_right = int(0.5 * (x_min + x_max) + 0.10 * fw)

    y_top_col = np.full(w, y_max, dtype=np.int32)
    for x in range(x_min, x_max + 1):
        col_ys = np.where(opaque[:, x])[0]
        if len(col_ys) > 0:
            y_top_col[x] = int(col_ys[0])

    collar_band_h = max(11, int(round(0.034 * fh)))

    # Protect ONLY the smooth upper back collar band between col_x_left and col_x_right
    top_collar_band = np.zeros((h, w), dtype=bool)
    collar_pad_x = max(6, int(0.022 * fw))
    for x in range(max(0, col_x_left - collar_pad_x), min(w, col_x_right + collar_pad_x + 1)):
        yt = y_top_col[x]
        if yt < y_min + int(0.10 * fh):
            # Taper band height gently to 0 outside [col_x_left..col_x_right] so side front collar legs are NOT kept
            if x < col_x_left:
                t = max(0.0, 1.0 - (col_x_left - x) / float(collar_pad_x))
            elif x > col_x_right:
                t = max(0.0, 1.0 - (x - col_x_right) / float(collar_pad_x))
            else:
                t = 1.0
            bh_x = int(round(collar_band_h * t))
            if bh_x > 0:
                top_collar_band[yt:min(h, yt + bh_x), x] = True

    # 3. Build replacement mask: central chest graphic + inner neck tag + front scoop collar loop
    outer_袖_hem_guard = ~erode_mask(opaque, max(8, int(0.05 * min(fh, fw))))
    # Allow replacement up to the top collar inside the neck column range even near top border
    in_neck_cols = (xx >= col_x_left - collar_pad_x - 6) & (xx <= col_x_right + collar_pad_x + 6) & (yy <= y_min + int(0.24 * fh))
    protected_outer = outer_袖_hem_guard & (~in_neck_cols)

    cx_norm = (xx - 0.5 * (x_min + x_max)) / (0.25 * fw + 1e-5)
    cy_chest = (yy - (y_min + 0.44 * fh)) / (0.27 * fh + 1e-5)
    chest_core = (cx_norm ** 2 + cy_chest ** 2) <= 1.0

    neck_scoop = (
        in_neck_cols
        & (yy >= (y_top_col[np.clip(xx, 0, w - 1)] + collar_band_h - 2))
        & (yy <= y_min + int(0.23 * fh))
    )

    ink_outliers = (
        (dE_from_base > 7.0)
        & (xx >= x_min + int(0.24 * fw))
        & (xx <= x_min + int(0.76 * fw))
        & (yy >= y_min + int(0.02 * fh))
        & (yy <= y_min + int(0.78 * fh))
        & (~top_collar_band)
    )
    ink_outliers = dilate_mask(ink_outliers, 5)

    replace_mask = (chest_core | neck_scoop | ink_outliers) & opaque & (~top_collar_band) & (~protected_outer)

    # 4. Reconstruct clean drape-shaded fabric across replace_mask using exact float64 normalized convolution!
    lower_y0 = y_min + int(0.70 * fh)
    lower_y1 = y_min + int(0.90 * fh)
    lower_strip = front_rgb[lower_y0:lower_y1, :, :]
    lower_valid = opaque[lower_y0:lower_y1, :] & (dE_from_base[lower_y0:lower_y1, :] < 9.0)

    col_fold_delta = np.zeros((w, 3), dtype=np.float64)
    for x in range(w):
        valid_rows = lower_valid[:, x]
        if np.sum(valid_rows) >= 4:
            col_fold_delta[x] = np.median(lower_strip[valid_rows, x, :], axis=0) - base_rgb

    for c in range(3):
        c1d = col_fold_delta[:, c].reshape(1, w)
        col_fold_delta[:, c] = blur_float(c1d, radius=3.0)[0] - blur_float(c1d, radius=28.0)[0]

    valid_fabric = opaque & (~replace_mask) & (dE_from_base < 10.0)
    if np.sum(valid_fabric) < 100:
        valid_fabric = opaque & (~replace_mask)

    w_known = valid_fabric.astype(np.float64)
    src_known = np.where(valid_fabric[..., None], front_rgb, 0.0)

    # Multi-scale exact float64 normalized Gaussian pyramid fill (guaranteed smooth across any radius!)
    num_coarse = blur_float(src_known, radius=42.0)
    den_coarse = blur_float(w_known, radius=42.0)[..., None]
    fill_coarse = np.where(den_coarse > 1e-6, num_coarse / np.maximum(den_coarse, 1e-6), base_rgb)

    # Seed medium pass with known pixels + coarse fill where den_coarse is weak
    seed_med = np.where(valid_fabric[..., None], front_rgb, fill_coarse)
    smooth_illum = blur_float(seed_med, radius=14.0)
    smooth_illum = np.where(valid_fabric[..., None], front_rgb, smooth_illum)
    smooth_illum = blur_float(smooth_illum, radius=5.0)

    rng = np.random.default_rng(seed=42)
    grain = rng.normal(0.0, 0.75, size=(h, w, 1))
    y_rel = np.clip((yy - (y_min + 0.14 * fh)) / (0.35 * fh), 0.20, 1.0)[..., None]
    synthesized_fabric = np.clip(
        smooth_illum + col_fold_delta[xx] * 0.72 * y_rel + grain,
        0.0,
        255.0,
    )

    # Clean body RGB (front silhouette with chest graphic & inner neck cleanly removed)
    blend_front = blur_float(replace_mask.astype(np.float64), radius=6.5)
    blend_front[top_collar_band] = 0.0
    blend_front = np.clip(blend_front * 1.35, 0.0, 1.0)
    blend_front = blur_float(blend_front, radius=2.2)
    blend_front[top_collar_band] = 0.0
    clean_body_rgb = front_rgb * (1.0 - blend_front[..., None]) + synthesized_fabric * blend_front[..., None]

    # 5. Reconstruct raised crew-neck back collar arch at top-center!
    back_rgb = clean_body_rgb.copy()
    back_alpha = front_alpha.copy()

    # Sample authentic collar trim RGB from the center of the upper collar band
    collar_mid_x = int(round(0.5 * (col_x_left + col_x_right)))
    sample_x0 = max(col_x_left, collar_mid_x - max(8, int(0.05 * fw)))
    sample_x1 = min(col_x_right, collar_mid_x + max(8, int(0.05 * fw)))
    collar_samples = []
    for sx in range(sample_x0, sample_x1 + 1):
        yt = y_top_col[sx]
        if yt < y_min + int(0.10 * fh):
            strip = front_rgb[yt + 2:min(h, yt + collar_band_h - 2), sx]
            if len(strip) > 0:
                collar_samples.append(np.median(strip, axis=0))
    collar_rgb = np.median(np.array(collar_samples), axis=0) if collar_samples else base_rgb

    center_dip = int(y_top_col[collar_mid_x] - y_min)
    collar_span = max(1, col_x_right - col_x_left)

    if 2 <= center_dip <= int(0.09 * fh) and collar_span >= 20:
        # Back crew-neck collar dips gently (~45% of front/flat-lay dip) from left to right shoulder peak
        target_dip = max(2.0, center_dip * 0.45)
        y_left_peak = float(y_top_col[col_x_left])
        y_right_peak = float(y_top_col[col_x_right])

        for x in range(col_x_left - 4, col_x_right + 5):
            if x < 0 or x >= w:
                continue
            u = np.clip((x - col_x_left) / float(collar_span), 0.0, 1.0)
            baseline_y = (1.0 - u) * y_left_peak + u * y_right_peak
            arch_dip = target_dip * math.sin(math.pi * u)
            yt_new = baseline_y + arch_dip

            # Lateral taper near shoulder seams so green collar joins cream shoulder seam cleanly
            edge_dist = min(x - col_x_left, col_x_right - x)
            taper = float(np.clip((edge_dist + 4.0) / 8.0, 0.0, 1.0))
            if taper <= 0.0:
                continue

            band_thick = collar_band_h * (0.78 + 0.22 * math.sin(math.pi * u))
            yb_new = yt_new + band_thick

            y_start = max(0, int(math.floor(yt_new)) - 2)
            y_end = min(h, int(math.ceil(yb_new)) + 12)
            for y in range(y_start, y_end):
                # Smooth anti-aliased top edge of back collar
                top_cov = float(np.clip((y - yt_new + 0.8) / 1.6, 0.0, 1.0))
                if top_cov <= 0.0:
                    continue
                back_alpha[y, x] = max(back_alpha[y, x], top_cov * taper + back_alpha[y, x] * (1.0 - taper))

                # Inside the ribbed collar band [yt_new .. yb_new]
                if y <= yb_new + 2.0:
                    bot_blend = float(np.clip((yb_new - y + 1.0) / 2.0, 0.0, 1.0))
                    rib_w = bot_blend * taper
                    # Subtle rib knit vertical wale & cylindrical collar roll shading
                    v_collar = (y - yt_new) / max(1.0, band_thick)
                    roll_shade = 1.04 - 0.10 * ((v_collar - 0.38) ** 2) * 2.2 + 0.018 * math.sin(2.0 * math.pi * x / 2.5)
                    # Subtle stitched seam shadow right along bottom of collar rib (v_collar ~ 0.95)
                    seam_dip = -4.5 * math.exp(-((v_collar - 0.96) / 0.10) ** 2)
                    rib_col = np.clip(collar_rgb * roll_shade + seam_dip, 0.0, 255.0)
                    back_rgb[y, x] = rib_col * rib_w + synthesized_fabric[y, x] * (1.0 - rib_w)
                else:
                    # Smooth back-yoke cotton right underneath the collar band
                    back_rgb[y, x] = synthesized_fabric[y, x] * taper + back_rgb[y, x] * (1.0 - taper)

    back_rgb[back_alpha == 0.0] = 0.0
    return back_rgb, back_alpha, clean_body_rgb


# ---------------------------------------------------------------------------
# Stage 3: Tangent-Space PBR Fabric Normal Map (Fold Relief + Cotton Weave)
# ---------------------------------------------------------------------------

def generate_fabric_normal_map(
    front_rgb: np.ndarray,
    clean_body_rgb: np.ndarray,
    alpha: np.ndarray,
    fold_strength: float = 3.0,
    weave_strength: float = 0.20,
) -> np.ndarray:
    """
    Generate an exact float64-derived tangent-space RGB normal map (uint8 HxWx3, #8080FF outside):
      - Attenuates sharp chest graphic ink contrast (90% clean_body_rgb + 10% front_rgb) so Snoopy
        and lettering show subtle plastisol screen-print ink relief instead of stamped sheet metal,
        while boosting soft cotton drape folds and collar/cuff seam ridges!
      - Blends procedural 1x1 combed cotton jersey knit micro-weave across the garment interior.
    """
    h, w, _ = front_rgb.shape

    lum_front = (0.2126 * front_rgb[..., 0] + 0.7152 * front_rgb[..., 1] + 0.0722 * front_rgb[..., 2]) / 255.0
    lum_clean = (0.2126 * clean_body_rgb[..., 0] + 0.7152 * clean_body_rgb[..., 1] + 0.0722 * clean_body_rgb[..., 2]) / 255.0

    opaque = alpha >= 0.5
    med_lum = float(np.median(lum_clean[opaque])) if np.any(opaque) else 0.9
    base_lum = np.where(alpha > 0.1, 0.90 * lum_clean + 0.10 * lum_front, med_lum)

    interior = erode_mask(opaque, 4)
    if np.any(interior):
        padded_lum = propagate_interior_rgb(
            np.repeat(base_lum[..., None], 3, axis=-1),
            interior,
            iterations=10,
        )[..., 0]
    else:
        padded_lum = base_lum

    # Exact float64 multi-scale fabric fold heightfield (zero 8-bit contour terracing!)
    h_fine = blur_float(padded_lum, radius=1.5) - blur_float(padded_lum, radius=4.8)
    h_meso = blur_float(padded_lum, radius=4.8) - blur_float(padded_lum, radius=15.0)
    h_macro = blur_float(padded_lum, radius=12.0) - blur_float(padded_lum, radius=32.0)
    height_folds = 0.50 * h_fine + 1.40 * h_meso + 1.80 * h_macro

    # Procedural combed-cotton 1x1 jersey knit micro-weave
    yy, xx = np.indices((h, w), dtype=np.float64)
    wale = np.sin(2.0 * math.pi * xx / 3.0)
    course = np.sin(2.0 * math.pi * yy / 2.6 + 0.85 * wale)
    slub = np.sin(2.0 * math.pi * yy / 11.0 + 0.3 * np.cos(2.0 * math.pi * xx / 17.0))
    micro_weave = (0.55 * wale + 0.35 * course + 0.10 * slub) * 0.0040

    total_height = height_folds * fold_strength + micro_weave * weave_strength
    dh_dx, dh_dy = sobel_xy(total_height)

    mask_taper = blur_float(erode_mask(alpha >= 0.4, 2).astype(np.float64), radius=2.0) * np.clip(alpha, 0.0, 1.0)
    nx = -dh_dx * 20.0 * mask_taper
    ny = dh_dy * 20.0 * mask_taper
    nz = np.ones_like(nx)

    norm_len = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    nx /= norm_len
    ny /= norm_len
    nz /= norm_len

    normal_rgb = np.empty((h, w, 3), dtype=np.uint8)
    normal_rgb[..., 0] = np.clip(np.rint((nx * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    normal_rgb[..., 1] = np.clip(np.rint((ny * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    normal_rgb[..., 2] = np.clip(np.rint((nz * 0.5 + 0.5) * 255.0), 128, 255).astype(np.uint8)

    outside = mask_taper < 0.01
    normal_rgb[outside, 0] = 128
    normal_rgb[outside, 1] = 128
    normal_rgb[outside, 2] = 255
    return normal_rgb


# ---------------------------------------------------------------------------
# End-to-End File Processor & CLI Batch Runner
# ---------------------------------------------------------------------------

def save_rgba(rgb: np.ndarray, alpha: np.ndarray, path: Path) -> None:
    h, w, _ = rgb.shape
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(np.rint(alpha * 255.0), 0, 255).astype(np.uint8)
    rgba[rgba[..., 3] == 0, :3] = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)


def derive_prefix(input_path: Path) -> str:
    stem = input_path.stem
    if stem.endswith("-raw") or stem.endswith("_raw"):
        return stem[:-4]
    return stem


def process_single_garment(
    input_path: Path,
    output_dir: Path,
    prefix: Optional[str] = None,
    back_image_path: Optional[Path] = None,
    tolerance: float = 20.0,
    collar_top_pct: float = 0.03,
) -> Dict[str, object]:
    t0 = time.perf_counter()
    pfx = prefix or derive_prefix(input_path)
    im = Image.open(input_path)

    front_rgb, front_alpha, metrics = compute_front_cutout(
        im,
        tolerance=tolerance,
        collar_top_pct=collar_top_pct,
    )

    if back_image_path and back_image_path.exists():
        back_im = Image.open(back_image_path)
        back_rgb_raw, back_alpha_raw, _ = compute_front_cutout(
            back_im,
            tolerance=tolerance,
            collar_top_pct=collar_top_pct,
        )
        bh, bw = front_alpha.shape
        back_pil = Image.fromarray(
            np.dstack([
                np.clip(np.rint(back_rgb_raw), 0, 255).astype(np.uint8),
                np.clip(np.rint(back_alpha_raw * 255.0), 0, 255).astype(np.uint8),
            ]),
            mode="RGBA",
        ).resize((bw, bh), Image.Resampling.LANCZOS)
        back_arr = np.asarray(back_pil, dtype=np.float64)
        back_rgb = back_arr[..., :3]
        back_alpha = back_arr[..., 3] / 255.0
        _, _, clean_body_rgb = synthesize_back_cutout(front_rgb, front_alpha)
    else:
        back_rgb, back_alpha, clean_body_rgb = synthesize_back_cutout(front_rgb, front_alpha)

    normal_rgb = generate_fabric_normal_map(front_rgb, clean_body_rgb, front_alpha)

    front_out = output_dir / f"{pfx}-front-cutout.png"
    back_out = output_dir / f"{pfx}-back-cutout.png"
    normal_out = output_dir / f"{pfx}-normal.png"
    meta_out = output_dir / f"{pfx}-meta.json"

    save_rgba(front_rgb, front_alpha, front_out)
    save_rgba(back_rgb, back_alpha, back_out)
    output_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(normal_rgb, mode="RGB").save(normal_out, format="PNG", optimize=True)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    report: Dict[str, object] = {
        "prefix": pfx,
        "input": str(input_path.as_posix()),
        "frontCutout": str(front_out.as_posix()),
        "backCutout": str(back_out.as_posix()),
        "normalMap": str(normal_out.as_posix()),
        "metaJson": str(meta_out.as_posix()),
        "elapsedMs": elapsed_ms,
        **metrics,
    }
    meta_out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Process raw garment photography into RGBA front/back cutouts + PBR normal maps."
    )
    parser.add_argument(
        "inputs",
        nargs="*",
        help="Input garment image path(s). Defaults to public/assets/raw-shirt.jpg + public/assets/garments/*-raw.*",
    )
    parser.add_argument(
        "--output-dir",
        default="public/assets/garments",
        help="Directory for generated PNGs & metadata (default: public/assets/garments)",
    )
    parser.add_argument("--prefix", default=None, help="Optional output filename prefix (single input mode)")
    parser.add_argument("--back-image", default=None, help="Optional explicit back-of-garment photo")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=20.0,
        help="Perceptual CIELAB flood-fill tolerance (default: 20.0)",
    )
    parser.add_argument(
        "--collar-top-pct",
        type=float,
        default=0.03,
        help="Normalized top collar anchor fraction from top of canvas (default: 0.03 = 3%%)",
    )

    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = Path(args.output_dir)
    if not out_dir.is_absolute():
        out_dir = repo_root / out_dir

    targets: List[Path] = []
    if args.inputs:
        for raw_in in args.inputs:
            p = Path(raw_in)
            if not p.is_absolute():
                p = (Path.cwd() / p).resolve()
            targets.append(p)
    else:
        default_hero = repo_root / "public" / "assets" / "raw-shirt.jpg"
        if default_hero.exists():
            targets.append(default_hero)
        garments_dir = repo_root / "public" / "assets" / "garments"
        if garments_dir.exists():
            for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
                for cand in sorted(garments_dir.glob(f"*-raw{ext[1:]}")):
                    if cand not in targets:
                        targets.append(cand)

    if not targets:
        print("No input garment images found.", file=sys.stderr)
        return 1

    for idx, target in enumerate(targets):
        pfx = args.prefix if (args.prefix and len(targets) == 1) else None
        back_p = Path(args.back_image) if (args.back_image and len(targets) == 1) else None
        res = process_single_garment(
            input_path=target,
            output_dir=out_dir,
            prefix=pfx,
            back_image_path=back_p,
            tolerance=args.tolerance,
            collar_top_pct=args.collar_top_pct,
        )
        print(
            f"[{idx + 1}/{len(targets)}] {res['prefix']}: "
            f"{res['width']}x{res['height']} (aspect={res['aspect']}), "
            f"collarTop={res['collarTopPct']}%, "
            f"torsoKept={res['torsoRetentionPct']}%, "
            f"bgRemoved={res['outerBgRemovalPct']}%, "
            f"dominant={res['dominantHex']}, accent={res['accentHex']} "
            f"({res['elapsedMs']}ms)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
