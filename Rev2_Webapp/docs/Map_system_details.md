# PART 1: Data Architecture & File Management System

**Project Name:** `Gemini-Atlas-Protocol`
**Target Host:** Raspberry Pi 3B (serving static files via NGINX/Apache/Node)
**Client:** Modern Web Browser (WebGL/Canvas support required)

## 1. Directory Structure

The system relies on a strict hierarchical directory structure to allow "Lazy Loading" (loading only what is needed) to save memory on the client and bandwidth on the RPi.

```text
/campaign_root
  /assets
    /textures       # Diffuse, Bump, Specular maps (WebP/JPG)
    /tiles          # Z/X/Y tiled images for city maps
    /icons          # UI icons (SVG/PNG)
  /data
    universe.json   # Global configuration & Index
    /sectors
      sector_01.json
      sector_02.json
    /systems
      sys_kilter.json
      sys_void.json
    /bodies
      body_tirra.json
    /locations
      loc_newhaven.json

```

## 2. Data Schemas (JSON Standards)

### A. The Universe Index (`universe.json`)

Entry point for the application.

```json
{
  "campaign_name": "Gemini: The Iron & The Ether",
  "global_settings": {
    "jump_range_calculation": "euclidean",
    "map_units": "light_years"
  },
  "sectors_index": [
    { "id": "sec_04", "name": "Sector 4 (The Drift)", "file": "data/sectors/sector_04.json" },
    { "id": "sec_06", "name": "Sector 6 (Deep Dark)", "file": "data/sectors/sector_06.json" }
  ]
}

```

### B. Sector Map (`sector_XX.json`)

Defines the 2D node graph (Elite Dangerous style).

```json
{
  "id": "sec_04",
  "dimensions": { "width": 1000, "height": 1000 },
  "systems": [
    {
      "id": "sys_kilter",
      "name": "Kilter System",
      "coordinates": { "x": 120, "y": 450 },
      "political_alignment": "Lower_Sympathizer",
      "status": "Colonized",
      "file": "data/systems/sys_kilter.json"
    }
  ],
  "jump_lanes": [
    { "from": "sys_kilter", "to": "sys_void", "type": "Stable", "distance": 12.5 }
  ]
}

```

### C. System Orrery (`sys_XX.json`)

Defines the celestial hierarchy. Note: Positions are relative for the UI (Order index), not realistic orbital mechanics.

```json
{
  "id": "sys_kilter",
  "star": {
    "name": "Kilter Prime",
    "spectral_class": "G2V",
    "radius_km": 696000,
    "color_hex": "#ffcc00"
  },
  "orbitals": [
    {
      "id": "body_tirra",
      "name": "Tirra",
      "type": "Planet",
      "orbit_index": 1,
      "file": "data/bodies/body_tirra.json"
    }
  ]
}

```

### D. Planetary Body (`body_XX.json`)

Contains 3D rendering data and Points of Interest (POIs).

```json
{
  "id": "body_tirra",
  "render_data": {
    "texture_diffuse": "assets/textures/tirra_diff.webp",
    "texture_bump": "assets/textures/tirra_bump.webp",
    "atmosphere_color": "#88aaff",
    "rotation_speed": 0.005
  },
  "pois": [
    {
      "id": "loc_newhaven",
      "name": "Newhaven City",
      "type": "Settlement",
      "coordinates_3d": { "lat": 45.12, "lon": -12.4 },
      "description": "Industrial hub.",
      "link_to_map": "data/locations/loc_newhaven.json"
    }
  ]
}

```

### E. Detailed Location (`loc_XX.json`)

Used for tiled city maps (Leaflet/Google Maps style).

```json
{
  "id": "loc_newhaven",
  "tile_source": "assets/tiles/newhaven/{z}/{x}/{y}.png",
  "min_zoom": 1,
  "max_zoom": 5,
  "markers": [
    {
      "coords": [1024, 512],
      "label": "The Rusty Anchor Bar",
      "npc_presence": ["Markus Revell"]
    }
  ]
}

```

---

# PART 2: PC Tool Specification ("Gemini Architect")

**Objective:** A desktop application to visually create, edit, and export the JSON structures defined above.
**Tech Stack Recommendation:** Electron (Node.js + HTML/JS) or Python (PyQt/Tkinter) if preferred.

## 1. Core Modules

### Module A: The Galaxy Plotter (2D Canvas)

* **Visual Interface:** Infinite 2D grid.
* **Functionality:**
* **Drag & Drop:** Drag "System Nodes" from a sidebar onto the grid.
* **Auto-Link:** Tool to draw lines between systems to create "Jump Lanes".
* **Distance Calc:** Automatically calculate distance between nodes based on grid pixels/light-years ratio.
* **Metadata Editor:** Clicking a node opens a side panel to edit Name, Allegiance, and Link the System JSON file.



### Module B: The Orrery Builder (Tree Editor)

* **Visual Interface:** Hierarchical tree view (Star -> Planet -> Moon).
* **Functionality:**
* **Drag & Drop:** Reorder planets.
* **Asset Link:** Assign "Texture" files to specific planets.
* **Preview:** Small 2D icon generation for the web client.



### Module C: Planetary Studio (3D Viewport)

* **Visual Interface:** Real-time 3D sphere preview (using Three.js inside the Electron app).
* **Functionality:**
* **Texture Mapper:** Load a rectangular (equirectangular) texture map and wrap it around the sphere.
* **Pin Dropper:** Click anywhere on the 3D sphere to place a POI. The tool must calculate the Lat/Lon automatically and save it to the JSON.
* **Atmosphere Sliders:** Adjust color/opacity of the atmospheric glow.



### Module D: The Cartographer (Tile Slicer)

* **Visual Interface:** High-res image viewer.
* **Functionality:**
* **Input:** Accept huge images (e.g., 8k x 8k PNG maps of cities).
* **Slicing Engine:** Automatically slice the image into 256x256 tiles for various zoom levels (0 to 4).
* **Export:** Save tiles into the standard folder structure (`/assets/tiles/name/z/x/y.png`).
* **Marker Editor:** Place pins on the 2D map for specific buildings/NPCs.



## 2. The "Export for RPi" Workflow

The tool must have a "Deploy" or "Build" button that performs the following:

1. **Validation:** Check for broken links (e.g., a system linking to a non-existent body file).
2. **Optimization:**
* Minify all JSON files (remove whitespace to save bytes).
* Convert heavy PNG textures to WebP (better compression for the web).


3. **Packaging:** Generate the final folder structure ready to be copied to the Raspberry Pi.

## 3. UX/UI Requirements for the Player Client (The Web Viewer)

*Note: This is what the RPi serves, but the PC tool must preview it.*

* **Navigation Stack:** A breadcrumb bar at the top (Sector > System > Planet > City).
* **Dynamic Jump Range:**
* Input field for "Current Ship Range".
* Visual feedback on the Sector Map: Systems in range glow Green; systems out of range glow Red/Grey.


* **Click-Through Logic:**
* Clicking a System on Sector Map -> Opens System Orrery Popup.
* Clicking "Visit" on Orrery -> Loads 3D Planet View.
* Clicking a POI on Planet -> Loads 2D City Map.



## 4. Implementation Priority (Roadmap)

1. **Phase 1:** Define JSON structure manually and build a basic Web Viewer to test RPi performance with Three.js.
2. **Phase 2:** Build the "Galaxy Plotter" (2D) in the PC Tool to generate Sector JSONs.
3. **Phase 3:** Build the "Planetary Studio" to handle textures and lat/lon coordinates visually.
4. **Phase 4:** Implement the Tile Slicer for city maps.