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

# PART 3: Procedural Generation & 3D Asset Management

**Context:** This module is strictly for the **PC Tool ("Gemini Architect")**. The tool will use these algorithms to generate static JSON files. The RPi viewer simply renders what the JSON dictates, ensuring performance remains high.

## 1. The 3D Asset Manifest (`assets_manifest.json`)

To allow the procedural engine to place stations and ships intelligently, it needs to know what files are available and what they represent.

**Location:** `/assets/models/manifest.json`

**Structure:**

```json
{
  "models_library": [
    {
      "file": "station_outpost_01.glb",
      "id": "model_outpost_alpha",
      "type": "Civilian_Outpost",
      "tags": ["trade", "low_security", "common"],
      "default_scale": 1.0,
      "docking_ports": 4
    },
    {
      "file": "mil_fortress_heavy.glb",
      "id": "model_mil_fortress",
      "type": "Military_Base",
      "tags": ["high_security", "rare", "gemini_defense_force"],
      "default_scale": 2.5,
      "is_unique": false
    },
    {
      "file": "wreckage_capital.glb",
      "id": "model_wreck_01",
      "type": "Debris",
      "tags": ["hazard", "scavenge"],
      "default_scale": 0.8
    }
  ]
}

```

## 2. PC Tool Module: The "System Forge" (Procedural Engine)

This module allows the GM to generate a full star system with a single click based on a seed or specific parameters.

### A. Star Generation Logic

The engine selects a Spectral Class (O, B, A, F, G, K, M) based on a weighted probability (M-class Red Dwarfs are common, O-class Giants are rare) or user selection.

* **Output:** Sets the `star.color_hex`, `star.radius_km`, and defines the **"Habitable Zone"** (Goldilocks Zone) distance range for the system.

### B. Planetary Architect (Orbit Slots)

The engine divides the system into three zones based on distance from the star:

1. **The Furnace (Inner Zone):** High probability of *Barren*, *Lava*, or *Rock* planets. No moons.
2. **The Cradle (Habitable Zone):** High probability of *Terran*, *Ocean*, *Jungle*, or *Desert* planets. Chance for moons.
3. **The Deep (Outer Zone):** High probability of *Gas Giants* or *Ice Giants*. High chance of multiple moons and rings.

**Texture Selection:**
The tool must have a local folder `library/textures/planets/` categorized by type (e.g., `terran_01.jpg`, `gas_red_02.jpg`). The engine randomly assigns a texture matching the generated planet type.

### C. Asteroid Belt Generation

Instead of individual 3D rocks (too heavy), Belts are generated as a logical ring.

* **Data Structure:** Added to `sys_XX.json`.
* **Visuals:** Rendered in the client as a particle system or a translucent textured ring geometry.

### D. Station & Ship Placement Algorithm

This logic distributes the GLB files from the Manifest into the system.

**The Algorithm Steps:**

1. **Determine System "Wealth/Tech Level":** (Random 1-10).
* *Low Tech:* Few stations, mostly "Debris" or "Outpost" types.
* *High Tech:* Many stations, "Military" and "Trade" types.


2. **Filter Manifest:**
* If the system is marked "Anarchy", filter for Pirate/Debris models.
* If the system is "Corporate", filter for Trade/Refinery models.


3. **Orbit Assignment:**
* *Gas Giants:* High chance of "Refinery" stations in orbit.
* *Habitable Worlds:* High chance of "Trade Docks" or "Defense Platforms".
* *Asteroid Belts:* High chance of "Mining Outposts".


4. **Instantiation:** Create an entry in the JSON `orbitals` array linking to the GLB file.

## 3. Handling "Special" vs. Random Assets

The Tool UI must distinguish between **Procedural Filling** and **Manual Override**.

* **Random Filling:** The GM clicks "Populate System". The tool fills empty orbits with generic stations based on the algorithm above.
* **Unique/Manual Placement:**
* The GM can drag a "Special" model (e.g., *The Black Yanta*) from the asset library manually into an orbit.
* **Locking:** These manual entries receive a flag `"locked": true` in the JSON editor, preventing the Procedural Engine from overwriting them if the GM clicks "Regenerate" later.



## 4. Updated JSON Data Structure (`sys_XX.json`)

The System file structure is updated to support GLB models and procedural belts.

```json
{
  "id": "sys_kilter",
  "star": { ... }, 
  "orbitals": [
    {
      "id": "planet_p1",
      "name": "Tirra",
      "type": "Planet",
      "texture": "assets/textures/planets/terran_04.webp",
      "orbit_radius": 1.2,
      "children": [
        {
          "id": "station_alpha",
          "name": "Kilter Trade Hub",
          "type": "Station",
          "model_3d": "assets/models/station_ring_02.glb",
          "scale": 1.5,
          "orbit_distance": 0.005,
          "faction": "Merchant_Guild"
        }
      ]
    },
    {
      "id": "belt_b1",
      "name": "The Iron Ring",
      "type": "Belt",
      "orbit_radius": 2.8,
      "width": 0.2,
      "density": "High",
      "texture": "assets/textures/belts/rocky_ring.png",
      "children": [
        {
          "id": "mining_outpost_09",
          "name": "Deep Dig 09",
          "type": "Station",
          "model_3d": "assets/models/mining_rig_small.glb",
          "scale": 0.8
        }
      ]
    }
  ]
}

```

## 5. UI Requirements for the PC Tool (Procedural Tab)

**Panel: The Genesis Engine**

* **Seed Input:** Text field (e.g., "Campaign2026"). Same seed = Same system result.
* **System Archetype:** Dropdown (Random, Red Dwarf, Binary, Nebula-Rich, Dead System).
* **Density Sliders:**
* *Planets:* [Sparse <-> Crowded]
* *Civilization:* [Empty <-> Core World] (Controls station count).


* **Button:** `GENERATE SYSTEM`
* *Action:* Clears current JSON (except Locked items), runs logic, refreshes 3D Preview.



**Panel: Asset Dropper**

* List of all GLB files from `manifest.json`, filtered by Type.
* Drag & Drop functionality to place a specific ship/station into a specific Planet's orbit in the hierarchy tree.

## 6. Performance Note for RPi 3B

* **GLB Optimization:** Ensure models used for procedural generation are **Low Poly**. High-detail models should be reserved for "Special" unique locations.
* **Instancing:** If the same "Mining Outpost" GLB is used 10 times in a system, the WebGL client (Three.js) should use **InstancedMesh** to render them. The JSON structure supports this naturally by referencing the same `model_3d` path multiple times.