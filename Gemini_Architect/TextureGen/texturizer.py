# -*- coding: utf-8 -*-

import sys
import os
import math
import multiprocessing

import numpy as np
from PIL import Image, ImageFilter
import opensimplex

# =============================================================================
# HABITABLE PLANET PALETTES
# Each palette defines colour stops for the elevation gradient and specular
# intensities. Colours are (R, G, B) tuples; elevation bands:
#   sea_deep  → sea_shallow  → shore  → lowland  → highland  → peak
# sea_level controls the ocean/land split (0‥1).
# =============================================================================
PLANET_PALETTES = {
    "terran": {
        "sea_level":   0.55,
        "sea_deep":    (10,   30, 150),
        "sea_shallow": (20,  100, 220),
        "shore":       (194, 178, 128),
        "lowland":     (34,  139,  34),
        "highland":    (105, 105, 105),
        "peak":        (250, 250, 250),
        "spec_sea": 240, "spec_shore": 30, "spec_land": 10, "spec_peak": 150,
    },
    "ocean": {
        "sea_level":   0.78,
        "sea_deep":    (5,    20, 120),
        "sea_shallow": (20,   90, 200),
        "shore":       (210, 200, 160),
        "lowland":     (60,  160,  60),
        "highland":    (130, 130,  80),
        "peak":        (240, 240, 240),
        "spec_sea": 250, "spec_shore": 40, "spec_land": 15, "spec_peak": 130,
    },
    "desert": {
        "sea_level":   0.20,
        "sea_deep":    (80,   60,  30),
        "sea_shallow": (120, 100,  50),
        "shore":       (210, 180, 100),
        "lowland":     (200, 160,  80),
        "highland":    (170, 130,  70),
        "peak":        (230, 210, 180),
        "spec_sea": 20, "spec_shore": 20, "spec_land": 5, "spec_peak": 40,
    },
    "volcanic": {
        "sea_level":   0.42,
        "sea_deep":    (200,  15,   0),
        "sea_shallow": (240,  80,   0),
        "shore":       (60,   40,  40),
        "lowland":     (45,   35,  35),
        "highland":    (80,   75,  75),
        "peak":        (160, 160, 160),
        "spec_sea": 200, "spec_shore": 10, "spec_land": 5, "spec_peak": 25,
    },
    "ice": {
        "sea_level":   0.50,
        "sea_deep":    (100, 160, 220),
        "sea_shallow": (160, 210, 240),
        "shore":       (215, 230, 245),
        "lowland":     (200, 220, 240),
        "highland":    (230, 240, 250),
        "peak":        (255, 255, 255),
        "spec_sea": 200, "spec_shore": 160, "spec_land": 120, "spec_peak": 220,
    },
    "jungle": {
        "sea_level":   0.52,
        "sea_deep":    (10,   50, 100),
        "sea_shallow": (20,   80, 150),
        "shore":       (100, 130,  60),
        "lowland":     (20,  110,  20),
        "highland":    (15,   75,  15),
        "peak":        (80,  115,  55),
        "spec_sea": 210, "spec_shore": 20, "spec_land": 5, "spec_peak": 10,
    },
}

# =============================================================================
# ROCKY WORLD PALETTES  (sea_level is effectively 0 – no oceans)
# =============================================================================
ROCKY_PALETTES = {
    "barren": {          # Moon-like grey dead world
        "sea_level":   0.0,
        "sea_deep":    (100,  95,  90),
        "sea_shallow": (110, 105, 100),
        "shore":       (130, 125, 118),
        "lowland":     (155, 148, 140),
        "highland":    (185, 178, 170),
        "peak":        (215, 210, 205),
        "spec_sea": 5, "spec_shore": 8, "spec_land": 6, "spec_peak": 18,
    },
    "martian": {         # Mars-like rust-red desert
        "sea_level":   0.0,
        "sea_deep":    (140,  55,  25),
        "sea_shallow": (155,  70,  35),
        "shore":       (195,  95,  55),
        "lowland":     (210, 110,  60),
        "highland":    (185,  75,  40),
        "peak":        (225, 168, 135),
        "spec_sea": 4, "spec_shore": 4, "spec_land": 4, "spec_peak": 12,
    },
    "mercurian": {       # Mercury-like dark heavily-cratered rock
        "sea_level":   0.0,
        "sea_deep":    ( 50,  46,  42),
        "sea_shallow": ( 62,  58,  53),
        "shore":       ( 82,  77,  72),
        "lowland":     ( 98,  93,  87),
        "highland":    (128, 122, 115),
        "peak":        (165, 160, 152),
        "spec_sea": 4, "spec_shore": 4, "spec_land": 4, "spec_peak":  8,
    },
    "sulfurous": {       # Io-like yellow/orange volcanic plains with lava pools
        "sea_level":   0.18,
        "sea_deep":    (170, 130,  10),
        "sea_shallow": (200, 165,  25),
        "shore":       (185, 135,  12),
        "lowland":     (162, 118,  14),
        "highland":    (128,  88,   8),
        "peak":        (200, 168,  75),
        "spec_sea": 80, "spec_shore": 28, "spec_land": 8, "spec_peak": 18,
    },
    "ashen": {           # Post-volcanic world; dark ash plains with pale ridges
        "sea_level":   0.05,
        "sea_deep":    ( 35,  30,  28),
        "sea_shallow": ( 42,  37,  34),
        "shore":       ( 60,  55,  50),
        "lowland":     ( 72,  65,  60),
        "highland":    (100,  92,  86),
        "peak":        (140, 133, 127),
        "spec_sea": 6, "spec_shore": 6, "spec_land": 5, "spec_peak": 14,
    },
}

# =============================================================================
# ICY WORLD PALETTES
# =============================================================================
ICY_PALETTES = {
    "frozen": {          # Ice-covered world with exposed dark sub-ice ocean hints
        "sea_level":   0.38,
        "sea_deep":    ( 55,  75, 140),
        "sea_shallow": ( 80, 125, 185),
        "shore":       (175, 210, 240),
        "lowland":     (200, 228, 250),
        "highland":    (220, 240, 255),
        "peak":        (255, 255, 255),
        "spec_sea": 155, "spec_shore": 175, "spec_land": 195, "spec_peak": 238,
    },
    "glacial": {         # Mostly icy but with exposed grey rock at low altitudes
        "sea_level":   0.28,
        "sea_deep":    ( 28,  58, 118),
        "sea_shallow": ( 58, 100, 162),
        "shore":       (110, 145, 195),
        "lowland":     (155, 185, 225),
        "highland":    (198, 220, 244),
        "peak":        (244, 250, 255),
        "spec_sea": 138, "spec_shore": 158, "spec_land": 178, "spec_peak": 218,
    },
    "methane": {         # Titan-like: orange haze, methane lakes, dune fields
        "sea_level":   0.48,
        "sea_deep":    ( 98,  52,  16),
        "sea_shallow": (138,  88,  38),
        "shore":       (175, 128,  65),
        "lowland":     (196, 158,  88),
        "highland":    (218, 188, 118),
        "peak":        (238, 218, 158),
        "spec_sea": 118, "spec_shore": 48, "spec_land": 18, "spec_peak": 28,
    },
    "nitrogen": {        # Pluto-like: pale pinkish-grey nitrogen ice plains
        "sea_level":   0.22,
        "sea_deep":    (155, 140, 150),
        "sea_shallow": (175, 162, 170),
        "shore":       (188, 175, 182),
        "lowland":     (200, 188, 195),
        "highland":    (218, 208, 214),
        "peak":        (238, 232, 236),
        "spec_sea": 168, "spec_shore": 148, "spec_land": 128, "spec_peak": 200,
    },
}

# =============================================================================
# STAR PALETTES  (spectral types O → M)
# Keys: core, mid, limb, spot, flare
# =============================================================================
STAR_PALETTES = {
    "O_star": {   # Blazing blue
        "core":  (155, 185, 255),
        "mid":   (100, 140, 255),
        "limb":  ( 55,  85, 210),
        "spot":  ( 25,  48, 165),
        "flare": (210, 228, 255),
    },
    "B_star": {   # Blue-white
        "core":  (185, 205, 255),
        "mid":   (150, 172, 255),
        "limb":  ( 95, 125, 230),
        "spot":  ( 58,  88, 188),
        "flare": (228, 238, 255),
    },
    "A_star": {   # White
        "core":  (242, 246, 255),
        "mid":   (218, 228, 255),
        "limb":  (168, 192, 245),
        "spot":  (128, 155, 215),
        "flare": (255, 255, 255),
    },
    "F_star": {   # Yellow-white
        "core":  (255, 255, 218),
        "mid":   (255, 248, 178),
        "limb":  (238, 218, 128),
        "spot":  (178, 158,  75),
        "flare": (255, 255, 238),
    },
    "G_star": {   # Yellow (Sun-like)
        "core":  (255, 248, 158),
        "mid":   (255, 228,  98),
        "limb":  (218, 178,  55),
        "spot":  (138,  98,  25),
        "flare": (255, 255, 198),
    },
    "K_star": {   # Orange
        "core":  (255, 198,  98),
        "mid":   (238, 158,  55),
        "limb":  (198, 108,  28),
        "spot":  (118,  58,   8),
        "flare": (255, 228, 158),
    },
    "M_star": {   # Red dwarf
        "core":  (255, 138,  55),
        "mid":   (228,  88,  28),
        "limb":  (178,  48,  12),
        "spot":  ( 98,  18,   4),
        "flare": (255, 178,  98),
    },
}

# =============================================================================
# GAS GIANT PALETTES  (banded pattern)
# bands: list of (R, G, B) cycling across the latitudinal bands
# storm_color: colour of large oval storm systems
# spec: cloud specular brightness (0-255)
# =============================================================================
GAS_GIANT_PALETTES = {
    "jovian": {       # Jupiter-like cream/brown/red bands
        "bands": [
            (255, 222, 182),
            (200, 150, 100),
            (178, 108,  68),
            (240, 198, 148),
            (158,  88,  48),
            (218, 168, 118),
        ],
        "storm_color": (198, 118, 58),
        "spec": 62,
    },
    "saturnian": {    # Saturn-like pale gold/tan bands
        "bands": [
            (242, 222, 182),
            (212, 192, 142),
            (192, 165, 108),
            (232, 212, 165),
            (172, 145,  88),
            (222, 202, 155),
        ],
        "storm_color": (202, 172, 108),
        "spec": 42,
    },
    "neptunian": {    # Neptune-like deep blue bands
        "bands": [
            ( 38,  78, 202),
            ( 58, 118, 222),
            ( 78, 158, 242),
            ( 28,  58, 182),
            ( 98, 178, 255),
            ( 48,  98, 212),
        ],
        "storm_color": (148, 222, 255),
        "spec": 102,
    },
    "uranian": {      # Uranus-like pale cyan/teal bands
        "bands": [
            ( 98, 222, 222),
            ( 78, 200, 212),
            ( 58, 182, 202),
            (118, 232, 228),
            ( 68, 192, 212),
            ( 88, 212, 218),
        ],
        "storm_color": (178, 248, 248),
        "spec": 92,
    },
    "toxic": {        # Venus/Titan-like sulfur yellow-green bands
        "bands": [
            (202, 202,  58),
            (182, 162,  28),
            (222, 202,  78),
            (168, 138,  18),
            (212, 192,  58),
            (158, 128,  12),
        ],
        "storm_color": (242, 222, 98),
        "spec": 82,
    },
    "crimson": {      # Fictional deep red/maroon gas giant
        "bands": [
            (198,  55,  38),
            (158,  35,  22),
            (218,  88,  58),
            (138,  22,  12),
            (185,  65,  42),
            (168,  42,  28),
        ],
        "storm_color": (248, 128, 98),
        "spec": 72,
    },
}

# Blur radius applied to diffuse textures (pixels).
DIFFUSE_BLUR_RADIUS = 2.0


def _lerp(a, b, t):
    return a + (b - a) * t

def _smooth(t):
    """Smoothstep."""
    return t * t * (3 - 2 * t)


def _build_diffuse_specular(noise_arr, palette):
    """
    Fully vectorised colour mapping.
    noise_arr : (H, W) float32 in [0, 1]
    Returns diffuse (H, W, 3) uint8 and specular (H, W) uint8.
    """
    sl      = palette["sea_level"]
    H, W    = noise_arr.shape
    diff    = np.zeros((H, W, 3), dtype=np.float32)
    spec    = np.zeros((H, W),    dtype=np.float32)

    # ---------- sea ----------
    sea = noise_arr < sl
    if sea.any():
        t = _smooth(np.clip(noise_arr[sea] / sl, 0.0, 1.0))
        for c in range(3):
            diff[sea, c] = _lerp(palette["sea_deep"][c], palette["sea_shallow"][c], t)
        spec[sea] = _lerp(palette["spec_sea"], palette["spec_sea"] * 0.6, t)

    # ---------- land ----------
    land = ~sea
    if land.any():
        alt = np.clip((noise_arr[land] - sl) / (1.0 - sl), 0.0, 1.0)
        ld  = np.zeros((land.sum(), 3), dtype=np.float32)
        ls  = np.zeros(land.sum(),      dtype=np.float32)

        b0 = alt < 0.06
        b1 = (alt >= 0.06) & (alt < 0.50)
        b2 = (alt >= 0.50) & (alt < 0.80)
        b3 = alt >= 0.80

        if b0.any():
            t = _smooth(alt[b0] / 0.06)
            for c in range(3):
                ld[b0, c] = _lerp(palette["sea_shallow"][c], palette["shore"][c], t)
            ls[b0] = _lerp(palette["spec_sea"] * 0.6, palette["spec_shore"], t)

        if b1.any():
            t = _smooth((alt[b1] - 0.06) / 0.44)
            for c in range(3):
                ld[b1, c] = _lerp(palette["shore"][c], palette["lowland"][c], t)
            ls[b1] = _lerp(palette["spec_shore"], palette["spec_land"], t)

        if b2.any():
            t = _smooth((alt[b2] - 0.50) / 0.30)
            for c in range(3):
                ld[b2, c] = _lerp(palette["lowland"][c], palette["highland"][c], t)
            ls[b2] = palette["spec_land"]

        if b3.any():
            t = _smooth((alt[b3] - 0.80) / 0.20)
            for c in range(3):
                ld[b3, c] = _lerp(palette["highland"][c], palette["peak"][c], t)
            ls[b3] = _lerp(palette["spec_land"], palette["spec_peak"], t)

        diff[land] = ld
        spec[land] = ls

    return np.clip(diff, 0, 255).astype(np.uint8), np.clip(spec, 0, 255).astype(np.uint8)


def generate_planet_maps(seed, base_name, planet_type="terran",
                         width=1024, height=512, output_folder="out"):
    """
    Genera mappe procedurali (Diffuse, Bump, Specular) per un pianeta.
    planet_type: 'terran' | 'ocean' | 'desert' | 'volcanic' | 'ice' | 'jungle'
    """
    palette = PLANET_PALETTES.get(planet_type, PLANET_PALETTES["terran"])

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
        print("Directory '{}' creata.".format(output_folder))

    print("Generazione '{}' [{}] seed {}...".format(base_name, planet_type, seed))

    opensimplex.seed(seed)

    # Vectorised point-wise noise evaluation (avoids explicit Python pixel loop)
    _vn3 = np.vectorize(opensimplex.noise3)

    # --- Spherical coordinate grid ---
    ys = np.linspace(0, 1, height, endpoint=False, dtype=np.float64)
    xs = np.linspace(0, 1, width,  endpoint=False, dtype=np.float64)
    X, Y = np.meshgrid(xs, ys)

    phi   = np.pi     * Y
    theta = 2 * np.pi * X

    nx = np.sin(phi) * np.cos(theta)
    ny = np.sin(phi) * np.sin(theta)
    nz = np.cos(phi)

    raw    = _vn3(nx * 2.5, ny * 2.5, nz * 2.5)
    detail = _vn3(nx * 10,  ny * 10,  nz * 10) * 0.1

    noise = np.clip((raw + detail + 1) / 2.0, 0.0, 1.0).astype(np.float32)

    # --- Maps ---
    bump_map             = (noise * 255).astype(np.uint8)
    diffuse_map, spec_map = _build_diffuse_specular(noise, palette)

    # --- Save ---
    # Naming: {type}_{number}_{texture}  e.g. terran_01_diffuse.png
    path_bump = os.path.join(output_folder, "{}_bump.png".format(base_name))
    path_diff = os.path.join(output_folder, "{}_diffuse.png".format(base_name))
    path_spec = os.path.join(output_folder, "{}_specular.png".format(base_name))

    Image.fromarray(bump_map).save(path_bump)

    diff_img = Image.fromarray(diffuse_map)
    diff_img = diff_img.filter(ImageFilter.GaussianBlur(radius=DIFFUSE_BLUR_RADIUS))
    diff_img.save(path_diff)

    Image.fromarray(spec_map).save(path_spec)

    print("  -> salvato in {}/".format(output_folder))


def _worker(args):
    seed, name, ptype, output_dir = args
    generate_planet_maps(seed, name, planet_type=ptype, output_folder=output_dir)


# =============================================================================
# ROCKY / ICY WORLD GENERATOR  (reuses elevation approach, no ocean)
# =============================================================================

def generate_rocky_maps(seed, base_name, rocky_type="barren",
                        width=1024, height=512, output_folder="out"):
    """
    Generates Diffuse, Bump, Specular maps for a rocky or icy world.
    rocky_type: 'barren'|'martian'|'mercurian'|'sulfurous'|'ashen'
                'frozen'|'glacial'|'methane'|'nitrogen'
    """
    all_palettes = {**ROCKY_PALETTES, **ICY_PALETTES}
    palette = all_palettes.get(rocky_type)
    if palette is None:
        raise ValueError("Unknown rocky/icy type: {}".format(rocky_type))

    os.makedirs(output_folder, exist_ok=True)
    print("Generating '{}' [{}] seed {}...".format(base_name, rocky_type, seed))

    opensimplex.seed(seed)
    _vn3 = np.vectorize(opensimplex.noise3)

    ys = np.linspace(0, 1, height, endpoint=False, dtype=np.float64)
    xs = np.linspace(0, 1, width,  endpoint=False, dtype=np.float64)
    X, Y = np.meshgrid(xs, ys)

    phi   = np.pi     * Y
    theta = 2 * np.pi * X
    nx = np.sin(phi) * np.cos(theta)
    ny = np.sin(phi) * np.sin(theta)
    nz = np.cos(phi)

    # Craterised look: sharper high-freq layering
    raw    = _vn3(nx * 2.5, ny * 2.5, nz * 2.5)
    detail = _vn3(nx * 8.0, ny * 8.0, nz * 8.0) * 0.18
    fine   = _vn3(nx * 20,  ny * 20,  nz * 20 ) * 0.06

    noise = np.clip((raw + detail + fine + 1) / 2.0, 0.0, 1.0).astype(np.float32)

    bump_arr               = (noise * 255).astype(np.uint8)
    diffuse_arr, spec_arr  = _build_diffuse_specular(noise, palette)

    path_bump = os.path.join(output_folder, "{}_bump.png".format(base_name))
    path_diff = os.path.join(output_folder, "{}_diffuse.png".format(base_name))
    path_spec = os.path.join(output_folder, "{}_specular.png".format(base_name))

    Image.fromarray(bump_arr).save(path_bump)
    diff_img = Image.fromarray(diffuse_arr).filter(
        ImageFilter.GaussianBlur(radius=DIFFUSE_BLUR_RADIUS))
    diff_img.save(path_diff)
    Image.fromarray(spec_arr).save(path_spec)
    print("  -> saved to {}/".format(output_folder))


def _worker_rocky(args):
    seed, name, rtype, output_dir = args
    generate_rocky_maps(seed, name, rocky_type=rtype, output_folder=output_dir)


# =============================================================================
# GAS GIANT GENERATOR  (latitudinal band pattern + turbulence)
# =============================================================================

def _build_gas_giant_diffuse(noise_arr, band_arr, palette):
    """
    noise_arr : (H, W) float32 [0,1] – turbulence displacement
    band_arr  : (H, W) float32 [0,1] – smooth latitude-based band gradient
    Returns diffuse (H, W, 3) uint8  and specular (H, W) uint8.
    """
    bands = palette["bands"]
    n_bands = len(bands)
    storm  = palette["storm_color"]
    spec_v = palette["spec"]

    H, W   = noise_arr.shape
    diff   = np.zeros((H, W, 3), dtype=np.float32)

    # Warp band index by turbulence noise
    warped = np.clip(band_arr + (noise_arr - 0.5) * 0.30, 0.0, 0.9999)
    band_idx = (warped * n_bands).astype(np.int32)
    band_frac = _smooth((warped * n_bands) - band_idx)

    for i in range(n_bands):
        mask_a = band_idx == i
        mask_b = band_idx == (i + 1) % n_bands
        if mask_a.any():
            c_a = np.array(bands[i],                   dtype=np.float32)
            c_b = np.array(bands[(i + 1) % n_bands],   dtype=np.float32)
            t   = band_frac[mask_a][..., None]
            diff[mask_a] = c_a * (1 - t) + c_b * t

    # Storm oval: high turbulence areas become slightly storm-tinted
    storm_mask = noise_arr > 0.82
    if storm_mask.any():
        intensity = _smooth((noise_arr[storm_mask] - 0.82) / 0.18)[..., None]
        sc = np.array(storm, dtype=np.float32)
        diff[storm_mask] = diff[storm_mask] * (1 - intensity * 0.6) + sc * (intensity * 0.6)

    spec = np.full((H, W), spec_v, dtype=np.uint8)
    return np.clip(diff, 0, 255).astype(np.uint8), spec


def generate_gas_giant_maps(seed, base_name, giant_type="jovian",
                            width=1024, height=512, output_folder="out"):
    """
    Generates Diffuse, Bump, Specular maps for a gas giant.
    giant_type: 'jovian'|'saturnian'|'neptunian'|'uranian'|'toxic'|'crimson'
    """
    palette = GAS_GIANT_PALETTES.get(giant_type)
    if palette is None:
        raise ValueError("Unknown gas giant type: {}".format(giant_type))

    os.makedirs(output_folder, exist_ok=True)
    print("Generating '{}' [{}] seed {}...".format(base_name, giant_type, seed))

    opensimplex.seed(seed)
    _vn3 = np.vectorize(opensimplex.noise3)

    ys = np.linspace(0, 1, height, endpoint=False, dtype=np.float64)
    xs = np.linspace(0, 1, width,  endpoint=False, dtype=np.float64)
    X, Y = np.meshgrid(xs, ys)

    phi   = np.pi     * Y
    theta = 2 * np.pi * X
    nx = np.sin(phi) * np.cos(theta)
    ny = np.sin(phi) * np.sin(theta)
    nz = np.cos(phi)

    # Turbulence noise (stretching horizontal = bands look streaked)
    turbulence = _vn3(nx * 3.0, ny * 1.2, nz * 3.0) * 0.5 \
               + _vn3(nx * 8.0, ny * 2.5, nz * 8.0) * 0.3 \
               + _vn3(nx * 18,  ny * 5.0, nz * 18 ) * 0.2
    turb_norm  = np.clip((turbulence + 1) / 2.0, 0.0, 1.0).astype(np.float32)

    # Smooth latitude band gradient (based purely on Y so bands are horizontal)
    # Multiple sinusoidal harmonics give natural banding variety per seed
    rng = np.random.default_rng(seed)
    freq1, phase1 = rng.uniform(4, 9),   rng.uniform(0, np.pi * 2)
    freq2, phase2 = rng.uniform(9, 18),  rng.uniform(0, np.pi * 2)
    band_wave  = 0.5 + 0.4 * np.sin(ys * np.pi * freq1 + phase1) \
                     + 0.1 * np.sin(ys * np.pi * freq2 + phase2)
    band_wave  = np.tile(
        np.clip(band_wave, 0.0, 1.0).astype(np.float32)[:, None], (1, width))

    diffuse_arr, spec_arr = _build_gas_giant_diffuse(turb_norm, band_wave, palette)

    # Bump: cloud ridges from turbulence
    bump_arr = (turb_norm * 255).astype(np.uint8)

    path_bump = os.path.join(output_folder, "{}_bump.png".format(base_name))
    path_diff = os.path.join(output_folder, "{}_diffuse.png".format(base_name))
    path_spec = os.path.join(output_folder, "{}_specular.png".format(base_name))

    Image.fromarray(bump_arr).save(path_bump)
    diff_img = Image.fromarray(diffuse_arr).filter(
        ImageFilter.GaussianBlur(radius=DIFFUSE_BLUR_RADIUS))
    diff_img.save(path_diff)
    Image.fromarray(spec_arr).save(path_spec)
    print("  -> saved to {}/".format(output_folder))


def _worker_gas_giant(args):
    seed, name, gtype, output_dir = args
    generate_gas_giant_maps(seed, name, giant_type=gtype, output_folder=output_dir)


# =============================================================================
# STAR GENERATOR  (granulation + limb darkening + star spots + emissive)
# =============================================================================

def _build_star_diffuse(granule_arr, spot_arr, latitude_arr, palette):
    """
    granule_arr  : (H, W) float32 [0,1] – convection cell noise
    spot_arr     : (H, W) float32 [0,1] – starspot noise (low = dark spot)
    latitude_arr : (H, W) float32 [0,1] – 0 at equator used for limb darkening
    Returns diffuse/emissive (H, W, 3) uint8.
    """
    H, W  = granule_arr.shape
    diff  = np.zeros((H, W, 3), dtype=np.float32)

    core  = np.array(palette["core"],  dtype=np.float32)
    mid   = np.array(palette["mid"],   dtype=np.float32)
    limb  = np.array(palette["limb"],  dtype=np.float32)
    spot  = np.array(palette["spot"],  dtype=np.float32)
    flare = np.array(palette["flare"], dtype=np.float32)

    # --- Granulation: bright granule interiors fade to dark intergranular lanes ---
    t_gran = _smooth(np.clip(granule_arr, 0.0, 1.0))
    for c in range(3):
        diff[..., c] = mid[c] * (1 - t_gran) + core[c] * t_gran

    # --- Flares: highest granule peaks are extra bright ---
    flare_mask = granule_arr > 0.88
    if flare_mask.any():
        t_fl = _smooth((granule_arr[flare_mask] - 0.88) / 0.12)[..., None]
        diff[flare_mask] = diff[flare_mask] * (1 - t_fl) + flare * t_fl

    # --- Starspots: darkest noise areas → spot colour ---
    spot_mask = spot_arr < 0.12
    if spot_mask.any():
        t_sp = _smooth(1.0 - spot_arr[spot_mask] / 0.12)[..., None]
        diff[spot_mask] = diff[spot_mask] * (1 - t_sp * 0.7) + spot * (t_sp * 0.7)

    # --- Limb darkening: pixel brightness drops toward the poles in UV space.
    #     In equirectangular, sin(phi) encodes how "limb-facing" the row is.
    #     We simply darken rows near phi=0 and phi=π.
    ld_factor = np.clip(latitude_arr, 0.0, 1.0)[..., None]  # 1=equator, 0=pole
    diff = diff * (0.5 + 0.5 * ld_factor)

    return np.clip(diff, 0, 255).astype(np.uint8)


def generate_star_maps(seed, base_name, star_type="G_star",
                       width=1024, height=512, output_folder="out"):
    """
    Generates Diffuse and Emissive maps for a star.
    star_type: 'O_star'|'B_star'|'A_star'|'F_star'|'G_star'|'K_star'|'M_star'
    Emissive is a brightness-boosted version of the diffuse.
    """
    palette = STAR_PALETTES.get(star_type)
    if palette is None:
        raise ValueError("Unknown star type: {}".format(star_type))

    os.makedirs(output_folder, exist_ok=True)
    print("Generating '{}' [{}] seed {}...".format(base_name, star_type, seed))

    opensimplex.seed(seed)
    _vn3 = np.vectorize(opensimplex.noise3)

    ys = np.linspace(0, 1, height, endpoint=False, dtype=np.float64)
    xs = np.linspace(0, 1, width,  endpoint=False, dtype=np.float64)
    X, Y = np.meshgrid(xs, ys)

    phi   = np.pi     * Y
    theta = 2 * np.pi * X
    nx = np.sin(phi) * np.cos(theta)
    ny = np.sin(phi) * np.sin(theta)
    nz = np.cos(phi)

    # Granulation: mid-frequency noise gives a cellular/convection look
    gran_raw  = _vn3(nx * 6.0, ny * 6.0, nz * 6.0)
    gran_fine = _vn3(nx * 18,  ny * 18,  nz * 18 ) * 0.25
    granule   = np.clip((gran_raw + gran_fine + 1) / 2.0, 0.0, 1.0).astype(np.float32)

    # Starspots: separate low-frequency noise layer
    opensimplex.seed(seed + 99999)
    _vn3b    = np.vectorize(opensimplex.noise3)
    spot_raw = _vn3b(nx * 2.5, ny * 2.5, nz * 2.5)
    spot_map = np.clip((spot_raw + 1) / 2.0, 0.0, 1.0).astype(np.float32)

    # Latitude (for limb darkening): sin(phi) is 1 at equator, 0 at poles
    lat_arr  = np.sin(phi).astype(np.float32)  # shape (H, W) after meshgrid
    lat_arr  = np.tile(lat_arr, (1, 1))         # already (H, W)

    diffuse_arr = _build_star_diffuse(granule, spot_map, lat_arr, palette)

    # Emissive: gamma-brighten the diffuse to simulate self-illumination
    emissive_f   = (diffuse_arr.astype(np.float32) / 255.0) ** 0.65 * 255.0
    emissive_arr = np.clip(emissive_f, 0, 255).astype(np.uint8)

    path_diff = os.path.join(output_folder, "{}_diffuse.png".format(base_name))
    path_emit = os.path.join(output_folder, "{}_emissive.png".format(base_name))

    Image.fromarray(diffuse_arr).save(path_diff)
    Image.fromarray(emissive_arr).save(path_emit)
    print("  -> saved to {}/".format(output_folder))


def _worker_star(args):
    seed, name, stype, output_dir = args
    generate_star_maps(seed, name, star_type=stype, output_folder=output_dir)


if __name__ == "__main__":
    # Usage:
    #   py -3 texturizer.py           → full batch: 20 variants per type
    #   py -3 texturizer.py --test    → quick test: 1 variant per type
    #   py -3 texturizer.py --planets → habitable planets only
    #   py -3 texturizer.py --rocky   → rocky + icy worlds only
    #   py -3 texturizer.py --gas     → gas giants only
    #   py -3 texturizer.py --stars   → stars only
    #
    # Output subfolders inside campaign_root/assets/textures/:
    #   planets/   – habitable worlds
    #   rocky/     – rocky & icy worlds
    #   gas/       – gas giants
    #   stars/     – stellar surfaces

    args_set   = set(sys.argv[1:])
    test_mode  = "--test"    in args_set
    _flags     = args_set - {"--test"}
    do_planets = "--planets" in args_set                   # explicit flag required
    do_rocky   = "--rocky"   in args_set or not _flags
    do_gas     = "--gas"     in args_set or not _flags
    do_stars   = "--stars"   in args_set or not _flags

    NUM_VARIANTS = 1 if test_mode else 20

    script_dir = os.path.dirname(os.path.abspath(__file__))
    tex_root   = os.path.normpath(
        os.path.join(script_dir, "..", "campaign_root", "assets", "textures"))

    dir_planets = os.path.join(tex_root, "planets")
    dir_rocky   = os.path.join(tex_root, "rocky")
    dir_gas     = os.path.join(tex_root, "gas")
    dir_stars   = os.path.join(tex_root, "stars")

    mode_label = "TEST" if test_mode else "FULL"
    print("Mode: {}  |  Output root: {}".format(mode_label, tex_root))

    workers = max(1, multiprocessing.cpu_count() - 1)
    print("Workers: {} / {} CPU".format(workers, multiprocessing.cpu_count()))

    total_files = 0

    # ---- Habitable planets ------------------------------------------------
    if do_planets:
        PLANET_TYPES = ["terran", "ocean", "desert", "volcanic", "ice", "jungle"]
        jobs = []
        for t_idx, ptype in enumerate(PLANET_TYPES):
            for i in range(NUM_VARIANTS):
                seed = 1000 + t_idx * 10000 + i * 137
                name = "{}_{:02d}".format(ptype, i + 1)
                jobs.append((seed, name, ptype, dir_planets))
        print("\n[PLANETS] {} jobs".format(len(jobs)))
        with multiprocessing.Pool(processes=workers) as pool:
            pool.map(_worker, jobs)
        total_files += len(jobs) * 3

    # ---- Rocky & icy worlds -----------------------------------------------
    if do_rocky:
        ROCKY_TYPES = list(ROCKY_PALETTES.keys()) + list(ICY_PALETTES.keys())
        jobs = []
        for t_idx, rtype in enumerate(ROCKY_TYPES):
            for i in range(NUM_VARIANTS):
                seed = 2000 + t_idx * 10000 + i * 137
                name = "{}_{:02d}".format(rtype, i + 1)
                jobs.append((seed, name, rtype, dir_rocky))
        print("\n[ROCKY/ICY] {} jobs".format(len(jobs)))
        with multiprocessing.Pool(processes=workers) as pool:
            pool.map(_worker_rocky, jobs)
        total_files += len(jobs) * 3

    # ---- Gas giants -------------------------------------------------------
    if do_gas:
        GAS_TYPES = list(GAS_GIANT_PALETTES.keys())
        jobs = []
        for t_idx, gtype in enumerate(GAS_TYPES):
            for i in range(NUM_VARIANTS):
                seed = 3000 + t_idx * 10000 + i * 137
                name = "{}_{:02d}".format(gtype, i + 1)
                jobs.append((seed, name, gtype, dir_gas))
        print("\n[GAS GIANTS] {} jobs".format(len(jobs)))
        with multiprocessing.Pool(processes=workers) as pool:
            pool.map(_worker_gas_giant, jobs)
        total_files += len(jobs) * 3

    # ---- Stars ------------------------------------------------------------
    if do_stars:
        STAR_TYPES = list(STAR_PALETTES.keys())
        jobs = []
        for t_idx, stype in enumerate(STAR_TYPES):
            for i in range(NUM_VARIANTS):
                seed = 4000 + t_idx * 10000 + i * 137
                name = "{}_{:02d}".format(stype, i + 1)
                jobs.append((seed, name, stype, dir_stars))
        print("\n[STARS] {} jobs".format(len(jobs)))
        with multiprocessing.Pool(processes=workers) as pool:
            pool.map(_worker_star, jobs)
        total_files += len(jobs) * 2   # diffuse + emissive (no bump/spec for stars)

    print("\nDone. ~{} texture files generated.".format(total_files))
