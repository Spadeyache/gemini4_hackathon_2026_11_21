#!/usr/bin/env python3
"""
Procedural PBR Architectural Texture & Boutique Art Print Synthesizer
Generates 4 crisp, seamless architectural textures and framed exhibition art
using ONLY numpy + Pillow (no scipy, no cv2).

Outputs in public/assets/textures/:
  1. travertine-floor.png  (1024x1024, seamless 2x4 running-bond Roman travertine)
  2. limewash-wall.png     (1024x1024, seamless warm Venetian limewash plaster)
  3. sage-fluted-wood.png  (1024x1024, seamless 32-flute Wimbledon sage millwork)
  4. club-crest-art.png    (900x1200, supersampled 2x from 1800x2400 gallery print)
"""

from __future__ import annotations

import math
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "public" / "assets" / "textures"


# ---------------------------------------------------------------------------
# Pure-NumPy Periodic (Seamless) Noise Primitives
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_str: str) -> np.ndarray:
    h = hex_str.lstrip("#")
    return np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)], dtype=np.float32)


def hex_to_tuple(hex_str: str, alpha: int | None = None) -> tuple[int, ...]:
    h = hex_str.lstrip("#")
    rgb = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    return rgb if alpha is None else (*rgb, alpha)


def periodic_perlin_2d(
    H: int,
    W: int,
    fy: int,
    fx: int,
    rng: np.random.Generator,
    warp_y: np.ndarray | None = None,
    warp_x: np.ndarray | None = None,
) -> np.ndarray:
    """
    2D periodic gradient (Perlin) noise on an (H, W) grid with exact integer
    periods (fy, fx) across [0, H) x [0, W). Guaranteed 100% seamless for
    Three.js RepeatWrapping.
    """
    y = (np.arange(H, dtype=np.float32)[:, None] / float(H)) * fy
    x = (np.arange(W, dtype=np.float32)[None, :] / float(W)) * fx

    if warp_y is not None:
        y = y + warp_y * fy
    if warp_x is not None:
        x = x + warp_x * fx

    y = np.mod(y, float(fy))
    x = np.mod(x, float(fx))

    yi0 = np.floor(y).astype(np.int32) % fy
    yi1 = (yi0 + 1) % fy
    xi0 = np.floor(x).astype(np.int32) % fx
    xi1 = (xi0 + 1) % fx

    yf = y - np.floor(y)
    xf = x - np.floor(x)

    # Quintic C2 smoothstep fade
    v = yf * yf * yf * (yf * (yf * 6.0 - 15.0) + 10.0)
    u = xf * xf * xf * (xf * (xf * 6.0 - 15.0) + 10.0)

    angles = rng.uniform(0.0, 2.0 * np.pi, size=(fy, fx)).astype(np.float32)
    gx = np.cos(angles)
    gy = np.sin(angles)

    n00 = gx[yi0, xi0] * xf + gy[yi0, xi0] * yf
    n10 = gx[yi0, xi1] * (xf - 1.0) + gy[yi0, xi1] * yf
    n01 = gx[yi1, xi0] * xf + gy[yi1, xi0] * (yf - 1.0)
    n11 = gx[yi1, xi1] * (xf - 1.0) + gy[yi1, xi1] * (yf - 1.0)

    nx0 = n00 + u * (n10 - n00)
    nx1 = n01 + u * (n11 - n01)
    return (nx0 + v * (nx1 - nx0)) * 1.41421356


def periodic_fbm_2d(
    H: int,
    W: int,
    base_fy: int,
    base_fx: int,
    octaves: int,
    rng: np.random.Generator,
    persistence: float = 0.5,
    lacunarity: int = 2,
    warp_y: np.ndarray | None = None,
    warp_x: np.ndarray | None = None,
) -> np.ndarray:
    """Multi-octave periodic fBm noise normalized approximately to [-1, 1]."""
    total = np.zeros((H, W), dtype=np.float32)
    amp = 1.0
    amp_sum = 0.0
    fy, fx = base_fy, base_fx

    for _ in range(octaves):
        if fy > H // 2 or fx > W // 2:
            break
        wy = warp_y if warp_y is not None else None
        wx = warp_x if warp_x is not None else None
        total += amp * periodic_perlin_2d(H, W, fy, fx, rng, warp_y=wy, warp_x=wx)
        amp_sum += amp
        amp *= persistence
        fy *= lacunarity
        fx *= lacunarity

    return total / max(amp_sum, 1e-6)


def periodic_rotated_stroke_2d(
    H: int,
    W: int,
    m: int,
    n: int,
    fu: int,
    fv: int,
    rng: np.random.Generator,
    warp_u: np.ndarray | None = None,
    warp_v: np.ndarray | None = None,
) -> np.ndarray:
    """
    Periodic anisotropic brush-sweep noise tilted along integer lattice vector (m, n).
    Because m, n, fu, fv are integers, (m*x/W + n*y/H)*fu wraps by exact multiples
    of fu across both X and Y boundaries -> 100% seamless diagonal brush strokes!
    """
    y_norm = np.arange(H, dtype=np.float32)[:, None] / float(H)
    x_norm = np.arange(W, dtype=np.float32)[None, :] / float(W)

    U = (m * x_norm + n * y_norm) * fu
    V = (-n * x_norm + m * y_norm) * fv

    if warp_u is not None:
        U = U + warp_u * fu
    if warp_v is not None:
        V = V + warp_v * fv

    U = np.mod(U, float(fu))
    V = np.mod(V, float(fv))

    ui0 = np.floor(U).astype(np.int32) % fu
    ui1 = (ui0 + 1) % fu
    vi0 = np.floor(V).astype(np.int32) % fv
    vi1 = (vi0 + 1) % fv

    uf = U - np.floor(U)
    vf = V - np.floor(V)

    su = uf * uf * uf * (uf * (uf * 6.0 - 15.0) + 10.0)
    sv = vf * vf * vf * (vf * (vf * 6.0 - 15.0) + 10.0)

    angles = rng.uniform(0.0, 2.0 * np.pi, size=(fv, fu)).astype(np.float32)
    gu = np.cos(angles)
    gv = np.sin(angles)

    n00 = gu[vi0, ui0] * uf + gv[vi0, ui0] * vf
    n10 = gu[vi0, ui1] * (uf - 1.0) + gv[vi0, ui1] * vf
    n01 = gu[vi1, ui0] * uf + gv[vi1, ui0] * (vf - 1.0)
    n11 = gu[vi1, ui1] * (uf - 1.0) + gv[vi1, ui1] * (vf - 1.0)

    nx0 = n00 + su * (n10 - n00)
    nx1 = n01 + su * (n11 - n01)
    return (nx0 + sv * (nx1 - nx0)) * 1.41421356


# ---------------------------------------------------------------------------
# 1. Roman Travertine Floor (1024x1024, Seamless 2x4 Running Bond)
# ---------------------------------------------------------------------------

def synthesize_single_travertine_field(H: int, W: int, rng: np.random.Generator) -> np.ndarray:
    """
    Synthesize a periodic 1024x1024 vein-cut honed Roman travertine stone sheet
    with horizontal sedimentary mineral bands, multi-octave fBm mottling, and
    subtle natural porous travertine pits.
    """
    # Domain warp for organic undulating sedimentary strata
    warp_y = 0.022 * periodic_fbm_2d(H, W, 2, 2, 4, rng, persistence=0.55)
    warp_x = 0.018 * periodic_fbm_2d(H, W, 2, 2, 3, rng, persistence=0.5)

    # Broad horizontal sedimentary mineral bands (high fy, low fx = horizontal veins)
    strata_broad = periodic_fbm_2d(H, W, 12, 2, 4, rng, persistence=0.58, warp_y=warp_y, warp_x=warp_x)
    strata_fine = periodic_fbm_2d(H, W, 40, 4, 3, rng, persistence=0.52, warp_y=warp_y * 0.6, warp_x=warp_x)

    # Non-linear sedimentary banding profile (mimics calcite/aragonite deposition rings)
    y_norm = np.arange(H, dtype=np.float32)[:, None] / float(H)
    phase = (y_norm * 6.0 + warp_y * 4.5 + 0.12 * strata_broad) * (2.0 * np.pi)
    sedimentary_wave = (
        0.50 * np.sin(phase)
        + 0.30 * np.sin(2.0 * phase + 1.1)
        + 0.20 * np.sin(5.0 * phase + 2.4)
    )

    # Isotropic limestone cloudiness & micro-mineral grain
    cloud_fbm = periodic_fbm_2d(H, W, 4, 4, 6, rng, persistence=0.52)
    micro_grain = periodic_perlin_2d(H, W, 256, 256, rng)

    # Combine into normalized stone value in [0, 1] with crisp sedimentary contrast
    stone_t = (
        0.50
        + 0.28 * strata_broad
        + 0.16 * strata_fine
        + 0.15 * sedimentary_wave
        + 0.15 * cloud_fbm
        + 0.03 * micro_grain
    )
    stone_t = np.clip(stone_t, 0.0, 1.0)

    # Honed warm Roman travertine palette (#DDD5C7 to #E8E1D4, with natural mineral veins)
    col_warm_low = hex_to_rgb("#CFC4B1")   # deeper warm travertine sedimentary vein
    col_mid_base = hex_to_rgb("#DDD5C7")   # classic Roman travertine
    col_high = hex_to_rgb("#E8E1D4")       # sunlit honed ivory-limestone
    col_calcite = hex_to_rgb("#F2EDE2")    # delicate pale calcite highlight vein

    rgb = np.empty((H, W, 3), dtype=np.float32)
    # Piecewise smooth blend from low -> mid -> high
    low_mask = np.clip(stone_t / 0.5, 0.0, 1.0)[..., None]
    high_mask = np.clip((stone_t - 0.5) / 0.5, 0.0, 1.0)[..., None]
    rgb = col_warm_low * (1.0 - low_mask) + col_mid_base * low_mask
    rgb = rgb * (1.0 - high_mask) + col_high * high_mask

    # Crisp pale calcite ribbon veins
    calcite_vein = np.clip((strata_fine - 0.34) / 0.36, 0.0, 1.0) ** 1.5
    rgb = rgb * (1.0 - 0.48 * calcite_vein[..., None]) + col_calcite * (0.48 * calcite_vein[..., None])

    # Tiny natural porous travertine pits (horizontally elongated vugs clustered along darker strata)
    pit_noise_1 = periodic_perlin_2d(H, W, 128, 32, rng, warp_y=warp_y * 0.3)
    pit_noise_2 = periodic_perlin_2d(H, W, 256, 64, rng)
    pit_field = 0.62 * pit_noise_1 + 0.38 * pit_noise_2
    # Favor pits along specific bedding planes
    bedding_gate = np.clip(0.65 - stone_t, 0.0, 0.65) / 0.65
    pit_raw = pit_field - (0.53 - 0.15 * bedding_gate)
    pit_mask = np.clip(pit_raw / 0.20, 0.0, 1.0) ** 1.6

    # Subtle 1px upper-edge rim highlight + recessed warm pore interior (honed & filled look)
    pit_shifted_down = np.roll(pit_mask, 1, axis=0)
    pit_rim = np.clip(pit_shifted_down - pit_mask, 0.0, 1.0)
    col_pit = hex_to_rgb("#B7AC98")
    rgb = rgb * (1.0 - 0.68 * pit_mask[..., None]) + col_pit * (0.68 * pit_mask[..., None])
    rgb = rgb + pit_rim[..., None] * 7.5

    return rgb


def generate_travertine_floor(out_path: Path) -> None:
    H, W = 1024, 1024
    rng = np.random.default_rng(20260401)

    # Generate 2 master periodic stone quarry blocks and give each of the 8 slabs
    # (4 rows x 2 cols) its own periodic roll offset + subtle quarry warmth shift.
    # Because every shifted sheet remains 1024x1024 periodic, slabs straddling
    # x = 0/1024 on odd running-bond rows are 100% seamless!
    quarry_a = synthesize_single_travertine_field(H, W, rng)
    quarry_b = synthesize_single_travertine_field(H, W, rng)

    yy = np.arange(H, dtype=np.int32)[:, None]
    xx = np.arange(W, dtype=np.int32)[None, :]

    # 4 courses across Y (256px tall each), 2 slabs per course across X (512px wide each)
    # Odd rows shift by 256px (50% running-bond ashlar pattern)
    row_idx = yy // 256  # 0..3
    row_offset = (row_idx % 2) * 256
    x_rel = (xx - row_offset) % W
    col_idx = x_rel // 512  # 0..1

    canvas = np.zeros((H, W, 3), dtype=np.float32)

    slab_configs = [
        # (use_b, dy, dx, lum_delta, warm_delta)
        (False, 0,   0,    +1.5, +0.8),
        (True,  96,  220,  -1.8, -0.4),
        (True,  310, 480,  +0.6, +1.0),
        (False, 180, 610,  -1.2, +0.3),
        (False, 420, 340,  -2.0, -0.6),
        (True,  640, 120,  +2.1, +0.5),
        (True,  205, 790,  +0.4, -0.5),
        (False, 730, 150,  -0.9, +0.9),
    ]

    for r in range(4):
        for c in range(2):
            idx = r * 2 + c
            use_b, dy, dx, lum_d, warm_d = slab_configs[idx]
            src = quarry_b if use_b else quarry_a
            shifted = np.roll(np.roll(src, dy, axis=0), dx, axis=1)
            # Subtle natural slab-to-slab tonal variation
            tint = np.array([lum_d + warm_d, lum_d + 0.3 * warm_d, lum_d - 0.8 * warm_d], dtype=np.float32)
            mask = (row_idx == r) & (col_idx == c)
            canvas[mask] = shifted[mask] + tint

    # Ultra-fine subtle grout lines (#C8BFAE, 2px wide with soft honed bevel)
    # Pixel centers at +0.5: seam at 0 / 256 has distance 0.5 for pixels 0 and 255 -> exact 2px seam!
    ly = (yy.astype(np.float32) + 0.5) % 256.0
    lx = (x_rel.astype(np.float32) + 0.5) % 512.0

    dist_y = np.minimum(ly, 256.0 - ly)
    dist_x = np.minimum(lx, 512.0 - lx)
    dist_joint = np.minimum(dist_x, dist_y)

    # Grout line profile: core 2px wide (dist_joint <= 1.0 -> 2 pixels across seam), soft 1.5px bevel shoulder
    grout_core = np.clip(1.65 - dist_joint, 0.0, 1.0)
    grout_mask = grout_core * grout_core * (3.0 - 2.0 * grout_core)

    # Subtle directional honed stone bevel highlight (top/left of slab) & shadow (bottom/right of slab)
    bevel_top = np.exp(-((ly - 2.2) ** 2) / 1.8) * (lx > 1.5) * (lx < 510.5)
    bevel_bot = np.exp(-((256.0 - ly - 2.2) ** 2) / 1.8) * (lx > 1.5) * (lx < 510.5)
    bevel_left = np.exp(-((lx - 2.2) ** 2) / 1.8) * (ly > 1.5) * (ly < 254.5)
    bevel_right = np.exp(-((512.0 - lx - 2.2) ** 2) / 1.8) * (ly > 1.5) * (ly < 254.5)

    canvas += (bevel_top + 0.8 * bevel_left)[..., None] * 3.8
    canvas -= (bevel_bot + 0.8 * bevel_right)[..., None] * 4.5

    # Fine mineral mortar texture around #C8BFAE
    mortar_grain = periodic_perlin_2d(H, W, 256, 256, rng)
    col_grout = hex_to_rgb("#C8BFAE")[None, None, :] + mortar_grain[..., None] * 2.8

    # Subtle edge AO right next to grout
    joint_ao = np.clip((3.2 - dist_joint) / 2.2, 0.0, 1.0) * (1.0 - grout_mask)
    canvas *= (1.0 - 0.025 * joint_ao[..., None])

    canvas = canvas * (1.0 - grout_mask[..., None]) + col_grout * grout_mask[..., None]
    img_u8 = np.clip(np.rint(canvas), 0, 255).astype(np.uint8)
    Image.fromarray(img_u8, mode="RGB").save(out_path, format="PNG", optimize=True)


# ---------------------------------------------------------------------------
# 2. Venetian Limewash Wall (1024x1024, Seamless Cloudy Plaster Sweeps)
# ---------------------------------------------------------------------------

def generate_limewash_wall(out_path: Path) -> None:
    H, W = 1024, 1024
    rng = np.random.default_rng(20260402)

    # Organic domain warp so brush strokes curve like artisanal hand-troweled/brushed limewash
    warp_a = 0.075 * periodic_fbm_2d(H, W, 2, 2, 4, rng, persistence=0.58)
    warp_b = 0.075 * periodic_fbm_2d(H, W, 2, 2, 4, rng, persistence=0.58)

    # Multi-scale cloudy slaked-lime mineral blooms
    clouds_large = periodic_fbm_2d(H, W, 2, 2, 5, rng, persistence=0.60, warp_y=warp_a, warp_x=warp_b)
    clouds_med = periodic_fbm_2d(H, W, 4, 4, 4, rng, persistence=0.55, warp_y=warp_b * 0.6, warp_x=warp_a * 0.6)

    # Overlapping artisanal cross-hatched masonry-brush sweeps (100% periodic diagonal lattice!)
    sweep_1 = periodic_rotated_stroke_2d(H, W, 2, 1, 3, 22, rng, warp_u=warp_a * 1.1, warp_v=warp_b * 0.9)
    sweep_2 = periodic_rotated_stroke_2d(H, W, 1, -2, 3, 24, rng, warp_u=warp_b * 1.1, warp_v=warp_a * 0.9)
    sweep_fine_1 = periodic_rotated_stroke_2d(H, W, 1, 2, 5, 52, rng, warp_u=warp_a * 0.5, warp_v=warp_b * 0.5)
    sweep_fine_2 = periodic_rotated_stroke_2d(H, W, 2, -1, 6, 72, rng, warp_u=warp_b * 0.4, warp_v=warp_a * 0.4)

    # Blend the two main brush passes softly based on cloudy plaster thickness
    pass_blend = np.clip(0.5 + 0.75 * clouds_large, 0.0, 1.0)
    brush_sweeps = pass_blend * sweep_1 + (1.0 - pass_blend) * sweep_2
    fine_bristles = 0.55 * sweep_fine_1 + 0.45 * sweep_fine_2

    # Micro calcium-carbonate / sand plaster aggregate grain
    plaster_grain_1 = periodic_perlin_2d(H, W, 128, 128, rng)
    plaster_grain_2 = periodic_perlin_2d(H, W, 256, 256, rng)
    plaster_micro = 0.6 * plaster_grain_1 + 0.4 * plaster_grain_2

    # Normalized tonal field in [0, 1]
    plaster_t = (
        0.50
        + 0.30 * clouds_large
        + 0.16 * clouds_med
        + 0.11 * brush_sweeps
        + 0.045 * fine_bristles
        + 0.042 * plaster_micro
    )
    plaster_t = np.clip(plaster_t, 0.0, 1.0)

    # Warm ivory/cream Venetian limewash palette (#EAE3D5 to #F4F0E7, subtle mineral depth)
    col_deep_mineral = hex_to_rgb("#E3DAC8")
    col_warm_cream = hex_to_rgb("#EAE3D5")
    col_ivory = hex_to_rgb("#F4F0E7")
    col_chalk_bloom = hex_to_rgb("#F8F5EE")

    t_low = np.clip(plaster_t / 0.45, 0.0, 1.0)[..., None]
    t_mid = np.clip((plaster_t - 0.45) / 0.40, 0.0, 1.0)[..., None]
    t_high = np.clip((plaster_t - 0.85) / 0.15, 0.0, 1.0)[..., None]

    rgb = col_deep_mineral * (1.0 - t_low) + col_warm_cream * t_low
    rgb = rgb * (1.0 - t_mid) + col_ivory * t_mid
    rgb = rgb * (1.0 - t_high) + col_chalk_bloom * t_high

    img_u8 = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    Image.fromarray(img_u8, mode="RGB").save(out_path, format="PNG", optimize=True)


# ---------------------------------------------------------------------------
# 3. Heritage Wimbledon Sage Fluted Wood (1024x1024, 32 Crisp Flutes)
# ---------------------------------------------------------------------------

def generate_sage_fluted_wood(out_path: Path) -> None:
    H, W = 1024, 1024
    num_flutes = 32
    flute_px = W // num_flutes  # 32px per flute (exact integer divisor -> 100% seamless)
    rng = np.random.default_rng(20260403)

    xx = np.arange(W, dtype=np.float32)[None, :]
    slat_idx = (np.arange(W, dtype=np.int32) // flute_px)[None, :]  # 0..31

    # Local coordinate across each 32px flute: u in (-1, 1)
    t_flute = ((xx + 0.5) % float(flute_px)) / float(flute_px)
    u = 2.0 * t_flute - 1.0

    # Cosine / half-round cylindrical millwork geometry + soft groove crevice
    # Surface normal (nx, 0, nz) across each flute
    theta = u * (np.pi * 0.47)
    nx = np.sin(theta)
    nz = np.cos(theta)  # cosine cylindrical profile: 1 at crown, ~0.09 at edges

    # Architectural gallery key light angled slightly from upper-left (-19 deg azimuth)
    light_x = -0.32
    light_z = math.sqrt(1.0 - light_x * light_x)
    n_dot_l = np.clip(nx * light_x + nz * light_z, 0.0, 1.0)

    # Combine pure cosine cylindrical falloff with directional key-light roll
    cyl_shade = 0.45 * nz + 0.55 * n_dot_l

    # Soft groove ambient occlusion in the tight architectural joint between flutes (|u| -> 1)
    groove_prox = np.clip((np.abs(u) - 0.72) / 0.28, 0.0, 1.0)
    groove_ao = groove_prox * groove_prox * (3.0 - 2.0 * groove_prox)

    # Subtle satin lacquer crown sheen highlight
    half_x = -0.20
    half_z = math.sqrt(1.0 - half_x * half_x)
    satin_spec = np.clip(nx * half_x + nz * half_z, 0.0, 1.0) ** 12

    # Fine vertical hardwood fiber grain (periodic in Y across 1024px)
    warp_grain_x = 0.008 * periodic_fbm_2d(H, W, 2, 8, 3, rng)
    cathedral = periodic_fbm_2d(H, W, 2, 32, 4, rng, persistence=0.55, warp_x=warp_grain_x)
    fine_fibers = periodic_fbm_2d(H, W, 8, 256, 3, rng, persistence=0.55)
    micro_pores = periodic_perlin_2d(H, W, 64, 512, rng)

    # Give each of the 32 vertical wood slats its own natural vertical phase offset & subtle tone
    slat_y_shifts = rng.integers(0, H, size=num_flutes)
    slat_tone_jitter = rng.uniform(-0.018, 0.018, size=num_flutes).astype(np.float32)

    wood_grain = np.empty((H, W), dtype=np.float32)
    pore_dips = np.empty((H, W), dtype=np.float32)
    raw_grain = 0.50 * cathedral + 0.50 * fine_fibers
    raw_pores = np.clip(-micro_pores - 0.48, 0.0, 1.0)

    for s in range(num_flutes):
        c0, c1 = s * flute_px, (s + 1) * flute_px
        dy = int(slat_y_shifts[s])
        wood_grain[:, c0:c1] = np.roll(raw_grain[:, c0:c1], dy, axis=0) + slat_tone_jitter[s]
        pore_dips[:, c0:c1] = np.roll(raw_pores[:, c0:c1], dy, axis=0)

    # Heritage Wimbledon Sage palette:
    # Base: #547049, Flute shadow: #3E5635, Flute crown highlight: #648258
    col_groove_deep = hex_to_rgb("#33482B")
    col_shadow = hex_to_rgb("#3E5635")
    col_base = hex_to_rgb("#547049")
    col_crown = hex_to_rgb("#648258")
    col_sheen = hex_to_rgb("#6D8C60")

    # Map cyl_shade into shadow -> base -> crown
    s_mid = np.clip((cyl_shade - 0.18) / 0.47, 0.0, 1.0)[..., None]
    s_high = np.clip((cyl_shade - 0.65) / 0.35, 0.0, 1.0)[..., None]

    rgb = col_shadow * (1.0 - s_mid) + col_base * s_mid
    rgb = rgb * (1.0 - s_high) + col_crown * s_high

    # Add satin crown highlight modulated lightly by wood grain
    spec_weight = (0.34 * satin_spec * (1.0 + 0.25 * wood_grain))[..., None]
    rgb = rgb * (1.0 - spec_weight) + col_sheen * spec_weight

    # Apply fine vertical painted hardwood grain & open-pore ash texture
    grain_mod = 1.0 + 0.055 * wood_grain - 0.065 * pore_dips
    rgb = rgb * grain_mod[..., None]

    # Tuck flute joints into crisp architectural groove ambient occlusion
    ao_weight = (0.78 * groove_ao)[..., None]
    rgb = rgb * (1.0 - ao_weight) + col_groove_deep * ao_weight

    img_u8 = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    Image.fromarray(img_u8, mode="RGB").save(out_path, format="PNG", optimize=True)


# ---------------------------------------------------------------------------
# 4. Club Crest Framed Exhibition Print (900x1200 via 1800x2400 LANCZOS)
# ---------------------------------------------------------------------------

def load_windows_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    fonts_dir = Path("C:/Windows/Fonts")
    for name in candidates:
        p = fonts_dir / name
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    center_xy: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, ...],
    tracking: float = 0.0,
) -> None:
    """Draw uppercase/editorial text with exact typographic tracking centered on center_xy."""
    cx, cy = center_xy
    advances = [font.getlength(ch) for ch in text]
    total_w = sum(advances) + max(0, len(text) - 1) * tracking

    bbox = font.getbbox(text)
    text_h = bbox[3] - bbox[1]
    y = cy - bbox[1] - text_h * 0.5

    x = cx - total_w * 0.5
    for ch, adv in zip(text, advances):
        draw.text((x, y), ch, font=font, fill=fill)
        x += adv + tracking


def build_vintage_racket_sprite(
    size: int,
    col_sage: tuple[int, int, int, int],
    col_gold: tuple[int, int, int, int],
    col_paper: tuple[int, int, int, int],
    col_grip_dark: tuple[int, int, int, int],
) -> Image.Image:
    """
    Render a crisp upright heritage wooden/laminated tennis racket on a transparent
    RGBA canvas of (size, size), ready for anti-aliased rotation.
    """
    sprite = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = size // 2

    # Proportions on a 960x960 sprite
    head_cy = 305
    rx_out, ry_out = 114, 150
    rx_in, ry_in = 96, 132

    # 1. Woven champagne-gold strings clipped cleanly inside inner oval
    strings_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(strings_layer)
    step = 16
    for sx in range(cx - rx_in, cx + rx_in + 1, step):
        s_draw.line([(sx, head_cy - ry_in), (sx, head_cy + ry_in)], fill=col_gold, width=2)
    for sy in range(head_cy - ry_in, head_cy + ry_in + 1, step):
        s_draw.line([(cx - rx_in, sy), (cx + rx_in, sy)], fill=col_gold, width=2)

    mask = Image.new("L", (size, size), 0)
    m_draw = ImageDraw.Draw(mask)
    m_draw.ellipse([cx - rx_in, head_cy - ry_in, cx + rx_in, head_cy + ry_in], fill=255)
    sprite.paste(strings_layer, (0, 0), mask)

    draw = ImageDraw.Draw(sprite)

    # 2. Open-heart vintage throat struts & shaft
    shaft_top_y = 548
    grip_top_y = 668
    butt_y = 838

    # Outer throat wedge polygon (sage laminated shoulders)
    throat_outer = [
        (cx - 74, head_cy + 114),
        (cx + 74, head_cy + 114),
        (cx + 15, shaft_top_y),
        (cx - 15, shaft_top_y),
    ]
    draw.polygon(throat_outer, fill=col_sage)

    # Concave throat bridge + open triangular heart cutout (filled with paper cream so crossing looks clean)
    throat_heart = [
        (cx - 46, head_cy + 135),
        (cx + 46, head_cy + 135),
        (cx, shaft_top_y - 24),
    ]
    draw.polygon(throat_heart, fill=col_paper, outline=col_gold, width=2)

    # Gold throat shoulder inlay lines
    draw.line([(cx - 65, head_cy + 118), (cx - 9, shaft_top_y)], fill=col_gold, width=2)
    draw.line([(cx + 65, head_cy + 118), (cx + 9, shaft_top_y)], fill=col_gold, width=2)

    # 3. Shaft
    draw.rectangle([cx - 14, shaft_top_y - 2, cx + 14, grip_top_y], fill=col_sage)
    draw.line([(cx, shaft_top_y + 4), (cx, grip_top_y - 6)], fill=col_gold, width=2)
    # Gold collar ring above grip
    draw.rectangle([cx - 16, grip_top_y - 10, cx + 16, grip_top_y], fill=col_gold)

    # 4. Fluted vintage leather grip handle with diagonal gold wrap seams
    grip_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(grip_layer)
    g_draw.rectangle([cx - 17, grip_top_y, cx + 17, butt_y - 12], fill=col_grip_dark)
    for gy in range(grip_top_y - 10, butt_y, 20):
        g_draw.line([(cx - 20, gy), (cx + 20, gy + 11)], fill=col_gold, width=2)
    g_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(g_mask).rectangle([cx - 17, grip_top_y, cx + 17, butt_y - 12], fill=255)
    sprite.paste(grip_layer, (0, 0), g_mask)
    draw.rectangle([cx - 17, grip_top_y, cx + 17, butt_y - 12], outline=col_sage, width=2)

    # Flared heritage butt-cap
    butt_poly = [
        (cx - 17, butt_y - 12),
        (cx + 17, butt_y - 12),
        (cx + 21, butt_y),
        (cx - 21, butt_y),
    ]
    draw.polygon(butt_poly, fill=col_sage, outline=col_gold, width=2)

    # 5. Laminated Oval Racket Frame (drawn cleanly with annular mask + gold center pinstripe)
    frame_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    f_draw = ImageDraw.Draw(frame_layer)
    f_draw.ellipse([cx - rx_out, head_cy - ry_out, cx + rx_out, head_cy + ry_out], fill=col_sage)
    # Cut out interior string bed
    frame_mask = Image.new("L", (size, size), 0)
    fm_draw = ImageDraw.Draw(frame_mask)
    fm_draw.ellipse([cx - rx_out, head_cy - ry_out, cx + rx_out, head_cy + ry_out], fill=255)
    fm_draw.ellipse([cx - rx_in, head_cy - ry_in, cx + rx_in, head_cy + ry_in], fill=0)
    sprite.paste(frame_layer, (0, 0), frame_mask)

    # Gold frame inlay pinstripe + crisp inner/outer rim outlines
    rx_mid, ry_mid = (rx_out + rx_in) // 2, (ry_out + ry_in) // 2
    draw.ellipse([cx - rx_mid, head_cy - ry_mid, cx + rx_mid, head_cy + ry_mid], outline=col_gold, width=2)
    draw.ellipse([cx - rx_in, head_cy - ry_in, cx + rx_in, head_cy + ry_in], outline=col_gold, width=2)

    return sprite


def make_leaf_polygon(
    base_xy: tuple[float, float],
    angle_rad: float,
    length: float,
    half_width: float,
    steps: int = 18,
) -> list[tuple[float, float]]:
    """Generate a smooth pointed botanical laurel leaf polygon."""
    bx, by = base_xy
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    nx, ny = -sa, ca

    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        w = math.sin(math.pi * (t ** 0.82)) * half_width
        px = bx + ca * (t * length) + nx * w
        py = by + sa * (t * length) + ny * w
        pts.append((px, py))
    for i in range(steps - 1, 0, -1):
        t = i / steps
        w = -math.sin(math.pi * (t ** 0.82)) * half_width
        px = bx + ca * (t * length) + nx * w
        py = by + sa * (t * length) + ny * w
        pts.append((px, py))
    return pts


def draw_laurel_wreath(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    radius: float,
    col_sage: tuple[int, ...],
    col_gold: tuple[int, ...],
    col_paper: tuple[int, ...],
) -> None:
    """Draw symmetric botanical laurel branches cradling the lower/side medallion."""
    num_nodes = 9
    max_sweep = 2.08  # stops cleanly below upper racket heads so strings remain pristine
    for side in (-1, 1):  # -1 = left, +1 = right
        stem_pts: list[tuple[float, float]] = []
        for i in range(60):
            u = i / 59.0
            sweep = -0.08 + u * max_sweep
            ang = math.pi * 0.5 - side * sweep
            stem_pts.append((cx + radius * math.cos(ang), cy + radius * math.sin(ang)))
        draw.line(stem_pts, fill=col_gold, width=3)

        for k in range(num_nodes):
            u = 0.10 + (k / (num_nodes - 1)) * 0.85
            sweep = -0.08 + u * max_sweep
            ang = math.pi * 0.5 - side * sweep
            px = cx + radius * math.cos(ang)
            py = cy + radius * math.sin(ang)

            tang_ang = ang - side * (math.pi * 0.5)
            taper = 1.0 - 0.34 * (u ** 1.35)
            leaf_len = 46.0 * taper
            leaf_hw = 11.2 * taper

            if k < num_nodes - 1:
                for splay in (-0.46, 0.44):
                    l_ang = tang_ang + splay
                    poly = make_leaf_polygon((px, py), l_ang, leaf_len, leaf_hw)
                    draw.polygon(poly, fill=col_sage)
                    vx = px + math.cos(l_ang) * (leaf_len * 0.72)
                    vy = py + math.sin(l_ang) * (leaf_len * 0.72)
                    draw.line([(px, py), (vx, vy)], fill=col_paper, width=2)

                if k % 2 == 1:
                    b_ang = tang_ang - side * 0.76
                    bx = px + math.cos(b_ang) * (leaf_len * 0.48)
                    by = py + math.sin(b_ang) * (leaf_len * 0.48)
                    draw.line([(px, py), (bx, by)], fill=col_gold, width=2)
                    br = 5.5
                    draw.ellipse([bx - br, by - br, bx + br, by + br], fill=col_gold)
            else:
                poly = make_leaf_polygon((px, py), tang_ang, leaf_len * 0.92, leaf_hw * 0.88)
                draw.polygon(poly, fill=col_sage)

    by_knot = cy + radius * math.cos(-0.08) - 2
    diamond = [(cx, by_knot - 11), (cx + 11, by_knot), (cx, by_knot + 11), (cx - 11, by_knot)]
    draw.polygon(diamond, fill=col_gold, outline=col_sage, width=2)


def draw_star_4pt(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    r_outer: float,
    r_inner: float,
    fill: tuple[int, ...],
) -> None:
    pts: list[tuple[float, float]] = []
    for i in range(8):
        ang = -math.pi * 0.5 + i * (math.pi * 0.25)
        r = r_outer if i % 2 == 0 else r_inner
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    draw.polygon(pts, fill=fill)


def generate_club_crest_art(out_path: Path) -> None:
    # Supersample at 1800x2400 -> downsample with LANCZOS to 900x1200
    W2, H2 = 1800, 2400
    W_FINAL, H_FINAL = 900, 1200
    rng = np.random.default_rng(20260404)

    # 1. Archival warm cream cotton rag paper (#F5F0E4) with subtle cold-press fiber texture
    # Note: this framed print is not tiled, so organic paper mottling + soft mat vignette adds museum depth
    base_paper = hex_to_rgb("#F5F0E4")
    paper_cloud = periodic_fbm_2d(H2, W2, 4, 3, 4, rng, persistence=0.55)
    paper_fiber_h = periodic_perlin_2d(H2, W2, 120, 45, rng)
    paper_fiber_v = periodic_perlin_2d(H2, W2, 45, 120, rng)
    paper_micro = rng.normal(0.0, 1.35, size=(H2, W2)).astype(np.float32)

    yy = (np.arange(H2, dtype=np.float32)[:, None] / H2) - 0.5
    xx = (np.arange(W2, dtype=np.float32)[None, :] / W2) - 0.5
    vignette = (xx * xx + yy * yy) * 7.5  # subtle warm archival edge tone

    paper_delta = 2.4 * paper_cloud + 1.2 * (paper_fiber_h + paper_fiber_v) + paper_micro - vignette
    paper_rgb = np.empty((H2, W2, 3), dtype=np.float32)
    paper_rgb[..., 0] = base_paper[0] + paper_delta
    paper_rgb[..., 1] = base_paper[1] + paper_delta * 0.96
    paper_rgb[..., 2] = base_paper[2] + paper_delta * 0.88 - vignette * 0.4

    canvas = Image.fromarray(np.clip(np.rint(paper_rgb), 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    col_sage = hex_to_tuple("#4D6A43", 255)
    col_sage_deep = hex_to_tuple("#3A5232", 255)
    col_gold = hex_to_tuple("#C5A059", 255)
    col_gold_text = hex_to_tuple("#AD863B", 255)  # rich legible champagne-gold ink on cream rag
    col_paper_rgba = hex_to_tuple("#F5F0E4", 255)

    cx = W2 // 2  # 900

    # 2. Crisp Double Hairline Sage & Gold Inner Border with Classical Stepped Corners
    m_out = 104
    m_in = 126
    draw.rectangle([m_out, m_out, W2 - m_out, H2 - m_out], outline=col_sage, width=4)
    draw.rectangle([m_in, m_in, W2 - m_in, H2 - m_in], outline=col_gold, width=2)

    # Architectural Georgian corner squares on the gold inner frame
    cs = 22
    for corner_x in (m_in, W2 - m_in - cs):
        for corner_y in (m_in, H2 - m_in - cs):
            draw.rectangle([corner_x, corner_y, corner_x + cs, corner_y + cs], outline=col_gold, width=2)

    # Subtle top exhibition header ornament
    top_orn_y = 206
    draw.line([(cx - 170, top_orn_y), (cx - 28, top_orn_y)], fill=col_gold, width=2)
    draw.line([(cx + 28, top_orn_y), (cx + 170, top_orn_y)], fill=col_gold, width=2)
    draw_star_4pt(draw, cx, top_orn_y, 14, 4, col_gold)

    # 3. Editorial Geometric Tennis Court Architectural Diagram (Wimbledon Sage & Champagne Gold)
    # True regulation championship court proportions (78 ft x 36 ft = 2.1667 : 1)
    court_w = 612  # 36 ft -> 17.0 px/ft
    court_h = 1326  # 78 ft -> 17.0 px/ft
    court_cy = 955
    c_left = cx - court_w // 2     # 594
    c_right = cx + court_w // 2    # 1206
    c_top = court_cy - court_h // 2     # 292
    c_bot = court_cy + court_h // 2     # 1618

    alley_px = round(4.5 * 17.0)   # 76 px (4.5 ft singles alley)
    s_left = c_left + alley_px     # 670
    s_right = c_right - alley_px   # 1130

    srv_dist = round(21.0 * 17.0)  # 357 px (21 ft service box)
    srv_top = court_cy - srv_dist  # 598
    srv_bot = court_cy + srv_dist  # 1312

    # Soft translucent Wimbledon lawn wash inside court boundary
    wash_layer = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    w_draw = ImageDraw.Draw(wash_layer)
    w_draw.rectangle([c_left, c_top, c_right, c_bot], fill=(77, 106, 67, 16))
    w_draw.rectangle([s_left, srv_top, s_right, srv_bot], fill=(77, 106, 67, 14))
    canvas = Image.alpha_composite(canvas, wash_layer)
    draw = ImageDraw.Draw(canvas)

    # Geometric architectural compass construction lines & witness ticks in Champagne Gold
    # Large subtle outer architectural circle & circumscribed diamond
    arch_r = 398
    draw.ellipse([cx - arch_r, court_cy - arch_r, cx + arch_r, court_cy + arch_r], outline=col_gold, width=2)
    # Corner quadrant geometry arcs inside baselines
    arc_r = 96
    draw.arc([c_left - arc_r, c_top - arc_r, c_left + arc_r, c_top + arc_r], start=0, end=90, fill=col_gold, width=2)
    draw.arc([c_right - arc_r, c_top - arc_r, c_right + arc_r, c_top + arc_r], start=90, end=180, fill=col_gold, width=2)
    draw.arc([c_right - arc_r, c_bot - arc_r, c_right + arc_r, c_bot + arc_r], start=180, end=270, fill=col_gold, width=2)
    draw.arc([c_left - arc_r, c_bot - arc_r, c_left + arc_r, c_bot + arc_r], start=270, end=360, fill=col_gold, width=2)

    # Architectural dimension witness ticks outside court perimeter
    tick_gap = 18
    tick_len = 26
    for tx in (c_left, s_left, cx, s_right, c_right):
        draw.line([(tx, c_top - tick_gap), (tx, c_top - tick_gap - tick_len)], fill=col_gold, width=2)
        draw.line([(tx, c_bot + tick_gap), (tx, c_bot + tick_gap + tick_len)], fill=col_gold, width=2)
    draw.line([(c_left, c_top - tick_gap - 13), (c_right, c_top - tick_gap - 13)], fill=col_gold, width=1)

    for ty in (c_top, srv_top, court_cy, srv_bot, c_bot):
        draw.line([(c_left - tick_gap, ty), (c_left - tick_gap - tick_len, ty)], fill=col_gold, width=2)
        draw.line([(c_right + tick_gap, ty), (c_right + tick_gap + tick_len, ty)], fill=col_gold, width=2)

    # Primary Tennis Court Architectural Linework in Wimbledon Sage (#4D6A43)
    # Doubles outer rectangle
    draw.rectangle([c_left, c_top, c_right, c_bot], outline=col_sage, width=5)
    # Singles sidelines
    draw.line([(s_left, c_top), (s_left, c_bot)], fill=col_sage, width=4)
    draw.line([(s_right, c_top), (s_right, c_bot)], fill=col_sage, width=4)
    # Service lines
    draw.line([(s_left, srv_top), (s_right, srv_top)], fill=col_sage, width=4)
    draw.line([(s_left, srv_bot), (s_right, srv_bot)], fill=col_sage, width=4)
    # Center service line
    draw.line([(cx, srv_top), (cx, srv_bot)], fill=col_sage, width=4)
    # Baseline center marks (inward 18px)
    draw.line([(cx, c_top), (cx, c_top + 22)], fill=col_sage, width=4)
    draw.line([(cx, c_bot - 22), (cx, c_bot)], fill=col_sage, width=4)

    # Net line & championship net posts (extending 3 ft = 51px past doubles sidelines)
    post_left = c_left - 51
    post_right = c_right + 51
    draw.line([(post_left, court_cy), (post_right, court_cy)], fill=col_gold, width=5)
    for px in (post_left, post_right):
        draw.ellipse([px - 10, court_cy - 10, px + 10, court_cy + 10], fill=col_paper_rgba, outline=col_sage, width=4)
        draw.ellipse([px - 4, court_cy - 4, px + 4, court_cy + 4], fill=col_gold)

    # 4. Central Heraldic Medallion Clearing + Botanical Laurel Wreath + Crossed Rackets & Ball
    med_r_out = 286
    med_r_in = 272
    # Paper-colored clearing so the central emblem reads cleanly without court-line clutter
    # Re-sample actual textured paper inside circle for cohesive cotton rag grain!
    med_mask = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(med_mask).ellipse(
        [cx - med_r_out, court_cy - med_r_out, cx + med_r_out, court_cy + med_r_out], fill=255
    )
    paper_base_img = Image.fromarray(np.clip(np.rint(paper_rgb), 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
    canvas.paste(paper_base_img, (0, 0), med_mask)
    draw = ImageDraw.Draw(canvas)

    # Concentric medallion rings + rotated geometric square/octagram frame
    draw.ellipse([cx - med_r_out, court_cy - med_r_out, cx + med_r_out, court_cy + med_r_out], outline=col_sage, width=4)
    draw.ellipse([cx - med_r_in, court_cy - med_r_in, cx + med_r_in, court_cy + med_r_in], outline=col_gold, width=2)

    # Subtle inner geometric diamond inscribed inside medallion
    d_r = 212
    diamond_ring = [(cx, court_cy - d_r), (cx + d_r, court_cy), (cx, court_cy + d_r), (cx - d_r, court_cy)]
    draw.polygon(diamond_ring, outline=col_gold, width=2)

    # Botanical Laurel Wreath inside medallion
    draw_laurel_wreath(draw, cx, court_cy + 6, 236, col_sage, col_gold, col_paper_rgba)

    # Crossed Vintage Tennis Rackets (rendered upright at high res and rotated ±36 deg)
    racket_sprite = build_vintage_racket_sprite(
        size=960,
        col_sage=col_sage,
        col_gold=col_gold,
        col_paper=col_paper_rgba,
        col_grip_dark=col_sage_deep,
    )
    racket_left = racket_sprite.rotate(35.0, resample=Image.Resampling.BICUBIC)
    racket_right = racket_sprite.rotate(-35.0, resample=Image.Resampling.BICUBIC)

    # Center of sprite (480, 505) aligns with crossing point (cx, court_cy + 12)
    paste_x = cx - 480
    paste_y = (court_cy + 18) - 505
    canvas.alpha_composite(racket_left, dest=(paste_x, paste_y))
    canvas.alpha_composite(racket_right, dest=(paste_x, paste_y))
    draw = ImageDraw.Draw(canvas)

    # Centered Heritage Tennis Ball Emblem at the racket intersection
    ball_cy = court_cy + 18
    ball_r = 46
    col_ball_fill = hex_to_tuple("#EFE8D6", 255)
    # Outer halo ring in paper cream so ball separates cleanly from crossed shafts
    draw.ellipse(
        [cx - ball_r - 7, ball_cy - ball_r - 7, cx + ball_r + 7, ball_cy + ball_r + 7],
        fill=col_paper_rgba,
    )
    draw.ellipse(
        [cx - ball_r, ball_cy - ball_r, cx + ball_r, ball_cy + ball_r],
        fill=col_ball_fill,
        outline=col_sage,
        width=5,
    )

    # Classic curved tennis ball seams clipped cleanly inside ball circle via alpha multiplication
    ball_seam_layer = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    bs_draw = ImageDraw.Draw(ball_seam_layer)
    seam_r = 35
    seam_off = 44
    bs_draw.ellipse(
        [cx - seam_off - seam_r, ball_cy - seam_r, cx - seam_off + seam_r, ball_cy + seam_r],
        outline=col_gold,
        width=8,
    )
    bs_draw.ellipse(
        [cx + seam_off - seam_r, ball_cy - seam_r, cx + seam_off + seam_r, ball_cy + seam_r],
        outline=col_gold,
        width=8,
    )
    bs_draw.ellipse(
        [cx - seam_off - seam_r, ball_cy - seam_r, cx - seam_off + seam_r, ball_cy + seam_r],
        outline=col_paper_rgba,
        width=3,
    )
    bs_draw.ellipse(
        [cx + seam_off - seam_r, ball_cy - seam_r, cx + seam_off + seam_r, ball_cy + seam_r],
        outline=col_paper_rgba,
        width=3,
    )
    ball_mask = Image.new("L", (W2, H2), 0)
    ImageDraw.Draw(ball_mask).ellipse(
        [cx - ball_r + 3, ball_cy - ball_r + 3, cx + ball_r - 3, ball_cy + ball_r - 3],
        fill=255,
    )
    empty_rgba = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    clipped_seams = Image.composite(ball_seam_layer, empty_rgba, ball_mask)
    canvas = Image.alpha_composite(canvas, clipped_seams)
    draw = ImageDraw.Draw(canvas)
    # Re-stroke crisp outer sage ball rim on top of seams
    draw.ellipse(
        [cx - ball_r, ball_cy - ball_r, cx + ball_r, ball_cy + ball_r],
        outline=col_sage,
        width=5,
    )

    # Crown 4-point star above rackets inside medallion
    draw_star_4pt(draw, cx, court_cy - 168, 18, 5, col_gold)

    # 5. High-Fashion Spaced Exhibition Typography
    font_title = load_windows_font(["FELIXTI.TTF", "GARABD.TTF", "BASKVILL.TTF", "georgiab.ttf"], size=80)
    font_sub = load_windows_font(["GOTHICB.TTF", "COPRGTB.TTF", "GOTHIC.TTF", "segoeui.ttf"], size=31)
    font_meta = load_windows_font(["GOTHIC.TTF", "GARA.TTF", "pala.ttf", "segoeui.ttf"], size=26)

    # Architectural divider rule between court diagram and title block
    div_y = 1756
    draw.line([(cx - 210, div_y), (cx - 22, div_y)], fill=col_gold, width=2)
    draw.line([(cx + 22, div_y), (cx + 210, div_y)], fill=col_gold, width=2)
    draw.polygon([(cx, div_y - 8), (cx + 8, div_y), (cx, div_y + 8), (cx - 8, div_y)], fill=col_sage)

    # Primary Title: "GOOD SHOT CLUB"
    draw_tracked_text(
        draw=draw,
        center_xy=(cx, 1872),
        text="GOOD SHOT CLUB",
        font=font_title,
        fill=col_sage_deep,
        tracking=16.0,
    )

    # Secondary Subtitle: "CHAMPIONSHIP LAWN & COURT"
    draw_tracked_text(
        draw=draw,
        center_xy=(cx, 1988),
        text="CHAMPIONSHIP LAWN & COURT",
        font=font_sub,
        fill=col_gold_text,
        tracking=12.5,
    )

    # Subtle hairline separator
    draw.line([(cx - 90, 2052), (cx + 90, 2052)], fill=col_gold, width=2)

    # Archival Edition Line: "NEW YORK  •  ARCHIVE NO. 04"
    draw_tracked_text(
        draw=draw,
        center_xy=(cx, 2116),
        text="NEW YORK  •  ARCHIVE NO. 04",
        font=font_meta,
        fill=col_sage,
        tracking=10.5,
    )

    # Downsample 1800x2400 -> 900x1200 with LANCZOS for razor-sharp anti-aliasing
    final_img = canvas.convert("RGB").resize((W_FINAL, H_FINAL), resample=Image.Resampling.LANCZOS)
    final_img.save(out_path, format="PNG", optimize=True)


# ---------------------------------------------------------------------------
# Entrypoint & Verification
# ---------------------------------------------------------------------------

def verify_seamless(img_path: Path) -> tuple[float, float, float, float]:
    """Return (wrap_y_diff, interior_y_diff, wrap_x_diff, interior_x_diff)."""
    arr = np.asarray(Image.open(img_path), dtype=np.float32)
    wrap_y = float(np.mean(np.abs(arr[0, :, :] - arr[-1, :, :])))
    int_y = float(np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :])))
    wrap_x = float(np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :])))
    int_x = float(np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :])))
    return wrap_y, int_y, wrap_x, int_x


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    travertine_path = OUTPUT_DIR / "travertine-floor.png"
    limewash_path = OUTPUT_DIR / "limewash-wall.png"
    fluted_path = OUTPUT_DIR / "sage-fluted-wood.png"
    crest_path = OUTPUT_DIR / "club-crest-art.png"

    print("Synthesizing travertine-floor.png (1024x1024)...")
    generate_travertine_floor(travertine_path)

    print("Synthesizing limewash-wall.png (1024x1024)...")
    generate_limewash_wall(limewash_path)

    print("Synthesizing sage-fluted-wood.png (1024x1024)...")
    generate_sage_fluted_wood(fluted_path)

    print("Synthesizing club-crest-art.png (1800x2400 -> 900x1200 LANCZOS)...")
    generate_club_crest_art(crest_path)

    print("\n--- Verification Report ---")
    for p, tileable in [
        (travertine_path, True),
        (limewash_path, True),
        (fluted_path, True),
        (crest_path, False),
    ]:
        im = Image.open(p)
        sz_kb = p.stat().st_size / 1024.0
        msg = f"{p.name:24s} | {im.size[0]}x{im.size[1]} {im.mode} | {sz_kb:8.1f} KB"
        if tileable:
            wy, iy, wx, ix = verify_seamless(p)
            msg += f" | wrapY={wy:.2f} (int={iy:.2f}), wrapX={wx:.2f} (int={ix:.2f})"
        print(msg)


if __name__ == "__main__":
    main()
