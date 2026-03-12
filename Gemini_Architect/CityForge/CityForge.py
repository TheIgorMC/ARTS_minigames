"""CityForge

Street editor with road painting, pan/zoom camera, and district brush painting.
Districts generate road-aligned build cells with density-driven size and height.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import random
import tkinter as tk
from tkinter import ttk


Point = tuple[float, float]
Polygon = list[Point]


@dataclass(frozen=True)
class RoadType:
    name: str
    width: float
    color: str


@dataclass
class RoadStroke:
    road_type: RoadType
    points: list[Point]


@dataclass
class Cell:
    shape: str
    polygon: Polygon
    building_polygon: Polygon
    height: float
    density: float


@dataclass
class District:
    polygon: Polygon
    density: float
    cells: list[Cell]


ROAD_TYPES: tuple[RoadType, ...] = (
    RoadType("Highway", 18.0, "#5E6A74"),
    RoadType("Arterial", 12.0, "#6F7F8E"),
    RoadType("Collector", 8.0, "#8797A6"),
    RoadType("Outskirt", 5.0, "#A4B1BC"),
)


class CityForgeApp:
    GRID_SIZE = 20.0
    CANVAS_BG = "#1A1F24"
    GRID_COLOR_MINOR = "#252D36"
    GRID_COLOR_MAJOR = "#34404D"
    ROAD_SNAP_PIXELS = 16

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("CityForge - Street and District Editor")
        self.root.geometry("1360x860")
        self.root.minsize(980, 640)

        self.current_tool = tk.StringVar(value="Road")
        self.current_road_name = tk.StringVar(value=ROAD_TYPES[1].name)
        self.show_grid = tk.BooleanVar(value=True)
        self.snap_grid = tk.BooleanVar(value=True)
        self.snap_roads = tk.BooleanVar(value=True)
        self.density = tk.DoubleVar(value=0.5)
        self.status_text = tk.StringVar(
            value="Road mode: drag to paint curved roads. Hold Shift to lock H/V."
        )

        self.scale = 1.0
        self.offset_x = 0.0
        self.offset_y = 0.0

        self.roads: list[RoadStroke] = []
        self.districts: list[District] = []
        self.action_stack: list[tuple[str, int]] = []

        self.is_drawing = False
        self.is_panning = False
        self.drag_points: list[Point] = []
        self.pan_start: tuple[float, float] | None = None

        self._build_layout()
        self._bind_events()
        self.root.after(50, self._initialize_camera)

    def _build_layout(self) -> None:
        frame = ttk.Frame(self.root, padding=8)
        frame.pack(fill=tk.BOTH, expand=True)

        toolbar = ttk.Frame(frame)
        toolbar.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(toolbar, text="Tool:").pack(side=tk.LEFT)
        tool_menu = ttk.OptionMenu(
            toolbar, self.current_tool, self.current_tool.get(), "Road", "District"
        )
        tool_menu.pack(side=tk.LEFT, padx=(6, 14))

        ttk.Label(toolbar, text="Road Type:").pack(side=tk.LEFT)
        road_menu = ttk.OptionMenu(
            toolbar,
            self.current_road_name,
            self.current_road_name.get(),
            *[road.name for road in ROAD_TYPES],
        )
        road_menu.pack(side=tk.LEFT, padx=(6, 14))

        ttk.Checkbutton(toolbar, text="Snap grid", variable=self.snap_grid).pack(side=tk.LEFT)
        ttk.Checkbutton(toolbar, text="Snap roads", variable=self.snap_roads).pack(
            side=tk.LEFT, padx=(10, 0)
        )
        ttk.Checkbutton(
            toolbar,
            text="Show grid",
            variable=self.show_grid,
            command=self.redraw,
        ).pack(side=tk.LEFT, padx=(10, 0))

        density_panel = ttk.Frame(toolbar)
        density_panel.pack(side=tk.LEFT, padx=(16, 0))
        ttk.Label(density_panel, text="District density").pack(side=tk.TOP, anchor=tk.W)
        ttk.Scale(
            density_panel,
            from_=0.1,
            to=1.0,
            orient=tk.HORIZONTAL,
            variable=self.density,
        ).pack(side=tk.TOP, fill=tk.X)

        ttk.Button(toolbar, text="Undo", command=self.undo_last).pack(side=tk.RIGHT)
        ttk.Button(toolbar, text="Clear", command=self.clear_all).pack(
            side=tk.RIGHT, padx=(0, 6)
        )

        self.canvas = tk.Canvas(
            frame,
            bg=self.CANVAS_BG,
            highlightthickness=1,
            highlightbackground="#101418",
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        status_bar = ttk.Label(
            frame,
            textvariable=self.status_text,
            relief=tk.SUNKEN,
            anchor=tk.W,
            padding=(6, 4),
        )
        status_bar.pack(fill=tk.X, pady=(8, 0))

    def _bind_events(self) -> None:
        self.canvas.bind("<ButtonPress-1>", self._on_left_press)
        self.canvas.bind("<B1-Motion>", self._on_left_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_left_release)
        self.canvas.bind("<Motion>", self._on_motion)

        self.canvas.bind("<ButtonPress-2>", self._on_pan_start)
        self.canvas.bind("<B2-Motion>", self._on_pan_drag)
        self.canvas.bind("<ButtonRelease-2>", self._on_pan_end)

        self.canvas.bind("<ButtonPress-3>", self._on_pan_start)
        self.canvas.bind("<B3-Motion>", self._on_pan_drag)
        self.canvas.bind("<ButtonRelease-3>", self._on_pan_end)

        self.canvas.bind("<MouseWheel>", self._on_mousewheel)
        self.canvas.bind("<Configure>", lambda _: self.redraw())

        self.root.bind("<Escape>", self._cancel_current)
        self.root.bind("<Control-z>", lambda _: self.undo_last())
        self.root.bind("<space>", lambda _: self._reset_view())

    def _initialize_camera(self) -> None:
        width = self.canvas.winfo_width()
        height = self.canvas.winfo_height()
        self.offset_x = width * 0.5
        self.offset_y = height * 0.5
        self.redraw()

    def _road_type(self) -> RoadType:
        selected = self.current_road_name.get()
        for road in ROAD_TYPES:
            if road.name == selected:
                return road
        return ROAD_TYPES[0]

    def world_to_screen(self, point: Point) -> Point:
        return point[0] * self.scale + self.offset_x, point[1] * self.scale + self.offset_y

    def screen_to_world(self, x: float, y: float) -> Point:
        return (x - self.offset_x) / self.scale, (y - self.offset_y) / self.scale

    def _distance(self, a: Point, b: Point) -> float:
        return math.dist(a, b)

    def _normalize(self, vec: Point) -> Point:
        vx, vy = vec
        n = math.hypot(vx, vy)
        if n < 1e-9:
            return 0.0, 0.0
        return vx / n, vy / n

    def _perp_left(self, vec: Point) -> Point:
        return -vec[1], vec[0]

    def _add(self, a: Point, b: Point) -> Point:
        return a[0] + b[0], a[1] + b[1]

    def _sub(self, a: Point, b: Point) -> Point:
        return a[0] - b[0], a[1] - b[1]

    def _mul(self, a: Point, s: float) -> Point:
        return a[0] * s, a[1] * s

    def _nearest_point_on_segment(self, p: Point, a: Point, b: Point) -> Point:
        ax, ay = a
        bx, by = b
        px, py = p
        abx = bx - ax
        aby = by - ay
        ab_len_sq = abx * abx + aby * aby
        if ab_len_sq <= 1e-9:
            return a
        t = ((px - ax) * abx + (py - ay) * aby) / ab_len_sq
        t = max(0.0, min(1.0, t))
        return ax + t * abx, ay + t * aby

    def _snap_grid_point(self, p: Point) -> Point:
        return (
            round(p[0] / self.GRID_SIZE) * self.GRID_SIZE,
            round(p[1] / self.GRID_SIZE) * self.GRID_SIZE,
        )

    def _snap_point(self, raw_world: Point, allow_road_snap: bool = True) -> Point:
        candidate = raw_world
        if self.snap_grid.get():
            candidate = self._snap_grid_point(raw_world)

        if not allow_road_snap or not self.snap_roads.get() or not self.roads:
            return candidate

        threshold = self.ROAD_SNAP_PIXELS / self.scale
        best: Point | None = None
        best_dist = threshold

        for road in self.roads:
            pts = road.points
            for i in range(len(pts) - 1):
                nearest = self._nearest_point_on_segment(raw_world, pts[i], pts[i + 1])
                d = self._distance(raw_world, nearest)
                if d < best_dist:
                    best = nearest
                    best_dist = d

        if best is None:
            return candidate

        if self.snap_grid.get() and self._distance(raw_world, candidate) <= best_dist:
            return candidate
        return best

    def _event_to_world(self, event: tk.Event) -> Point:
        raw = self.screen_to_world(event.x, event.y)
        shift_pressed = bool(event.state & 0x0001)

        if shift_pressed and self.drag_points:
            anchor = self.drag_points[-1]
            dx = raw[0] - anchor[0]
            dy = raw[1] - anchor[1]
            if abs(dx) >= abs(dy):
                raw = (raw[0], anchor[1])
            else:
                raw = (anchor[0], raw[1])
            return self._snap_point(raw, allow_road_snap=False)

        return self._snap_point(raw)

    def _append_drag_point(self, world_point: Point) -> None:
        if not self.drag_points:
            self.drag_points.append(world_point)
            return
        min_step = max(4.0 / self.scale, self.GRID_SIZE * 0.2)
        if self._distance(self.drag_points[-1], world_point) >= min_step:
            self.drag_points.append(world_point)

    def _on_left_press(self, event: tk.Event) -> None:
        if self.is_panning:
            return
        self.is_drawing = True
        self.drag_points = []
        self._append_drag_point(self._event_to_world(event))

        if self.current_tool.get() == "Road":
            self.status_text.set(
                "Painting road. Hold Shift for strict horizontal/vertical lock."
            )
        else:
            self.status_text.set(
                "Painting district polygon. Draw boundary and release to generate cells."
            )

        self.redraw()

    def _on_left_drag(self, event: tk.Event) -> None:
        if not self.is_drawing:
            return
        self._append_drag_point(self._event_to_world(event))
        self.redraw()

    def _on_left_release(self, event: tk.Event) -> None:
        if not self.is_drawing:
            return
        self.is_drawing = False
        self._append_drag_point(self._event_to_world(event))

        if self.current_tool.get() == "Road":
            self._finalize_road()
        else:
            self._finalize_district()

        self.drag_points = []
        self.redraw()

    def _on_motion(self, event: tk.Event) -> None:
        if self.is_drawing:
            self._append_drag_point(self._event_to_world(event))
            self.redraw()

    def _on_pan_start(self, event: tk.Event) -> None:
        self.is_panning = True
        self.pan_start = (event.x, event.y)
        self.status_text.set("Panning camera.")

    def _on_pan_drag(self, event: tk.Event) -> None:
        if not self.is_panning or self.pan_start is None:
            return
        dx = event.x - self.pan_start[0]
        dy = event.y - self.pan_start[1]
        self.offset_x += dx
        self.offset_y += dy
        self.pan_start = (event.x, event.y)
        self.redraw()

    def _on_pan_end(self, _event: tk.Event) -> None:
        self.is_panning = False
        self.pan_start = None
        self.status_text.set("Camera pan ended.")

    def _on_mousewheel(self, event: tk.Event) -> None:
        factor = 1.1 if event.delta > 0 else 0.9
        new_scale = max(0.2, min(5.0, self.scale * factor))
        if abs(new_scale - self.scale) < 1e-9:
            return

        cursor_world = self.screen_to_world(event.x, event.y)
        self.scale = new_scale
        self.offset_x = event.x - cursor_world[0] * self.scale
        self.offset_y = event.y - cursor_world[1] * self.scale
        self.status_text.set(f"Zoom: {self.scale:.2f}x")
        self.redraw()

    def _reset_view(self) -> None:
        self.scale = 1.0
        self._initialize_camera()
        self.status_text.set("View reset.")

    def _cancel_current(self, _event: tk.Event | None = None) -> None:
        self.is_drawing = False
        self.drag_points = []
        self.redraw()
        self.status_text.set("Current paint operation cancelled.")

    def _cleanup_path(self, points: list[Point]) -> list[Point]:
        result: list[Point] = []
        for p in points:
            if not result or self._distance(result[-1], p) > 1e-4:
                result.append(p)
        return result

    def _chaikin_smooth(self, points: list[Point], iterations: int = 2) -> list[Point]:
        if len(points) < 3:
            return points[:]
        result = points[:]
        for _ in range(iterations):
            if len(result) < 3:
                break
            nxt: list[Point] = [result[0]]
            for i in range(len(result) - 1):
                p0 = result[i]
                p1 = result[i + 1]
                q = (0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1])
                r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1])
                nxt.extend([q, r])
            nxt.append(result[-1])
            result = self._cleanup_path(nxt)
        return result

    def _resample_path(self, points: list[Point], spacing: float) -> list[Point]:
        if len(points) < 2:
            return points[:]
        output: list[Point] = [points[0]]
        carry = 0.0
        for i in range(len(points) - 1):
            a = points[i]
            b = points[i + 1]
            seg = self._sub(b, a)
            length = math.hypot(seg[0], seg[1])
            if length < 1e-6:
                continue
            direction = (seg[0] / length, seg[1] / length)
            pos = spacing - carry
            while pos < length:
                output.append((a[0] + direction[0] * pos, a[1] + direction[1] * pos))
                pos += spacing
            carry = max(0.0, length - (pos - spacing))
        if self._distance(output[-1], points[-1]) > 1e-4:
            output.append(points[-1])
        return self._cleanup_path(output)

    def _finalize_road(self) -> None:
        if len(self.drag_points) < 2:
            self.status_text.set("Road stroke ignored: not enough path length.")
            return

        clean = self._cleanup_path(self.drag_points)
        if len(clean) < 2:
            self.status_text.set("Road stroke ignored: points collapsed after snap.")
            return

        smooth = self._chaikin_smooth(clean, iterations=2)
        resampled = self._resample_path(smooth, spacing=max(8.0, self.GRID_SIZE * 0.35))
        if len(resampled) < 2:
            self.status_text.set("Road stroke ignored: smoothing collapsed the path.")
            return

        road = RoadStroke(road_type=self._road_type(), points=resampled)
        self.roads.append(road)
        self.action_stack.append(("road", len(self.roads) - 1))
        self.status_text.set(
            f"Placed curved {road.road_type.name} stroke with {len(resampled)} points."
        )

    def _finalize_district(self) -> None:
        if len(self.drag_points) < 3:
            self.status_text.set("District ignored: not enough boundary points.")
            return

        clean = self._cleanup_path(self.drag_points)
        if len(clean) < 3:
            self.status_text.set("District ignored: invalid boundary.")
            return

        district_poly = clean[:]
        if self._distance(district_poly[0], district_poly[-1]) > 1e-3:
            district_poly.append(district_poly[0])

        if len(district_poly) < 3:
            self.status_text.set("District ignored: invalid polygon.")
            return

        if self._polygon_area(district_poly) < 1200.0:
            self.status_text.set("District ignored: polygon area too small.")
            return

        density_value = max(0.1, min(1.0, float(self.density.get())))
        cells, debug = self._generate_cells_for_district(district_poly, density_value)

        district = District(polygon=district_poly, density=density_value, cells=cells)
        self.districts.append(district)
        self.action_stack.append(("district", len(self.districts) - 1))

        if cells:
            self.status_text.set(
                f"Placed district (density {density_value:.2f}). Generated {len(cells)} cells."
            )
        else:
            self.status_text.set(
                "No cells generated. "
                f"roads={debug['roads']} candidates={debug['candidates']} "
                f"outside={debug['outside']} area={debug['area']} contact={debug['contact']} "
                f"roadHit={debug['road_hit']} overlap={debug['overlap']}"
            )

    def _road_segments(self) -> list[tuple[Point, Point, float]]:
        segments: list[tuple[Point, Point, float]] = []
        for road in self.roads:
            for i in range(len(road.points) - 1):
                segments.append((road.points[i], road.points[i + 1], road.road_type.width))
        return segments

    def _build_road_aligned_cell(
        self,
        segment_start: Point,
        tangent: Point,
        normal: Point,
        along0: float,
        along1: float,
        road_half: float,
        side_sign: float,
        depth: float,
        taper: float,
    ) -> Polygon:
        front_offset = road_half + 0.8
        side_vec = self._mul(normal, side_sign)

        p0 = self._add(segment_start, self._mul(tangent, along0))
        p1 = self._add(segment_start, self._mul(tangent, along1))

        f0 = self._add(p0, self._mul(side_vec, front_offset))
        f1 = self._add(p1, self._mul(side_vec, front_offset))

        b0 = self._add(f0, self._add(self._mul(side_vec, depth), self._mul(tangent, -taper)))
        b1 = self._add(f1, self._add(self._mul(side_vec, depth), self._mul(tangent, taper)))

        return [f0, f1, b1, b0]

    def _generate_cells_for_district(self, polygon: Polygon, density: float) -> tuple[list[Cell], dict[str, int]]:
        roads = self._road_segments_in_or_near_polygon(polygon)
        debug = {
            "roads": len(roads),
            "candidates": 0,
            "outside": 0,
            "area": 0,
            "contact": 0,
            "road_hit": 0,
            "overlap": 0,
            "building": 0,
        }
        if not roads:
            return [], debug

        min_lot_width = self._lerp(9.0, 32.0, 1.0 - density)
        max_lot_width = self._lerp(14.0, 46.0, 1.0 - density)
        min_depth = self._lerp(10.0, 34.0, 1.0 - density)
        max_depth = self._lerp(16.0, 52.0, 1.0 - density)
        min_area = self._lerp(90.0, 1400.0, 1.0 - density)
        max_area = self._lerp(300.0, 3600.0, 1.0 - density)
        lot_gap = self._lerp(0.0, 0.8, 1.0 - density)

        cells: list[Cell] = []

        for seg_start, seg_end, width in roads:
            vec = self._sub(seg_end, seg_start)
            seg_len = math.hypot(vec[0], vec[1])
            if seg_len < min_lot_width * 0.8:
                continue

            tangent = (vec[0] / seg_len, vec[1] / seg_len)
            normal = self._perp_left(tangent)
            road_half = width * 0.5

            for side_sign in (-1.0, 1.0):
                along = 0.0
                while along < seg_len - min_lot_width:
                    lot_width = random.uniform(min_lot_width, max_lot_width)
                    next_along = min(seg_len, along + lot_width)
                    if next_along - along < min_lot_width * 0.75:
                        break

                    depth = random.uniform(min_depth, max_depth)
                    # taper=0 keeps side edges collinear between neighbors; small taper for trapezoids.
                    taper = 0.0 if random.random() < 0.55 else random.uniform(-lot_width * 0.14, lot_width * 0.14)
                    shape = "square" if abs(taper) < 0.25 else "trapezoid"

                    cell_poly = self._build_road_aligned_cell(
                        seg_start,
                        tangent,
                        normal,
                        along,
                        next_along,
                        road_half,
                        side_sign,
                        depth,
                        taper,
                    )
                    debug["candidates"] += 1

                    area = self._polygon_area(cell_poly)
                    if area < min_area or area > max_area:
                        debug["area"] += 1
                        along = next_along + lot_gap
                        continue

                    if not self._polygon_inside_polygon(cell_poly, polygon):
                        debug["outside"] += 1
                        along = next_along + lot_gap
                        continue

                    # Every cell must have road contact and a side parallel to road.
                    dist_to_road, nearest_half, nearest_tangent = self._distance_cell_to_nearest_road(cell_poly, roads)
                    if dist_to_road is None:
                        debug["contact"] += 1
                        along = next_along + lot_gap
                        continue
                    if dist_to_road > nearest_half + 3.2:
                        along = next_along + lot_gap
                        debug["contact"] += 1
                        continue
                    if dist_to_road < max(0.0, nearest_half - 0.65):
                        along = next_along + lot_gap
                        debug["contact"] += 1
                        continue
                    if not self._has_side_parallel_to_tangent(cell_poly, nearest_tangent, max_angle_deg=10.0):
                        along = next_along + lot_gap
                        debug["contact"] += 1
                        continue

                    if self._cell_intersects_roads(cell_poly, roads):
                        debug["road_hit"] += 1
                        along = next_along + lot_gap
                        continue

                    if any(self._convex_polygons_overlap_strict(cell_poly, c.polygon) for c in cells):
                        debug["overlap"] += 1
                        along = next_along + lot_gap
                        continue

                    inset_ratio = self._lerp(0.12, 0.2, 1.0 - density)
                    building_poly = self._inset_polygon(cell_poly, inset_ratio)
                    if len(building_poly) < 3 or self._polygon_area(building_poly) < min_area * 0.22:
                        debug["building"] += 1
                        along = next_along + lot_gap
                        continue

                    height = self._lerp(2.0, 30.0, density) + random.uniform(-1.0, 2.0)
                    height = max(1.0, height)

                    cells.append(
                        Cell(
                            shape=shape,
                            polygon=cell_poly,
                            building_polygon=building_poly,
                            height=height,
                            density=density,
                        )
                    )

                    along = next_along + lot_gap

        return cells, debug

    def _road_segments_in_or_near_polygon(self, polygon: Polygon) -> list[tuple[Point, Point, float]]:
        selected: list[tuple[Point, Point, float]] = []
        for a, b, width in self._road_segments():
            mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
            if self._point_in_polygon_or_boundary(a, polygon):
                selected.append((a, b, width))
                continue
            if self._point_in_polygon_or_boundary(b, polygon):
                selected.append((a, b, width))
                continue
            if self._point_in_polygon_or_boundary(mid, polygon):
                selected.append((a, b, width))
                continue

            hit = False
            for i in range(len(polygon)):
                p0 = polygon[i]
                p1 = polygon[(i + 1) % len(polygon)]
                if self._segments_cross_strict(a, b, p0, p1):
                    hit = True
                    break
            if hit:
                selected.append((a, b, width))
        return selected

    def _distance_point_to_segment(self, p: Point, a: Point, b: Point) -> float:
        near = self._nearest_point_on_segment(p, a, b)
        return self._distance(p, near)

    def _segment_distance(self, a1: Point, a2: Point, b1: Point, b2: Point) -> float:
        if self._segments_intersect(a1, a2, b1, b2):
            return 0.0
        p1 = self._distance_point_to_segment(a1, b1, b2)
        p2 = self._distance_point_to_segment(a2, b1, b2)
        p3 = self._distance_point_to_segment(b1, a1, a2)
        p4 = self._distance_point_to_segment(b2, a1, a2)
        return min(p1, p2, p3, p4)

    def _distance_cell_to_nearest_road(
        self, cell: Polygon, roads: list[tuple[Point, Point, float]]
    ) -> tuple[float | None, float, Point]:
        best_dist: float | None = None
        best_half = 0.0
        best_tangent = (1.0, 0.0)

        for i in range(len(cell)):
            a1 = cell[i]
            a2 = cell[(i + 1) % len(cell)]
            for b1, b2, width in roads:
                d = self._segment_distance(a1, a2, b1, b2)
                if best_dist is None or d < best_dist:
                    best_dist = d
                    best_half = width * 0.5
                    best_tangent = self._normalize(self._sub(b2, b1))

        return best_dist, best_half, best_tangent

    def _has_side_parallel_to_tangent(
        self, poly: Polygon, tangent: Point, max_angle_deg: float
    ) -> bool:
        t = self._normalize(tangent)
        if math.hypot(t[0], t[1]) < 1e-6:
            return False
        threshold = math.cos(math.radians(max_angle_deg))

        for i in range(len(poly)):
            edge = self._sub(poly[(i + 1) % len(poly)], poly[i])
            e = self._normalize(edge)
            if math.hypot(e[0], e[1]) < 1e-6:
                continue
            if abs(e[0] * t[0] + e[1] * t[1]) >= threshold:
                return True
        return False

    def _cell_intersects_roads(self, poly: Polygon, roads: list[tuple[Point, Point, float]]) -> bool:
        for i in range(len(poly)):
            a1 = poly[i]
            a2 = poly[(i + 1) % len(poly)]
            for b1, b2, width in roads:
                d = self._segment_distance(a1, a2, b1, b2)
                if d < width * 0.5 - 0.65:
                    return True

        return False

    def _polygon_inside_polygon(self, inner: Polygon, outer: Polygon) -> bool:
        for p in inner:
            if not self._point_in_polygon_or_boundary(p, outer):
                return False
        for i in range(len(inner)):
            a1 = inner[i]
            a2 = inner[(i + 1) % len(inner)]
            for j in range(len(outer)):
                b1 = outer[j]
                b2 = outer[(j + 1) % len(outer)]
                if self._segments_cross_strict(a1, a2, b1, b2):
                    return False
        return True

    def _point_on_segment(self, p: Point, a: Point, b: Point, eps: float = 1e-6) -> bool:
        cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if abs(cross) > eps:
            return False
        dot = (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1])
        return dot <= eps

    def _point_in_polygon_or_boundary(self, point: Point, poly: Polygon) -> bool:
        for i in range(len(poly)):
            if self._point_on_segment(point, poly[i], poly[(i + 1) % len(poly)]):
                return True
        return self._point_in_polygon(point, poly)

    def _segments_cross_strict(self, a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
        def orient(p: Point, q: Point, r: Point) -> float:
            return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

        o1 = orient(a1, a2, b1)
        o2 = orient(a1, a2, b2)
        o3 = orient(b1, b2, a1)
        o4 = orient(b1, b2, a2)
        return (o1 > 1e-9) != (o2 > 1e-9) and (o3 > 1e-9) != (o4 > 1e-9)

    def _convex_polygons_overlap_strict(self, a: Polygon, b: Polygon) -> bool:
        axes: list[Point] = []

        def add_axes(poly: Polygon) -> None:
            for i in range(len(poly)):
                edge = self._sub(poly[(i + 1) % len(poly)], poly[i])
                normal = self._normalize((-edge[1], edge[0]))
                if math.hypot(normal[0], normal[1]) > 1e-8:
                    axes.append(normal)

        add_axes(a)
        add_axes(b)

        eps = 1e-6
        for axis in axes:
            amin = min(p[0] * axis[0] + p[1] * axis[1] for p in a)
            amax = max(p[0] * axis[0] + p[1] * axis[1] for p in a)
            bmin = min(p[0] * axis[0] + p[1] * axis[1] for p in b)
            bmax = max(p[0] * axis[0] + p[1] * axis[1] for p in b)
            overlap = min(amax, bmax) - max(amin, bmin)
            if overlap <= eps:
                return False

        return True

    def _segments_intersect(self, a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
        def orient(p: Point, q: Point, r: Point) -> float:
            return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

        def on_seg(p: Point, q: Point, r: Point) -> bool:
            return (
                min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9
                and min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9
            )

        o1 = orient(a1, a2, b1)
        o2 = orient(a1, a2, b2)
        o3 = orient(b1, b2, a1)
        o4 = orient(b1, b2, a2)

        if (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0):
            return True

        if abs(o1) < 1e-9 and on_seg(a1, b1, a2):
            return True
        if abs(o2) < 1e-9 and on_seg(a1, b2, a2):
            return True
        if abs(o3) < 1e-9 and on_seg(b1, a1, b2):
            return True
        if abs(o4) < 1e-9 and on_seg(b1, a2, b2):
            return True

        return False

    def _point_in_polygon(self, point: Point, poly: Polygon) -> bool:
        x, y = point
        inside = False
        j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]
            xj, yj = poly[j]
            intersects = ((yi > y) != (yj > y)) and (
                x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            )
            if intersects:
                inside = not inside
            j = i
        return inside

    def _polygon_area(self, poly: Polygon) -> float:
        acc = 0.0
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            acc += x1 * y2 - x2 * y1
        return abs(acc) * 0.5

    def _inset_polygon(self, poly: Polygon, inset_ratio: float) -> Polygon:
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        result: Polygon = []
        for px, py in poly:
            vx = px - cx
            vy = py - cy
            result.append((cx + vx * (1.0 - inset_ratio), cy + vy * (1.0 - inset_ratio)))
        return result

    def _lerp(self, a: float, b: float, t: float) -> float:
        return a + (b - a) * t

    def undo_last(self) -> None:
        if not self.action_stack:
            self.status_text.set("Nothing to undo.")
            return

        action_type, _ = self.action_stack.pop()
        if action_type == "road" and self.roads:
            self.roads.pop()
            self.status_text.set("Removed last road stroke.")
        elif action_type == "district" and self.districts:
            self.districts.pop()
            self.status_text.set("Removed last district.")
        else:
            self.status_text.set("Undo stack mismatch; no changes removed.")

        self.redraw()

    def clear_all(self) -> None:
        self.roads.clear()
        self.districts.clear()
        self.action_stack.clear()
        self.drag_points = []
        self.is_drawing = False
        self.redraw()
        self.status_text.set("Cleared all roads, districts, cells, and buildings.")

    def redraw(self) -> None:
        self.canvas.delete("all")
        self._draw_grid()
        self._draw_districts()
        self._draw_roads()
        self._draw_drag_preview()

    def _draw_grid(self) -> None:
        if not self.show_grid.get():
            return

        w = self.canvas.winfo_width()
        h = self.canvas.winfo_height()
        if w <= 0 or h <= 0:
            return

        world_left, world_top = self.screen_to_world(0, 0)
        world_right, world_bottom = self.screen_to_world(w, h)

        minor = self.GRID_SIZE
        major = self.GRID_SIZE * 5.0

        start_x = math.floor(world_left / minor) * minor
        start_y = math.floor(world_top / minor) * minor

        x = start_x
        while x <= world_right:
            sx, _ = self.world_to_screen((x, 0.0))
            is_major = abs((x / major) - round(x / major)) < 1e-6
            self.canvas.create_line(
                sx,
                0,
                sx,
                h,
                fill=self.GRID_COLOR_MAJOR if is_major else self.GRID_COLOR_MINOR,
                width=1,
            )
            x += minor

        y = start_y
        while y <= world_bottom:
            _, sy = self.world_to_screen((0.0, y))
            is_major = abs((y / major) - round(y / major)) < 1e-6
            self.canvas.create_line(
                0,
                sy,
                w,
                sy,
                fill=self.GRID_COLOR_MAJOR if is_major else self.GRID_COLOR_MINOR,
                width=1,
            )
            y += minor

    def _draw_roads(self) -> None:
        for road in self.roads:
            if len(road.points) < 2:
                continue
            coords: list[float] = []
            for p in road.points:
                sx, sy = self.world_to_screen(p)
                coords.extend([sx, sy])
            self.canvas.create_line(
                *coords,
                fill=road.road_type.color,
                width=max(1.0, road.road_type.width * self.scale),
                capstyle=tk.ROUND,
                joinstyle=tk.ROUND,
                smooth=True,
                splinesteps=16,
            )

    def _draw_districts(self) -> None:
        for district in self.districts:
            d_coords: list[float] = []
            for p in district.polygon:
                sx, sy = self.world_to_screen(p)
                d_coords.extend([sx, sy])
            self.canvas.create_polygon(
                *d_coords,
                fill=self._density_to_color(district.density),
                outline="#4D755A",
                width=2,
                stipple="gray25",
            )

            for cell in district.cells:
                cell_coords: list[float] = []
                for p in cell.polygon:
                    sx, sy = self.world_to_screen(p)
                    cell_coords.extend([sx, sy])
                self.canvas.create_polygon(
                    *cell_coords,
                    fill="#B9D2A7",
                    outline="#3E5B3F",
                    width=1,
                )

                building_coords: list[float] = []
                for p in cell.building_polygon:
                    sx, sy = self.world_to_screen(p)
                    building_coords.extend([sx, sy])
                self.canvas.create_polygon(
                    *building_coords,
                    fill=self._building_color(cell.height),
                    outline="#22311F",
                    width=1,
                )

    def _draw_drag_preview(self) -> None:
        if len(self.drag_points) < 2:
            return

        coords: list[float] = []
        for p in self.drag_points:
            sx, sy = self.world_to_screen(p)
            coords.extend([sx, sy])

        if self.current_tool.get() == "Road":
            self.canvas.create_line(
                *coords,
                fill="#DDE3E8",
                width=max(1.0, self._road_type().width * self.scale),
                dash=(8, 6),
                capstyle=tk.ROUND,
                joinstyle=tk.ROUND,
                smooth=True,
                splinesteps=16,
            )
        else:
            closed_preview = coords[:]
            if len(self.drag_points) >= 3:
                sx0, sy0 = self.world_to_screen(self.drag_points[0])
                closed_preview.extend([sx0, sy0])
            self.canvas.create_line(
                *closed_preview,
                fill="#B6D1A5",
                width=2,
                dash=(6, 6),
                capstyle=tk.ROUND,
                joinstyle=tk.ROUND,
                smooth=True,
                splinesteps=16,
            )

    def _density_to_color(self, density: float) -> str:
        d = max(0.0, min(1.0, density))
        r = int(self._lerp(88, 32, d))
        g = int(self._lerp(130, 96, d))
        b = int(self._lerp(90, 54, d))
        return f"#{r:02x}{g:02x}{b:02x}"

    def _building_color(self, height: float) -> str:
        h = max(1.0, min(30.0, height))
        t = (h - 1.0) / 29.0
        r = int(self._lerp(205, 92, t))
        g = int(self._lerp(198, 104, t))
        b = int(self._lerp(177, 117, t))
        return f"#{r:02x}{g:02x}{b:02x}"


def main() -> None:
    root = tk.Tk()
    style = ttk.Style(root)
    if "clam" in style.theme_names():
        style.theme_use("clam")
    CityForgeApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
