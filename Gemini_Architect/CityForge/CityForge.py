"""CityForge

Street editor with road painting, pan/zoom camera, and polygon district painting.
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
    source: str = "manual"


@dataclass
class Cell:
    shape: str
    polygon: Polygon
    building_polygon: Polygon
    height: float
    population: int
    density: float


@dataclass
class District:
    polygon: Polygon
    density: float
    fill_mode: bool
    cells: list[Cell]


@dataclass
class ManualBuilding:
    polygon: Polygon
    building_polygon: Polygon
    height: float
    population: int


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
        self.max_height = tk.DoubleVar(value=120.0)
        self.size_randomness = tk.DoubleVar(value=0.28)
        self.status_text = tk.StringVar(
            value="Road mode: drag to paint curved roads. Hold Shift to lock H/V."
        )

        self.scale = 1.0
        self.offset_x = 0.0
        self.offset_y = 0.0

        self.roads: list[RoadStroke] = []
        self.districts: list[District] = []
        self.manual_buildings: list[ManualBuilding] = []
        self.main_spine: list[Point] | None = None
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
            toolbar,
            self.current_tool,
            self.current_tool.get(),
            "Road",
            "District",
            "Main Spine",
            "Manual Building",
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

        param_panel = ttk.Frame(toolbar)
        param_panel.pack(side=tk.LEFT, padx=(14, 0))
        ttk.Label(param_panel, text="Max height").pack(side=tk.TOP, anchor=tk.W)
        ttk.Scale(
            param_panel,
            from_=20.0,
            to=220.0,
            orient=tk.HORIZONTAL,
            variable=self.max_height,
        ).pack(side=tk.TOP, fill=tk.X)

        jitter_panel = ttk.Frame(toolbar)
        jitter_panel.pack(side=tk.LEFT, padx=(10, 0))
        ttk.Label(jitter_panel, text="Size randomness").pack(side=tk.TOP, anchor=tk.W)
        ttk.Scale(
            jitter_panel,
            from_=0.0,
            to=0.65,
            orient=tk.HORIZONTAL,
            variable=self.size_randomness,
        ).pack(side=tk.TOP, fill=tk.X)

        ttk.Button(toolbar, text="Undo", command=self.undo_last).pack(side=tk.RIGHT)
        ttk.Button(toolbar, text="Auto From Perimeter", command=self.auto_generate_from_perimeter).pack(
            side=tk.RIGHT, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Clear Spine", command=self.clear_main_spine).pack(
            side=tk.RIGHT, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Redraw Districts", command=self.redraw_districts).pack(
            side=tk.RIGHT, padx=(0, 6)
        )
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

        status_row = ttk.Frame(frame)
        status_row.pack(fill=tk.X, pady=(8, 0))

        self.status_entry = ttk.Entry(status_row, textvariable=self.status_text)
        self.status_entry.state(["readonly"])
        self.status_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.status_entry.bind("<Button-1>", self._select_status_text)

        ttk.Button(status_row, text="Copy", command=self._copy_status_to_clipboard).pack(
            side=tk.RIGHT, padx=(6, 0)
        )

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
        self.root.bind("<Control-c>", self._copy_status_to_clipboard)
        self.root.bind("<Control-Shift-C>", self._copy_status_to_clipboard)
        self.root.bind("<space>", lambda _: self._reset_view())

    def _select_status_text(self, _event: tk.Event) -> str:
        self.status_entry.selection_range(0, tk.END)
        self.status_entry.icursor(tk.END)
        return "break"

    def _copy_status_to_clipboard(self, _event: tk.Event | None = None) -> str:
        text = self.status_text.get()
        if text:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
        return "break"

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

        tool = self.current_tool.get()
        if tool == "Road":
            self.status_text.set(
                "Painting road. Hold Shift for strict horizontal/vertical lock."
            )
        elif tool == "District":
            self.status_text.set(
                "Painting district polygon. Draw boundary and release to generate cells."
            )
        elif tool == "Main Spine":
            self.status_text.set(
                "Draw one main city spine line. Auto From Perimeter will branch from it."
            )
        else:
            self.status_text.set(
                "Manual building mode: draw a polygon footprint and release."
            )

        self.redraw()

    def _on_left_drag(self, event: tk.Event) -> None:
        if not self.is_drawing:
            return
        world = self._event_to_world(event)
        self._append_drag_point(world)
        self.redraw()

    def _on_left_release(self, event: tk.Event) -> None:
        if not self.is_drawing:
            return
        self.is_drawing = False
        self._append_drag_point(self._event_to_world(event))

        tool = self.current_tool.get()
        if tool == "Road":
            self._finalize_road()
        elif tool == "District":
            self._finalize_district()
        elif tool == "Main Spine":
            self._finalize_main_spine()
        else:
            self._finalize_manual_building()

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
        resampled = self._resample_path(smooth, spacing=max(18.0, self.GRID_SIZE * 0.95))
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
        if len(district_poly) < 3:
            self.status_text.set("District ignored: invalid polygon.")
            return

        if self._polygon_area(district_poly) < 1200.0:
            self.status_text.set("District ignored: polygon area too small.")
            return

        for existing in self.districts:
            if self._polygons_overlap_nonzero_area(district_poly, existing.polygon):
                self.status_text.set(
                    "District ignored: districts cannot overlap existing districts."
                )
                return

        density_value = max(0.1, min(1.0, float(self.density.get())))
        fill_mode = density_value >= 0.97
        blocked = [b.polygon for b in self.manual_buildings]
        cells, debug = self._generate_cells_for_district(
            district_poly,
            density_value,
            blocked_polygons=blocked,
            force_fill=fill_mode,
        )

        district = District(
            polygon=district_poly,
            density=density_value,
            fill_mode=fill_mode,
            cells=cells,
        )
        self.districts.append(district)
        self.action_stack.append(("district", len(self.districts) - 1))

        if cells:
            fill_suffix = " (fill mode)" if fill_mode else ""
            self.status_text.set(
                f"Placed district (density {density_value:.2f}{fill_suffix}). Generated {len(cells)} cells."
            )
        else:
            self.status_text.set(
                "No cells generated. "
                f"roads={debug['roads']} candidates={debug['candidates']} "
                f"outside={debug['outside']} area={debug['area']} contact={debug['contact']} "
                f"roadHit={debug['road_hit']} overlap={debug['overlap']} short={debug['too_short']} "
                f"manual={debug['manual_block']}"
            )

    def _finalize_manual_building(self) -> None:
        if len(self.drag_points) < 3:
            self.status_text.set("Manual building ignored: draw a polygon with at least 3 points.")
            return

        poly = self._cleanup_path(self.drag_points)
        if len(poly) < 3:
            self.status_text.set("Manual building ignored: invalid polygon.")
            return
        area = self._polygon_area(poly)
        if area < 180.0:
            self.status_text.set("Manual building ignored: draw a larger footprint.")
            return

        inside_any = any(self._polygon_inside_polygon(poly, d.polygon) for d in self.districts)
        if not inside_any:
            self.status_text.set("Manual building ignored: must be inside a district.")
            return

        roads = self._road_segments()
        if self._cell_intersects_roads(poly, roads):
            self.status_text.set("Manual building ignored: intersects a road.")
            return

        for district in self.districts:
            for cell in district.cells:
                if self._convex_polygons_overlap_strict(poly, cell.building_polygon):
                    self.status_text.set("Manual building ignored: overlaps generated building.")
                    return

        for other in self.manual_buildings:
            if self._convex_polygons_overlap_strict(poly, other.polygon):
                self.status_text.set("Manual building ignored: overlaps manual building.")
                return

        local_density = self._density_at_point(self._polygon_centroid(poly))
        road_width = self._nearest_road_width(self._polygon_centroid(poly))
        building_poly = self._inset_polygon(poly, self._lerp(0.05, 0.12, 1.0 - local_density))
        if len(building_poly) < 3 or self._polygon_area(building_poly) < 120.0:
            self.status_text.set("Manual building ignored: polygon too narrow after setbacks.")
            return

        height, population = self._compute_height_population(
            footprint_area=self._polygon_area(building_poly),
            density=local_density,
            road_width=road_width,
        )
        self.manual_buildings.append(
            ManualBuilding(
                polygon=poly,
                building_polygon=building_poly,
                height=height,
                population=population,
            )
        )
        self.action_stack.append(("manual", len(self.manual_buildings) - 1))
        self.status_text.set(
            f"Placed manual building (height {height:.1f}m, pop {population}). Use Redraw Districts to update around it."
        )

    def _finalize_main_spine(self) -> None:
        if len(self.drag_points) < 2:
            self.status_text.set("Main spine ignored: not enough path length.")
            return
        clean = self._cleanup_path(self.drag_points)
        if len(clean) < 2:
            self.status_text.set("Main spine ignored: invalid path.")
            return
        smooth = self._chaikin_smooth(clean, iterations=1)
        self.main_spine = self._resample_path(smooth, spacing=max(20.0, self.GRID_SIZE))
        self.status_text.set(f"Main spine set with {len(self.main_spine)} points.")

    def clear_main_spine(self) -> None:
        self.main_spine = None
        self.redraw()
        self.status_text.set("Main spine cleared.")

    def auto_generate_from_perimeter(self) -> None:
        if not self.districts:
            self.status_text.set("Auto generation needs a perimeter district first.")
            return

        district = self.districts[-1]
        self._clear_autogen_roads()
        roads = self._generate_roads_for_polygon(
            district.polygon,
            district.density,
            self.main_spine,
        )
        if not roads:
            self.status_text.set("Auto generation failed: could not create roads in perimeter.")
            return

        before = len(self.roads)
        self.roads.extend(roads)
        generated_count = len(self.roads) - before

        blocked = [b.polygon for b in self.manual_buildings]
        cells, _ = self._generate_cells_for_district(
            district.polygon,
            district.density,
            blocked_polygons=blocked,
            force_fill=district.fill_mode,
        )
        district.cells = cells

        self.redraw()
        self.status_text.set(
            f"Auto generated {generated_count} roads and {len(cells)} cells from perimeter."
        )

    def _clear_autogen_roads(self) -> None:
        self.roads = [r for r in self.roads if r.source != "autogen"]

    def _polyline_segs(self, points: list[Point]) -> list[tuple[Point, Point]]:
        """Return all consecutive (a, b) segment pairs from a polyline."""
        return [(points[i], points[i + 1]) for i in range(len(points) - 1)]

    def _generate_roads_for_polygon(
        self,
        polygon: Polygon,
        density: float,
        main_spine: list[Point] | None,
    ) -> list[RoadStroke]:
        out: list[RoadStroke] = []

        # Scale branch length to polygon size so large districts get coverage.
        xmin, ymin, xmax, ymax = self._bbox(polygon)
        half_diag = math.hypot(xmax - xmin, ymax - ymin) * 0.5

        spine_type = ROAD_TYPES[0] if density >= 0.72 else ROAD_TYPES[1]
        if main_spine and len(main_spine) >= 2:
            spine_points = [p for p in main_spine if self._point_in_polygon_or_boundary(p, polygon)]
            if len(spine_points) < 2:
                spine_line = self._derive_spine_line(polygon, main_spine)
                if spine_line is None:
                    return out
                spine_points = self._curved_polyline_between(
                    spine_line[0],
                    spine_line[1],
                    bend_ratio=random.uniform(-0.08, 0.08),
                )
        else:
            spine_line = self._derive_spine_line(polygon, main_spine)
            if spine_line is None:
                return out
            spine_points = self._curved_polyline_between(
                spine_line[0],
                spine_line[1],
                bend_ratio=random.uniform(-0.1, 0.1),
            )

        spine_points = self._cleanup_path(spine_points)
        if len(spine_points) < 2:
            return out

        out.append(RoadStroke(road_type=spine_type, points=spine_points, source="autogen"))

        # Accumulate placed segments so subsequent roads stop before crossing.
        avoid_segs: list[tuple[Point, Point]] = self._polyline_segs(spine_points)

        # Phase 1: collectors branching from spine.
        collectors: list[RoadStroke] = []
        max_collectors = int(self._lerp(14.0, 28.0, density))
        branch_spacing = self._lerp(90.0, 40.0, density)
        branch_len = max(self._lerp(260.0, 160.0, density), half_diag * 0.70)
        for p, tangent in self._sample_polyline_points(spine_points, branch_spacing):
            if len(collectors) >= max_collectors:
                break
            normal = self._perp_left(tangent)
            for sign in (-1.0, 1.0):
                if len(collectors) >= max_collectors:
                    break
                if random.random() > self._lerp(0.85, 0.97, density):
                    continue
                angle = math.radians(random.uniform(-20.0, 20.0))
                heading = self._rotate(self._mul(normal, sign), angle)
                points = self._grow_curvy_road(
                    start=p,
                    direction=heading,
                    polygon=polygon,
                    target_len=branch_len,
                    step=self._lerp(34.0, 24.0, density),
                    curvature=self._lerp(0.16, 0.22, density),
                    avoid_segs=avoid_segs,
                )
                if len(points) >= 3:
                    avoid_segs.extend(self._polyline_segs(points))
                    collectors.append(RoadStroke(road_type=ROAD_TYPES[2], points=points, source="autogen"))

        out.extend(collectors)

        # Phase 2: local streets and dead ends from collectors.
        locals_out: list[RoadStroke] = []
        max_locals = int(self._lerp(22.0, 58.0, density))
        local_spacing = self._lerp(62.0, 30.0, density)
        local_len_thru = max(self._lerp(180.0, 100.0, density), half_diag * 0.45)
        local_len_dead = self._lerp(110.0, 65.0, density)
        for collector in collectors:
            if len(locals_out) >= max_locals:
                break
            for p, tangent in self._sample_polyline_points(collector.points, local_spacing):
                if len(locals_out) >= max_locals:
                    break
                if random.random() > self._lerp(0.72, 0.94, density):
                    continue
                side = -1.0 if random.random() < 0.5 else 1.0
                base = self._mul(self._perp_left(tangent), side)
                heading = self._rotate(base, math.radians(random.uniform(-35.0, 35.0)))

                is_dead_end = random.random() < self._lerp(0.25, 0.40, density)
                target = local_len_dead if is_dead_end else local_len_thru
                points = self._grow_curvy_road(
                    start=p,
                    direction=heading,
                    polygon=polygon,
                    target_len=target,
                    step=self._lerp(30.0, 20.0, density),
                    curvature=self._lerp(0.2, 0.28, density),
                    avoid_segs=avoid_segs,
                )
                if len(points) < 3:
                    continue

                avoid_segs.extend(self._polyline_segs(points))
                road_type = ROAD_TYPES[3] if is_dead_end else ROAD_TYPES[2]
                locals_out.append(RoadStroke(road_type=road_type, points=points, source="autogen"))

        out.extend(locals_out)

        # Hard cap to keep generation responsive.
        max_total = int(self._lerp(60.0, 140.0, density))
        return out[:max_total]

    def _derive_spine_line(
        self,
        polygon: Polygon,
        main_spine: list[Point] | None,
    ) -> tuple[Point, Point] | None:
        center = self._polygon_centroid(polygon)
        if main_spine and len(main_spine) >= 2:
            vec = self._sub(main_spine[-1], main_spine[0])
        else:
            xmin, ymin, xmax, ymax = self._bbox(polygon)
            if (xmax - xmin) >= (ymax - ymin):
                vec = (1.0, 0.0)
            else:
                vec = (0.0, 1.0)

        if math.hypot(vec[0], vec[1]) < 1e-6:
            vec = (1.0, 0.0)

        return self._line_polygon_segment(center, self._normalize(vec), polygon)

    def redraw_districts(self) -> None:
        blocked = [b.polygon for b in self.manual_buildings]
        total = 0
        for district in self.districts:
            cells, _ = self._generate_cells_for_district(
                district.polygon,
                district.density,
                blocked_polygons=blocked,
                force_fill=district.fill_mode,
            )
            district.cells = cells
            total += len(cells)
        self.redraw()
        self.status_text.set(
            f"Redrew {len(self.districts)} districts. Generated {total} cells. Manual buildings preserved."
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
        front_offset: float,
        side_sign: float,
        depth: float,
        taper: float,
    ) -> Polygon:
        side_vec = self._mul(normal, side_sign)

        p0 = self._add(segment_start, self._mul(tangent, along0))
        p1 = self._add(segment_start, self._mul(tangent, along1))

        f0 = self._add(p0, self._mul(side_vec, front_offset))
        f1 = self._add(p1, self._mul(side_vec, front_offset))

        b0 = self._add(f0, self._add(self._mul(side_vec, depth), self._mul(tangent, -taper)))
        b1 = self._add(f1, self._add(self._mul(side_vec, depth), self._mul(tangent, taper)))

        return [f0, f1, b1, b0]

    def _generate_cells_for_district(
        self,
        polygon: Polygon,
        density: float,
        blocked_polygons: list[Polygon] | None = None,
        force_fill: bool = False,
    ) -> tuple[list[Cell], dict[str, int]]:
        blocked = blocked_polygons or []
        roads = self._road_segments_in_or_near_polygon(polygon)
        all_roads = self._road_segments()
        if not roads and all_roads:
            roads = all_roads
        if len(roads) > 140:
            stride = int(math.ceil(len(roads) / 140.0))
            roads = roads[::max(1, stride)]
        debug = {
            "roads": len(roads),
            "candidates": 0,
            "outside": 0,
            "area": 0,
            "contact": 0,
            "road_hit": 0,
            "overlap": 0,
            "building": 0,
            "too_short": 0,
            "manual_block": 0,
        }
        if not roads:
            return [], debug

        district_area = max(1.0, self._polygon_area(polygon))
        max_cells = int(min(2200, max(120, district_area / self._lerp(220.0, 80.0, density))))
        max_candidates = max_cells * 16

        # Density controls occupancy and verticality more than lot size.
        base_min_width = self._lerp(13.0, 7.0, density)
        base_max_width = self._lerp(31.0, 16.0, density)
        base_min_depth = self._lerp(12.0, 10.0, density)
        base_max_depth = self._lerp(32.0, 18.0, density)

        min_area = max(38.0, base_min_width * base_min_depth * 0.42)
        max_area = base_max_width * base_max_depth * 2.1
        lot_gap = self._lerp(5.0, 0.15, density)
        placement_chance = self._lerp(0.45, 0.985, density)
        fill_mode = force_fill or density >= 0.97
        if fill_mode:
            lot_gap = 0.0
            placement_chance = 1.0

        cells: list[Cell] = []
        stop_generation = False

        for seg_start, seg_end, width in roads:
            vec = self._sub(seg_end, seg_start)
            seg_len = math.hypot(vec[0], vec[1])
            if seg_len < base_min_width * 0.8:
                debug["too_short"] += 1
                continue

            tangent = (vec[0] / seg_len, vec[1] / seg_len)
            normal = self._perp_left(tangent)
            road_half = width * 0.5

            # Link frontage lot scale to road type width.
            road_scale = self._clamp(self._lerp(0.85, 2.05, (width - 5.0) / 13.0), 0.7, 2.3)
            # High density packs rows tighter and adds more rows.
            row_count = int(round(self._lerp(1.2, 4.8, density) + self._lerp(0.0, 1.6, (width - 5.0) / 13.0)))
            row_count = max(1, min(6, row_count))
            dense_frontage = density >= 0.8 or fill_mode

            for side_sign in (-1.0, 1.0):
                for row_idx in range(row_count):
                    row_pitch = self._lerp(18.0, 7.2, density) * self._lerp(0.95, 1.2, road_scale - 0.7)
                    row_band = row_idx * row_pitch
                    row_dense = dense_frontage and row_idx < max(1, row_count - 1)
                    row_min_width = self._clamp(base_min_width * road_scale * (0.9 if row_dense else 1.0), 5.0, 90.0)
                    row_max_width = self._clamp(base_max_width * road_scale * (0.92 if row_dense else 1.05), row_min_width + 0.5, 130.0)
                    intervals = self._packed_segment_intervals(seg_len, row_min_width, row_max_width, dense=row_dense)
                    last_interval_end = 0.0

                    for along, next_along in intervals:
                        if len(cells) >= max_cells or debug["candidates"] >= max_candidates:
                            stop_generation = True
                            break
                        size_rand = self._size_random_factor(width)
                        if not row_dense and random.random() > placement_chance:
                            last_interval_end = next_along
                            continue

                        actual_width = next_along - along
                        if actual_width < max(4.5, row_min_width * 0.5):
                            last_interval_end = next_along
                            continue

                        depth = random.uniform(base_min_depth, base_max_depth) * road_scale * size_rand
                        depth = self._clamp(depth, 6.0, 130.0)
                        taper = 0.0 if row_dense or random.random() < 0.55 else random.uniform(-actual_width * 0.12, actual_width * 0.12)
                        shape = "square" if abs(taper) < 0.25 else "trapezoid"

                        cell_poly = self._build_road_aligned_cell(
                            seg_start,
                            tangent,
                            normal,
                            along,
                            next_along,
                            road_half + 0.8 + row_band,
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

                        # Accept if centroid is inside and at least half of vertices are inside.
                        _cell_centroid = self._polygon_centroid(cell_poly)
                        _in_count = sum(1 for _p in cell_poly if self._point_in_polygon_or_boundary(_p, polygon))
                        if not self._point_in_polygon_or_boundary(_cell_centroid, polygon) or _in_count < max(2, len(cell_poly) // 2):
                            debug["outside"] += 1
                            along = next_along + lot_gap
                            continue

                        dist_to_road, nearest_half, nearest_tangent = self._distance_cell_to_nearest_road(cell_poly, roads)
                        if dist_to_road is None:
                            debug["contact"] += 1
                            along = next_along + lot_gap
                            continue
                        contact_max = nearest_half + self._lerp(5.0, 22.0, min(1.0, row_idx / max(1, row_count - 1)))
                        if dist_to_road > contact_max:
                            along = next_along + lot_gap
                            debug["contact"] += 1
                            continue
                        if dist_to_road < max(0.0, nearest_half - 0.75):
                            along = next_along + lot_gap
                            debug["contact"] += 1
                            continue
                        if not self._has_side_parallel_to_tangent(cell_poly, nearest_tangent, max_angle_deg=12.0):
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

                        if any(self._convex_polygons_overlap_strict(cell_poly, blocked_poly) for blocked_poly in blocked):
                            debug["manual_block"] += 1
                            along = next_along + lot_gap
                            continue

                        inset_ratio = self._lerp(0.1, 0.012, density)
                        if row_dense:
                            inset_ratio = 0.0
                        building_poly = self._inset_polygon(cell_poly, inset_ratio)
                        if len(building_poly) < 3 or self._polygon_area(building_poly) < min_area * 0.18:
                            debug["building"] += 1
                            last_interval_end = next_along
                            continue

                        height, population = self._compute_height_population(
                            footprint_area=self._polygon_area(building_poly),
                            density=density,
                            road_width=width,
                        )

                        cells.append(
                            Cell(
                                shape=shape,
                                polygon=cell_poly,
                                building_polygon=building_poly,
                                height=height,
                                population=population,
                                density=density,
                            )
                        )

                        last_interval_end = next_along

                    if fill_mode and last_interval_end < seg_len - base_min_width * 0.45:
                        tail_width = seg_len - last_interval_end
                        if tail_width >= base_min_width * 0.5:
                            depth = random.uniform(base_min_depth, base_max_depth) * road_scale
                            tail_poly = self._build_road_aligned_cell(
                                seg_start,
                                tangent,
                                normal,
                                last_interval_end,
                                seg_len,
                                road_half + 0.8 + row_band,
                                side_sign,
                                depth,
                                0.0,
                            )
                            if (
                                self._polygon_area(tail_poly) >= min_area
                                and self._polygon_area(tail_poly) <= max_area
                                and self._polygon_inside_polygon(tail_poly, polygon)
                                and not self._cell_intersects_roads(tail_poly, roads)
                                and not any(self._convex_polygons_overlap_strict(tail_poly, c.polygon) for c in cells)
                                and not any(self._convex_polygons_overlap_strict(tail_poly, blocked_poly) for blocked_poly in blocked)
                            ):
                                tail_inset = 0.0 if row_dense else self._lerp(0.1, 0.012, density)
                                building_poly = self._inset_polygon(tail_poly, tail_inset)
                                if len(building_poly) >= 3 and self._polygon_area(building_poly) > min_area * 0.16:
                                    height, population = self._compute_height_population(
                                        footprint_area=self._polygon_area(building_poly),
                                        density=density,
                                        road_width=width,
                                    )
                                    cells.append(
                                        Cell(
                                            shape="trapezoid",
                                            polygon=tail_poly,
                                            building_polygon=building_poly,
                                            height=height,
                                            population=population,
                                            density=density,
                                        )
                                    )

                    if stop_generation:
                        break

                if stop_generation:
                    break

            if stop_generation:
                break

        if len(cells) < max_cells:
            added = self._infill_cells_for_gaps(
                polygon=polygon,
                density=density,
                roads=roads,
                cells=cells,
                blocked=blocked,
                max_extra=max_cells - len(cells),
            )
            if added > 0:
                debug["candidates"] += added

        return cells, debug

    def _infill_cells_for_gaps(
        self,
        polygon: Polygon,
        density: float,
        roads: list[tuple[Point, Point, float]],
        cells: list[Cell],
        blocked: list[Polygon],
        max_extra: int,
    ) -> int:
        if max_extra <= 0:
            return 0

        added = 0
        target_rows = max(1, int(round(self._lerp(1.0, 3.0, density))))
        for seg_start, seg_end, width in roads:
            if added >= max_extra:
                break
            vec = self._sub(seg_end, seg_start)
            seg_len = math.hypot(vec[0], vec[1])
            if seg_len < 16.0:
                continue
            tangent = (vec[0] / seg_len, vec[1] / seg_len)
            normal = self._perp_left(tangent)
            road_half = width * 0.5

            road_scale = self._clamp(self._lerp(0.8, 1.8, (width - 5.0) / 13.0), 0.7, 2.0)
            infill_w = self._clamp(self._lerp(10.0, 6.0, density) * road_scale, 4.0, 34.0)
            infill_d = self._clamp(self._lerp(16.0, 10.0, density) * road_scale, 5.0, 42.0)
            row_pitch = self._lerp(15.0, 8.0, density)

            for side_sign in (-1.0, 1.0):
                for row in range(target_rows):
                    if added >= max_extra:
                        break
                    row_offset = road_half + 0.8 + row * row_pitch
                    intervals = self._packed_segment_intervals(
                        seg_len,
                        infill_w * 0.75,
                        infill_w * 1.15,
                        dense=True,
                    )
                    for along0, along1 in intervals:
                        if added >= max_extra:
                            break
                        cell_poly = self._build_road_aligned_cell(
                            seg_start,
                            tangent,
                            normal,
                            along0,
                            along1,
                            row_offset,
                            side_sign,
                            infill_d,
                            0.0,
                        )
                        area = self._polygon_area(cell_poly)
                        if area < 30.0:
                            continue
                        _ic = self._polygon_centroid(cell_poly)
                        _iv = sum(1 for _p in cell_poly if self._point_in_polygon_or_boundary(_p, polygon))
                        if not self._point_in_polygon_or_boundary(_ic, polygon) or _iv < max(2, len(cell_poly) // 2):
                            continue
                        if self._cell_intersects_roads(cell_poly, roads):
                            continue
                        if any(self._convex_polygons_overlap_strict(cell_poly, c.polygon) for c in cells):
                            continue
                        if any(self._convex_polygons_overlap_strict(cell_poly, b) for b in blocked):
                            continue

                        inset = 0.0 if density >= 0.78 else self._lerp(0.08, 0.02, density)
                        building_poly = self._inset_polygon(cell_poly, inset)
                        if len(building_poly) < 3 or self._polygon_area(building_poly) < 24.0:
                            continue

                        height, population = self._compute_height_population(
                            footprint_area=self._polygon_area(building_poly),
                            density=density,
                            road_width=width,
                        )
                        cells.append(
                            Cell(
                                shape="square",
                                polygon=cell_poly,
                                building_polygon=building_poly,
                                height=height,
                                population=population,
                                density=density,
                            )
                        )
                        added += 1
        return added

    def _road_segments_in_or_near_polygon(self, polygon: Polygon) -> list[tuple[Point, Point, float]]:
        selected: list[tuple[Point, Point, float]] = []
        for a, b, width in self._road_segments():
            mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
            # Accept segments that are close enough to district edge, not only strictly intersecting/inside.
            near_edge = False
            for i in range(len(polygon)):
                p0 = polygon[i]
                p1 = polygon[(i + 1) % len(polygon)]
                if self._segment_distance(a, b, p0, p1) <= max(6.0, width):
                    near_edge = True
                    break

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
            if hit or near_edge:
                selected.append((a, b, width))
        return selected

    def _distance_point_to_segment(self, p: Point, a: Point, b: Point) -> float:
        near = self._nearest_point_on_segment(p, a, b)
        return self._distance(p, near)

    def _cross2(self, a: Point, b: Point) -> float:
        return a[0] * b[1] - a[1] * b[0]

    def _line_polygon_segment(
        self,
        center: Point,
        direction: Point,
        polygon: Polygon,
    ) -> tuple[Point, Point] | None:
        d = self._normalize(direction)
        if math.hypot(d[0], d[1]) < 1e-8:
            return None

        ts: list[float] = []
        for i in range(len(polygon)):
            a = polygon[i]
            b = polygon[(i + 1) % len(polygon)]
            e = self._sub(b, a)
            denom = self._cross2(d, e)
            if abs(denom) < 1e-9:
                continue
            ac = self._sub(a, center)
            t = self._cross2(ac, e) / denom
            u = self._cross2(ac, d) / denom
            if -1e-6 <= u <= 1.0 + 1e-6:
                ts.append(t)

        if len(ts) < 2:
            return None
        tmin = min(ts)
        tmax = max(ts)
        if tmax - tmin < 1e-4:
            return None
        p0 = self._add(center, self._mul(d, tmin))
        p1 = self._add(center, self._mul(d, tmax))
        return p0, p1

    def _sample_line_points(
        self,
        start: Point,
        end: Point,
        spacing: float,
    ) -> list[tuple[Point, Point]]:
        vec = self._sub(end, start)
        length = math.hypot(vec[0], vec[1])
        if length < 1e-8:
            return []
        tangent = (vec[0] / length, vec[1] / length)

        points: list[tuple[Point, Point]] = []
        s = 0.0
        while s <= length:
            p = self._add(start, self._mul(tangent, s))
            points.append((p, tangent))
            s += max(8.0, spacing)
        return points

    def _sample_polyline_points(
        self,
        points: list[Point],
        spacing: float,
    ) -> list[tuple[Point, Point]]:
        if len(points) < 2:
            return []
        out: list[tuple[Point, Point]] = []
        carry = 0.0
        step = max(8.0, spacing)
        for i in range(len(points) - 1):
            a = points[i]
            b = points[i + 1]
            seg = self._sub(b, a)
            length = math.hypot(seg[0], seg[1])
            if length < 1e-8:
                continue
            tangent = (seg[0] / length, seg[1] / length)
            s = step - carry
            while s < length:
                p = self._add(a, self._mul(tangent, s))
                out.append((p, tangent))
                s += step
            carry = max(0.0, length - (s - step))
        return out

    def _grow_curvy_road(
        self,
        start: Point,
        direction: Point,
        polygon: Polygon,
        target_len: float,
        step: float,
        curvature: float,
        avoid_segs: list[tuple[Point, Point]] | None = None,
    ) -> list[Point]:
        avoid = avoid_segs or []
        points: list[Point] = [start]
        heading = self._normalize(direction)
        if math.hypot(heading[0], heading[1]) < 1e-8:
            return points

        # Grace distance: the first few steps are allowed to leave the
        # parent road without triggering the avoid-intersection check.
        # This prevents the start point (which lies on the parent) from
        # being immediately blocked by the parent's own segments.
        grace_dist = step * 2.5

        traveled = 0.0
        while traveled < target_len:
            turn = random.uniform(-curvature, curvature)
            heading = self._normalize(self._rotate(heading, turn))
            next_p = self._add(points[-1], self._mul(heading, step))
            if not self._point_in_polygon_or_boundary(next_p, polygon):
                break
            # Only check avoid-segments once we've cleared the parent road.
            if avoid and traveled >= grace_dist:
                if any(self._segments_intersect(points[-1], next_p, a, b) for a, b in avoid):
                    break
            points.append(next_p)
            traveled += step

        if len(points) >= 3:
            points = self._chaikin_smooth(points, iterations=1)
            points = self._cleanup_path(points)
        return points

    def _rotate(self, v: Point, angle: float) -> Point:
        c = math.cos(angle)
        s = math.sin(angle)
        return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)

    def _curved_polyline_between(self, a: Point, b: Point, bend_ratio: float) -> list[Point]:
        vec = self._sub(b, a)
        length = math.hypot(vec[0], vec[1])
        if length < 1e-6:
            return [a, b]
        tangent = (vec[0] / length, vec[1] / length)
        normal = self._perp_left(tangent)
        mid = self._mul(self._add(a, b), 0.5)
        bulge = length * bend_ratio
        ctrl = self._add(mid, self._mul(normal, bulge))
        return [a, ctrl, b]

    def _ray_to_polygon_boundary(self, start: Point, direction: Point, polygon: Polygon) -> float | None:
        d = self._normalize(direction)
        if math.hypot(d[0], d[1]) < 1e-8:
            return None
        best_t: float | None = None
        for i in range(len(polygon)):
            a = polygon[i]
            b = polygon[(i + 1) % len(polygon)]
            e = self._sub(b, a)
            denom = self._cross2(d, e)
            if abs(denom) < 1e-9:
                continue
            ac = self._sub(a, start)
            t = self._cross2(ac, e) / denom
            u = self._cross2(ac, d) / denom
            if t > 1e-6 and -1e-6 <= u <= 1.0 + 1e-6:
                if best_t is None or t < best_t:
                    best_t = t
        return best_t

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

    def _point_strictly_in_polygon(self, point: Point, poly: Polygon) -> bool:
        for i in range(len(poly)):
            if self._point_on_segment(point, poly[i], poly[(i + 1) % len(poly)]):
                return False
        return self._point_in_polygon(point, poly)

    def _polygons_overlap_nonzero_area(self, a: Polygon, b: Polygon) -> bool:
        for i in range(len(a)):
            a1 = a[i]
            a2 = a[(i + 1) % len(a)]
            for j in range(len(b)):
                b1 = b[j]
                b2 = b[(j + 1) % len(b)]
                if self._segments_cross_strict(a1, a2, b1, b2):
                    return True
        if any(self._point_strictly_in_polygon(p, b) for p in a):
            return True
        if any(self._point_strictly_in_polygon(p, a) for p in b):
            return True
        return False

    def _rect_from_diagonal(self, p0: Point, p1: Point) -> Polygon:
        x0, y0 = p0
        x1, y1 = p1
        xmin, xmax = min(x0, x1), max(x0, x1)
        ymin, ymax = min(y0, y1), max(y0, y1)
        return [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]

    def _polygon_centroid(self, poly: Polygon) -> Point:
        x = sum(p[0] for p in poly) / len(poly)
        y = sum(p[1] for p in poly) / len(poly)
        return x, y

    def _density_at_point(self, point: Point) -> float:
        for district in reversed(self.districts):
            if self._point_in_polygon_or_boundary(point, district.polygon):
                return district.density
        return max(0.1, min(1.0, float(self.density.get())))

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

    def _bbox(self, poly: Polygon) -> tuple[float, float, float, float]:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return min(xs), min(ys), max(xs), max(ys)

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

    def _clamp(self, value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, value))

    def _size_random_factor(self, road_width: float) -> float:
        jitter = self._clamp(float(self.size_randomness.get()), 0.0, 0.8)
        road_bias = self._clamp((road_width - 5.0) / 13.0, 0.0, 1.0)
        # Big roads skew a bit bigger on average but still allow small outcomes.
        center = self._lerp(0.98, 1.1, road_bias)
        low = max(0.45, center - jitter)
        high = min(1.9, center + jitter)
        if random.random() < 0.16:
            return random.uniform(0.55, 0.9)
        if random.random() < 0.12:
            return random.uniform(1.2, 1.75)
        return random.uniform(low, high)

    def _nearest_road_width(self, point: Point) -> float:
        roads = self._road_segments()
        if not roads:
            return 8.0
        best = float("inf")
        best_width = 8.0
        for a, b, width in roads:
            d = self._distance_point_to_segment(point, a, b)
            if d < best:
                best = d
                best_width = width
        return best_width

    def _compute_height_population(
        self,
        footprint_area: float,
        density: float,
        road_width: float,
    ) -> tuple[float, int]:
        road_bias = self._clamp((road_width - 5.0) / 13.0, 0.0, 1.0)
        max_h = self._clamp(float(self.max_height.get()), 8.0, 400.0)

        base_h = self._lerp(4.5, 78.0, density)
        road_h = self._lerp(0.8, 1.35, road_bias)
        height = base_h * road_h * random.uniform(0.78, 1.28)
        height = self._clamp(height, 3.0, max_h)

        floors = max(1, int(round(height / 3.2)))
        # Assume one model unit ~ 1.4m for rough occupancy conversion.
        footprint_m2 = max(30.0, footprint_area * 1.4)
        gross_floor_area = footprint_m2 * floors * self._lerp(0.68, 0.88, density)
        ppl_per_m2 = self._lerp(0.013, 0.028, density) * self._lerp(0.9, 1.2, road_bias)
        population = int(round(gross_floor_area * ppl_per_m2 * random.uniform(0.75, 1.3)))
        population = max(1, population)
        return height, population

    def _packed_segment_intervals(
        self,
        seg_len: float,
        min_width: float,
        max_width: float,
        dense: bool,
    ) -> list[tuple[float, float]]:
        if seg_len <= min_width * 0.55:
            return []

        if dense:
            target = self._clamp((min_width + max_width) * 0.42, min_width, max_width)
            count = max(1, int(round(seg_len / max(target, 1e-6))))
            count = max(count, int(seg_len / max(min_width * 1.15, 1.0)))
            intervals: list[tuple[float, float]] = []
            cursor = 0.0
            for index in range(count):
                remaining = seg_len - cursor
                remaining_count = count - index
                width = remaining / remaining_count
                if width < min_width * 0.55:
                    break
                intervals.append((cursor, min(seg_len, cursor + width)))
                cursor += width
            return intervals

        intervals = []
        cursor = 0.0
        while cursor < seg_len - min_width * 0.55:
            width = random.uniform(min_width, max_width)
            nxt = min(seg_len, cursor + width)
            if nxt - cursor < min_width * 0.55:
                break
            intervals.append((cursor, nxt))
            cursor = nxt
        return intervals

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
        elif action_type == "manual" and self.manual_buildings:
            self.manual_buildings.pop()
            self.status_text.set("Removed last manual building.")
        else:
            self.status_text.set("Undo stack mismatch; no changes removed.")

        self.redraw()

    def clear_all(self) -> None:
        self.roads.clear()
        self.districts.clear()
        self.manual_buildings.clear()
        self.action_stack.clear()
        self.drag_points = []
        self.is_drawing = False
        self.redraw()
        self.status_text.set("Cleared all roads, districts, cells, and buildings.")

    def redraw(self) -> None:
        self.canvas.delete("all")
        self._draw_grid()
        self._draw_districts()
        self._draw_manual_buildings()
        self._draw_main_spine()
        self._draw_roads()
        self._draw_drag_preview()

    def _draw_main_spine(self) -> None:
        if not self.main_spine or len(self.main_spine) < 2:
            return
        coords: list[float] = []
        for p in self.main_spine:
            sx, sy = self.world_to_screen(p)
            coords.extend([sx, sy])
        self.canvas.create_line(
            *coords,
            fill="#E6B450",
            width=max(1.0, 6.0 * self.scale),
            dash=(8, 5),
            capstyle=tk.ROUND,
            joinstyle=tk.ROUND,
            smooth=True,
            splinesteps=12,
        )

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

    def _draw_manual_buildings(self) -> None:
        for building in self.manual_buildings:
            coords: list[float] = []
            for p in building.polygon:
                sx, sy = self.world_to_screen(p)
                coords.extend([sx, sy])
            self.canvas.create_polygon(
                *coords,
                fill="#D5B295",
                outline="#4F2D1A",
                width=2,
            )

            bcoords: list[float] = []
            for p in building.building_polygon:
                sx, sy = self.world_to_screen(p)
                bcoords.extend([sx, sy])
            self.canvas.create_polygon(
                *bcoords,
                fill="#B86D42",
                outline="#4A2615",
                width=1,
            )

    def _draw_drag_preview(self) -> None:
        if len(self.drag_points) < 2:
            return

        coords: list[float] = []
        for p in self.drag_points:
            sx, sy = self.world_to_screen(p)
            coords.extend([sx, sy])

        tool = self.current_tool.get()
        if tool == "Road":
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
        elif tool == "District":
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
        elif tool == "Main Spine":
            self.canvas.create_line(
                *coords,
                fill="#FFD27D",
                width=max(1.0, 7.0 * self.scale),
                dash=(7, 4),
                capstyle=tk.ROUND,
                joinstyle=tk.ROUND,
                smooth=True,
                splinesteps=16,
            )
        elif len(self.drag_points) >= 2:
            closed_preview = coords[:]
            if len(self.drag_points) >= 3:
                sx0, sy0 = self.world_to_screen(self.drag_points[0])
                closed_preview.extend([sx0, sy0])
            self.canvas.create_line(
                *closed_preview,
                fill="#CF9B79",
                width=2,
                dash=(5, 4),
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
