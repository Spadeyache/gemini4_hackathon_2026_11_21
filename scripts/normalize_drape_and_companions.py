#!/usr/bin/env python3
"""
Physics Sleeve-Drape Normalizer & Capsule Garment Synthesizer
=============================================================
Part 1:
  - Perceptual CIELAB corner-sampled flood-fill segmentation of `public/assets/raw-shirt.jpg`
    with directional warm-chroma separation, edge color-spill decontamination, and 1.5px soft
    anti-aliased alpha feathering.
  - Vectorized numpy 2D Cloth Gravity Drape Warp (bilinear backward-mapping):
      * Keeps central torso (|x - cx| < 0.20 * width) 100% undistorted horizontally so the
        Snoopy tennis illustration and "Good Shot Club" typography stay razor-sharp.
      * Smoothly rotates/droops left and right sleeves downward & inward by ~20.5 deg around
        each shoulder hinge (cx +/- 0.21 * width, top_collar + 0.08 * height).
      * Adds subtle cosine cylindrical torso shading + vertical catenary cloth drape waves
        (attenuated over the chest print) and frames to 900x1100 RGBA with collar top at 3%.
  - Synthesizes matching rear hanging view (`normalized-back-cutout.png`) and tangent-space
    cloth + jersey knit normal map (`normalized-normal.png`).

Part 2:
  - Supersampled 1600x2000 -> 800x1000 LANCZOS synthesis of two companion capsule garments
    aligned with collar top at 3%:
      1) Companion 1: Cream & Sage Collegiate Cable-Knit Tennis Cardigan (front, back, normal)
      2) Companion 2: Heritage Wimbledon Sage Pique Club Polo (front, back, normal)

Dependencies: Python 3.13 stdlib + numpy + PIL (no scipy, no cv2).
"""

from __future__ import annotations

import math
import os
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_SHIRT_PATH = ROOT_DIR / "public" / "assets" / "raw-shirt.jpg"
OUT_GARMENTS_DIR = ROOT_DIR / "public" / "assets" / "garments"


# ---------------------------------------------------------------------------
# Core Vectorized Math & Image Helpers
# ---------------------------------------------------------------------------

def smoothstep(edge0: float | np.ndarray, edge1: float | np.ndarray, x: np.ndarray) -> np.ndarray:
    denom = edge1 - edge0
    safe_denom = np.where(np.abs(denom) < 1e-6, np.where(denom >= 0.0, 1e-6, -1e-6), denom)
    t = np.clip((x - edge0) / safe_denom, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blur_channel(arr2d: np.ndarray, radius: float) -> np.ndarray:
    """Fast Gaussian blur on a 2D float32 array using PIL (no scipy/cv2)."""
    if radius <= 0.0:
        return arr2d.astype(np.float32, copy=True)
    mn = float(arr2d.min())
    mx = float(arr2d.max())
    if mx - mn < 1e-8:
        return np.full_like(arr2d, mn, dtype=np.float32)
    scaled = np.clip((arr2d - mn) / (mx - mn) * 255.0, 0.0, 255.0).astype(np.uint8)
    im = Image.fromarray(scaled, mode="L").filter(ImageFilter.GaussianBlur(radius=radius))
    out = np.asarray(im, dtype=np.float32) / 255.0
    return out * (mx - mn) + mn


def srgb_to_cielab(rgb_01: np.ndarray) -> np.ndarray:
    """Vectorized sRGB [0,1] -> D65 CIELAB conversion."""
    lin = np.where(rgb_01 <= 0.04045, rgb_01 / 12.92, ((rgb_01 + 0.055) / 1.055) ** 2.4)
    X = (lin[..., 0] * 0.4124564 + lin[..., 1] * 0.3575761 + lin[..., 2] * 0.1804375) / 0.95047
    Y = lin[..., 0] * 0.2126729 + lin[..., 1] * 0.7151522 + lin[..., 2] * 0.0721750
    Z = (lin[..., 0] * 0.0193339 + lin[..., 1] * 0.1191920 + lin[..., 2] * 0.9503041) / 1.08883
    delta = 6.0 / 29.0
    d3 = delta ** 3
    inv_3d2 = 1.0 / (3.0 * delta * delta)

    def f(t: np.ndarray) -> np.ndarray:
        return np.where(t > d3, np.cbrt(np.maximum(t, 0.0)), t * inv_3d2 + 4.0 / 29.0)

    fx, fy, fz = f(X), f(Y), f(Z)
    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1).astype(np.float32)


def bilinear_sample_rgba(img: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Vectorized premultiplied-alpha bilinear backward sampler on float32 RGBA [0,1]."""
    H, W, _ = img.shape
    valid = (sx >= 0.0) & (sx <= W - 1.0) & (sy >= 0.0) & (sy <= H - 1.0)
    sx_c = np.clip(sx, 0.0, W - 1.0001)
    sy_c = np.clip(sy, 0.0, H - 1.0001)

    x0 = np.floor(sx_c).astype(np.int32)
    y0 = np.floor(sy_c).astype(np.int32)
    x1 = np.minimum(x0 + 1, W - 1)
    y1 = np.minimum(y0 + 1, H - 1)

    fx = (sx_c - x0)[..., None]
    fy = (sy_c - y0)[..., None]

    c00 = img[y0, x0]
    c10 = img[y0, x1]
    c01 = img[y1, x0]
    c11 = img[y1, x1]

    a00, a10, a01, a11 = c00[..., 3:4], c10[..., 3:4], c01[..., 3:4], c11[..., 3:4]
    pm00 = c00[..., :3] * a00
    pm10 = c10[..., :3] * a10
    pm01 = c01[..., :3] * a01
    pm11 = c11[..., :3] * a11

    pm = (pm00 * (1.0 - fx) + pm10 * fx) * (1.0 - fy) + (pm01 * (1.0 - fx) + pm11 * fx) * fy
    a = (a00 * (1.0 - fx) + a10 * fx) * (1.0 - fy) + (a01 * (1.0 - fx) + a11 * fx) * fy
    rgb = pm / np.maximum(a, 1e-5)
    a = np.where(valid[..., None], a, 0.0)
    return np.concatenate([np.clip(rgb, 0.0, 1.0), np.clip(a, 0.0, 1.0)], axis=-1)


def extrapolate_rgb_outside_mask(rgb: np.ndarray, interior_mask: np.ndarray, iterations: int = 8) -> np.ndarray:
    """Propagate clean interior RGB outward across alpha boundaries to prevent edge color spill."""
    H, W, _ = rgb.shape
    clean = rgb.copy()
    known = interior_mask.copy()
    neighbors = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    for _ in range(iterations):
        acc = np.zeros_like(clean)
        wsum = np.zeros((H, W, 1), dtype=np.float32)
        for dy, dx in neighbors:
            sy0, sy1 = max(0, -dy), H - max(0, dy)
            sx0, sx1 = max(0, -dx), W - max(0, dx)
            dy0, dy1 = max(0, dy), H - max(0, -dy)
            dx0, dx1 = max(0, dx), W - max(0, -dx)
            wt = 1.0 if (dy == 0 or dx == 0) else 0.7071
            k = known[sy0:sy1, sx0:sx1, None].astype(np.float32) * wt
            acc[dy0:dy1, dx0:dx1] += clean[sy0:sy1, sx0:sx1] * k
            wsum[dy0:dy1, dx0:dx1] += k
        can_fill = (~known) & (wsum[..., 0] > 0.0)
        if not np.any(can_fill):
            break
        clean = np.where(can_fill[..., None], acc / np.maximum(wsum, 1e-6), clean)
        known = known | can_fill
    return clean


def height_to_normal_rgb(height: np.ndarray, alpha: np.ndarray, strength: float = 3.5) -> np.ndarray:
    """Convert a 2D heightfield + garment alpha into an OpenGL tangent-space normal map (#8080FF outside)."""
    H, W = height.shape
    dh_dx = np.zeros_like(height, dtype=np.float32)
    dh_dy = np.zeros_like(height, dtype=np.float32)
    dh_dx[:, 1:-1] = (height[:, 2:] - height[:, :-2]) * 0.5
    dh_dy[1:-1, :] = (height[2:, :] - height[:-2, :]) * 0.5

    # Taper normal perturbation right at outer rim so silhouette transition to #8080FF is seamless
    edge_weight = blur_channel((alpha > 0.45).astype(np.float32), 1.6) * (alpha > 0.04).astype(np.float32)
    nx = -dh_dx * strength * edge_weight
    ny = dh_dy * strength * edge_weight
    nz = np.ones_like(nx, dtype=np.float32)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    inside = alpha > 0.04
    out = np.empty((H, W, 3), dtype=np.uint8)
    out[..., 0] = np.where(inside, np.clip(np.round((nx * 0.5 + 0.5) * 255.0), 0, 255), 128).astype(np.uint8)
    out[..., 1] = np.where(inside, np.clip(np.round((ny * 0.5 + 0.5) * 255.0), 0, 255), 128).astype(np.uint8)
    out[..., 2] = np.where(inside, np.clip(np.round((nz * 0.5 + 0.5) * 255.0), 0, 255), 255).astype(np.uint8)
    return out


def downsample_rgba_lanczos(rgba_hi: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """Halo-free supersampled RGBA -> target LANCZOS downsample."""
    rgb_clean = extrapolate_rgb_outside_mask(rgba_hi[..., :3], rgba_hi[..., 3] > 0.65, iterations=8)
    rgb_u8 = np.clip(np.round(rgb_clean * 255.0), 0, 255).astype(np.uint8)
    a_u8 = np.clip(np.round(rgba_hi[..., 3] * 255.0), 0, 255).astype(np.uint8)

    rgb_lo = np.asarray(
        Image.fromarray(rgb_u8, mode="RGB").resize((out_w, out_h), Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / 255.0
    a_lo = np.asarray(
        Image.fromarray(a_u8, mode="L").resize((out_w, out_h), Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / 255.0
    # Ensure strictly zero alpha in transparent background outside 1.5px feather
    a_lo = np.where(a_lo < 0.012, 0.0, a_lo)
    return np.concatenate([rgb_lo, a_lo[..., None]], axis=-1)


def save_rgba_png(rgba_01: np.ndarray, path: Path) -> None:
    arr = np.clip(np.round(rgba_01 * 255.0), 0, 255).astype(np.uint8)
    # Zero out RGB in strictly transparent pixels for clean PNG compression
    zero_a = arr[..., 3] == 0
    arr[zero_a, :3] = 0
    Image.fromarray(arr, mode="RGBA").save(path, format="PNG", optimize=True)


def hex_to_rgb01(hex_str: str) -> np.ndarray:
    h = hex_str.lstrip("#")
    return np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)], dtype=np.float32) / 255.0


def hash_noise_2d(H: int, W: int, cell: int = 4, seed: int = 42) -> np.ndarray:
    """Smooth tile-free value noise in [-0.5, 0.5] using PIL bicubic upsampling."""
    rng = np.random.default_rng(seed)
    gh = max(4, H // cell + 2)
    gw = max(4, W // cell + 2)
    grid = rng.uniform(0.0, 255.0, size=(gh, gw)).astype(np.uint8)
    up = Image.fromarray(grid, mode="L").resize((W, H), Image.Resampling.BICUBIC)
    return np.asarray(up, dtype=np.float32) / 255.0 - 0.5


# ---------------------------------------------------------------------------
# PART 1: Physics-Warped Hanging Normalization of `public/assets/raw-shirt.jpg`
# ---------------------------------------------------------------------------

def segment_raw_shirt(raw_img: Image.Image) -> np.ndarray:
    """
    Corner-sampled perceptual CIELAB flood-fill segmentation + edge color-spill
    decontamination + 1.5px soft anti-aliased alpha feather.
    """
    rgb = np.asarray(raw_img.convert("RGB"), dtype=np.float32) / 255.0
    H, W, _ = rgb.shape
    lab = srgb_to_cielab(rgb)

    corners_lab = np.concatenate([
        lab[:40, :40].reshape(-1, 3),
        lab[:40, -40:].reshape(-1, 3),
        lab[-40:, :40].reshape(-1, 3),
        lab[-40:, -40:].reshape(-1, 3),
    ], axis=0)
    bg_lab = np.median(corners_lab, axis=0)

    corners_rgb = np.concatenate([
        rgb[:40, :40].reshape(-1, 3),
        rgb[:40, -40:].reshape(-1, 3),
        rgb[-40:, :40].reshape(-1, 3),
        rgb[-40:, -40:].reshape(-1, 3),
    ], axis=0)
    bg_rgb = np.median(corners_rgb, axis=0)

    # Lightly smooth JPEG 4:2:0 chroma blockiness for mask boundary detection only
    L_sm = blur_channel(lab[..., 0], 0.55)
    a_sm = blur_channel(lab[..., 1], 1.15)
    b_sm = blur_channel(lab[..., 2], 1.15)

    dL = L_sm - bg_lab[0]
    da = a_sm - bg_lab[1]
    db = b_sm - bg_lab[2]
    # Cream cotton & sage-green trim both carry positive yellow-warmth (+db) or darker L;
    # ignoring negative db suppresses cool/cyan 8x8 JPEG ringing blocks around the cuffs.
    db_warm = np.maximum(db, 0.0)
    de_perceptual = np.sqrt(dL * dL + da * da + 3.85 * (db_warm * db_warm))

    bg_cand = de_perceptual < 4.15
    visited = np.zeros((H, W), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(W):
        visited[0, x] = True
        q.append((0, x))
        visited[H - 1, x] = True
        q.append((H - 1, x))
    for y in range(H):
        visited[y, 0] = True
        q.append((y, 0))
        visited[y, W - 1] = True
        q.append((y, W - 1))

    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < H and 0 <= nx < W and not visited[ny, nx] and bg_cand[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    fg = ~visited

    # Retain largest 4-connected foreground component
    comp_id = np.zeros((H, W), dtype=np.int32)
    best_id, best_count = 0, 0
    cid = 0
    for y in range(H):
        for x in range(W):
            if fg[y, x] and comp_id[y, x] == 0:
                cid += 1
                cnt = 0
                dq = deque([(y, x)])
                comp_id[y, x] = cid
                while dq:
                    cy, cx = dq.popleft()
                    cnt += 1
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                        if 0 <= ny < H and 0 <= nx < W and fg[ny, nx] and comp_id[ny, nx] == 0:
                            comp_id[ny, nx] = cid
                            dq.append((ny, nx))
                if cnt > best_count:
                    best_count = cnt
                    best_id = cid
    fg = comp_id == best_id

    # Level-set contour smoothing to remove 8x8 JPEG staircase while keeping sharp armpits & cuff tips
    fg_f = fg.astype(np.float32)
    closed = (blur_channel(fg_f, 2.1) > 0.42).astype(np.float32)
    sm_broad = blur_channel(closed, 3.6)
    sm_sharp = blur_channel(fg_f, 1.15)

    yy, xx = np.meshgrid(np.arange(H, dtype=np.float32), np.arange(W, dtype=np.float32), indexing="ij")
    pit_L = np.exp(-((xx - 159.0) ** 2 + (yy - 379.0) ** 2) / (2.0 * 16.0 ** 2))
    pit_R = np.exp(-((xx - 442.0) ** 2 + (yy - 379.0) ** 2) / (2.0 * 16.0 ** 2))
    cuff_corners = (
        np.exp(-((xx - 35.0) ** 2 + (yy - 315.0) ** 2) / (2.0 * 13.0 ** 2))
        + np.exp(-((xx - 98.0) ** 2 + (yy - 396.0) ** 2) / (2.0 * 13.0 ** 2))
        + np.exp(-((xx - 565.0) ** 2 + (yy - 317.0) ** 2) / (2.0 * 13.0 ** 2))
        + np.exp(-((xx - 504.0) ** 2 + (yy - 402.0) ** 2) / (2.0 * 13.0 ** 2))
    )
    sharp_w = np.clip(pit_L + pit_R + 0.75 * cuff_corners, 0.0, 1.0)
    level = sharp_w * sm_sharp + (1.0 - sharp_w) * sm_broad
    alpha = smoothstep(0.45, 0.62, level)
    alpha = np.where(alpha < 0.01, 0.0, alpha)

    # Edge color-spill decontamination: unmix + propagate clean interior fabric hues across rim
    interior = level > 0.83
    prop_rgb = extrapolate_rgb_outside_mask(rgb, interior, iterations=10)
    a_safe = np.maximum(alpha[..., None], 0.40)
    unmixed = np.clip((rgb - (1.0 - a_safe) * bg_rgb) / a_safe, 0.0, 1.0)
    clean_rgb = np.where(
        interior[..., None],
        rgb,
        np.where((alpha > 0.5)[..., None], 0.78 * prop_rgb + 0.22 * unmixed, prop_rgb),
    )
    return np.concatenate([clean_rgb, alpha[..., None]], axis=-1)


def apply_cloth_gravity_drape_warp(
    rgba: np.ndarray,
    top_collar: float,
    cx_src: float = 299.5,
    out_w: int = 900,
    out_h: int = 1100,
    scale: float = 1.78,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Smooth 2D Cloth Gravity Drape Warp (vectorized numpy coordinate grid + bilinear sampling):
      - Central torso (|x - cx| < 0.20 * width) is 100% undistorted horizontally so Snoopy
        and "Good Shot Club" remain 100% crisp and authentic.
      - Beyond |x - cx| > 0.21 * width, sleeves smoothly rotate/droop downward & inward by
        ~20.5 deg around each shoulder pivot (cx +/- 0.21*width, top_collar + 0.08*height).
      - Framed to 900x1100 RGBA with top collar cleanly at 3% from top (y = 33).
    """
    H, W, _ = rgba.shape
    yy_s, xx_s = np.meshgrid(np.arange(H, dtype=np.float32), np.arange(W, dtype=np.float32), indexing="ij")

    # Separate sleeve overhang at the lower armpit cleft (y > 365) while transitioning smoothly
    # inside the undistorted torso zone above y=365 so no seam line ever occurs.
    in_cleft = smoothstep(365.0, 382.0, yy_s)
    cut_L = (1.0 - in_cleft) * 180.0 + in_cleft * 158.5
    cut_R = (1.0 - in_cleft) * 419.0 + in_cleft * 442.5
    feather = (1.0 - in_cleft) * 8.0 + in_cleft * 2.0

    in_sleeve_y = 1.0 - smoothstep(404.0, 416.0, yy_s)
    sl_L = smoothstep(cut_L + feather, cut_L - feather, xx_s) * in_sleeve_y
    sl_R = smoothstep(cut_R - feather, cut_R + feather, xx_s) * in_sleeve_y
    sleeve_w = np.clip(sl_L + sl_R, 0.0, 1.0)

    torso_L = smoothstep(155.0 - 12.0 * (1.0 - in_cleft), 159.0 - 8.0 * (1.0 - in_cleft), xx_s)
    torso_R = smoothstep(445.0 + 12.0 * (1.0 - in_cleft), 441.0 + 8.0 * (1.0 - in_cleft), xx_s)
    torso_w = np.where(yy_s < 414.0, torso_L * torso_R, 1.0)

    torso_rgba = rgba.copy()
    torso_rgba[..., 3] *= torso_w
    sleeve_rgba = rgba.copy()
    sleeve_rgba[..., 3] *= sleeve_w

    target_collar_y = 0.03 * out_h  # 33.0 px = 3.0% from top
    cx_dst = out_w * 0.5            # 450.0 px horizontal center

    yy_d, xx_d = np.meshgrid(np.arange(out_h, dtype=np.float32), np.arange(out_w, dtype=np.float32), indexing="ij")
    bx = (xx_d - cx_dst) / scale + cx_src
    by = (yy_d - target_collar_y) / scale + top_collar

    abs_dx = np.abs(bx - cx_src)
    side = np.where(bx >= cx_src, 1.0, -1.0)

    # 1) Torso backward map: |bx - cx_src| <= 0.20 * W (120 px) has ZERO horizontal distortion!
    w_outer = smoothstep(0.20 * W, 0.245 * W, abs_dx)
    w_sh_slope = w_outer * (1.0 - smoothstep(235.0, 290.0, by))
    w_hem_relax = w_outer * smoothstep(350.0, 615.0, by)
    w_catenary = smoothstep(535.0, 620.0, by)
    catenary_dy = -2.0 * np.cos((bx - cx_src) / 145.0 * np.pi * 0.5) - 1.1 * np.cos((bx - cx_src) / 27.0 * np.pi)

    tx_src = bx + side * (4.5 * w_hem_relax)
    ty_src = by - 5.0 * w_sh_slope + w_catenary * catenary_dy * (0.30 + 0.70 * w_outer)

    warped_torso = bilinear_sample_rgba(torso_rgba, tx_src, ty_src)

    # 2) Sleeve 2D Cloth Gravity Drape Warp around shoulder pivot (cx +/- 0.21*W, top_collar + 0.08*H)
    x_piv = cx_src + side * (0.21 * W)
    y_piv = top_collar + 0.08 * H

    w_rot = smoothstep(0.20 * W, 0.232 * W, abs_dx)
    theta = np.deg2rad(20.5) * w_rot
    ang = -side * theta
    cos_a = np.cos(ang)
    sin_a = np.sin(ang)

    rx = bx - x_piv
    ry = by - y_piv
    hinge_drop = 5.0 * w_outer * (1.0 - smoothstep(235.0, 290.0, by))
    sx_sl = x_piv + rx * cos_a - (ry - hinge_drop) * sin_a
    sy_sl = y_piv + rx * sin_a + (ry - hinge_drop) * cos_a

    warped_sleeves = bilinear_sample_rgba(sleeve_rgba, sx_sl, sy_sl)

    # Subtle ambient-occlusion shadow cast by the relaxed sleeve onto outer torso seam
    sl_shadow = blur_channel(warped_sleeves[..., 3], 10.0) * (1.0 - warped_sleeves[..., 3]) * smoothstep(340.0, 390.0, by)
    torso_rgb = warped_torso[..., :3] * (1.0 - 0.068 * sl_shadow[..., None])

    a_s = warped_sleeves[..., 3:4]
    a_t = warped_torso[..., 3:4]
    out_a = a_s + a_t * (1.0 - a_s)
    out_rgb = (warped_sleeves[..., :3] * a_s + torso_rgb * a_t * (1.0 - a_s)) / np.maximum(out_a, 1e-5)

    # Crisp 1.5px anti-aliased alpha feather
    out_a_clean = smoothstep(0.18, 0.82, out_a[..., 0])
    out_a_clean = np.where(out_a_clean < 0.012, 0.0, out_a_clean)
    return np.concatenate([out_rgb, out_a_clean[..., None]], axis=-1), bx, by, w_rot


def build_part1_normalized_shirt() -> None:
    print("[Part 1] Segmenting and drape-warping raw-shirt.jpg -> 900x1100 hanging assets...")
    raw_img = Image.open(RAW_SHIRT_PATH)
    src_rgba = segment_raw_shirt(raw_img)

    ys_fg, _ = np.where(src_rgba[..., 3] > 0.5)
    top_collar = float(ys_fg.min())  # ~176.0

    OUT_W, OUT_H = 900, 1100
    front_warped, bx, by, w_rot = apply_cloth_gravity_drape_warp(
        src_rgba, top_collar=top_collar, out_w=OUT_W, out_h=OUT_H, scale=1.78
    )

    yy_d, xx_d = np.meshgrid(np.arange(OUT_H, dtype=np.float32), np.arange(OUT_W, dtype=np.float32), indexing="ij")

    # Protect Snoopy & "Good Shot Club" chest print from shading distortion
    in_graphic_box = (
        smoothstep(185.0, 210.0, bx)
        * (1.0 - smoothstep(385.0, 410.0, bx))
        * smoothstep(280.0, 305.0, by)
        * (1.0 - smoothstep(515.0, 535.0, by))
    )
    rgb_f = front_warped[..., :3]
    luma_f = 0.299 * rgb_f[..., 0] + 0.587 * rgb_f[..., 1] + 0.114 * rgb_f[..., 2]
    is_ink_or_trim = smoothstep(0.86, 0.74, luma_f)
    protect = np.clip(0.88 * in_graphic_box + 0.70 * is_ink_or_trim, 0.0, 0.94)

    # Gentle cosine cylindrical torso highlight + 4 soft vertical catenary gravity fold waves
    u_torso = (xx_d - OUT_W * 0.5) / (0.285 * OUT_W)
    cyl = np.cos(np.clip(u_torso, -1.2, 1.2) * np.pi * 0.46)
    cyl_shade = 0.022 * (cyl - 0.65)

    v_grow = smoothstep(220.0, 760.0, yy_d)
    fan_x = (xx_d - OUT_W * 0.5) / (1.0 + 0.17 * (yy_d / OUT_H))
    fold_waves = (
        0.42 * np.sin(fan_x / 33.0 + 0.4)
        + 0.33 * np.sin(fan_x / 21.0 - 1.1)
        + 0.25 * np.cos(fan_x / 50.0 + 0.8)
    )
    sl_fold = w_rot * 0.024 * np.sin((bx - 299.5) / 14.0 + (by - 240.0) / 19.0)
    drape_delta = (cyl_shade + 0.027 * v_grow * fold_waves + sl_fold) * (1.0 - protect)

    warm_shadow_tint = np.array([1.0, 1.04, 1.10], dtype=np.float32)
    mult_f = np.where(
        drape_delta[..., None] >= 0.0,
        1.0 + drape_delta[..., None],
        1.0 + drape_delta[..., None] * warm_shadow_tint,
    )
    front_final = np.concatenate([np.clip(rgb_f * mult_f, 0.0, 1.0), front_warped[..., 3:4]], axis=-1)

    # --- Build Seamless Rear Hanging View (`normalized-back-cutout.png`) ---
    back_src = src_rgba.copy()
    H_s, W_s, _ = back_src.shape
    yy_s, xx_s = np.meshgrid(np.arange(H_s, dtype=np.float32), np.arange(W_s, dtype=np.float32), indexing="ij")

    # Authentic shirt cream tone + seamless procedural cotton jersey micro-grain (zero tile seams!)
    cream_sample = src_rgba[252:288, 188:224, :3]
    base_cream = np.median(cream_sample.reshape(-1, 3), axis=0)
    fine_grain = 0.008 * hash_noise_2d(H_s, W_s, cell=2, seed=101) + 0.006 * hash_noise_2d(H_s, W_s, cell=9, seed=202)
    jersey_micro = 0.004 * np.sin(xx_s * 3.2) * np.cos(yy_s * 3.8)

    # Fill rear collar scoop slightly higher like a real crew-neck t-shirt back collar
    u_col = (xx_s - 299.5) / 68.5
    y_back_top = top_collar + 7.2 * np.clip(1.0 - u_col * u_col, 0.0, 1.0)
    y_back_bot = y_back_top + 15.8

    higher_neck_fill = (
        smoothstep(y_back_top - 0.8, y_back_top + 0.8, yy_s)
        * smoothstep(1.02, 0.94, np.abs(u_col))
        * (1.0 - smoothstep(215.0, 225.0, yy_s))
    )
    back_src[..., 3] = np.maximum(back_src[..., 3], higher_neck_fill)

    # Sage-green 1x1 rib-knit rear collar ring matching the front collar sage green
    collar_green = np.array([0.435, 0.525, 0.400], dtype=np.float32)
    rib_wave = 0.028 * np.sin(xx_s * 2.5)
    band_t = (yy_s - y_back_top) / 15.8
    band_prof = 1.0 + 0.075 * np.sin(np.clip(band_t, 0.0, 1.0) * np.pi) - 0.09 * np.exp(-((band_t - 0.95) ** 2) / 0.009)
    rear_collar_rgb = np.clip(collar_green[None, None, :] * (band_prof + rib_wave)[..., None], 0.0, 1.0)

    in_rear_collar = (
        smoothstep(172.0, 174.5, yy_s)
        * (1.0 - smoothstep(y_back_bot - 0.9, y_back_bot + 0.9, yy_s))
        * smoothstep(1.03, 0.95, np.abs(u_col))
    )

    # Replace inner neck tag, front U-scoop, and front Snoopy print with seamless cream cotton knit
    replace_torso = (
        smoothstep(158.0, 182.0, xx_s)
        * (1.0 - smoothstep(417.0, 441.0, xx_s))
        * smoothstep(y_back_bot - 1.2, y_back_bot + 1.5, yy_s)
        * (1.0 - smoothstep(530.0, 585.0, yy_s))
    )
    coverstitch_seam = 0.042 * np.exp(-((yy_s - (y_back_bot + 2.2)) ** 2) / 1.3) * smoothstep(1.02, 0.92, np.abs(u_col))
    # Match vertical luminance continuity of original cream shirt subtly
    vert_grad = -0.010 * smoothstep(220.0, 560.0, yy_s)
    cream_back_patch = np.clip(
        base_cream[None, None, :] + (fine_grain + jersey_micro + vert_grad - coverstitch_seam)[..., None],
        0.0,
        1.0,
    )

    back_src[..., :3] = back_src[..., :3] * (1.0 - replace_torso[..., None]) + cream_back_patch * replace_torso[..., None]
    back_src[..., :3] = back_src[..., :3] * (1.0 - in_rear_collar[..., None]) + rear_collar_rgb * in_rear_collar[..., None]
    back_src[..., :3] = extrapolate_rgb_outside_mask(back_src[..., :3], back_src[..., 3] > 0.70, iterations=6)

    back_warped, _, _, _ = apply_cloth_gravity_drape_warp(
        back_src, top_collar=top_collar, out_w=OUT_W, out_h=OUT_H, scale=1.78
    )
    rgb_b = back_warped[..., :3]
    luma_b = 0.299 * rgb_b[..., 0] + 0.587 * rgb_b[..., 1] + 0.114 * rgb_b[..., 2]
    trim_b = smoothstep(0.84, 0.70, luma_b) * 0.65

    v_grow_b = smoothstep(130.0, 760.0, yy_d)
    fold_waves_b = (
        0.40 * np.sin(fan_x / 36.0 - 0.5)
        + 0.34 * np.cos(fan_x / 22.5 + 0.9)
        + 0.26 * np.sin(fan_x / 53.0 - 0.3)
    )
    shoulder_blade = 0.020 * np.exp(-((yy_d - 165.0) ** 2) / (2.0 * 55.0 ** 2)) * np.cos(np.clip(u_torso, -1.0, 1.0) * np.pi * 0.5)
    drape_b = (cyl_shade + shoulder_blade + 0.031 * v_grow_b * fold_waves_b - sl_fold) * (1.0 - trim_b)
    mult_b = np.where(
        drape_b[..., None] >= 0.0,
        1.0 + drape_b[..., None],
        1.0 + drape_b[..., None] * warm_shadow_tint,
    )
    back_final = np.concatenate([np.clip(rgb_b * mult_b, 0.0, 1.0), back_warped[..., 3:4]], axis=-1)

    # --- Build Tangent-Space Normal Map (`normalized-normal.png`) ---
    # Pure cloth physics + collar/cuff ribbing + fine cotton jersey knit micro-texture (clean on both front & back!)
    luma_clean_folds = blur_channel(luma_b, 3.5) - blur_channel(luma_b, 32.0)
    # Stockinette cotton jersey micro-loops
    wale = np.sin(xx_d * 2.35)
    course = np.sin(yy_d * 2.85 + 0.85 * wale)
    jersey_height = 0.018 * (0.5 + 0.5 * wale) * course

    is_green_trim = (
        smoothstep(0.025, 0.075, rgb_f[..., 1] - rgb_f[..., 0] * 0.92)
        * smoothstep(0.86, 0.68, luma_f)
        * (1.0 - in_graphic_box)
    )
    rib_tex = 0.025 * np.sin(xx_d * 1.6 + yy_d * 0.6) * is_green_trim
    trim_relief = 0.16 * blur_channel(is_green_trim, 1.8) + rib_tex

    height_map = (
        0.55 * np.cos(np.clip(u_torso, -1.1, 1.1) * np.pi * 0.45)
        + 0.34 * v_grow * fold_waves
        + 0.24 * w_rot * np.sin((bx - 299.5) / 14.0 + (by - 240.0) / 19.0)
        + 0.85 * luma_clean_folds
        + trim_relief
        + jersey_height
    )
    normal_rgb = height_to_normal_rgb(height_map, front_final[..., 3], strength=4.2)

    save_rgba_png(front_final, OUT_GARMENTS_DIR / "normalized-front-cutout.png")
    save_rgba_png(back_final, OUT_GARMENTS_DIR / "normalized-back-cutout.png")
    Image.fromarray(normal_rgb, mode="RGB").save(OUT_GARMENTS_DIR / "normalized-normal.png", format="PNG", optimize=True)


# ---------------------------------------------------------------------------
# PART 2A: Companion 1 — Cream & Sage Collegiate Cable-Knit Tennis Cardigan
# ---------------------------------------------------------------------------

def cable_knit_height(u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Analytical 3D Aran/collegiate braided rope cable + purl channel + moss-rib stitch heightfield.
    u: cross-panel coordinate in pixels; v: vertical/axial coordinate in pixels.
    Returns (height in [0, 1], ambient_occlusion in [0, 1]).
    """
    period = 88.0
    local = np.mod(u + period * 0.5, period) - period * 0.5  # [-44, +44]

    # 1) Central braided 2-strand rope cable in |local| < 21
    twist_freq = 2.0 * np.pi / 74.0
    phase = v * twist_freq
    s1_center = 7.8 * np.sin(phase)
    s2_center = -7.8 * np.sin(phase)
    s1_over = 0.5 + 0.5 * np.tanh(3.0 * np.cos(phase))
    s2_over = 1.0 - s1_over

    r = 10.4
    d1 = np.clip(1.0 - ((local - s1_center) / r) ** 2, 0.0, 1.0)
    d2 = np.clip(1.0 - ((local - s2_center) / r) ** 2, 0.0, 1.0)
    ply1 = 0.08 * np.cos((local - s1_center) * 1.05)
    ply2 = 0.08 * np.cos((local - s2_center) * 1.05)
    h1 = np.sqrt(d1) * (0.66 + 0.34 * s1_over + ply1 * (d1 > 0.05))
    h2 = np.sqrt(d2) * (0.66 + 0.34 * s2_over + ply2 * (d2 > 0.05))
    cable_h = np.maximum(h1, h2)
    in_cable = smoothstep(23.5, 18.0, np.abs(local))

    # 2) Flanking purl-stitch channels (soft warm cream recessed stitches, not dark gray!)
    purl_bumps = 0.36 + 0.12 * np.sin(v * (2.0 * np.pi / 9.0)) * (0.6 + 0.4 * np.cos(local * 0.75))

    # 3) Outer twin knit rib + seed-stitch columns
    in_outer_rib = smoothstep(29.5, 33.5, np.abs(local))
    rib_ridges = 0.62 + 0.20 * np.cos((np.abs(local) - 37.5) * (2.0 * np.pi / 11.5))
    stitch_v = 0.07 * np.sin(v * (2.0 * np.pi / 7.8) + np.sin(local * 0.8))
    outer_h = rib_ridges + stitch_v

    h = in_cable * cable_h + (1.0 - in_cable) * ((1.0 - in_outer_rib) * purl_bumps + in_outer_rib * outer_h)
    # Soft warm-wool self-occlusion: stays bright warm cream (#DFD7C7 in crevices, #F7F2E8 on crowns!)
    ao = np.clip(0.88 + 0.15 * h - 0.035 * (1.0 - in_cable) * (1.0 - in_outer_rib), 0.83, 1.04)
    return h.astype(np.float32), ao.astype(np.float32)


def rib_2x2_height(u_across: np.ndarray, v_along: np.ndarray, pitch: float = 13.0) -> np.ndarray:
    """Crisp 2x2 knit ribbing heightfield."""
    rib = 0.58 + 0.28 * np.cos(u_across * (2.0 * np.pi / pitch))
    loop = 0.07 * np.sin(v_along * (2.0 * np.pi / 7.5) + 0.5 * np.sin(u_across * 0.9))
    return (rib + loop).astype(np.float32)


def build_companion_cardigan() -> None:
    print("[Part 2A] Synthesizing Companion 1: Cream & Sage Collegiate Cable-Knit Tennis Cardigan (1600x2000 -> 800x1000)...")
    H, W = 2000, 1600
    cx = 800.0
    yy, xx = np.meshgrid(np.arange(H, dtype=np.float32), np.arange(W, dtype=np.float32), indexing="ij")
    dx = xx - cx
    adx = np.abs(dx)

    # Palette
    cream_wool = hex_to_rgb01("#F2ECE1")
    sage_stripe = hex_to_rgb01("#4F6D45")
    gold_stripe = hex_to_rgb01("#C9AA6B")
    cream_shadow_tint = np.array([0.98, 0.95, 0.90], dtype=np.float32)

    # --- 1. Hanging Cardigan Silhouette (Top of collar at y = 60 = 3.0% of 2000!) ---
    # Smooth C1 continuous collar + rounded hanger shoulder contour (ZERO step notch!)
    y_top_rear = 60.0 + 14.0 * np.clip(1.0 - (adx / 205.0) ** 2, 0.0, 1.0)
    t_sh = np.clip((adx - 198.0) / (415.0 - 198.0), 0.0, 1.0)
    y_shoulder = 60.5 + 124.0 * (t_sh ** 1.25)
    y_upper_torso = np.where(adx <= 198.0, y_top_rear, y_shoulder)

    # Torso side edges: hang cleanly with subtle natural waist taper + ribbed hem cinch
    t_body = np.clip((yy - 185.0) / (1715.0 - 185.0), 0.0, 1.0)
    waist_cinch = 15.0 * smoothstep(1530.0, 1715.0, yy)
    torso_half_w = 408.0 - 24.0 * smoothstep(0.0, 0.28, t_body) + 7.0 * np.sin(t_body * np.pi) - waist_cinch
    y_hem = 1712.0 + 11.0 * np.cos(np.clip(dx / 385.0, -1.0, 1.0) * np.pi * 0.5) + 2.5 * np.cos(dx / 46.0)

    torso_mask = (
        smoothstep(y_upper_torso - 2.0, y_upper_torso + 2.0, yy)
        * smoothstep(y_hem + 2.0, y_hem - 2.0, yy)
        * smoothstep(torso_half_w + 2.0, torso_half_w - 2.0, adx)
    )

    # --- 2. Smooth Rounded-Cap Relaxed Hanging Long Sleeves ---
    # Seamless shoulder-to-sleeve cap curve: starts tangent to y_shoulder at (adx=402, y=180)
    # and curves gracefully downward & outward into a relaxed boutique long sleeve!
    t_sl = np.clip((yy - 175.0) / (1755.0 - 175.0), 0.0, 1.0)
    # Outer edge curves smoothly from shoulder (adx=405, y=180) -> upper arm (545, 520) -> wrist (595, 1740)
    sl_outer = 404.0 + 178.0 * (t_sl ** 0.56) + 14.0 * (t_sl ** 1.6) - 10.0 * smoothstep(1590.0, 1745.0, yy)
    # Inner underarm edge starts inside torso above armpit (y=515), then separates cleanly leaving a realistic boutique gap!
    armpit_sep = smoothstep(475.0, 565.0, yy)
    sl_inner = (1.0 - armpit_sep) * 355.0 + armpit_sep * (396.0 + 54.0 * ((np.maximum(yy - 510.0, 0.0) / 1235.0) ** 0.88) + 8.0 * smoothstep(1590.0, 1745.0, yy))

    sl_center_adx = 0.5 * (sl_outer + sl_inner)
    sl_half_w = np.maximum(0.5 * (sl_outer - sl_inner), 10.0)
    sl_u = adx - sl_center_adx

    # Upper cap bound seamlessly continues shoulder curve
    y_sl_cap = 176.0 + 0.58 * np.maximum(adx - 400.0, 0.0) + 0.0028 * (np.maximum(adx - 400.0, 0.0) ** 2)
    y_sl_bot = 1746.0 - 18.0 * (sl_u / sl_half_w) + 5.0 * np.cos(np.clip(sl_u / sl_half_w, -1.0, 1.0) * np.pi * 0.5)

    sleeve_mask = (
        smoothstep(y_sl_cap - 2.2, y_sl_cap + 2.2, yy)
        * smoothstep(y_sl_bot + 2.2, y_sl_bot - 2.2, yy)
        * smoothstep(sl_inner - 2.0, sl_inner + 2.0, adx)
        * smoothstep(sl_outer + 2.0, sl_outer - 2.0, adx)
    )

    full_alpha = np.clip(torso_mask + sleeve_mask - torso_mask * sleeve_mask, 0.0, 1.0)

    # --- 3. Yarn Noise & Base Knit Heightfields ---
    yarn_fuzz = 0.018 * hash_noise_2d(H, W, cell=2, seed=11) + 0.012 * hash_noise_2d(H, W, cell=7, seed=22)

    body_cable_h, body_ao = cable_knit_height(dx, yy)
    sl_angle = np.arctan2(135.0, 1520.0)
    sl_v = (yy - 190.0) * math.cos(sl_angle) + sl_u * math.sin(sl_angle)
    sl_cable_h, sl_ao = cable_knit_height(sl_u * 1.08, sl_v)

    # Bottom waistband 2x2 ribbing (y = 1565 .. y_hem)
    in_hem_rib = smoothstep(1560.0, 1572.0, yy)
    hem_rib_h = rib_2x2_height(dx, yy, pitch=12.0)

    # Sleeve cuff 2x2 ribbing (last 150px of sleeve)
    cuff_start_y = y_sl_bot - 148.0
    in_cuff_rib = smoothstep(cuff_start_y - 5.0, cuff_start_y + 5.0, yy)
    cuff_rib_h = rib_2x2_height(sl_u, sl_v, pitch=10.5)

    # Collegiate tipping stripes on hem & cuffs (knitted stitch-serrated!)
    stitch_jag_body = 1.4 * np.sin(dx * (2.0 * np.pi / 6.0))
    hem_dist = y_hem - yy + stitch_jag_body
    hem_sage = smoothstep(36.0, 39.0, hem_dist) * (1.0 - smoothstep(76.0, 79.0, hem_dist))
    hem_gold = (
        smoothstep(21.0, 23.5, hem_dist) * (1.0 - smoothstep(30.0, 32.5, hem_dist))
        + smoothstep(82.0, 84.5, hem_dist) * (1.0 - smoothstep(91.0, 93.5, hem_dist))
    )

    stitch_jag_cuff = 1.3 * np.sin(sl_u * (2.0 * np.pi / 5.25))
    cuff_dist = y_sl_bot - yy + stitch_jag_cuff
    cuff_sage = smoothstep(34.0, 37.0, cuff_dist) * (1.0 - smoothstep(70.0, 73.0, cuff_dist))
    cuff_gold = (
        smoothstep(20.0, 22.5, cuff_dist) * (1.0 - smoothstep(28.5, 31.0, cuff_dist))
        + smoothstep(76.0, 78.5, cuff_dist) * (1.0 - smoothstep(84.5, 87.0, cuff_dist))
    )

    # --- 4. Front-Specific Features: V-Neck Ghost Interior, Single Overlapped Ribbed Placket, Pockets & 5 Tortoise Buttons ---
    # Deep collegiate V-neck opening down to y = 680, transitioning smoothly into a realistic single overlapped button placket (adx <= 46)!
    v_progress = np.clip((680.0 - yy) / (680.0 - 60.0), 0.0, 1.0)
    v_inner_half_w = 156.0 * (v_progress ** 0.88)

    # Above y=680: two symmetric ribbed neckbands of width 54px flanking the V-opening;
    # Below y=680: they merge into ONE overlapped center-front button placket of total width 92px (adx <= 46)!
    placket_in = np.where(yy < 680.0, v_inner_half_w, -10.0)
    placket_out = np.where(yy < 680.0, v_inner_half_w + 54.0, 46.0 + 62.0 * ((np.maximum(680.0 - yy, 0.0) / 620.0)))
    # Smooth merge around V-point (y in [640, 720])
    merge_t = smoothstep(635.0, 710.0, yy)
    p_outer_edge = (1.0 - merge_t) * (v_inner_half_w + 54.0) + merge_t * 46.0

    v_interior_w = smoothstep(v_inner_half_w + 2.0, v_inner_half_w - 2.0, adx) * (1.0 - smoothstep(674.0, 682.0, yy))
    in_front_placket = (1.0 - v_interior_w) * smoothstep(p_outer_edge + 2.5, p_outer_edge - 2.5, adx)

    # Coordinate from outer edge of placket inward [0..54] so the collegiate stripes frame the outer border continuously from neck to hem!
    dist_from_placket_outer = p_outer_edge - adx
    placket_rib_h = rib_2x2_height(dist_from_placket_outer, yy, pitch=10.5)
    p_jag = 1.2 * np.sin(yy * (2.0 * np.pi / 7.5))
    p_pos = dist_from_placket_outer + p_jag
    placket_sage = smoothstep(10.0, 12.5, p_pos) * (1.0 - smoothstep(23.5, 26.0, p_pos)) * in_front_placket
    placket_gold = smoothstep(4.0, 6.0, p_pos) * (1.0 - smoothstep(8.2, 10.2, p_pos)) * in_front_placket

    # Subtle overlap shadow along right edge of placket below V-point
    overlap_seam = (
        smoothstep(670.0, 700.0, yy)
        * np.exp(-((dx - 46.0) ** 2) / (2.0 * 4.5 ** 2))
        * (1.0 - smoothstep(1700.0, 1715.0, yy))
    )

    # Two neat collegiate ribbed welt pockets on lower front panels (adx in [125, 295], y in [1265, 1326])
    in_pocket_welt = (
        smoothstep(125.0, 130.0, adx)
        * (1.0 - smoothstep(290.0, 295.0, adx))
        * smoothstep(1265.0, 1270.0, yy)
        * (1.0 - smoothstep(1321.0, 1326.0, yy))
    )
    pocket_rib_h = rib_2x2_height(dx, yy, pitch=11.0)
    pw_dist = yy - 1265.0 + stitch_jag_body * 0.8
    pocket_sage = smoothstep(17.0, 19.5, pw_dist) * (1.0 - smoothstep(32.0, 34.5, pw_dist)) * in_pocket_welt
    pocket_gold = smoothstep(36.5, 38.5, pw_dist) * (1.0 - smoothstep(43.0, 45.0, pw_dist)) * in_pocket_welt
    pocket_shadow = (
        smoothstep(124.0, 132.0, adx)
        * (1.0 - smoothstep(288.0, 296.0, adx))
        * np.exp(-((yy - 1263.0) ** 2) / (2.0 * 5.0 ** 2))
    )

    # Assemble Front Torso Knit Height & Color
    front_body_h = np.where(in_hem_rib > 0.5, hem_rib_h, body_cable_h)
    front_body_h = front_body_h * (1.0 - in_pocket_welt) + (pocket_rib_h + 0.16) * in_pocket_welt
    front_body_h = front_body_h * (1.0 - in_front_placket) + (placket_rib_h + 0.15) * in_front_placket

    # Ghost-hanger interior back-neck inside V opening (with rear ribbed collar band + soft shadow)
    rear_neck_band_in_v = smoothstep(58.0, 62.0, yy) * (1.0 - smoothstep(122.0, 128.0, yy))
    v_int_sage = smoothstep(80.0, 83.0, yy + stitch_jag_body) * (1.0 - smoothstep(100.0, 103.0, yy + stitch_jag_body))
    v_int_gold = smoothstep(106.0, 108.5, yy + stitch_jag_body) * (1.0 - smoothstep(113.0, 115.5, yy + stitch_jag_body))
    v_int_h = np.where(rear_neck_band_in_v > 0.5, rib_2x2_height(dx, yy, 11.0), 0.45 + 0.08 * np.sin(yy * 0.7) * np.cos(dx * 0.6))
    front_body_h = front_body_h * (1.0 - v_interior_w) + (v_int_h - 0.16) * v_interior_w

    sl_h_total = sl_cable_h * (1.0 - in_cuff_rib) + cuff_rib_h * in_cuff_rib

    def shade_knit_panel(
        base_rgb: np.ndarray,
        h_field: np.ndarray,
        ao_field: np.ndarray,
        sage_mask: np.ndarray,
        gold_mask: np.ndarray,
        extra_shadow: np.ndarray,
        u_cyl: np.ndarray,
        drape_wave: np.ndarray,
    ) -> np.ndarray:
        gx = np.zeros_like(h_field)
        gy = np.zeros_like(h_field)
        gx[:, 1:-1] = (h_field[:, 2:] - h_field[:, :-2]) * 0.5
        gy[1:-1, :] = (h_field[2:, :] - h_field[:-2, :]) * 0.5
        diffuse_bump = np.clip(-0.14 * gx - 0.17 * gy, -0.13, 0.15)
        cyl_light = 0.048 * (np.cos(np.clip(u_cyl, -1.15, 1.15) * np.pi * 0.46) - 0.48)

        col = base_rgb[None, None, :].copy()
        s_m = np.clip(sage_mask, 0.0, 1.0)[..., None]
        g_m = np.clip(gold_mask, 0.0, 1.0)[..., None]
        col = col * (1.0 - s_m) + sage_stripe[None, None, :] * s_m
        col = col * (1.0 - g_m) + gold_stripe[None, None, :] * g_m

        light_total = ao_field * (1.0 + diffuse_bump + cyl_light + drape_wave + yarn_fuzz) - extra_shadow
        shaded = np.where(
            light_total[..., None] < 1.0,
            col * (light_total[..., None] * cream_shadow_tint + (1.0 - cream_shadow_tint) * light_total[..., None] ** 0.65),
            col * light_total[..., None],
        )
        return np.clip(shaded, 0.0, 1.0)

    v_drape = smoothstep(240.0, 1520.0, yy) * (1.0 - 0.5 * in_hem_rib)
    torso_drape = 0.036 * v_drape * (0.55 * np.sin(dx / 66.0 + 0.3) + 0.45 * np.cos(dx / 42.0 - 0.8))
    sleeve_drape = 0.038 * np.sin(sl_u / 26.0 + t_sl * 2.8)

    front_sage_body = np.clip(hem_sage * in_hem_rib * (1.0 - in_front_placket) + placket_sage + pocket_sage + v_int_sage * v_interior_w * rear_neck_band_in_v, 0.0, 1.0)
    front_gold_body = np.clip(hem_gold * in_hem_rib * (1.0 - in_front_placket) + placket_gold + pocket_gold + v_int_gold * v_interior_w * rear_neck_band_in_v, 0.0, 1.0)
    v_rim_shadow = v_interior_w * (0.09 + 0.10 * np.exp(-((v_inner_half_w - adx) ** 2) / (2.0 * 18.0 ** 2)))
    front_ao = np.where(in_hem_rib > 0.5, 0.95 + 0.06 * hem_rib_h, body_ao)
    front_ao = np.where(in_front_placket > 0.5, 0.96 + 0.06 * placket_rib_h, front_ao)
    front_ao = np.where(v_interior_w > 0.5, 0.92, front_ao)

    front_torso_rgb = shade_knit_panel(
        cream_wool,
        front_body_h,
        front_ao,
        front_sage_body,
        front_gold_body,
        v_rim_shadow + 0.10 * overlap_seam + 0.08 * pocket_shadow,
        dx / 400.0,
        torso_drape * (1.0 - v_interior_w),
    )

    sl_ao_total = np.where(in_cuff_rib > 0.5, 0.95 + 0.06 * cuff_rib_h, sl_ao)
    sleeve_rgb = shade_knit_panel(
        cream_wool,
        sl_h_total,
        sl_ao_total,
        cuff_sage * in_cuff_rib,
        cuff_gold * in_cuff_rib,
        np.zeros_like(yy),
        sl_u / sl_half_w,
        sleeve_drape,
    )

    # Soft armhole seam & shadow where sleeve joins shoulder/torso
    armhole_seam_x = 382.0 + 18.0 * np.sin(np.clip((yy - 180.0) / 340.0, 0.0, 1.0) * np.pi)
    sl_over = sleeve_mask * smoothstep(armhole_seam_x - 5.0, armhole_seam_x + 5.0, adx)
    armhole_ao = blur_channel(sl_over, 12.0) * torso_mask * (1.0 - sl_over)
    front_torso_rgb *= 1.0 - 0.10 * armhole_ao[..., None]
    front_rgb = front_torso_rgb * (1.0 - sl_over[..., None]) + sleeve_rgb * sl_over[..., None]

    # --- 5. Render Woven Neck Label & 5 Realistic Dark Tortoiseshell Buttons ---
    # 5 buttons along center-front placket below V-point
    btn_ys = [760.0, 975.0, 1190.0, 1405.0, 1620.0]
    btn_r = 25.0
    btn_height_accum = np.zeros((H, W), dtype=np.float32)

    for idx, by_c in enumerate(btn_ys):
        bx_c = cx
        y0, y1 = int(by_c - 44), int(by_c + 44)
        x0, x1 = int(bx_c - 44), int(bx_c + 48)
        sub_x = xx[y0:y1, x0:x1]
        sub_y = yy[y0:y1, x0:x1]
        sub_rgb = front_rgb[y0:y1, x0:x1].copy()

        # Subtle horizontal buttonhole stitch slit to the right of button
        slit = np.exp(-((sub_y - by_c) ** 2) / (2.0 * 2.2 ** 2)) * smoothstep(bx_c + 12.0, bx_c + 18.0, sub_x) * (1.0 - smoothstep(bx_c + 34.0, bx_c + 39.0, sub_x))
        sub_rgb *= 1.0 - 0.22 * slit[..., None]

        # Contact drop shadow under button
        d_sh = np.sqrt((sub_x - (bx_c + 4.0)) ** 2 + (sub_y - (by_c + 6.0)) ** 2)
        sh_w = smoothstep(btn_r + 8.0, btn_r - 4.0, d_sh)
        sub_rgb *= 1.0 - 0.28 * sh_w[..., None]

        dist = np.sqrt((sub_x - bx_c) ** 2 + (sub_y - by_c) ** 2)
        in_btn = smoothstep(btn_r + 1.2, btn_r - 1.2, dist)
        rn = dist / btn_r

        # Mottled dark espresso & warm amber tortoiseshell pattern
        ang = np.arctan2(sub_y - by_c, sub_x - bx_c)
        mottle = (
            0.5
            + 0.28 * np.sin((sub_x - bx_c) * 0.24 + (sub_y - by_c) * 0.17 + idx * 1.7)
            + 0.22 * np.cos((sub_x - bx_c) * 0.37 - (sub_y - by_c) * 0.29 + 1.5 * np.sin(ang * 3.0))
        )
        mottle = smoothstep(0.32, 0.74, mottle)
        dark_tortoise = hex_to_rgb01("#281910")
        amber_tortoise = hex_to_rgb01("#845026")
        b_col = dark_tortoise[None, None, :] * (1.0 - mottle[..., None]) + amber_tortoise[None, None, :] * mottle[..., None]

        # Concave center dish + raised outer bevel rim + glossy upper-left specular highlight
        rim_ridge = np.exp(-((rn - 0.84) ** 2) / (2.0 * 0.09 ** 2))
        dish = -0.18 * np.clip(1.0 - (rn / 0.76) ** 2, 0.0, 1.0)
        b_height = np.clip(0.35 + dish + 0.24 * rim_ridge, 0.0, 1.0) * (dist <= btn_r + 1.5)
        btn_height_accum[y0:y1, x0:x1] = np.maximum(btn_height_accum[y0:y1, x0:x1], b_height * in_btn)

        spec_rim = rim_ridge * np.clip(-0.65 * (sub_x - bx_c) / btn_r - 0.75 * (sub_y - by_c) / btn_r, 0.0, 1.0)
        spec_spot = np.exp(-((sub_x - (bx_c - 8.5)) ** 2 + (sub_y - (by_c - 9.0)) ** 2) / (2.0 * 5.0 ** 2))
        b_col = b_col * (0.85 + 0.30 * rim_ridge[..., None]) + np.array([0.35, 0.28, 0.20], dtype=np.float32)[None, None, :] * spec_rim[..., None] + 0.28 * spec_spot[..., None]

        # 4 thread holes + cream cross-stitched yarn
        hole_offsets = [(-6.5, -6.5), (6.5, -6.5), (-6.5, 6.5), (6.5, 6.5)]
        for hx, hy in hole_offsets:
            hd = np.sqrt((sub_x - (bx_c + hx)) ** 2 + (sub_y - (by_c + hy)) ** 2)
            h_m = smoothstep(3.3, 2.0, hd)
            b_col = b_col * (1.0 - h_m[..., None]) + np.array([0.09, 0.06, 0.04], dtype=np.float32)[None, None, :] * h_m[..., None]

        # X-thread stitches connecting the 4 holes
        for s_sign in (-1.0, 1.0):
            px_b, py_b = sub_x - bx_c, sub_y - by_c
            proj = np.clip((px_b + s_sign * py_b) * 0.5, -6.5, 6.5)
            d_seg = np.sqrt((px_b - proj) ** 2 + (py_b - s_sign * proj) ** 2)
            th_m = smoothstep(2.4, 1.1, d_seg)
            thread_col = cream_wool[None, None, :] * (0.92 + 0.08 * np.cos(proj * 0.8))[..., None]
            b_col = b_col * (1.0 - th_m[..., None]) + thread_col * th_m[..., None]

        front_rgb[y0:y1, x0:x1] = sub_rgb * (1.0 - in_btn[..., None]) + np.clip(b_col, 0.0, 1.0) * in_btn[..., None]

    # Add woven "GOOD SHOT CLUB" cream/sage heritage neck label inside back neck (y=158..218, x=730..870)
    front_pil = Image.fromarray(np.clip(np.round(front_rgb * 255.0), 0, 255).astype(np.uint8), mode="RGB")
    draw_f = ImageDraw.Draw(front_pil)
    draw_f.rounded_rectangle([732, 158, 868, 214], radius=4, fill=(246, 241, 230), outline=(79, 109, 69), width=2)
    draw_f.line([(740, 166), (860, 166)], fill=(201, 170, 107), width=2)
    draw_f.line([(740, 206), (860, 206)], fill=(201, 170, 107), width=2)
    # Crisp pixel micro-lettering bars suggesting woven club typography
    for lx in range(750, 850, 8):
        draw_f.rectangle([lx, 181, lx + 4, 191], fill=(79, 109, 69))
    front_rgb = np.asarray(front_pil, dtype=np.float32) / 255.0
    # Re-apply subtle inner-neck shadow over label so it sits naturally inside the collar
    lbl_box = (xx >= 728) & (xx <= 872) & (yy >= 154) & (yy <= 218)
    front_rgb = np.where(lbl_box[..., None], front_rgb * 0.90, front_rgb)

    # --- 6. Build Rear View (`companion-cardigan-back-cutout.png`) ---
    # Rear collar ribbed band across full upper neck (y = y_top_rear .. y_top_rear + 64)
    rear_col_bot = y_top_rear + 62.0 + 10.0 * np.clip(1.0 - (adx / 210.0) ** 2, 0.0, 1.0)
    rear_collar_w = smoothstep(rear_col_bot + 3.0, rear_col_bot - 3.0, yy) * smoothstep(214.0, 200.0, adx)
    rc_dist = rear_col_bot - yy + stitch_jag_body
    rc_sage = smoothstep(18.0, 21.0, rc_dist) * (1.0 - smoothstep(38.0, 41.0, rc_dist)) * rear_collar_w
    rc_gold = smoothstep(10.0, 12.2, rc_dist) * (1.0 - smoothstep(15.5, 17.7, rc_dist)) * rear_collar_w

    back_body_h = np.where(in_hem_rib > 0.5, hem_rib_h, body_cable_h)
    back_body_h = back_body_h * (1.0 - rear_collar_w) + (rib_2x2_height(dx, yy, 11.5) + 0.14) * rear_collar_w
    back_ao = np.where(in_hem_rib > 0.5, 0.94 + 0.08 * hem_rib_h, body_ao)
    back_ao = np.where(rear_collar_w > 0.5, 0.96 + 0.07 * rib_2x2_height(dx, yy, 11.5), back_ao)

    rear_seam_shadow = 0.08 * np.exp(-((yy - (rear_col_bot + 4.0)) ** 2) / (2.0 * 4.0 ** 2)) * smoothstep(228.0, 205.0, adx)
    back_drape = 0.032 * v_drape * (0.50 * np.cos(dx / 72.0 - 0.4) + 0.50 * np.sin(dx / 45.0 + 0.7))

    back_torso_rgb = shade_knit_panel(
        cream_wool,
        back_body_h,
        back_ao,
        np.clip(hem_sage * in_hem_rib + rc_sage, 0.0, 1.0),
        np.clip(hem_gold * in_hem_rib + rc_gold, 0.0, 1.0),
        rear_seam_shadow,
        dx / 415.0,
        back_drape,
    )
    back_torso_rgb *= 1.0 - 0.10 * armhole_ao[..., None]
    back_rgb = back_torso_rgb * (1.0 - sl_over[..., None]) + sleeve_rgb * sl_over[..., None]

    # --- 7. Downsample 1600x2000 -> 800x1000 LANCZOS & Generate Normal Map ---
    front_hi = np.concatenate([front_rgb, full_alpha[..., None]], axis=-1)
    back_hi = np.concatenate([back_rgb, full_alpha[..., None]], axis=-1)

    front_lo = downsample_rgba_lanczos(front_hi, 800, 1000)
    back_lo = downsample_rgba_lanczos(back_hi, 800, 1000)

    # Combined 3D heightfield for normal map (macro cylindrical volume + braided cables + ribbing + buttons)
    macro_dome = 0.75 * np.cos(np.clip(dx / 430.0, -1.1, 1.1) * np.pi * 0.45) * torso_mask + 0.45 * np.cos(
        np.clip(sl_u / np.maximum(sl_half_w, 1.0), -1.0, 1.0) * np.pi * 0.45
    ) * sl_over
    total_h_hi = (
        macro_dome
        + 0.65 * (front_body_h * (1.0 - sl_over) + sl_h_total * sl_over)
        + 0.40 * torso_drape
        + 0.55 * btn_height_accum
    )
    # Downsample heightfield cleanly to 800x1000
    h_min, h_max = float(total_h_hi.min()), float(total_h_hi.max())
    h_u8 = np.clip((total_h_hi - h_min) / max(h_max - h_min, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    total_h_lo = (
        np.asarray(Image.fromarray(h_u8, mode="L").resize((800, 1000), Image.Resampling.LANCZOS), dtype=np.float32)
        / 255.0
        * (h_max - h_min)
        + h_min
    )
    cardigan_normal = height_to_normal_rgb(total_h_lo, front_lo[..., 3], strength=5.2)

    save_rgba_png(front_lo, OUT_GARMENTS_DIR / "companion-cardigan-front-cutout.png")
    save_rgba_png(back_lo, OUT_GARMENTS_DIR / "companion-cardigan-back-cutout.png")
    Image.fromarray(cardigan_normal, mode="RGB").save(
        OUT_GARMENTS_DIR / "companion-cardigan-normal.png", format="PNG", optimize=True
    )


# ---------------------------------------------------------------------------
# PART 2B: Companion 2 — Heritage Wimbledon Sage Pique Club Polo
# ---------------------------------------------------------------------------

def pique_honeycomb_weave(xx: np.ndarray, yy: np.ndarray) -> np.ndarray:
    """Authentic staggered cotton pique honeycomb/diamond waffle micro-weave in [-0.5, +0.5]."""
    px = 6.2
    py = 5.4
    w1 = np.cos(xx * (2.0 * np.pi / px)) * np.cos(yy * (2.0 * np.pi / py))
    w2 = np.cos((xx + px * 0.5) * (2.0 * np.pi / px)) * np.cos((yy + py * 0.5) * (2.0 * np.pi / py))
    # Dimpled waffle cells with crisp raised yarn ridges around recessed cells
    cell = 0.55 * w1 + 0.45 * np.sin((xx + yy) * (2.0 * np.pi / 7.5)) * np.sin((xx - yy) * (2.0 * np.pi / 7.5))
    return (0.65 * cell + 0.35 * w2).astype(np.float32)


def build_companion_polo() -> None:
    print("[Part 2B] Synthesizing Companion 2: Heritage Wimbledon Sage Pique Club Polo (1600x2000 -> 800x1000)...")
    H, W = 2000, 1600
    cx = 800.0
    yy, xx = np.meshgrid(np.arange(H, dtype=np.float32), np.arange(W, dtype=np.float32), indexing="ij")
    dx = xx - cx
    adx = np.abs(dx)

    # Palette
    sage_body = hex_to_rgb01("#4B6843")
    sage_dark = hex_to_rgb01("#374E31")
    cream_trim = hex_to_rgb01("#F3EFE4")
    gold_crest = hex_to_rgb01("#D8B86A")

    # --- 1. Hanging Polo Silhouette (Top of collar stand at y = 60 = 3.0% of 2000!) ---
    # Seamless C1 collar crown -> rounded hanger shoulder -> relaxed hanging short sleeve
    y_collar_top = 60.0 + 12.0 * np.clip(1.0 - (adx / 205.0) ** 2, 0.0, 1.0)
    t_sh = np.clip((adx - 198.0) / (428.0 - 198.0), 0.0, 1.0)
    y_shoulder = 60.5 + 146.0 * (t_sh ** 1.18)
    y_upper = np.where(adx <= 198.0, y_collar_top, y_shoulder)

    # Tailored tennis polo body hanging from armpits (adx=414) down to stepped tennis hem (y=1665)
    t_body = np.clip((yy - 208.0) / (1665.0 - 208.0), 0.0, 1.0)
    torso_half_w = 418.0 - 15.0 * np.sin(t_body * np.pi * 0.78) + 7.0 * smoothstep(0.55, 1.0, t_body)
    y_hem = 1662.0 + 10.0 * np.cos(np.clip(dx / 412.0, -1.0, 1.0) * np.pi * 0.5) + 2.8 * np.cos(dx / 48.0)

    # Classic tennis-tail side-vent notch at bottom outer corners
    side_vent_cut = smoothstep(402.0, 414.0, adx) * smoothstep(1598.0, 1618.0, yy)

    torso_mask = (
        smoothstep(y_upper - 2.0, y_upper + 2.0, yy)
        * smoothstep(y_hem + 2.0, y_hem - 2.0, yy)
        * smoothstep(torso_half_w + 2.0, torso_half_w - 2.0, adx)
        * (1.0 - 0.85 * side_vent_cut)
    )

    # --- 2. Relaxed Hanging Short Sleeves with Cream Ringer Cuffs ---
    # Smooth continuation of shoulder slope at ~27 deg outward from vertical (63 deg natural droop!)
    sl_angle = np.deg2rad(27.0)
    sl_ax = (adx - 404.0) * math.sin(sl_angle) + (yy - 206.0) * math.cos(sl_angle)
    sl_perp = (adx - 404.0) * math.cos(sl_angle) - (yy - 206.0) * math.sin(sl_angle)

    sl_len = 578.0
    cuff_cinch = 8.0 * smoothstep(sl_len - 68.0, sl_len, sl_ax)
    sl_half_w = 134.0 - 15.0 * np.clip(sl_ax / sl_len, 0.0, 1.0) - cuff_cinch

    # Seamless upper sleeve cap curve tangent to y_shoulder at adx=428, y=206.5
    du_cap = np.maximum(adx - 425.0, 0.0)
    y_sl_cap = 205.0 + 0.76 * du_cap + 0.0019 * (du_cap ** 2)

    sleeve_mask = (
        smoothstep(-10.0, 8.0, sl_ax)
        * smoothstep(sl_len + 2.2, sl_len - 2.2, sl_ax)
        * smoothstep(sl_half_w + 2.2, sl_half_w - 2.2, np.abs(sl_perp))
        * smoothstep(y_sl_cap - 2.2, y_sl_cap + 2.2, yy)
        * smoothstep(382.0, 405.0, adx + 56.0 * (1.0 - smoothstep(220.0, 545.0, yy)))
    )

    full_alpha = np.clip(torso_mask + sleeve_mask - torso_mask * sleeve_mask, 0.0, 1.0)

    # Cream ribbed ringer sleeve cuffs (last 56px of sleeve length!)
    cuff_pos = sl_len - sl_ax
    in_cuff = smoothstep(-2.0, 2.0, cuff_pos) * (1.0 - smoothstep(54.0, 58.0, cuff_pos))
    cuff_sage_tip = smoothstep(15.0, 17.5, cuff_pos) * (1.0 - smoothstep(24.0, 26.5, cuff_pos)) * in_cuff
    cuff_rib = 0.5 + 0.35 * np.cos(sl_perp * (2.0 * np.pi / 8.5))

    # --- 3. Pique Cotton Weave & Natural Hanging Drape Shading ---
    pique_body = pique_honeycomb_weave(xx, yy)
    pique_sleeve = pique_honeycomb_weave(sl_perp, sl_ax)
    melange = 0.018 * hash_noise_2d(H, W, cell=3, seed=77) + 0.012 * hash_noise_2d(H, W, cell=11, seed=88)

    u_torso = dx / 415.0
    cyl_body = 0.072 * (np.cos(np.clip(u_torso, -1.15, 1.15) * np.pi * 0.47) - 0.48)
    shoulder_hi = 0.038 * np.exp(-((yy - 185.0) ** 2) / (2.0 * 65.0 ** 2)) * np.cos(np.clip(u_torso, -1.0, 1.0) * np.pi * 0.42)
    v_grow = smoothstep(240.0, 1460.0, yy)
    fan_x = dx / (1.0 + 0.16 * (yy / H))
    drape_folds_f = v_grow * (
        0.048 * np.sin(fan_x / 56.0 + 0.5)
        + 0.036 * np.cos(fan_x / 35.0 - 0.9)
        + 0.026 * np.sin(fan_x / 82.0 + 0.2)
    )
    drape_folds_b = v_grow * (
        0.048 * np.cos(fan_x / 60.0 - 0.4)
        + 0.036 * np.sin(fan_x / 37.0 + 0.8)
        + 0.026 * np.cos(fan_x / 86.0 - 0.3)
    )

    # Twin-needle bottom hem stitch line
    hem_stitch = 0.065 * np.sin(xx * 1.6) ** 2 * np.exp(-((y_hem - 32.0 - yy) ** 2) / 2.2)

    def shade_sage_pique(drape_w: np.ndarray) -> np.ndarray:
        weave_light = 0.048 * pique_body + melange
        shade = 1.0 + cyl_body + shoulder_hi + drape_w + weave_light - hem_stitch
        col = np.where(
            shade[..., None] >= 1.0,
            sage_body[None, None, :] * shade[..., None] + 0.035 * (shade[..., None] - 1.0),
            sage_body[None, None, :] * (shade[..., None] ** 1.15),
        )
        vent_tape = (
            smoothstep(396.0, 403.0, adx)
            * (1.0 - smoothstep(410.0, 415.0, adx))
            * smoothstep(1598.0, 1608.0, yy)
        )
        col = col * (1.0 - vent_tape[..., None]) + (cream_trim * 0.92)[None, None, :] * vent_tape[..., None]
        return np.clip(col, 0.0, 1.0)

    front_torso_rgb = shade_sage_pique(drape_folds_f)
    back_torso_rgb = shade_sage_pique(drape_folds_b)

    # Shade Sleeves + Cream Ringer Cuffs
    u_sl = sl_perp / np.maximum(sl_half_w, 1.0)
    sl_cyl = 0.065 * (np.cos(np.clip(u_sl, -1.05, 1.05) * np.pi * 0.46) - 0.45)
    sl_drape = 0.042 * np.sin(sl_perp / 26.0 + sl_ax / 88.0) + 0.024 * np.cos(sl_perp / 17.0 - sl_ax / 64.0)
    sl_sage_col = sage_body[None, None, :] * (1.0 + sl_cyl + sl_drape + 0.048 * pique_sleeve + melange)[..., None]
    cuff_col = cream_trim[None, None, :] * (0.96 + 0.06 * cuff_rib + sl_cyl * 0.8 + melange * 0.5)[..., None]
    cuff_col = cuff_col * (1.0 - cuff_sage_tip[..., None]) + (sage_body * 1.02)[None, None, :] * cuff_sage_tip[..., None]
    cuff_seam = 0.09 * np.exp(-((cuff_pos - 56.0) ** 2) / 3.5)
    sleeve_rgb = np.clip(sl_sage_col * (1.0 - in_cuff[..., None]) + cuff_col * in_cuff[..., None] - cuff_seam[..., None], 0.0, 1.0)

    armhole_seam_x = 390.0 + 18.0 * np.sin(np.clip((yy - 205.0) / 360.0, 0.0, 1.0) * np.pi)
    sl_over = sleeve_mask * smoothstep(armhole_seam_x - 6.0, armhole_seam_x + 6.0, adx)
    armhole_ao = blur_channel(sl_over, 13.0) * torso_mask * (1.0 - sl_over)
    front_torso_rgb *= 1.0 - 0.15 * armhole_ao[..., None]
    back_torso_rgb *= 1.0 - 0.15 * armhole_ao[..., None]

    front_rgb = front_torso_rgb * (1.0 - sl_over[..., None]) + sleeve_rgb * sl_over[..., None]
    back_rgb = back_torso_rgb * (1.0 - sl_over[..., None]) + sleeve_rgb * sl_over[..., None]

    # --- 4. Front Details: 2-Button Placket, Classic Spread Cream Collar, Chest Pocket & Gold Racquet Crest ---
    front_extra_h = np.zeros((H, W), dtype=np.float32)

    # 4a) 2-Button Box Placket (x in [752, 848], y in [212, 615])
    in_placket = (
        smoothstep(48.5, 45.5, adx)
        * smoothstep(208.0, 215.0, yy)
        * (1.0 - smoothstep(612.0, 617.0, yy))
    )
    placket_drop_sh = (
        smoothstep(54.0, 44.0, adx)
        * smoothstep(208.0, 218.0, yy)
        * (1.0 - smoothstep(615.0, 624.0, yy))
        * (1.0 - in_placket)
    )
    front_rgb *= 1.0 - 0.18 * placket_drop_sh[..., None]
    placket_col = sage_body[None, None, :] * (1.03 + 0.042 * pique_body + melange * 0.7)[..., None]
    edge_stitch = (np.abs(adx - 41.0) < 1.6) & (yy > 224) & (yy < 608) & (np.mod(yy, 9.0) < 5.0)
    box_stitch = (adx < 41.0) & ((np.abs(yy - 585.0) < 1.6) | (np.abs(yy - 608.0) < 1.6))
    placket_col = np.where((edge_stitch | box_stitch)[..., None], placket_col * 0.86, placket_col)
    front_rgb = front_rgb * (1.0 - in_placket[..., None]) + np.clip(placket_col, 0.0, 1.0) * in_placket[..., None]
    front_extra_h += 0.18 * in_placket

    # 4b) Left-Chest Patch Pocket (wearer's left = viewer's right: x in [935, 1125], y in [485, 705])
    px_c = 1030.0
    pdx = np.abs(xx - px_c)
    p_bot = 688.0 + 18.0 * (1.0 - np.clip(pdx / 95.0, 0.0, 1.0))
    in_pocket = (
        smoothstep(96.5, 93.5, pdx)
        * smoothstep(484.0, 488.0, yy)
        * (1.0 - smoothstep(p_bot - 1.5, p_bot + 1.5, yy))
    )
    pock_sh = (
        smoothstep(102.0, 92.0, pdx)
        * smoothstep(484.0, 492.0, yy)
        * (1.0 - smoothstep(p_bot, p_bot + 9.0, yy))
        * (1.0 - in_pocket)
    )
    front_rgb *= 1.0 - 0.18 * pock_sh[..., None]

    in_pock_welt = in_pocket * (1.0 - smoothstep(520.0, 524.0, yy))
    welt_sage_line = smoothstep(500.0, 502.0, yy) * (1.0 - smoothstep(507.0, 509.0, yy)) * in_pock_welt
    welt_rib = 0.5 + 0.32 * np.cos((xx - px_c) * (2.0 * np.pi / 8.0))
    pock_body_col = sage_body[None, None, :] * (1.02 + 0.046 * pique_body + cyl_body * 0.8 + melange)[..., None]
    pock_welt_col = cream_trim[None, None, :] * (0.97 + 0.05 * welt_rib)[..., None]
    pock_welt_col = pock_welt_col * (1.0 - welt_sage_line[..., None]) + sage_body[None, None, :] * welt_sage_line[..., None]
    pock_col = pock_body_col * (1.0 - in_pock_welt[..., None]) + pock_welt_col * in_pock_welt[..., None]
    front_rgb = front_rgb * (1.0 - in_pocket[..., None]) + np.clip(pock_col, 0.0, 1.0) * in_pocket[..., None]
    front_extra_h += 0.16 * in_pocket + 0.06 * in_pock_welt

    # 4c) Classic Spread Cream #F3EFE4 Tipped Fold-Over Polo Collar & Curved Back Neck Stand
    throat_t = np.clip((218.0 - yy) / (218.0 - 62.0), 0.0, 1.0)
    throat_hw = 158.0 * (throat_t ** 0.70)
    in_throat = smoothstep(throat_hw + 2.0, throat_hw - 2.0, adx) * smoothstep(60.0, 64.0, yy) * (1.0 - smoothstep(215.0, 220.0, yy))

    # Curved rear cream collar stand at top of neck (crescent curve y = 60 .. 116 + 14*(adx/158)^2)
    stand_bot = 114.0 + 16.0 * np.clip((adx / 160.0) ** 2, 0.0, 1.0)
    in_stand = in_throat * (1.0 - smoothstep(stand_bot - 2.5, stand_bot + 2.5, yy))
    throat_sage_yoke = sage_dark[None, None, :] * (0.85 + 0.03 * pique_body)[..., None]
    stand_col = cream_trim[None, None, :] * (0.87 + 0.04 * np.cos(dx * 0.8) - 0.11 * smoothstep(stand_bot - 26.0, stand_bot, yy))[..., None]
    throat_rgb = throat_sage_yoke * (1.0 - in_stand[..., None]) + stand_col * in_stand[..., None]
    front_rgb = front_rgb * (1.0 - in_throat[..., None]) + np.clip(throat_rgb, 0.0, 1.0) * in_throat[..., None]

    # Classic Spread Folded Collar Wings:
    # Inner edge follows neck curve down to throat button at (adx=10, y=216);
    # Lower collar spread sweeps downward & outward at ~25 deg from (adx=10, y=216) to crisp collar point (adx=238, y=314)!
    t_spread = np.clip((adx - 10.0) / (238.0 - 10.0), 0.0, 1.0)
    y_wing_low = 216.0 + 98.0 * (t_spread ** 0.92)
    x_wing_out = 194.0 + (238.0 - 194.0) * np.clip((yy - 64.0) / (314.0 - 64.0), 0.0, 1.0)
    x_wing_in = np.where(yy < 216.0, np.maximum(throat_hw - 3.0, 10.0), 10.0 + (yy - 216.0) * 1.15)

    in_collar_wing = (
        smoothstep(x_wing_in - 2.2, x_wing_in + 2.2, adx)
        * smoothstep(x_wing_out + 2.5, x_wing_out - 2.5, adx)
        * smoothstep(60.5, 64.5, yy)
        * smoothstep(y_wing_low + 2.5, y_wing_low - 2.5, yy)
    )

    wing_sh = blur_channel(in_collar_wing, 12.0) * (1.0 - in_collar_wing) * (1.0 - in_throat)
    front_rgb *= 1.0 - 0.25 * wing_sh[..., None]

    dist_low = (y_wing_low - yy) * 0.91
    dist_out = (x_wing_out - adx) * 0.96
    edge_d = np.minimum(dist_low, dist_out) + 0.8 * np.sin((adx + yy) * 0.9)
    wing_sage_tip = smoothstep(14.0, 16.5, edge_d) * (1.0 - smoothstep(23.0, 25.5, edge_d))
    wing_gold_tip = smoothstep(28.0, 30.2, edge_d) * (1.0 - smoothstep(34.5, 36.7, edge_d))

    wing_rib = 0.5 + 0.30 * np.cos((adx * 0.65 - yy * 0.35) * (2.0 * np.pi / 7.5))
    # Soft 3D roll highlight near upper collar fold
    wing_roll = 0.075 * np.exp(-((yy - 110.0) ** 2) / (2.0 * 48.0 ** 2))
    wing_col = cream_trim[None, None, :] * (0.95 + 0.05 * wing_rib + wing_roll + melange * 0.4)[..., None]
    wing_col = wing_col * (1.0 - wing_sage_tip[..., None]) + sage_body[None, None, :] * wing_sage_tip[..., None]
    wing_col = wing_col * (1.0 - wing_gold_tip[..., None]) + gold_crest[None, None, :] * wing_gold_tip[..., None]

    front_rgb = front_rgb * (1.0 - in_collar_wing[..., None]) + np.clip(wing_col, 0.0, 1.0) * in_collar_wing[..., None]
    front_extra_h += 0.36 * in_collar_wing

    # 4d) 2 Lustrous Mother-of-Pearl Placket Buttons (y = 335, 485)
    for by_c in (335.0, 485.0):
        y0, y1 = int(by_c - 34), int(by_c + 34)
        x0, x1 = int(cx - 34), int(cx + 34)
        sub_x = xx[y0:y1, x0:x1]
        sub_y = yy[y0:y1, x0:x1]
        sub_rgb = front_rgb[y0:y1, x0:x1].copy()

        d_sh = np.sqrt((sub_x - (cx + 3.5)) ** 2 + (sub_y - (by_c + 5.0)) ** 2)
        sub_rgb *= 1.0 - 0.25 * smoothstep(24.0, 14.0, d_sh)[..., None]

        dist = np.sqrt((sub_x - cx) ** 2 + (sub_y - by_c) ** 2)
        b_r = 18.5
        in_b = smoothstep(b_r + 1.2, b_r - 1.2, dist)
        rn = dist / b_r
        # Pearlescent iridescent sheen
        pearl_swirl = 0.04 * np.sin((sub_x - cx) * 0.35 + (sub_y - by_c) * 0.25)
        rim = np.exp(-((rn - 0.82) ** 2) / (2.0 * 0.10 ** 2))
        b_col = np.array([0.96, 0.95, 0.91], dtype=np.float32)[None, None, :] * (0.92 + 0.12 * rim + pearl_swirl)[..., None]
        # Subtle pink/aqua nacre iridescence
        b_col[..., 0] += 0.025 * np.sin((sub_x - cx) * 0.22)
        b_col[..., 1] += 0.020 * np.cos((sub_y - by_c) * 0.24)
        for hx, hy in ((-4.8, -4.8), (4.8, -4.8), (-4.8, 4.8), (4.8, 4.8)):
            hd = np.sqrt((sub_x - (cx + hx)) ** 2 + (sub_y - (by_c + hy)) ** 2)
            hm = smoothstep(2.6, 1.5, hd)
            b_col = b_col * (1.0 - hm[..., None]) + sage_dark[None, None, :] * hm[..., None]
        # Cross sage thread
        for s_sign in (-1.0, 1.0):
            px_t, py_t = sub_x - cx, sub_y - by_c
            proj = np.clip((px_t + s_sign * py_t) * 0.5, -4.8, 4.8)
            d_seg = np.sqrt((px_t - proj) ** 2 + (py_t - s_sign * proj) ** 2)
            tm = smoothstep(1.9, 0.9, d_seg)
            b_col = b_col * (1.0 - tm[..., None]) + sage_body[None, None, :] * tm[..., None]

        front_rgb[y0:y1, x0:x1] = sub_rgb * (1.0 - in_b[..., None]) + np.clip(b_col, 0.0, 1.0) * in_b[..., None]
        front_extra_h[y0:y1, x0:x1] += 0.28 * in_b

    # 4e) Tiny Embroidered Gold Crossed-Racquets Crest on Pocket + Woven Neck Label via PIL Draw
    front_pil = Image.fromarray(np.clip(np.round(front_rgb * 255.0), 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(front_pil)

    # Woven collar label inside sage neck yoke (y=138..184, x=742..858)
    draw.rounded_rectangle([744, 140, 856, 182], radius=3, fill=(243, 239, 228), outline=(216, 184, 106), width=2)
    for lx in range(758, 844, 7):
        draw.rectangle([lx, 157, lx + 4, 165], fill=(75, 104, 67))

    # Embroidered Gold Crossed Tennis Racquets + Laurel + Ball Crest centered at (1030, 608)
    crest_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(crest_layer)
    gx_c, gy_c = 1030, 608
    gold_hi = (232, 202, 124, 255)
    gold_mid = (206, 170, 92, 255)
    gold_sh = (42, 60, 38, 130)

    # Draw shadow then gold embroidery for two crossed racquets (+/- 36 deg)
    for ox, oy, col in ((2, 3, gold_sh), (0, 0, gold_mid)):
        for sign in (-1, 1):
            ang_r = math.radians(sign * 36.0)
            ux, uy = math.sin(ang_r), -math.cos(ang_r)
            px_v, py_v = math.cos(ang_r), math.sin(ang_r)
            # Handle from -38 to -6 along axis
            x0 = gx_c + ox - ux * 36
            y0 = gy_c + oy - uy * 36
            x1 = gx_c + ox + ux * 2
            y1 = gy_c + oy + uy * 2
            cdraw.line([(x0, y0), (x1, y1)], fill=col, width=5)
            # Oval racquet head centered at +20 along axis (rx=15, ry=20 rotated)
            hc_x = gx_c + ox + ux * 20
            hc_y = gy_c + oy + uy * 20
            pts = []
            for k in range(28):
                th = 2.0 * math.pi * k / 28.0
                ex = 14.5 * math.cos(th)
                ey = 19.5 * math.sin(th)
                pts.append((hc_x + ex * px_v + ey * ux, hc_y + ex * py_v + ey * uy))
            cdraw.polygon(pts, outline=col, width=4)
            if ox == 0:
                # Fine gold racquet strings
                for s_off in (-7, 0, 7):
                    sx0 = hc_x + s_off * px_v - 14 * ux
                    sy0 = hc_y + s_off * py_v - 14 * uy
                    sx1 = hc_x + s_off * px_v + 14 * ux
                    sy1 = hc_y + s_off * py_v + 14 * uy
                    cdraw.line([(sx0, sy0), (sx1, sy1)], fill=(238, 214, 148, 190), width=1)

    # Tiny gold tennis ball at bottom-center of crossed racquets + crown dot at top
    cdraw.ellipse([gx_c - 6, gy_c + 22, gx_c + 6, gy_c + 34], fill=gold_hi, outline=gold_mid, width=2)
    cdraw.ellipse([gx_c - 4, gy_c - 34, gx_c + 4, gy_c - 26], fill=gold_hi)

    crest_np = np.asarray(crest_layer, dtype=np.float32) / 255.0
    base_np = np.asarray(front_pil, dtype=np.float32) / 255.0
    ca = crest_np[..., 3:4]
    # Add satin embroidery thread shimmer
    shimmer = 1.0 + 0.10 * np.sin((xx + yy) * 1.4)[..., None]
    front_rgb = np.clip(base_np * (1.0 - ca) + np.clip(crest_np[..., :3] * shimmer, 0.0, 1.0) * ca, 0.0, 1.0)
    front_extra_h += 0.22 * crest_np[..., 3]

    # --- 5. Rear View Details: High Folded Cream Tipped Polo Collar (`companion-polo-back-cutout.png`) ---
    rear_col_bot = y_collar_top + 100.0 + 14.0 * np.clip(1.0 - (adx / 212.0) ** 2, 0.0, 1.0)
    in_rear_collar = smoothstep(rear_col_bot + 2.5, rear_col_bot - 2.5, yy) * smoothstep(214.0, 200.0, adx)
    rear_col_sh = blur_channel(in_rear_collar, 11.0) * (1.0 - in_rear_collar)
    back_rgb *= 1.0 - 0.22 * rear_col_sh[..., None]

    rc_d = rear_col_bot - yy + 0.9 * np.sin(dx * 0.9)
    rc_sage = smoothstep(15.0, 17.5, rc_d) * (1.0 - smoothstep(24.5, 27.0, rc_d))
    rc_gold = smoothstep(30.0, 32.3, rc_d) * (1.0 - smoothstep(36.5, 38.8, rc_d))
    rc_rib = 0.5 + 0.30 * np.cos(dx * (2.0 * np.pi / 7.5))
    rc_col = cream_trim[None, None, :] * (0.96 + 0.05 * rc_rib + cyl_body * 0.7 + melange * 0.4)[..., None]
    rc_col = rc_col * (1.0 - rc_sage[..., None]) + sage_body[None, None, :] * rc_sage[..., None]
    rc_col = rc_col * (1.0 - rc_gold[..., None]) + gold_crest[None, None, :] * rc_gold[..., None]
    back_rgb = back_rgb * (1.0 - in_rear_collar[..., None]) + np.clip(rc_col, 0.0, 1.0) * in_rear_collar[..., None]

    # --- 6. Downsample 1600x2000 -> 800x1000 LANCZOS & Generate Honeycomb Pique Normal Map ---
    front_hi = np.concatenate([front_rgb, full_alpha[..., None]], axis=-1)
    back_hi = np.concatenate([back_rgb, full_alpha[..., None]], axis=-1)

    front_lo = downsample_rgba_lanczos(front_hi, 800, 1000)
    back_lo = downsample_rgba_lanczos(back_hi, 800, 1000)

    macro_dome = 0.72 * np.cos(np.clip(u_torso, -1.1, 1.1) * np.pi * 0.45) * torso_mask + 0.48 * np.cos(
        np.clip(u_sl, -1.0, 1.0) * np.pi * 0.45
    ) * sl_over
    pique_h = np.where(sl_over > 0.5, np.where(in_cuff > 0.5, 0.26 * cuff_rib + 0.16, 0.24 * pique_sleeve), 0.24 * pique_body)
    total_h_hi = macro_dome + pique_h + 5.2 * drape_folds_f + front_extra_h

    h_min, h_max = float(total_h_hi.min()), float(total_h_hi.max())
    h_u8 = np.clip((total_h_hi - h_min) / max(h_max - h_min, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    total_h_lo = (
        np.asarray(Image.fromarray(h_u8, mode="L").resize((800, 1000), Image.Resampling.LANCZOS), dtype=np.float32)
        / 255.0
        * (h_max - h_min)
        + h_min
    )
    polo_normal = height_to_normal_rgb(total_h_lo, front_lo[..., 3], strength=5.8)

    save_rgba_png(front_lo, OUT_GARMENTS_DIR / "companion-polo-front-cutout.png")
    save_rgba_png(back_lo, OUT_GARMENTS_DIR / "companion-polo-back-cutout.png")
    Image.fromarray(polo_normal, mode="RGB").save(
        OUT_GARMENTS_DIR / "companion-polo-normal.png", format="PNG", optimize=True
    )


def verify_outputs() -> None:
    expected = [
        ("normalized-front-cutout.png", (900, 1100), "RGBA"),
        ("normalized-back-cutout.png", (900, 1100), "RGBA"),
        ("normalized-normal.png", (900, 1100), "RGB"),
        ("companion-cardigan-front-cutout.png", (800, 1000), "RGBA"),
        ("companion-cardigan-back-cutout.png", (800, 1000), "RGBA"),
        ("companion-cardigan-normal.png", (800, 1000), "RGB"),
        ("companion-polo-front-cutout.png", (800, 1000), "RGBA"),
        ("companion-polo-back-cutout.png", (800, 1000), "RGBA"),
        ("companion-polo-normal.png", (800, 1000), "RGB"),
    ]
    print("\n=== Verification Summary ===")
    for fname, exp_size, exp_mode in expected:
        p = OUT_GARMENTS_DIR / fname
        assert p.exists(), f"Missing output file: {p}"
        im = Image.open(p)
        assert im.size == exp_size, f"{fname}: expected size {exp_size}, got {im.size}"
        assert im.mode == exp_mode, f"{fname}: expected mode {exp_mode}, got {im.mode}"
        arr = np.asarray(im)
        if exp_mode == "RGBA":
            alpha = arr[..., 3]
            corners_a = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
            assert all(a == 0 for a in corners_a), f"{fname}: non-transparent corners {corners_a}"
            ys, xs = np.where(alpha > 127)
            top_pct = ys.min() / exp_size[1] * 100.0
            bot_pct = ys.max() / exp_size[1] * 100.0
            print(
                f"  [OK] {fname:38s} | {im.size[0]}x{im.size[1]} {im.mode} | "
                f"bbox=({xs.min()}..{xs.max()}, {ys.min()}..{ys.max()}) | "
                f"collar_top={top_pct:.2f}% | hem={bot_pct:.1f}% | corners_alpha={corners_a}"
            )
        else:
            corners_rgb = [tuple(int(v) for v in arr[0, 0]), tuple(int(v) for v in arr[-1, -1])]
            assert corners_rgb[0] == (128, 128, 255), f"{fname}: expected #8080FF outside mask, got {corners_rgb[0]}"
            print(
                f"  [OK] {fname:38s} | {im.size[0]}x{im.size[1]} {im.mode}  | "
                f"outside_normal={corners_rgb[0]} (#8080FF)"
            )


def main() -> None:
    os.makedirs(OUT_GARMENTS_DIR, exist_ok=True)
    build_part1_normalized_shirt()
    build_companion_cardigan()
    build_companion_polo()
    verify_outputs()


if __name__ == "__main__":
    main()
