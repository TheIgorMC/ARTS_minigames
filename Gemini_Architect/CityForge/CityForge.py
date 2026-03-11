#!/usr/bin/env python3
"""
CityForge — Procedural City Generator
Generates realistic cities (SVG + GeoJSON) with:
  - Grid street network in the center (Manhattan-style)
  - Organic street growth toward outskirts (L-system + noise)
  - Proper block subdivision and building footprints
  - Zoning (CBD, residential, industrial, parkland)
  - Public transit (metro, bus, rail)

Usage:
    python3 cityforge.py [options]

    python3 cityforge.py --scale city --seed 42 --output mytown
    python3 cityforge.py --scale megalopolis --style mixed --no-transit
    python3 cityforge.py --help
"""

import math, random, json, argparse, sys, os, time, collections
from xml.etree.ElementTree import Element, SubElement, ElementTree, tostring, indent
import xml.etree.ElementTree as ET
import numpy as np
from scipy.spatial import Voronoi, KDTree
import networkx as nx

try:
    from PIL import Image
except Exception:
    Image = None

# ═══════════════════════════════════════════════════
#  CONFIGURATION & CONSTANTS
# ═══════════════════════════════════════════════════

SCALES = {
    "hamlet":     dict(pop=400,    world=1200,  grid_r=100,  blocks=12,   buildings=60,   transit=False),
    "village":    dict(pop=3000,   world=2000,  grid_r=200,  blocks=30,   buildings=200,  transit=False),
    "town":       dict(pop=30000,  world=4000,  grid_r=500,  blocks=120,  buildings=700,  transit=True),
    "city":       dict(pop=400000, world=8000,  grid_r=1200, blocks=400,  buildings=2500, transit=True),
    "metro":      dict(pop=3000000,world=16000, grid_r=2500, blocks=1000, buildings=6000, transit=True),
    "megalopolis":dict(pop=20000000,world=32000,grid_r=5000, blocks=2500, buildings=14000,transit=True),
}

ZONE_STYLES = {
    "cbd":         dict(fill="#1a2540", stroke="#2a3f70", label="CBD"),
    "residential": dict(fill="#1a2e1a", stroke="#2a4a2a", label="Residential"),
    "commercial":  dict(fill="#2e1a0a", stroke="#4a2a10", label="Commercial"),
    "industrial":  dict(fill="#1a1a10", stroke="#2a2a18", label="Industrial"),
    "mixed":       dict(fill="#1e1a30", stroke="#3a2a50", label="Mixed-Use"),
    "park":        dict(fill="#0d1f0a", stroke="#1a3a12", label="Park"),
    "water":       dict(fill="#0a1828", stroke="#0f2840", label="Water"),
}

ROAD_STYLES = {
    "motorway":   dict(color="#c8a020", width=5.0, z=0),
    "primary":    dict(color="#8a7040", width=3.5, z=1),
    "secondary":  dict(color="#505868", width=2.5, z=2),
    "tertiary":   dict(color="#363d4a", width=1.8, z=3),
    "residential":dict(color="#2a2f3a", width=1.2, z=4),
    "path":       dict(color="#222830", width=0.7, z=5),
}

TRANSIT_STYLES = {
    "metro":  dict(color="#e8304a", width=2.5, dash="8,4"),
    "rail":   dict(color="#9060e0", width=2.0, dash="12,5"),
    "bus":    dict(color="#e8a020", width=1.5, dash="5,5"),
    "tram":   dict(color="#30c0a0", width=1.5, dash="6,3"),
}

BUILDING_TYPES = {
    "skyscraper":       dict(color="#0f1830", stroke="#1a3060", floors=(25,100)),
    "office_high":      dict(color="#101c2e", stroke="#1a3050", floors=(10,25)),
    "office_mid":       dict(color="#121e2a", stroke="#203550", floors=(5,10)),
    "residential_high": dict(color="#0f1e18", stroke="#1a3828", floors=(8,20)),
    "residential_mid":  dict(color="#111e12", stroke="#1e3220", floors=(3,8)),
    "residential_low":  dict(color="#121a10", stroke="#1e2a18", floors=(1,3)),
    "commercial":       dict(color="#1e1208", stroke="#3a2010", floors=(1,4)),
    "industrial":       dict(color="#12120a", stroke="#202018", floors=(1,3)),
    "civic":            dict(color="#0a1220", stroke="#142040", floors=(2,6)),
    "mixed":            dict(color="#181220", stroke="#302040", floors=(3,12)),
}


# ═══════════════════════════════════════════════════
#  MATH UTILITIES
# ═══════════════════════════════════════════════════

def v2(x, y): return np.array([x, y], dtype=float)
def vlen(v): return float(np.linalg.norm(v))
def vnorm(v): l = vlen(v); return v / l if l > 1e-9 else v
def vperp(v): return v2(-v[1], v[0])
def vlerp(a, b, t): return a + (b - a) * t
def vdot(a, b): return float(np.dot(a, b))
def vcross(a, b): return float(a[0]*b[1] - a[1]*b[0])

def angle_between(a, b):
    d = vdot(vnorm(a), vnorm(b))
    return math.acos(max(-1.0, min(1.0, d)))

def seg_intersect(p1, p2, p3, p4):
    """Returns intersection point of segments p1-p2 and p3-p4, or None."""
    d1 = p2 - p1; d2 = p4 - p3
    cross = vcross(d1, d2)
    if abs(cross) < 1e-9: return None
    t = vcross(p3 - p1, d2) / cross
    u = vcross(p3 - p1, d1) / cross
    if 0 < t < 1 and 0 < u < 1:
        return p1 + d1 * t
    return None

def point_in_circle(p, center, r):
    return vlen(p - center) <= r

def poly_area(pts):
    n = len(pts)
    a = 0.0
    for i in range(n):
        j = (i+1) % n
        a += pts[i][0]*pts[j][1] - pts[j][0]*pts[i][1]
    return abs(a) / 2.0

def poly_centroid(pts):
    cx = cy = 0.0
    for p in pts: cx += p[0]; cy += p[1]
    return v2(cx / len(pts), cy / len(pts))

def offset_polygon(pts, offset):
    """Shrink/grow polygon by offset."""
    pts = [np.array(p, dtype=float) for p in pts]
    n = len(pts)
    result = []
    for i in range(n):
        a = pts[(i-1) % n]; b = pts[i]; c = pts[(i+1) % n]
        ab = vnorm(b - a); bc = vnorm(c - b)
        nb = vnorm(vperp(ab) + vperp(bc))
        cos_a = vdot(vperp(ab), nb)
        if abs(cos_a) > 0.1: nb = nb / cos_a * offset
        else: nb = vperp(ab) * offset
        result.append(b + nb)
    return result

def smooth_polyline(pts, iterations=2, strength=0.3):
    """Chaikin smoothing for organic roads."""
    # Ensure all points are numpy arrays
    pts = [np.array(p, dtype=float) if not isinstance(p, np.ndarray) else p for p in pts]
    for _ in range(iterations):
        new_pts = [pts[0]]
        for i in range(len(pts)-1):
            a, b = pts[i], pts[i+1]
            new_pts.append(vlerp(a, b, 0.25))
            new_pts.append(vlerp(a, b, 0.75))
        new_pts.append(pts[-1])
        pts = new_pts
    return pts

def perlin_noise_2d(x, y, seed=0):
    """Simple gradient noise (no external lib)."""
    rng = random.Random(seed)
    def grad(ix, iy):
        h = hash((ix, iy, seed)) & 7
        grads = [(1,1),(-1,1),(1,-1),(-1,-1),(1,0),(-1,0),(0,1),(0,-1)]
        return grads[h]
    def fade(t): return t*t*t*(t*(t*6-15)+10)
    def lerp(a,b,t): return a+t*(b-a)
    ix, iy = int(math.floor(x)), int(math.floor(y))
    fx, fy = x-ix, y-iy
    def dot_grad(cx, cy, px, py):
        gx, gy = grad(cx, cy); return gx*(px-cx) + gy*(py-cy)
    n00 = dot_grad(ix,iy,x,y); n10 = dot_grad(ix+1,iy,x,y)
    n01 = dot_grad(ix,iy+1,x,y); n11 = dot_grad(ix+1,iy+1,x,y)
    u, v_ = fade(fx), fade(fy)
    return lerp(lerp(n00,n10,u), lerp(n01,n11,u), v_)


class RasterMap:
    """Simple world-space sampler for grayscale raster maps."""

    def __init__(self, path, invert=False):
        if Image is None:
            raise RuntimeError("Pillow is required for --shape-map/--density-map. Install with: pip install pillow")
        img = Image.open(path).convert("L")
        arr = np.array(img, dtype=np.float32) / 255.0
        self.data = 1.0 - arr if invert else arr
        self.h, self.w = self.data.shape
        self.path = path

    def sample01(self, x, y, world_size):
        if world_size <= 0:
            return 0.0
        u = min(1.0, max(0.0, x / world_size))
        v = min(1.0, max(0.0, y / world_size))
        ix = min(self.w - 1, max(0, int(u * (self.w - 1))))
        iy = min(self.h - 1, max(0, int(v * (self.h - 1))))
        return float(self.data[iy, ix])


def poly_bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return (min(xs), min(ys), max(xs), max(ys))


def bbox_overlap(a, b, pad=0.0):
    return not (
        a[2] + pad <= b[0] or b[2] + pad <= a[0] or
        a[3] + pad <= b[1] or b[3] + pad <= a[1]
    )


def convex_polys_overlap(poly_a, poly_b):
    """Separating Axis Theorem for convex polygons."""
    if len(poly_a) < 3 or len(poly_b) < 3:
        return False

    def axes(poly):
        out = []
        for i in range(len(poly)):
            p0 = np.array(poly[i], dtype=float)
            p1 = np.array(poly[(i + 1) % len(poly)], dtype=float)
            edge = p1 - p0
            if vlen(edge) < 1e-9:
                continue
            out.append(vnorm(vperp(edge)))
        return out

    def proj(poly, axis):
        dots = [vdot(np.array(p, dtype=float), axis) for p in poly]
        return min(dots), max(dots)

    for axis in axes(poly_a) + axes(poly_b):
        a0, a1 = proj(poly_a, axis)
        b0, b1 = proj(poly_b, axis)
        if a1 <= b0 or b1 <= a0:
            return False
    return True


# ═══════════════════════════════════════════════════
#  ROAD NETWORK GENERATION
# ═══════════════════════════════════════════════════

class RoadNetwork:
    """
    Generates a realistic mixed-mode road network:
      1. Grid core  — regular block structure for CBD
      2. Radial arteries — main roads radiating from center
      3. Organic growth — L-system style road propagation in suburbs
      4. Ring roads — orbital connectors
    All roads are stored as a networkx graph + raw GeoJSON segments.
    """

    def __init__(self, cfg, rng):
        self.cfg = cfg
        self.rng = rng
        self.W = cfg['world']
        self.cx = self.W / 2
        self.cy = self.W / 2
        self.grid_r = cfg['grid_r']
        self.shape_mask = cfg.get('shape_mask')
        self.density_map = cfg.get('density_map')
        self.shape_threshold = cfg.get('shape_threshold', 0.5)
        self.hubs = self._generate_hubs()
        self.G = nx.Graph()          # node=(x,y) rounded, edge attrs: type, pts
        self.segments = []           # list of dicts for GeoJSON/SVG

    # ── Main entry ────────────────────────────────
    def generate(self):
        print(f"  [roads] Hubs: {len(self.hubs)}")
        print("  [roads] Generating grid core...")
        self._gen_grid()
        print("  [roads] Generating radial arteries...")
        self._gen_radials()
        print("  [roads] Generating ring roads...")
        self._gen_rings()
        print("  [roads] Organic suburban growth...")
        self._gen_organic()
        print(f"  [roads] Network: {self.G.number_of_nodes()} nodes, {self.G.number_of_edges()} edges")
        return self

    def _inside_city(self, x, y):
        if x < 0 or y < 0 or x > self.W or y > self.W:
            return False
        if self.shape_mask is not None:
            return self.shape_mask.sample01(x, y, self.W) >= self.shape_threshold
        city_r = self.W * 0.42
        hubs = getattr(self, 'hubs', [(self.cx, self.cy, 1.0)])
        for hx, hy, _ in hubs:
            if math.hypot(x - hx, y - hy) <= city_r:
                return True
        return False

    def _density(self, x, y):
        if self.density_map is not None:
            return self.density_map.sample01(x, y, self.W)
        return 0.5 + perlin_noise_2d(x * 0.0004, y * 0.0004, seed=self.cfg.get('seed', 0) + 23) * 0.25

    def _generate_hubs(self):
        scale_hubs = {
            "hamlet": 1,
            "village": 1,
            "town": 2,
            "city": 3,
            "metro": 4,
            "megalopolis": 6,
        }
        target = self.cfg.get('hubs') or scale_hubs.get(self.cfg.get('scale_name', 'city'), 3)
        hubs = []
        min_dist = self.W * 0.18

        for _ in range(max(200, target * 80)):
            if len(hubs) >= target:
                break
            x = self.rng.uniform(self.W * 0.08, self.W * 0.92)
            y = self.rng.uniform(self.W * 0.08, self.W * 0.92)
            if not self._inside_city(x, y):
                continue
            if any(math.hypot(x - hx, y - hy) < min_dist for hx, hy, _ in hubs):
                continue
            d = self.density_map.sample01(x, y, self.W) if self.density_map is not None else self.rng.uniform(0.35, 0.95)
            hubs.append((x, y, max(0.2, d)))

        if not hubs:
            hubs = [(self.cx, self.cy, 1.0)]
        return hubs

    # ── Grid Core ─────────────────────────────────
    def _gen_grid(self):
        """
        Lays out an orthogonal grid in the CBD zone.
        Block size varies with density: smaller in CBD core, larger in suburbs.
        The grid is slightly rotated for realism.
        """
        for hx, hy, weight in self.hubs:
            grid_r = self.grid_r * (0.55 + 0.65 * weight)
            block_primary = max(30.0, grid_r * 0.10)
            block_secondary = max(14.0, grid_r * 0.05)
            angle = self.rng.uniform(-20, 20) * math.pi / 180
            cos_a, sin_a = math.cos(angle), math.sin(angle)

            def rotate(x, y):
                rx = cos_a * x - sin_a * y + hx
                ry = sin_a * x + cos_a * y + hy
                return rx, ry

            primary_range = grid_r * 1.05
            x = -primary_range
            while x <= primary_range:
                pts = []
                y = -primary_range
                while y <= primary_range:
                    rx, ry = rotate(x, y)
                    if self._inside_city(rx, ry):
                        pts.append((rx, ry))
                    y += block_secondary
                rtype = "primary" if abs(x) < block_primary * 0.5 else "secondary"
                self._add_road_pts(pts, rtype)
                x += block_primary

            y = -primary_range
            while y <= primary_range:
                pts = []
                x = -primary_range
                while x <= primary_range:
                    rx, ry = rotate(x, y)
                    if self._inside_city(rx, ry):
                        pts.append((rx, ry))
                    x += block_secondary
                rtype = "primary" if abs(y) < block_primary * 0.5 else "secondary"
                self._add_road_pts(pts, rtype)
                y += block_primary

            x = -primary_range
            while x <= primary_range:
                if x % block_primary != 0:
                    pts = []
                    y = -primary_range
                    while y <= primary_range:
                        rx, ry = rotate(x, y)
                        if math.hypot(rx - hx, ry - hy) <= grid_r * 1.2 and self._inside_city(rx, ry):
                            pts.append((rx, ry))
                        y += block_secondary
                    self._add_road_pts(pts, "tertiary")
                x += block_secondary

    # ── Radials ───────────────────────────────────
    def _gen_radials(self):
        """
        Radial arteries: shoot out from center, carrying traffic to ring roads.
        They organically deviate from straight lines using noise.
        """
        max_r = self.W * 0.48
        for hidx, (hx, hy, weight) in enumerate(self.hubs):
            num_radials = max(3, int((6 + 8 * weight) / max(1, len(self.hubs))))
            for i in range(num_radials):
                angle = (i / num_radials) * 2 * math.pi + self.rng.uniform(-0.2, 0.2)
                pts = []
                r = self.grid_r * (0.2 + 0.2 * weight)
                while r < max_r:
                    noise = perlin_noise_2d(r * 0.003, i * 10 + hidx * 7, self.rng.randint(0, 999))
                    a = angle + noise * 0.45
                    x = hx + math.cos(a) * r
                    y = hy + math.sin(a) * r
                    if self._inside_city(x, y):
                        pts.append((x, y))
                    r += self.W * 0.018 + self.rng.uniform(0, self.W * 0.012)
                if len(pts) >= 2:
                    rtype = "primary" if i % 2 == 0 else "secondary"
                    self._add_road_pts(smooth_polyline(pts, 1), rtype)

    # ── Ring Roads ────────────────────────────────
    def _gen_rings(self):
        """
        Concentric ring roads (orbital connectors).
        Slightly organic — not perfect circles.
        """
        for hidx, (hx, hy, weight) in enumerate(self.hubs):
            num_rings = max(1, int(math.log2(self.W / 1000) + 1))
            radii = np.linspace(self.grid_r * (0.6 + 0.2 * weight), self.W * 0.26, num_rings)
            for idx, r in enumerate(radii):
                pts = []
                num_pts = max(24, int(r * 0.4))
                for i in range(num_pts + 1):
                    a = (i / num_pts) * 2 * math.pi
                    noise = perlin_noise_2d(math.cos(a) * 3 + idx + hidx, math.sin(a) * 3, 77)
                    rr = r * (1.0 + noise * 0.08)
                    x = hx + math.cos(a) * rr
                    y = hy + math.sin(a) * rr
                    if self._inside_city(x, y):
                        pts.append((x, y))
                rtype = "motorway" if idx == 0 else "primary"
                self._add_road_pts(pts, rtype)

    # ── Organic Suburban Streets ──────────────────
    def _gen_organic(self):
        """
        L-system style growth from the grid boundary outward.
        Roads follow terrain noise, curve naturally, and avoid
        looping back too close to existing roads.
        """
        max_r = self.W * 0.47
        seeds = []
        for hx, hy, weight in self.hubs:
            outer_r = self.grid_r * (0.6 + 0.5 * weight)
            num_seeds = max(6, int((self.W / 180) * (0.7 + weight)))
            for i in range(num_seeds):
                a = (i / num_seeds) * 2 * math.pi + self.rng.uniform(-0.25, 0.25)
                r = outer_r * self.rng.uniform(0.85, 1.15)
                x = hx + math.cos(a) * r
                y = hy + math.sin(a) * r
                if self._inside_city(x, y):
                    seeds.append((v2(x, y), a, (hx, hy), outer_r))

        # Build KDTree of existing nodes for proximity checks
        def get_existing_nodes():
            nodes = list(self.G.nodes())
            if not nodes: return None
            return KDTree(nodes)

        tree = get_existing_nodes()
        min_road_gap = self.W * 0.015  # minimum distance between parallel streets

        for seed_pt, seed_angle, hub_xy, outer_r in seeds:
            hub = v2(hub_xy[0], hub_xy[1])
            # Each seed spawns 1-3 roads
            for fork in range(self.rng.randint(1, 3)):
                angle = seed_angle + self.rng.uniform(-0.8, 0.8) + fork * math.pi * 0.5
                pt = seed_pt.copy()
                pts = [pt.copy()]
                dens = max(0.08, self._density(pt[0], pt[1]))
                step = self.W * (0.012 + 0.02 * (1.0 - dens))

                for step_i in range(self.rng.randint(8, 25)):
                    # Noise-driven direction change
                    noise = perlin_noise_2d(pt[0] * 0.0008, pt[1] * 0.0008, seed=42)
                    angle += noise * 0.35 + self.rng.gauss(0, 0.08)

                    new_pt = pt + v2(math.cos(angle), math.sin(angle)) * step
                    dist_from_center = vlen(new_pt - hub)

                    # Stop if outside city boundary
                    if dist_from_center > max_r or not self._inside_city(new_pt[0], new_pt[1]):
                        break

                    # Stop if too close to another road (avoid spaghetti)
                    if tree:
                        nearby = tree.query_ball_point(new_pt, min_road_gap)
                        if len(nearby) > 3: break

                    pts.append(new_pt.copy())
                    pt = new_pt

                    # Chance to branch
                    if self.rng.random() < 0.12 and len(pts) > 3:
                        branch_angle = angle + self.rng.choice([-1, 1]) * math.pi * 0.5
                        bpts = [pt.copy()]
                        bpt = pt.copy()
                        for _ in range(self.rng.randint(4, 12)):
                            branch_noise = perlin_noise_2d(bpt[0]*0.001, bpt[1]*0.001, seed=99)
                            branch_angle += branch_noise * 0.3 + self.rng.gauss(0, 0.07)
                            nbpt = bpt + v2(math.cos(branch_angle), math.sin(branch_angle)) * step
                            if vlen(nbpt - hub) > max_r or not self._inside_city(nbpt[0], nbpt[1]):
                                break
                            bpts.append(nbpt.copy())
                            bpt = nbpt
                        if len(bpts) >= 2:
                            self._add_road_pts(smooth_polyline(bpts, 2), "residential")

                if len(pts) >= 2:
                    dist = vlen(pts[-1] - hub)
                    rtype = "tertiary" if dist < outer_r * 1.5 else "residential"
                    self._add_road_pts(smooth_polyline(pts, 2), rtype)

    # ── Internal helpers ──────────────────────────
    def _snap(self, x, y, grid=2.0):
        return (round(x / grid) * grid, round(y / grid) * grid)

    def _add_road_pts(self, pts, rtype):
        if len(pts) < 2: return
        coords = []
        for p in pts:
            if hasattr(p, '__len__'):
                coords.append((float(p[0]), float(p[1])))
            else:
                coords.append((float(pts[0]), float(pts[1])))

        seg = {"type": rtype, "coords": coords}
        self.segments.append(seg)

        # Add to graph
        prev = None
        for c in coords:
            sn = self._snap(*c)
            if sn not in self.G:
                self.G.add_node(sn, x=sn[0], y=sn[1])
            if prev and prev != sn:
                if not self.G.has_edge(prev, sn):
                    self.G.add_edge(prev, sn, road_type=rtype,
                                    length=math.hypot(sn[0]-prev[0], sn[1]-prev[1]))
            prev = sn


# ═══════════════════════════════════════════════════
#  BLOCK & BUILDING GENERATION
# ═══════════════════════════════════════════════════

class BlockGenerator:
    """
    From the road network, identifies city blocks via Voronoi + road polygon clipping,
    assigns zones, and subdivides blocks into building footprints.
    """

    def __init__(self, road_net, cfg, rng):
        self.roads = road_net
        self.cfg = cfg
        self.rng = rng
        self.W = cfg['world']
        self.cx = self.W / 2; self.cy = self.W / 2
        self.shape_mask = cfg.get('shape_mask')
        self.density_map = cfg.get('density_map')
        self.shape_threshold = cfg.get('shape_threshold', 0.5)
        self.hubs = road_net.hubs if hasattr(road_net, 'hubs') else [(self.cx, self.cy, 1.0)]
        self.blocks = []      # list of dicts: {zone, polygon, buildings:[]}
        self.buildings = []   # flat list of building dicts
        self._occupied_buildings = []

    def generate(self):
        print("  [blocks] Detecting city blocks...")
        self._detect_blocks()
        print(f"  [blocks] {len(self.blocks)} blocks found. Generating buildings...")
        self._gen_buildings()
        print(f"  [buildings] {len(self.buildings)} buildings placed.")
        return self

    # ── Block detection via Voronoi ───────────────
    def _detect_blocks(self):
        """
        Approximates city blocks by sampling the road network:
        - place Voronoi seeds along road midpoints
        - generate Voronoi polygons
        - filter/clip to valid city area
        Assigns zone based on distance from center + noise.
        """
        W = self.W

        # Collect midpoints of all road segments
        seed_pts = []
        for seg in self.roads.segments:
            coords = seg['coords']
            for i in range(len(coords)-1):
                x1, y1 = coords[i]; x2, y2 = coords[i+1]
                # Sample a point slightly inside the block (perp offset)
                mx, my = (x1+x2)/2, (y1+y2)/2
                dx, dy = x2-x1, y2-y1
                length = math.hypot(dx, dy)
                if length < 1: continue
                nx_, ny_ = -dy/length, dx/length
                offset = self.rng.uniform(8, 30)
                for side in [1, -1]:
                    sx = mx + nx_ * offset * side
                    sy = my + ny_ * offset * side
                    if 0 < sx < W and 0 < sy < W:
                        seed_pts.append((sx, sy))

        if len(seed_pts) < 4:
            return

        # Deduplicate seeds
        seed_arr = np.array(seed_pts)
        # Thin out dense areas
        tree = KDTree(seed_arr)
        keep = np.ones(len(seed_arr), dtype=bool)
        for i in range(len(seed_arr)):
            if not keep[i]: continue
            close = tree.query_ball_point(seed_arr[i], 15)
            for j in close:
                if j != i: keep[j] = False
        seed_arr = seed_arr[keep]

        # Add boundary points so Voronoi is bounded
        margin = W * 0.02
        for bx in np.linspace(margin, W-margin, 12):
            for by in [margin, W-margin]:
                seed_arr = np.vstack([seed_arr, [bx, by]])
        for by in np.linspace(margin, W-margin, 12):
            for bx in [margin, W-margin]:
                seed_arr = np.vstack([seed_arr, [bx, by]])

        try:
            vor = Voronoi(seed_arr)
        except Exception:
            return

        # Build blocks from Voronoi regions
        for region_idx in vor.point_region:
            region = vor.regions[region_idx]
            if -1 in region or len(region) < 3: continue
            verts = [vor.vertices[i] for i in region]
            if any(np.isnan(v).any() for v in verts): continue

            # Filter: must be within city boundary
            centroid = np.mean(verts, axis=0)
            if not self._inside_city(centroid[0], centroid[1]):
                continue

            # Filter by area
            area = poly_area(verts)
            if area < 200 or area > W * W * 0.01: continue

            poly = self._organicize_polygon(verts)
            if len(poly) < 3:
                continue
            area = poly_area(poly)
            if area < 200:
                continue

            # Assign zone based on distance + noise
            zone = self._assign_zone(centroid[0], centroid[1])
            self.blocks.append({
                "zone": zone,
                "polygon": poly,
                "centroid": (float(centroid[0]), float(centroid[1])),
                "area": area,
                "buildings": []
            })

    def _inside_city(self, x, y):
        if x < 0 or y < 0 or x > self.W or y > self.W:
            return False
        if self.shape_mask is not None:
            return self.shape_mask.sample01(x, y, self.W) >= self.shape_threshold
        city_r = self.W * 0.42
        return any(math.hypot(x - hx, y - hy) <= city_r for hx, hy, _ in self.hubs)

    def _density(self, x, y):
        if self.density_map is not None:
            return self.density_map.sample01(x, y, self.W)
        return 0.5 + perlin_noise_2d(x * 0.0005, y * 0.0005, seed=self.cfg.get('seed', 0) + 11) * 0.3

    def _organicize_polygon(self, verts):
        pts = [(float(v[0]), float(v[1])) for v in verts]
        if len(pts) < 3:
            return pts
        out = []
        for i in range(len(pts)):
            a = np.array(pts[i], dtype=float)
            b = np.array(pts[(i + 1) % len(pts)], dtype=float)
            out.append((float(a[0]), float(a[1])))
            mid = (a + b) * 0.5
            edge = b - a
            el = vlen(edge)
            if el > 1e-6:
                # Add a perturbed midpoint to avoid perfectly rigid Voronoi look.
                n = vnorm(vperp(edge))
                amp = min(self.W * 0.004, el * 0.2)
                jitter = self.rng.uniform(-amp, amp)
                p = mid + n * jitter
                out.append((float(p[0]), float(p[1])))
        cleaned = []
        for x, y in out:
            if 0 <= x <= self.W and 0 <= y <= self.W and self._inside_city(x, y):
                cleaned.append((x, y))
        return cleaned if len(cleaned) >= 3 else pts

    def _assign_zone(self, x, y):
        nearest = min(math.hypot(x - hx, y - hy) for hx, hy, _ in self.hubs)
        r = nearest / (self.W * 0.42)
        noise = perlin_noise_2d(x * 0.0005, y * 0.0005, seed=13)
        dens = self._density(x, y)

        if r < 0.08 and dens > 0.7: return "cbd"
        if r < 0.18 + noise * 0.05: return "commercial" if noise > 0 or dens > 0.65 else "cbd"
        if r < 0.35 + noise * 0.08: return "mixed" if noise > 0.1 or dens > 0.55 else "residential"
        if r < 0.55 + noise * 0.10:
            return "industrial" if noise < -0.2 else "residential"
        if r < 0.75 + noise * 0.08:
            return "residential" if noise > -0.1 else "park"
        return "park"

    # ── Building placement ────────────────────────
    def _gen_buildings(self):
        max_buildings = self.cfg['buildings']
        budget = max_buildings
        # Sort blocks: CBD/commercial first
        priority = {"cbd":0,"commercial":1,"mixed":2,"residential":3,"industrial":4,"park":5}
        sorted_blocks = sorted(self.blocks, key=lambda b: priority.get(b['zone'], 9))

        for block in sorted_blocks:
            if budget <= 0: break
            zone = block['zone']
            if zone in ("park", "water"): continue

            placed = self._fill_block(block, budget)
            block['buildings'] = placed
            self.buildings.extend(placed)
            budget -= len(placed)

    def _fill_block(self, block, budget):
        """
        Subdivides a block into building lots along its edges (setback pattern).
        Returns list of building dicts.
        """
        zone = block['zone']
        poly = block['polygon']
        area = block['area']

        # Shrink block inward to represent roads/sidewalks
        try:
            inner = offset_polygon(poly, -8)
        except Exception:
            inner = poly

        if len(inner) < 3: return []
        inner_area = poly_area(inner)
        if inner_area < 100: return []

        buildings = []

        # Determine lot size by zone
        lot_sizes = {
            "cbd":        (40, 90),
            "commercial": (30, 70),
            "mixed":      (25, 55),
            "residential":(20, 45),
            "industrial": (50, 120),
        }
        min_lot, max_lot = lot_sizes.get(zone, (25, 50))
        dens = self._density(block['centroid'][0], block['centroid'][1])
        density_factor = 0.7 + dens * 0.8
        min_lot = max(10.0, min_lot / density_factor)
        max_lot = max(min_lot + 4.0, max_lot / density_factor)

        # Grid-subdivide the inner block
        cx_b, cy_b = poly_centroid(inner)
        bounds = self._bbox(inner)
        bx0, by0, bx1, by1 = bounds

        # How many lots fit
        w = bx1 - bx0; h = by1 - by0
        if w < min_lot or h < min_lot: return []

        cols = max(1, int(w / self.rng.uniform(min_lot, max_lot)))
        rows = max(1, int(h / self.rng.uniform(min_lot, max_lot)))

        col_breaks = np.linspace(bx0, bx1, cols + 1)
        row_breaks = np.linspace(by0, by1, rows + 1)

        # Setback from lot edges
        setback = self.rng.uniform(2.5, 5.0)

        for ci in range(cols):
            for ri in range(rows):
                if len(buildings) >= min(budget, 20): break
                lx0 = col_breaks[ci]   + setback
                lx1 = col_breaks[ci+1] - setback
                ly0 = row_breaks[ri]   + setback
                ly1 = row_breaks[ri+1] - setback
                if lx1 - lx0 < 5 or ly1 - ly0 < 5: continue

                # Check building centroid is within block polygon
                bcx = (lx0 + lx1) / 2; bcy = (ly0 + ly1) / 2
                if not self._point_in_poly((bcx, bcy), inner): continue

                btype = self._pick_building_type(zone, block)
                bt = BUILDING_TYPES[btype]
                floors = self.rng.randint(*bt['floors'])

                # Vary building footprint slightly
                jx = self.rng.uniform(0, (lx1-lx0)*0.15)
                jy = self.rng.uniform(0, (ly1-ly0)*0.15)
                footprint = self._make_organic_footprint(lx0+jx, ly0+jy, lx1-jx, ly1-jy)
                if len(footprint) < 3:
                    continue
                if not all(self._point_in_poly(pt, inner) for pt in footprint):
                    continue
                if self._overlaps_existing(footprint):
                    continue

                b_area = poly_area(footprint)
                if b_area < 8:
                    continue
                buildings.append({
                    "type": btype,
                    "zone": zone,
                    "floors": floors,
                    "footprint": footprint,
                    "centroid": (bcx, bcy),
                    "area": b_area,
                })
                self._occupied_buildings.append({
                    "bbox": poly_bbox(footprint),
                    "poly": footprint,
                })
        return buildings

    def _make_organic_footprint(self, x0, y0, x1, y1):
        w = x1 - x0
        h = y1 - y0
        if w < 4 or h < 4:
            return []
        jx = w * 0.12
        jy = h * 0.12
        return [
            (x0 + self.rng.uniform(0, jx), y0 + self.rng.uniform(0, jy)),
            (x1 - self.rng.uniform(0, jx), y0 + self.rng.uniform(0, jy)),
            (x1 - self.rng.uniform(0, jx), y1 - self.rng.uniform(0, jy)),
            (x0 + self.rng.uniform(0, jx), y1 - self.rng.uniform(0, jy)),
        ]

    def _overlaps_existing(self, footprint):
        bb = poly_bbox(footprint)
        for b in self._occupied_buildings:
            if not bbox_overlap(bb, b['bbox'], pad=0.5):
                continue
            if convex_polys_overlap(footprint, b['poly']):
                return True
        return False

    def _pick_building_type(self, zone, block):
        cx = self.cx; cy = self.cy
        bx, by = block['centroid']
        dist = math.hypot(bx - cx, by - cy)
        r = dist / (self.W * 0.47)

        choices = {
            "cbd":        ["skyscraper","office_high","office_mid","civic"],
            "commercial": ["commercial","office_mid","residential_high","mixed"],
            "mixed":      ["residential_high","residential_mid","commercial","office_mid"],
            "residential":["residential_low","residential_mid","residential_high"],
            "industrial": ["industrial","commercial"],
        }
        pool = choices.get(zone, ["residential_low"])

        # Weight toward taller in CBD
        if zone == "cbd" and r < 0.1 and self.rng.random() < 0.4:
            return "skyscraper"
        return self.rng.choice(pool)

    def _bbox(self, pts):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)

    def _point_in_poly(self, pt, poly):
        x, y = pt; inside = False
        n = len(poly)
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]; xj, yj = poly[j]
            if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi):
                inside = not inside
            j = i
        return inside


# ═══════════════════════════════════════════════════
#  TRANSIT GENERATION
# ═══════════════════════════════════════════════════

class TransitGenerator:
    def __init__(self, road_net, cfg, rng):
        self.roads = road_net
        self.cfg = cfg
        self.rng = rng
        self.W = cfg['world']
        self.cx = self.W / 2; self.cy = self.W / 2
        self.hubs = road_net.hubs if hasattr(road_net, 'hubs') else [(self.cx, self.cy, 1.0)]
        self.lines = []

    def generate(self):
        print("  [transit] Generating transit lines...")
        scale = self.cfg.get('scale_name', 'city')
        counts = {
            "hamlet": {}, "village": {},
            "town":   {"bus": 3},
            "city":   {"metro": 2, "bus": 6, "tram": 2},
            "metro":  {"metro": 5, "rail": 2, "bus": 12, "tram": 4},
            "megalopolis": {"metro": 9, "rail": 4, "bus": 20, "tram": 8},
        }
        plan = counts.get(scale, {"metro": 2, "bus": 4})
        line_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        idx = 0
        for ttype, count in plan.items():
            for i in range(count):
                name = f"{'Line ' if ttype in ('metro','rail','tram') else 'Route '}{line_letters[idx % 26]}"
                pts = self._gen_line(ttype, i, count)
                if pts:
                    self.lines.append({"type": ttype, "name": name, "coords": pts,
                                       "stations": self._pick_stations(pts, ttype)})
                idx += 1
        print(f"  [transit] {len(self.lines)} lines, {sum(len(l['stations']) for l in self.lines)} stations.")
        return self

    def _gen_line(self, ttype, idx, total):
        W = self.W
        hx, hy, _ = self.hubs[idx % len(self.hubs)]
        max_r = W * 0.44

        # Metro and rail: straight-ish through center
        if ttype in ("metro", "rail"):
            angle = (idx / total) * math.pi + self.rng.uniform(-0.2, 0.2)
            pts = []
            for t in np.linspace(-max_r * 0.9, max_r * 0.9, 20):
                noise = perlin_noise_2d(t * 0.001, idx * 5.3, seed=55) * W * 0.04
                x = hx + math.cos(angle) * t + noise * math.sin(angle)
                y = hy + math.sin(angle) * t + noise * math.cos(angle)
                pts.append((x, y))
            return pts

        # Bus: radial fan from center
        if ttype == "bus":
            angle = (idx / total) * 2 * math.pi + self.rng.uniform(-0.3, 0.3)
            pts = [(hx, hy)]
            r = 0
            a = angle
            while r < max_r:
                noise = perlin_noise_2d(r * 0.002, idx * 3.1, seed=88) * 0.4
                a += noise
                r += W * 0.04
                pts.append((hx + math.cos(a)*r, hy + math.sin(a)*r))
            return pts

        # Tram: ring-ish orbital
        if ttype == "tram":
            r = self.cfg['grid_r'] * (0.5 + (idx % max(1, len(self.hubs))) * 0.25)
            pts = []
            for i in range(25):
                a = (i / 24) * 2 * math.pi
                noise = perlin_noise_2d(math.cos(a)*2 + idx, math.sin(a)*2, seed=33)
                rr = r * (1 + noise * 0.1)
                pts.append((hx + math.cos(a)*rr, hy + math.sin(a)*rr))
            pts.append(pts[0])
            return pts
        return []

    def _pick_stations(self, pts, ttype):
        spacing = {"metro": 4, "rail": 5, "bus": 2, "tram": 3}
        step = spacing.get(ttype, 3)
        stations = []
        for i in range(0, len(pts), step):
            stations.append(pts[i])
        if pts and pts[-1] not in stations:
            stations.append(pts[-1])
        return stations


# ═══════════════════════════════════════════════════
#  GEOJSON EXPORT
# ═══════════════════════════════════════════════════

def build_geojson(roads, blocks_gen, transit, cfg):
    """
    Builds a full GeoJSON FeatureCollection.
    Coordinates are in the city's internal unit space (meters-like).
    """
    features = []

    # ── Zone polygons
    for block in blocks_gen.blocks:
        poly = block['polygon']
        features.append({
            "type": "Feature",
            "properties": {
                "featureType": "zone",
                "zoneType": block['zone'],
                "area": round(block['area'], 1),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[round(x,2),round(y,2)] for x,y in poly] + [[round(poly[0][0],2),round(poly[0][1],2)]]]
            }
        })

    # ── Roads
    for seg in roads.segments:
        features.append({
            "type": "Feature",
            "properties": {
                "featureType": "road",
                "roadType": seg['type'],
                "length": round(sum(
                    math.hypot(seg['coords'][i+1][0]-seg['coords'][i][0],
                               seg['coords'][i+1][1]-seg['coords'][i][1])
                    for i in range(len(seg['coords'])-1)
                ), 1)
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x,2),round(y,2)] for x,y in seg['coords']]
            }
        })

    # ── Buildings
    for b in blocks_gen.buildings:
        fp = b['footprint']
        features.append({
            "type": "Feature",
            "properties": {
                "featureType": "building",
                "buildingType": b['type'],
                "zone": b['zone'],
                "floors": b['floors'],
                "area": round(b['area'], 1),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[round(x,2),round(y,2)] for x,y in fp] + [[round(fp[0][0],2),round(fp[0][1],2)]]]
            }
        })

    # ── Transit
    for line in transit.lines:
        features.append({
            "type": "Feature",
            "properties": {
                "featureType": "transit_line",
                "transitType": line['type'],
                "name": line['name'],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(x,2),round(y,2)] for x,y in line['coords']]
            }
        })
        for i, st in enumerate(line['stations']):
            features.append({
                "type": "Feature",
                "properties": {
                    "featureType": "transit_station",
                    "transitType": line['type'],
                    "line": line['name'],
                    "stationIndex": i,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(st[0],2), round(st[1],2)]
                }
            })

    return {
        "type": "FeatureCollection",
        "metadata": {
            "generator": "CityForge",
            "scale": cfg.get('scale_name','city'),
            "seed": cfg.get('seed', 0),
            "world_size": cfg['world'],
            "hubs": len(getattr(roads, 'hubs', [(cfg['world'] / 2, cfg['world'] / 2, 1.0)])),
            "shape_map": getattr(cfg.get('shape_mask'), 'path', None),
            "density_map": getattr(cfg.get('density_map'), 'path', None),
            "feature_count": len(features),
        },
        "features": features
    }


# ═══════════════════════════════════════════════════
#  SVG EXPORT
# ═══════════════════════════════════════════════════

def build_svg(roads, blocks_gen, transit, cfg, svg_size=2048):
    W = cfg['world']
    S = svg_size
    scale = S / W

    def tx(x): return x * scale
    def ty(y): return y * scale
    def tp(pts): return " ".join(f"{tx(x):.2f},{ty(y):.2f}" for x,y in pts)

    root = Element("svg", xmlns="http://www.w3.org/2000/svg",
                   width=str(S), height=str(S),
                   viewBox=f"0 0 {S} {S}")
    root.set("style", "background:#090c12")

    defs = SubElement(root, "defs")

    # Filter for glow effect on transit
    filt = SubElement(defs, "filter", id="glow")
    SubElement(filt, "feGaussianBlur", stdDeviation="2", result="blur")
    merge = SubElement(filt, "feMerge")
    SubElement(merge, "feMergeNode", **{"in": "blur"})
    SubElement(merge, "feMergeNode", **{"in": "SourceGraphic"})

    # Filter for building shadow
    filt2 = SubElement(defs, "filter", id="bshadow")
    SubElement(filt2, "feDropShadow", **{
        "dx": "1", "dy": "1", "stdDeviation": "1.5",
        "flood-color": "#000", "flood-opacity": "0.6"
    })

    # ── Background
    SubElement(root, "rect", width=str(S), height=str(S), fill="#090c12")

    # ── Zones (lowest layer)
    g_zones = SubElement(root, "g", id="zones", opacity="0.85")
    for block in blocks_gen.blocks:
        zs = ZONE_STYLES.get(block['zone'], ZONE_STYLES['residential'])
        poly = block['polygon']
        SubElement(g_zones, "polygon",
                   points=tp(poly),
                   fill=zs['fill'], stroke=zs['stroke'],
                   **{"stroke-width": "0.5"})

    # ── Roads (sorted by z-order: motorways on top)
    g_roads = SubElement(root, "g", id="roads")
    order = ["residential","path","tertiary","secondary","primary","motorway"]
    for rtype in order:
        rs = ROAD_STYLES[rtype]
        g_r = SubElement(g_roads, "g", id=f"roads_{rtype}")
        for seg in roads.segments:
            if seg['type'] != rtype: continue
            coords = seg['coords']
            if len(coords) < 2: continue
            pts_str = " ".join(f"{tx(x):.2f},{ty(y):.2f}" for x,y in coords)
            SubElement(g_r, "polyline",
                       points=pts_str,
                       fill="none",
                       stroke=rs['color'],
                       **{"stroke-width": str(rs['width']),
                          "stroke-linecap": "round",
                          "stroke-linejoin": "round"})

    # ── Buildings
    g_bldgs = SubElement(root, "g", id="buildings", filter="url(#bshadow)")
    for b in blocks_gen.buildings:
        bt = BUILDING_TYPES[b['type']]
        fp = b['footprint']
        # Height-based opacity
        alpha = min(1.0, 0.5 + b['floors'] / 40.0)
        fill = bt['color']
        stroke = bt['stroke']
        sw = "0.4" if b['floors'] < 5 else "0.7"
        SubElement(g_bldgs, "polygon",
                   points=tp(fp),
                   fill=fill, stroke=stroke,
                   opacity=f"{alpha:.2f}",
                   **{"stroke-width": sw})

        # Roof highlight for tall buildings
        if b['floors'] >= 10:
            inner_fp = offset_polygon(fp, -max(1, len(fp)))
            if inner_fp and len(inner_fp) >= 3:
                SubElement(g_bldgs, "polygon",
                           points=tp(inner_fp),
                           fill="none",
                           stroke="#203060",
                           opacity="0.4",
                           **{"stroke-width": "0.3"})

    # ── Transit lines
    g_transit = SubElement(root, "g", id="transit", filter="url(#glow)")
    for line in transit.lines:
        ts = TRANSIT_STYLES.get(line['type'], TRANSIT_STYLES['bus'])
        coords = line['coords']
        pts_str = " ".join(f"{tx(x):.2f},{ty(y):.2f}" for x,y in coords)

        # Outer glow
        SubElement(g_transit, "polyline",
                   points=pts_str, fill="none",
                   stroke=ts['color'], opacity="0.2",
                   **{"stroke-width": str(ts['width'] * 3),
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round"})
        # Main line
        SubElement(g_transit, "polyline",
                   points=pts_str, fill="none",
                   stroke=ts['color'],
                   **{"stroke-width": str(ts['width']),
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                      "stroke-dasharray": ts['dash']})

        # Stations
        for st in line['stations']:
            SubElement(g_transit, "circle",
                       cx=f"{tx(st[0]):.2f}", cy=f"{ty(st[1]):.2f}",
                       r="3",
                       fill=ts['color'],
                       stroke="#fff",
                       **{"stroke-width": "0.8"})

    # ── City boundary circle (subtle)
    cx_s = tx(cfg['world'] / 2); cy_s = ty(cfg['world'] / 2)
    city_r_s = tx(cfg['world'] * 0.47)
    SubElement(root, "circle",
               cx=f"{cx_s:.1f}", cy=f"{cy_s:.1f}", r=f"{city_r_s:.1f}",
               fill="none", stroke="#1a2030", **{"stroke-width": "1.5"})

    # ── Legend
    g_legend = SubElement(root, "g", id="legend",
                           transform=f"translate({S-180}, 16)")
    SubElement(g_legend, "rect", width="164", height=str(24 + len(ZONE_STYLES)*18 + 10 + 5*18),
               rx="4", fill="#090c12cc", stroke="#1e2840", **{"stroke-width": "1"})
    SubElement(g_legend, "text", x="12", y="18",
               fill="#6080b0",
               **{"font-family":"monospace","font-size":"10","font-weight":"bold"}
               ).text = "CITYFORGE"

    y_off = 32
    for zone, zs in ZONE_STYLES.items():
        SubElement(g_legend, "rect", x="10", y=str(y_off-8), width="10", height="10",
                   fill=zs['fill'], stroke=zs['stroke'], **{"stroke-width":"0.5"})
        t = SubElement(g_legend, "text", x="26", y=str(y_off),
                       fill="#6080a0",
                       **{"font-family":"monospace","font-size":"9"})
        t.text = zs['label']
        y_off += 18

    y_off += 8
    for ttype, ts in TRANSIT_STYLES.items():
        SubElement(g_legend, "line", x1="10", y1=str(y_off-4), x2="20", y2=str(y_off-4),
                   stroke=ts['color'], **{"stroke-width":"2"})
        t = SubElement(g_legend, "text", x="26", y=str(y_off),
                       fill="#6080a0",
                       **{"font-family":"monospace","font-size":"9"})
        t.text = ttype.capitalize()
        y_off += 18

    # ── Metadata text
    meta_g = SubElement(root, "g", transform=f"translate(12, {S-12})")
    SubElement(meta_g, "text",
               fill="#2a3a5a",
               **{"font-family":"monospace","font-size":"8"}
               ).text = f"CityForge | scale:{cfg.get('scale_name','?')} seed:{cfg.get('seed',0)} features:{len(blocks_gen.buildings)+len(roads.segments)}"

    indent(root, space="  ")
    return root


# ═══════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════

def parse_args():
    p = argparse.ArgumentParser(
        description="CityForge — Procedural City Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 cityforge.py
  python3 cityforge.py --scale city --seed 42 --output mytown
  python3 cityforge.py --scale megalopolis --svg-size 4096
  python3 cityforge.py --scale hamlet --no-transit
  python3 cityforge.py --scale metro --seed 7 --output paris
        """
    )
    p.add_argument("--scale",    choices=list(SCALES.keys()), default="city",
                   help="City scale (default: city)")
    p.add_argument("--seed",     type=int, default=None,
                   help="Random seed for reproducibility")
    p.add_argument("--output",   type=str, default="city",
                   help="Output file prefix (default: city)")
    p.add_argument("--svg-size", type=int, default=2048,
                   help="SVG canvas size in pixels (default: 2048)")
    p.add_argument("--no-transit", action="store_true",
                   help="Disable transit generation")
    p.add_argument("--no-buildings", action="store_true",
                   help="Skip building generation (faster for large scales)")
    p.add_argument("--outdir",   type=str, default=".",
                   help="Output directory (default: current dir)")
    p.add_argument("--shape-map", type=str, default=None,
                   help="Optional B/W image controlling city footprint (white=inside city)")
    p.add_argument("--shape-threshold", type=float, default=0.5,
                   help="Threshold for shape-map inclusion in [0,1] (default: 0.5)")
    p.add_argument("--shape-invert", action="store_true",
                   help="Invert shape-map brightness before sampling")
    p.add_argument("--density-map", type=str, default=None,
                   help="Optional B/M-style density map (brighter = denser urban generation)")
    p.add_argument("--density-invert", action="store_true",
                   help="Invert density-map brightness before sampling")
    p.add_argument("--hubs", type=int, default=None,
                   help="Override number of generation hubs (prevents single-origin growth)")
    return p.parse_args()


def main():
    args = parse_args()

    seed = args.seed if args.seed is not None else random.randint(0, 999999)
    print(f"\n{'='*56}")
    print(f"  CityForge — Procedural City Generator")
    print(f"  Scale : {args.scale}")
    print(f"  Seed  : {seed}")
    print(f"  Output: {args.output}.svg / {args.output}.geojson")
    print(f"{'='*56}\n")

    rng = random.Random(seed)
    np.random.seed(seed)

    cfg = dict(SCALES[args.scale])
    cfg['scale_name'] = args.scale
    cfg['seed'] = seed
    cfg['transit'] = cfg['transit'] and not args.no_transit
    cfg['shape_threshold'] = min(1.0, max(0.0, args.shape_threshold))
    cfg['hubs'] = args.hubs if args.hubs and args.hubs > 0 else None

    if args.shape_map:
        cfg['shape_mask'] = RasterMap(args.shape_map, invert=args.shape_invert)
        print(f"  Shape map  : {args.shape_map}")
    else:
        cfg['shape_mask'] = None

    if args.density_map:
        cfg['density_map'] = RasterMap(args.density_map, invert=args.density_invert)
        print(f"  Density map: {args.density_map}")
    else:
        cfg['density_map'] = None

    t0 = time.time()

    # ── Generate road network
    print("[1/4] Road network...")
    roads = RoadNetwork(cfg, rng).generate()

    # ── Generate blocks + buildings
    print("\n[2/4] Blocks & buildings...")
    blocks_gen = BlockGenerator(roads, cfg, rng)
    if not args.no_buildings:
        blocks_gen.generate()
    else:
        blocks_gen.blocks = []
        blocks_gen.buildings = []
        print("  (skipped)")

    # ── Generate transit
    print("\n[3/4] Transit...")
    transit_gen = TransitGenerator(roads, cfg, rng)
    if cfg['transit']:
        transit_gen.generate()
    else:
        transit_gen.lines = []
        print("  (disabled)")

    # ── Export
    print("\n[4/4] Exporting...")
    os.makedirs(args.outdir, exist_ok=True)

    # GeoJSON
    geojson = build_geojson(roads, blocks_gen, transit_gen, cfg)
    geojson_path = os.path.join(args.outdir, f"{args.output}.geojson")
    with open(geojson_path, "w") as f:
        json.dump(geojson, f, indent=2)
    print(f"  ✓ GeoJSON  → {geojson_path}  ({len(geojson['features'])} features)")

    # SVG
    svg_root = build_svg(roads, blocks_gen, transit_gen, cfg, args.svg_size)
    svg_path = os.path.join(args.outdir, f"{args.output}.svg")
    tree = ElementTree(svg_root)
    tree.write(svg_path, encoding="unicode", xml_declaration=False)
    print(f"  ✓ SVG      → {svg_path}  ({args.svg_size}×{args.svg_size}px)")

    t1 = time.time()
    print(f"\n{'='*56}")
    print(f"  Done in {t1-t0:.2f}s")
    print(f"  Roads    : {len(roads.segments)} segments")
    print(f"  Blocks   : {len(blocks_gen.blocks)}")
    print(f"  Buildings: {len(blocks_gen.buildings)}")
    print(f"  Transit  : {len(transit_gen.lines)} lines")
    print(f"{'='*56}\n")


if __name__ == "__main__":
    main()