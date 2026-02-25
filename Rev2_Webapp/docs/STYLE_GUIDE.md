# SIT — Visual Style Guide

Reference document for maintaining visual consistency across the SIT webapp. All new UI work should follow these conventions.

---

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [Color System](#color-system)
- [Typography](#typography)
- [Spacing & Layout](#spacing--layout)
- [Borders & Dividers](#borders--dividers)
- [Buttons](#buttons)
- [Tabs & Navigation](#tabs--navigation)
- [Form Inputs](#form-inputs)
- [Modals & Dialogs](#modals--dialogs)
- [Bars & Indicators](#bars--indicators)
- [Shadows & Glows](#shadows--glows)
- [Animations & Transitions](#animations--transitions)
- [Scrollbars](#scrollbars)
- [Sci-Fi Effects](#sci-fi-effects)
- [Z-Index Layers](#z-index-layers)
- [Do's and Don'ts](#dos-and-donts)

---

## Design Philosophy

SIT uses a **dark sci-fi / cyberpunk** aesthetic inspired by terminal interfaces and neon signage. The core principles:

1. **Dark-on-dark with cyan accents** — Near-black backgrounds with glowing cyan interactive elements
2. **Outlined → filled interactions** — Elements default to transparent/outlined; hover and active states fill solid with inverted text
3. **Neon glow feedback** — All interactive hover states emit a soft glow via `box-shadow`
4. **Monospace everywhere** — Reinforces the terminal/hacking aesthetic
5. **Uppercase UI chrome** — Buttons, tabs, labels, and headers use `text-transform: uppercase`
6. **Sharp geometry** — No border-radius on most elements (angular, sci-fi feel). Rounded only on scrollbars, chat bubbles, and badges
7. **Muted labels, bright values** — Labels in gray, values in accent/gold/primary

---

## Color System

### CSS Variables (Admin)

Admin uses a comprehensive variable system defined on `:root`:

```css
:root {
    /* ── Backgrounds ── */
    --bg-color:      #050505;    /* Page background */
    --panel-bg:      #0f0f15;    /* Panel/card backgrounds */

    /* ── Accent ── */
    --accent-color:  #00d2ff;    /* Primary cyan — used everywhere */

    /* ── Text ── */
    --text-color:    #eee;       /* Default body text */

    /* ── Semantic ── */
    --color-danger:  #ff3333;    /* Errors, delete, alerts */
    --color-success: #00cc44;    /* Confirmations, positive */
    --color-warning: #ffaa00;    /* Warnings, NPC highlight */
    --color-npc:     #ffaa00;    /* NPC name color */
    --color-gold:    #ffd700;    /* Currency, level-up, gold accents */
    --color-muted:   #888;       /* De-emphasized text */
    --color-faint:   #555;       /* Faintest visible text */

    /* ── Gray Scale ── */
    --gray-950:      #050505;
    --gray-900:      #0a0a12;
    --gray-850:      #0f0f15;
    --gray-800:      #1a1a24;    /* Dark panel bg, button bg */
    --gray-700:      #333;       /* Borders (primary) */
    --gray-600:      #444;
    --gray-500:      #888;
    --gray-400:      #aaa;
    --gray-300:      #ccc;

    /* ── Type Scale ── */
    --text-xs:       0.7rem;
    --text-sm:       0.8rem;
    --text-base:     0.9rem;
    --text-lg:       1.1rem;
    --text-xl:       1.3rem;
    --text-2xl:      1.5rem;
}
```

### CSS Variables (Player)

Player uses a smaller variable set — notably with a slightly brighter primary:

```css
:root {
    --primary-color: #00f3ff;                    /* Primary cyan (brighter than admin) */
    --bg-color:      #0a0a12;                    /* Background */
    --panel-bg:      rgba(0, 243, 255, 0.05);    /* Translucent cyan panel bg */
    --alert-color:   #ff3333;                    /* Alert/danger */
}
```

### Alert Mode (Player)

The player page supports an alert mode that swaps the entire color scheme from cyan to red:

```css
body.alert-red {
    --primary-color: #ff3333;
    --panel-bg: rgba(255, 51, 51, 0.1);
}
```

### Full Color Palette

#### Backgrounds (darkest → lightest)

| Value | Usage |
|-------|-------|
| `#000` | Pure black — input backgrounds, deepest bg |
| `#050505` | Page background (admin), login bg |
| `#080808` | Detail row alternating bg |
| `#0a0a12` | Page background (player) |
| `#0a0a14` | Popover/dropdown bg |
| `#0f0f15` | Panel backgrounds, login box bg |
| `#111` | Input bg, form bg, sub-tab bg |
| `#1a1a24` | Action button bg, input area bg |
| `#222` | Select bg, table header bg, log entry border |
| `#333` | Scrollbar thumb default |

#### Text Colors

| Value | Usage |
|-------|-------|
| `#555` | Faint/disabled text, separators |
| `#666` | Item source, metadata |
| `#888` | Muted labels, timestamps, inactive tabs |
| `#999` | Descriptions |
| `#aaa` | Channel tags, secondary text |
| `#ccc` | Inventory item names, stat labels |
| `#ddd` | Spell item names |
| `#eee` | Default body text (admin) |
| `#fff` | Input text, bold/emphasized names |

#### Accent & Semantic Colors

| Value | Name | Usage |
|-------|------|-------|
| `#00d2ff` | **Cyan (admin)** | Primary accent — borders, hover, active |
| `#00f3ff` | **Cyan (player)** | Primary accent — slightly brighter |
| `#ff3333` | **Red** | Danger, delete buttons, alerts |
| `#f55` | **Soft Red** | HP bar, sell button |
| `#00cc44` | **Green** | Success states |
| `#0f0` | **Bright Green** | DB editor text, auto-computed values |
| `#6f6` | **Light Green** | "Owned" text |
| `#5f5` | **RP Green** | Roleplay stat labels/values |
| `#ffaa00` | **Amber** | Warnings, NPC names |
| `#ffd700` | **Gold** | Currency, level-up, spell headers |
| `#ffcc00` | **Yellow** | GM chat messages |
| `#55f` | **Blue** | Stamina bar |
| `#00ffaa` | **Teal** | NPC roleplay header |

#### Key RGBA Values

```css
/* ── Cyan tints (admin — based on #00d2ff) ── */
rgba(0, 210, 255, 0.05)    /* Hover bg (lightest) */
rgba(0, 210, 255, 0.1)     /* Active tab bg, row hover */
rgba(0, 210, 255, 0.15)    /* Wizard step active bg */
rgba(0, 210, 255, 0.2)     /* Active tab shadow, focus shadow */
rgba(0, 210, 255, 0.3)     /* Card shadow */
rgba(0, 210, 255, 0.4)     /* Time display text-shadow */

/* ── Cyan tints (player — based on #00f3ff) ── */
rgba(0, 243, 255, 0.05)    /* Panel bg, contact item bg */
rgba(0, 243, 255, 0.08)    /* Spell active bg */
rgba(0, 243, 255, 0.1)     /* Header bg, chat msg bg */
rgba(0, 243, 255, 0.15)    /* Hover bg */
rgba(0, 243, 255, 0.2)     /* "Me" chat msg bg, btn hover bg */
rgba(0, 243, 255, 0.3)     /* Scrollbar thumb, notification shadow */
rgba(0, 243, 255, 0.4)     /* Button hover shadow */

/* ── Black overlays ── */
rgba(0, 0, 0, 0.5)         /* Chat input bg, scrollbar track */
rgba(0, 0, 0, 0.8)         /* Tooltips, chat input area */
rgba(0, 0, 0, 0.85)        /* Admin modal overlay */
rgba(0, 0, 0, 0.9)         /* Player check modal overlay */
rgba(0, 0, 0, 0.92)        /* Player modal overlay */

/* ── Accent overlays ── */
rgba(10, 10, 18, 0.95)     /* User menu bg, bottom nav bg */
rgba(0, 20, 20, 0.95)      /* Notification popup bg */
rgba(255, 215, 0, 0.08)    /* Level-up selection bg */
rgba(255, 215, 0, 0.1)     /* Level-up banner bg */
rgba(255, 200, 0, 0.1)     /* GM chat msg bg */
```

---

## Typography

### Font Stack

| Font | Source | Where |
|------|--------|-------|
| `'Share Tech Mono', monospace` | Google Fonts | **All main UI** — admin, player, login |
| `'Courier New', Courier, monospace` | System | Base `style.css`, Konva canvas text |
| `monospace` | System | Log panel, code/DB editor fallback |

### Import

```html
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
```

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | `0.7rem` | Tiny labels, badges |
| `--text-sm` | `0.8rem` | Small buttons, metadata, sub-tabs |
| `--text-base` | `0.9rem` | Body text, form inputs |
| `--text-lg` | `1.1rem` | Section headers |
| `--text-xl` | `1.3rem` | Panel titles |
| `--text-2xl` | `1.5rem` | Page headers |

### Text Conventions

- **Uppercase** for all UI chrome: buttons, tabs, headers, labels → `text-transform: uppercase`
- **Normal case** for user-generated content: character names, descriptions, chat messages
- **Letter-spacing**: `1px` on player buttons; none elsewhere
- **Line-height**: default (not explicitly set)

---

## Spacing & Layout

### Grid Patterns

| Pattern | Usage |
|---------|-------|
| `grid-template-rows: 60px 1fr` | Admin body (fixed header + scrollable main) |
| `grid-template-columns: 450px 1fr` | Map layout (controls + preview) |
| `grid-template-columns: 300px 1fr` | Comms tab (contact list + chat area) |
| `grid-template-columns: 1fr 1fr` | Two-column layouts (RP, paired fields) |
| `grid-template-columns: repeat(auto-fill, minmax(350px, 1fr))` | PC character card grid |
| `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` | NPC card grid |
| `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` | Controls / detail grid |

### Flex Patterns

| Pattern | Usage |
|---------|-------|
| `display: flex; gap: 10px` | Standard horizontal control rows |
| `display: flex; gap: 5px` | Compact rows |
| `display: flex; gap: 15px; flex-direction: column` | Modal / form content |
| `display: flex; justify-content: space-between` | Stat rows, item rows, headers |
| `display: flex; flex-wrap: wrap` | Sub-tab bars, filter bars |

### Standard Gaps

- **5px** — compact/tight spacing (inside cells, between small controls)
- **10px** — default gap (between controls, form rows, buttons)
- **15px** — modal content, section spacing
- **20px** — padding inside panels and modals

---

## Borders & Dividers

### The Universal Border

```css
border: 1px solid #333;   /* or var(--gray-700) or var(--border-color) */
```

This is SIT's default border — used on panels, inputs, table cells, dividers, and separators.

### Border Hierarchy

| Border | Usage |
|--------|-------|
| `1px solid #222` | Subtle dividers (log entries, spell lists) |
| `1px solid #333` | **Standard** — panels, inputs, table borders |
| `1px solid #444` | Emphasized inputs (filter fields) |
| `1px solid #555` | Minor button borders |
| `1px solid var(--accent-color)` | **Accent** — highlighted panels, active headers |
| `2px solid var(--primary-color)` | Strong accent — menu borders, overlay separators |
| `3px solid var(--accent-color)` | Selected wizard item `border-left` |

### Border Radius

```
Default:     0       (sharp corners — sci-fi angular aesthetic)
Scrollbars:  3px
Chat bubbles: 5px
Badges:      50%     (circular)
Small chips: 4px     (spell slots, time dropdown)
```

---

## Buttons

### Pattern: Outlined → Filled

All SIT buttons follow the same interaction pattern:

```
Default state:   transparent/dark bg + colored border + colored text
Hover state:     filled bg (accent color) + black text + glow shadow
Active state:    same as hover or brighter
```

### Primary Button (Admin)

```css
.btn {
    background: var(--gray-800);            /* #1a1a24 */
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
    padding: 8px 16px;
    text-transform: uppercase;
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.2s;
}
.btn:hover {
    background: var(--accent-color);
    color: #000;
}
```

### Danger Button

```css
.btn.red {
    border-color: var(--color-danger);
    color: var(--color-danger);
}
.btn.red:hover {
    background: var(--color-danger);
    color: #000;
}
```

### Success Button

```css
.active-btn {
    border: 1px solid var(--color-success);
    color: var(--color-success);
}
.active-btn:hover {
    background: var(--color-success);
    color: #000;
}
```

### Large Action Button (Admin)

```css
.action-btn {
    background: #1a1a24;
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
    padding: 15px;
    text-transform: uppercase;
    transition: all 0.2s;
}
.action-btn:hover {
    background: var(--accent-color);
    color: #000;
    box-shadow: 0 0 15px var(--accent-color);
}
.action-btn.danger {
    border-color: #ff3333;
    color: #ff3333;
}
.action-btn.danger:hover {
    background: #ff3333;
    color: #000;
    box-shadow: 0 0 15px #ff3333;
}
```

### Cyberpunk Button (Player)

The player page uses clip-path for chamfered corners:

```css
.btn {
    background: var(--panel-bg);
    border: 1px solid var(--primary-color);
    color: var(--primary-color);
    padding: 15px 30px;
    font-size: 1.2rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    transition: all 0.3s ease;
    clip-path: polygon(
        10px 0, 100% 0, 100% calc(100% - 10px),
        calc(100% - 10px) 100%, 0 100%, 0 10px
    );
}
.btn:hover {
    background: rgba(0, 243, 255, 0.2);
    box-shadow: 0 0 15px rgba(0, 243, 255, 0.4);
    text-shadow: 0 0 5px var(--primary-color);
}
.btn:active {
    background: var(--primary-color);
    color: #000;
}
```

### Icon Button (Minimal)

```css
.btn-icon {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    padding: 4px 6px;
    transition: color 0.15s;
}
/* Variants by suffix: */
.btn-icon--close { color: #fff; }    /* → var(--color-danger) on hover */
.btn-icon--danger { color: var(--color-danger); }
.btn-icon--edit { color: #aaa; }     /* → #fff on hover */
```

### Micro Button (Inline)

```css
.btn-micro {
    font-size: 0.8rem;
    padding: 4px 8px;
    border: 1px solid #333;
    background: #222;
    color: #aaa;
}
```

### Number Spinner

```css
.num-btn {
    background: #222;
    color: #888;
    border: none;
    padding: 5px 8px;
    font-weight: bold;
}
.num-btn:hover { background: #333; color: #fff; }
.num-btn:active { background: var(--accent-color); color: #000; }
```

### Gold & Red Variants (Player)

```css
.btn-gold { border-color: #ffd700; color: #ffd700; }
.btn-gold:active { background: #ffd700; color: #000; }
.btn-red { border-color: #f55; color: #f55; }
```

---

## Tabs & Navigation

### Main Tabs (Admin)

```css
.tab-btn {
    background: transparent;
    border: 1px solid var(--border-color);    /* #333 */
    color: #888;
    padding: 10px 20px;
    text-transform: uppercase;
    transition: all 0.2s;
}
.tab-btn:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
}
.tab-btn.active {
    background: rgba(0, 210, 255, 0.1);
    color: var(--accent-color);
    border-color: var(--accent-color);
    box-shadow: 0 0 10px rgba(0, 210, 255, 0.2);
}
```

### Sub-Tabs (Admin)

```css
.sub-tab-btn {
    background: #111;
    border: 1px solid #333;
    color: #888;
    padding: 5px 10px;
    font-size: 0.8rem;
    text-transform: uppercase;
}
.sub-tab-btn:hover { color: #fff; border-color: #555; }
.sub-tab-btn.active {
    background: var(--accent-color);
    color: #000;
    border-color: var(--accent-color);
    font-weight: bold;
}
```

### Bottom Navigation (Player)

```css
.nav-btn {
    background: transparent;
    border: none;
    color: #555;
    font-size: 1.2rem;
    text-transform: uppercase;
    padding: 10px 20px;
    transition: color 0.3s;
}
.nav-btn.active {
    color: var(--primary-color);
    text-shadow: 0 0 5px var(--primary-color);
    border-bottom: 2px solid var(--primary-color);
}
.nav-btn:disabled { opacity: 0.3; }
```

### Current Admin Tabs

| Tab | Sub-tabs |
|-----|----------|
| **Actions** | — |
| **Scene** | Stage, Objects, Roleplay |
| **Items** | Weapon, Armor, Tech, Magic, Consumable, Goods, Fusion, Upgrade, Augment |
| **Characters** | PCs (Active Party), NPCs (Combat), NPCs (Roleplay) |
| **Comms** | — |
| **Encounters** | — |
| **Play** | — |
| **Map** | — |
| **Shops** | — |
| **Settings** | Logs (sub-tab within) |

### Character Editor Tabs (Admin Modal)

Details, Stats, Combat, Skills, Feats, Spells, Inventory, Companions

---

## Form Inputs

### Standard Input

```css
.form-input, .form-select {
    width: 100%;
    padding: 8px;
    background: #000;
    color: #fff;
    border: 1px solid var(--gray-700);    /* #333 */
    font-family: inherit;
    font-size: var(--text-base);          /* 0.9rem */
}
.form-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 5px rgba(0, 210, 255, 0.2);
    outline: none;
}
```

### Inline Input (Inside Tables/Rows)

```css
input {
    padding: 5px;
    background: #000;              /* or #111 */
    color: #fff;                   /* or var(--accent-color) */
    border: 1px solid #333;       /* or #444 */
    font-family: inherit;
}
```

### Textarea (DB Editor)

```css
.db-editor {
    width: 100%;
    height: 400px;
    background: #000;
    color: #0f0;                   /* Green-on-black terminal look */
    border: 1px solid #333;
    font-family: monospace;
    padding: 10px;
    resize: none;
}
```

### Hide Number Spinners

```css
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
input[type=number] {
    -moz-appearance: textfield;
    appearance: textfield;
}
```

---

## Modals & Dialogs

### Admin Modal

```css
.modal-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 200;
    display: none;                  /* .open → display: flex */
    justify-content: center;
    align-items: center;
}
.modal-box {
    background: var(--gray-800);    /* #1a1a24 */
    border: 1px solid var(--accent-color);
    padding: 20px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
}
/* Size variants */
.modal-box--sm { max-width: 400px; }
.modal-box--md { max-width: 700px; }
.modal-box--lg { max-width: 1000px; }
```

### Player Modal

```css
.player-modal-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.92);
    z-index: 300;
    padding: 10px;
    overflow-y: auto;
}
.player-modal-box {
    background: #0a0a12;
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 30px rgba(0, 243, 255, 0.2);
    width: 100%;
    max-width: 500px;
    padding: 20px;
    margin: 10px auto;
}
```

---

## Bars & Indicators

### HP / SP / XP Vitals

| Bar | Track BG | Track Border | Fill Color |
|-----|----------|--------------|------------|
| **SP** (Stamina) | `#113` | `1px solid #335` | `#55f` |
| **HP** (Hit Points) | `#311` | `1px solid #522` | `#f55` |
| **XP** (Experience) | `#111` | `1px solid #333` | `var(--primary-color)` |

```css
/* All bars share: */
height: 6px;                    /* Vitals: SP/HP */
height: 10px;                   /* XP bar */
transition: width 0.3s;         /* Smooth fill animation */
transition: width 0.5s;         /* XP (slower) */
```

### Status Dot

```css
.status-dot {
    width: 8px;
    height: 8px;
    background-color: var(--primary-color);
    border-radius: 50%;
    box-shadow: 0 0 5px var(--primary-color);
}
/* Alert mode: blink animation */
animation: blink 0.5s infinite;
```

---

## Shadows & Glows

### Box Shadow Scale

All shadows are **centered glows** (no offset) — this is the core neon aesthetic:

```css
/* Subtle — focus indicators, small elements */
box-shadow: 0 0 5px rgba(0, 210, 255, 0.2);

/* Medium — active tabs, hover states */
box-shadow: 0 0 10px rgba(0, 210, 255, 0.2);

/* Strong — button hover, notification popups */
box-shadow: 0 0 15px rgba(0, 243, 255, 0.4);

/* Intense — modals, important UI */
box-shadow: 0 0 30px rgba(0, 243, 255, 0.2);
```

### Rule: Match glow color to element color

```css
/* Cyan element → cyan glow */
border-color: var(--accent-color);
box-shadow: 0 0 15px var(--accent-color);

/* Red element → red glow */
border-color: #ff3333;
box-shadow: 0 0 15px #ff3333;

/* Gold element → gold glow */
border-color: #ffd700;
box-shadow: 0 0 20px rgba(255, 215, 0, 0.6);

/* Green element → green glow */
border-color: #00cc44;
box-shadow: 0 0 30px rgba(0, 255, 0, 0.2);
```

### Text Shadow

```css
/* Standard glow text */
text-shadow: 0 0 5px var(--primary-color);

/* Time display glow */
text-shadow: 0 0 8px rgba(0, 210, 255, 0.4);

/* Glitch effect (chromatic aberration) */
text-shadow: 2px 0 red, -2px 0 blue;
```

---

## Animations & Transitions

### Transition Speeds

| Speed | Value | Usage |
|-------|-------|-------|
| **Fast** | `0.15s` | Icon buttons, row hover, small interactions |
| **Normal** | `0.2s` | Tabs, buttons, standard interactions |
| **Smooth** | `0.3s ease` | Player buttons, nav, bar fills, slide-in menus |
| **Slow** | `0.5s` | XP bar |
| **Dramatic** | `0.8s cubic-bezier(0.25, 1, 0.5, 1)` | Character entries (RP mode) |
| **Crossfade** | `1.5s ease-in-out` | Mood image opacity transitions |

### Keyframe Animations

```css
/* Blinking alert dot */
@keyframes blink {
    0%   { opacity: 1; }
    50%  { opacity: 0.3; }
    100% { opacity: 1; }
}
/* Usage: animation: blink 0.5s infinite; */

/* Notification slide-in */
@keyframes slideDown {
    from { transform: translateY(-20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
}
/* Usage: animation: slideDown 0.3s ease-out forwards; */

/* Notification dismiss */
@keyframes fadeOut {
    to { opacity: 0; transform: translateY(-10px); }
}
/* Usage: animation: fadeOut 0.3s ease-in forwards; */

/* Level-up pulsing gold glow */
@keyframes pulse-gold {
    0%, 100% { box-shadow: 0 0 5px rgba(255, 215, 0, 0.3); }
    50%      { box-shadow: 0 0 20px rgba(255, 215, 0, 0.6); }
}
/* Usage: animation: pulse-gold 2s infinite; */
```

---

## Scrollbars

### Admin

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #000; }
::-webkit-scrollbar-thumb {
    background: #333;
    border: 1px solid var(--accent-color);
}
::-webkit-scrollbar-thumb:hover {
    background: var(--accent-color);
}
```

### Player

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.5); }
::-webkit-scrollbar-thumb {
    background: rgba(0, 243, 255, 0.3);
    border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
    background: var(--primary-color);
}
```

---

## Sci-Fi Effects

### CRT Scanlines (Player)

Applied via `body::before` pseudo-element:

```css
body::before {
    content: " ";
    display: block;
    position: absolute;
    top: 0; left: 0; bottom: 0; right: 0;
    background:
        linear-gradient(
            rgba(18, 16, 16, 0) 50%,
            rgba(0, 0, 0, 0.25) 50%
        ),
        linear-gradient(
            90deg,
            rgba(255, 0, 0, 0.06),
            rgba(0, 255, 0, 0.02),
            rgba(0, 0, 255, 0.06)
        );
    z-index: 2;
    background-size: 100% 2px, 3px 100%;
    pointer-events: none;
}
```

This creates:
- **Horizontal scanlines**: 2px alternating transparent/dark bands
- **RGB sub-pixel fringing**: Subtle red-green-blue vertical bars

### Cyberpunk Clip-Path

Used on player buttons for chamfered / cut corners:

```css
clip-path: polygon(
    10px 0,
    100% 0,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    0 100%,
    0 10px
);
```

### Glitch Effect

Applied temporarily to text for error/interference:

```css
.glitching {
    text-shadow: 2px 0 red, -2px 0 blue;
    color: #fff !important;
    background: rgba(255, 255, 255, 0.1);
}
```

### Talking Character Glow (Mood)

```css
.char-wrapper.talking {
    transform: scale(1.1);
    z-index: 100;
    filter: drop-shadow(0 0 30px rgba(255, 255, 255, 0.3));
}
```

### Character Drop Shadow (Mood)

```css
.rp-char {
    filter: drop-shadow(0 0 20px rgba(0, 0, 0, 0.8));
}
```

---

## Z-Index Layers

| Z-Index | Layer |
|---------|-------|
| `2` | CRT scanline overlay |
| `3–10` | Tab content, panels |
| `50` | Bottom navigation, user menu |
| `100` | Slide-out panels (chat overlay) |
| `200` | Admin modals |
| `300` | Player modals |
| `1000` | Notification popups |

---

## Do's and Don'ts

### DO

- **Use CSS variables** — `var(--accent-color)` not `#00d2ff`
- **Use the outlined → filled pattern** for all interactive elements
- **Add glow on hover** — `box-shadow: 0 0 15px` with matching translucent color
- **Keep backgrounds dark** — never use light/white backgrounds
- **Use `text-transform: uppercase`** on UI chrome (buttons, tabs, headers)
- **Use `inherit` for font-family** on buttons and inputs
- **Match glow color to element color** — cyan border = cyan glow, red border = red glow
- **Use `transition: all 0.2s`** as the default for interactive elements
- **Keep borders at `1px solid #333`** for standard dividers
- **Use the gray scale variables** for backgrounds (`--gray-800`, `--gray-850`, etc.)

### DON'T

- **Don't use border-radius** on buttons, panels, or tabs (exception: scrollbars, badges, chat bubbles)
- **Don't use light backgrounds** — the darkest element should be `#000`, the lightest bg is `#222`
- **Don't use offset shadows** — all shadows should be `0 0 Npx` (centered glow only)
- **Don't mix font families** — stick to Share Tech Mono for all UI
- **Don't use `px` for font sizes** — use the `--text-*` variables or `rem` units
- **Don't add transitions longer than `0.3s`** for standard interactions (save slow transitions for mood/RP effects)
- **Don't introduce new colors** — use the existing palette. If a new semantic color is needed, add it as a CSS variable
- **Don't use white (`#fff`) for backgrounds** — white is only for text in inputs and emphasized names
