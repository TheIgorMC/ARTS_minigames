# -*- coding: utf-8 -*-

import sys
import os
import math
import multiprocessing

import numpy as np
from PIL import Image, ImageFilter
import opensimplex

# ---------------------------------------------------------------------------
# Planet type palettes
# Each palette defines colour stops for the elevation gradient and specular
# intensities. Colours are (R, G, B) tuples; elevation bands:
#   sea_deep  → sea_shallow  → shore  → lowland  → highland  → peak
# sea_level controls the ocean/land split (0‥1).
# ---------------------------------------------------------------------------
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

# Blur radius applied to the diffuse texture (pixels).
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


if __name__ == "__main__":
    # Usage:
    #   py -3 texturizer.py           → full batch: 20 variants per type (120 planets)
    #   py -3 texturizer.py --test    → quick test: 1 variant per type  (6 planets)
    #
    # File format: {type}_{num:02d}_diffuse.png / _bump.png / _specular.png

    test_mode    = "--test" in sys.argv
    TYPES        = ["terran", "ocean", "desert", "volcanic", "ice", "jungle"]
    NUM_VARIANTS = 1 if test_mode else 20

    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.normpath(
        os.path.join(script_dir, "..", "campaign_root", "assets", "textures", "planets")
    )

    print("Mode: {}  |  Output: {}".format("TEST" if test_mode else "FULL", output_dir))

    jobs = []
    for t_idx, ptype in enumerate(TYPES):
        for i in range(NUM_VARIANTS):
            num  = i + 1
            seed = 1000 + t_idx * 10000 + i * 137
            name = "{}_{:02d}".format(ptype, num)
            jobs.append((seed, name, ptype, output_dir))

    workers = max(1, multiprocessing.cpu_count() - 1)
    print("Avvio {} worker su {} CPU...".format(workers, multiprocessing.cpu_count()))

    with multiprocessing.Pool(processes=workers) as pool:
        pool.map(_worker, jobs)

    print("Completato: {} pianeti, {} file.".format(len(jobs), len(jobs) * 3))