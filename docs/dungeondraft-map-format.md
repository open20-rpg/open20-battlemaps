# `.dungeondraft_map` Format (save format 3)

Field-by-field specification of the `.dungeondraft_map` file format,
cross-checked against real map files.

Anything not confirmed is marked **UNVERIFIED**.

---

## 1. File container and encoding conventions

A map file is a single JSON document:

- **Tab-indented JSON** produced by Godot 3's JSON printer with `"\t"` as the
  indent string. A newline is appended when writing the line; observed files
  end at the closing brace (trailing-newline presence **UNVERIFIED**).
- Exactly three top-level keys: `header`, `world`, `mod`.
  `mod` holds mod-manager data; on unmodded maps it is `{".node_table": {}}`.
- Saving is atomic: the file is written to a `.temporary` file, moves the previous
  map into a backups folder, then renames. The extension is always forced to
  `.dungeondraft_map`.
- Loading is a plain JSON parse; there is no checksum or binary framing.

### 1.1 Godot literal encodings

Many values are stored as **strings containing Godot variant literals**
(produced by Godot's variant-to-string conversion, parsed back symmetrically):

| Godot type | JSON representation (string) |
|---|---|
| `Vector2` | `"Vector2( 2855.54, 3377.9 )"` — note the spaces inside parens |
| `PoolVector2Array` | `"PoolVector2Array( x0, y0, x1, y1, ... )"` — flat x,y pairs |
| `PoolIntArray` | `"PoolIntArray( -1, -1, 73, ... )"` — 2-D int arrays are flattened row-major and read back as a flat array |
| `PoolByteArray` | `"PoolByteArray( 189, 66, 0, ... )"` — decimal byte values |
| null-ish variant | the string `"null"` (e.g. `editor_state.guide_position`) |

Other conventions:

- **Colors** are 8-hex-digit **ARGB** strings, alpha first, lowercase, no `#`:
  `"ffffffff"` = opaque white, `"18ffffff"` = ~9%-alpha white. A missing color
  key defaults to opaque white on load.
- **IDs / counters** (`node_id`, `wall_id`, `next_node_id`, `next_prefab_id`,
  `msi.seed`) are lowercase **hexadecimal strings** with no prefix and no
  zero-padding (e.g. `"2c5"`, `"1ca"`).
- **Textures** are stored as Godot resource paths: `res://...` for built-in
  and pack assets (packs mount under `res://packs/<PACKID>/...`), or
  `embedded://<key>` for images embedded in the map file itself.
- **Enums** are stored as plain JSON integers.
- **Booleans, numbers, plain strings, dicts, arrays** are native JSON values.

### 1.2 Number formatting

Numbers are printed by Godot 3's real-to-string routine: integers have no
decimal point; floats are printed with about six significant decimal digits
and trailing zeros trimmed. Observed examples: `-1.570796` (−π/2),
`5.333333`, `0.2`, `45`, `2855.54`, `0.227273`. The exact rounding algorithm
is Godot's internal number-to-string conversion — **UNVERIFIED** beyond
observation; when writing files, printing floats with up to 6 decimal places
and stripping trailing zeros reproduces observed output.

### 1.3 Units

- 1 grid cell = **256 world units** ("pixels"). This is a fixed constant;
  it is *not* stored in the file. All coordinates,
  radii and widths in the file are in these world pixels unless noted.
- Angles are **radians** except `roofs.sun_direction` (degrees).

---

## 2. `header`

| key | type | meaning |
|---|---|---|
| `creation_build` | string | build version + codename, e.g. `"1.2.0.1 opulent kirin"`. Mismatch on load only logs a warning. |
| `creation_date` | dict | Godot datetime dict: `year, month, day, weekday, dst (bool), hour, minute, second` |
| `uses_default_assets` | bool | whether the map uses the built-in asset library |
| `asset_manifest` | array | one entry per asset pack used (below) |
| `editor_state` | dict | editor UI state (below) |

### 2.1 `asset_manifest[]` entry

| key | type | meaning |
|---|---|---|
| `name` | string | pack display name |
| `id` | string | 8-character pack id (matches `res://packs/<id>/`) |
| `version` | string | pack version; mismatch only logs |
| `author` | string | |
| `keywords` | string or null | |
| `custom_color_overrides` | dict | `{enabled: bool, min_redness: float, min_saturation: float, red_tolerance: float}` — per-pack overrides of the red-key recolor shader thresholds (see render doc §10) |

On load, packs listed here but not installed produce a missing-assets warning.

### 2.2 `editor_state`

Pure editor UI state; safe for a renderer to ignore, but must be preserved
round-trip:

| key | type | meaning |
|---|---|---|
| `current_level` | int | index of the level open in the editor |
| `camera_position` | Vector2 string | |
| `camera_zoom` | float | camera zoom factor |
| `guide_position` | Vector2 string or `"null"` | |
| `trace_image` | null or dict | `{image: path, scale: float, opacity: float, position: Vector2 string}` |
| `color_palettes` | dict | 8 fixed keys, each an array of ARGB hex strings: `object_custom_colors`, `scatter_custom_colors`, `light_colors`, `grid_colors`, `deep_water_colors`, `shallow_water_colors`, `cave_ground_colors`, `cave_wall_colors` |
| `object_tags_memory`, `scatter_tags_memory` | dict | `{set: int, tags: [string]}` |
| `object_library_memory`, `scatter_library_memory`, `path_library_memory` | null or dict | `{mode, scroll, selected: [...]}` |
| `sharpen_fonts` | bool | |

---

## 3. `world`

| key | type | meaning |
|---|---|---|
| `format` | int | save format version; always **3** for this spec. No hard version gate exists on load (see §5). |
| `width`, `height` | int | map size **in grid cells** (defaults 64×48). World pixel size = `width*256 × height*256`. |
| `next_node_id` | hex string | next value of the global node-id counter. Every saved entity (wall, portal, object, path, light, roof, pattern, text) consumes one id from this counter at creation; ids are never reused within a map. Saved/loaded as lowercase hex. |
| `next_prefab_id` | hex string | same, for prefab-group ids. Note: the counter is saved in hex, but `prefab_id` values stored on entities are **decimal** strings. |
| `msi` | dict | marching-squares jitter parameters (below) |
| `grid` | dict | `{color: ARGB hex, texture: res path}` — grid overlay tint and line texture (e.g. `res://textures/grid/dotted_line.png`). Grid line width is fixed at 8 px. |
| `building_wear` | path or null | global "wear" overlay texture multiplied into floor-tile / wall / cave shaders |
| `wall_shadow`, `object_shadow` | bool | global shadow toggles (load default: true) |
| `trace_image_visible` | bool | |
| `embedded` | dict | embedded images, keyed by name: `{width, height, format: "raw"|"png", data: base64}`. `"raw"` = base64 of raw RGBA8 pixel bytes; `"png"` = base64 of a PNG file. Referenced by `embedded://<key>` texture paths. |
| `levels` | dict | keyed by stringified level index (`"0"`, `"1"`, ...) |

### 3.1 `world.msi`

Parameters of the deterministic vertex-jitter table shared by the cave and
material meshes (see render doc §5 for the exact generation algorithm):

| key | default | meaning |
|---|---|---|
| `offset_map_size` | 512 | side length of the square random-offset table |
| `max_offset_distance` | 0.2 | jitter amplitude, in marching-squares cells |
| `cell_size` | 64 | world pixels per marching-squares cell (¼ grid cell) |
| `seed` | — | hex string; 32-bit seed of the offset table (new maps seed from Unix time) |

---

## 4. Per-level sections

Level keys, in save order: `label`, `environment`, `layers`, `shapes`,
`tiles`, `patterns`, `walls`, `portals`, `cave`, `terrain`, `water`,
`materials`, `paths`, `objects`, `lights`, `roofs`, `texts`, `texts_vis`.
On load, `patterns`, `roofs`, `texts` are optional; `texts_vis` defaults true.

### 4.1 Layer system

A "layer" on any entity is its Godot z-index (draw order). Built-in locked
layers are **not saved**: Terrain −500, Caves −300, Floor −200, Water 0,
Portals 500, Walls 600, Roofs 800. The `layers` dict saves only user layers as
`{"<int>": "<name>"}`; new maps default to `-400 Below Ground`,
`-100 Below Water`, `100..400 User Layer 1–4`, `700 Above Walls`,
`900 Above Roofs`.

### 4.2 `environment`

| key | type | meaning |
|---|---|---|
| `baked_lighting` | bool | whether the lighting layer is visible/rendered (written on save; note the loader does not read it back — it reads only `ambient_light`) |
| `ambient_light` | ARGB hex | color of the ambient light pass (opaque white = fully lit) |

### 4.3 `shapes` (floor shapes)

| key | type | meaning |
|---|---|---|
| `polygons` | array of PoolVector2Array strings | outlines of the floor/room shapes, world pixels |
| `walls` | array of **decimal ints** | node ids of the auto-generated building walls (wall `type` 0) that trace these outlines. Cross-references entries in this level's `walls` array — but note those store `node_id` as *hex* (e.g. `696` here ↔ wall `node_id` `"2b8"`). This is the one place format 3 still uses decimal ids. |

On load, floor tiles are re-derived from the polygons and the referenced
auto-walls are re-clipped against the cave mesh.

### 4.4 `tiles`

| key | type | meaning |
|---|---|---|
| `cells` | PoolIntArray string | exactly `width*height` ints, **row-major** (`index = y*width + x`). Each value is a tileset tile id; **−1 = empty**. No bit packing: no variant bits, no color bits. The autotile sub-tile (which atlas piece) is *not* stored — it is recomputed from neighbors on load. |
| `colors` | array of ARGB hex | one per cell, same row-major index; present even for empty cells. Per-cell tint. |
| `lookup` | dict | `{"<tileId>": "<texture res path>"}` for **every** tile registered in the saving session (not just used ids). Tile ids are session-dependent; on load ids are remapped through this table by texture path. Consumers must resolve `cells` values through `lookup` and match by path, never by raw id. |

Legacy: very old maps may store `tiles` as a bare cells string.
See render doc §6 for the smart/smart_double/simple atlas semantics.

### 4.5 `patterns`

Array of pattern-shape dicts (a textured polygon):

| key | meaning |
|---|---|
| `position` | Vector2 string — node origin; `points` are local to it |
| `shape_rotation` | float radians — rotation of the polygon node |
| `scale` | Vector2 string (load default 1,1) |
| `points` | PoolVector2Array string — polygon vertices, local coords |
| `layer` | int z-index |
| `color` | ARGB hex — polygon tint (also feeds the custom-color shader) |
| `outline` | bool — draw a default border line around the polygon |
| `texture` | res path (only written when the shape has a material) |
| `rotation` | float radians — rotation of the **texture**, not the shape |
| `node_id` | hex string |
| `prefab_id`, `locked` | optional |

### 4.6 `walls`

Array of wall dicts. Cave-edge walls (type 2) are **never saved** — they are
regenerated from the cave bitmap.

| key | type | meaning |
|---|---|---|
| `points` | PoolVector2Array string | polyline vertices, world pixels |
| `texture` | path | wall texture; end-cap texture is the same filename with an `_end` suffix before the extension |
| `color` | ARGB hex | tint |
| `loop` | bool | closed polyline |
| `type` | int | **0 = Auto** (generated from floor shapes; drawn at z 0), **1 = Manual** (hand-drawn; drawn at z −1), **2 = Cave** (never appears in files) |
| `joint` | int | corner style, matching Godot's Line2D joint modes: **0 = Sharp (miter), 1 = Bevel, 2 = Round**. Default 1. |
| `normalize_uv` | bool | texture-tiling distribution flag (see render doc §3) |
| `shadow` | bool | wall drop-shadow visible |
| `node_id` | hex string | |
| `portals` | array | embedded portal dicts (§4.7) |

Wall thickness is not stored: it equals the wall texture's pixel height.

### 4.7 Portals — embedded (`walls[].portals`) and freestanding (`portals`)

Both use the same schema:

| key | type | meaning |
|---|---|---|
| `position` | Vector2 string | portal **center**, global world pixels (on the wall line for embedded portals) |
| `rotation` | float radians | sprite rotation; equals the angle of `direction` (plus π when flipped) |
| `scale` | Vector2 string | |
| `direction` | Vector2 string | unit vector along the wall at the portal. The portal span is `position ± direction*radius`. |
| `texture` | path | door/window sprite, centered on `position` (default footprint 256×32 when missing) |
| `radius` | float | half-length of the portal opening in world pixels = half the texture's pixel width |
| `point_index` | int | index of the wall point that starts the segment the portal sits on |
| `wall_id` | hex string | owning wall's node id. Freestanding portals store −1, which serializes as `"ffffffff"` (two's-complement hex of −1). In formats < 3 this was a decimal int. |
| `wall_distance` | float | parametric position along the wall polyline: `point_index + t`, where `t ∈ [0,1)` is the fraction of the way along that segment (portal center distance from the segment's start point divided by segment length). Used as the sort key when splitting wall geometry. |
| `closed` | bool | door closed (a closed portal blocks light) |
| `node_id` | hex string | |
| `prefab_id`, `locked` | optional | |

Freestanding portals live in the level's `portals` array; their `direction`
is `(cos rotation, sin rotation)`.

### 4.8 `cave`

| key | type | meaning |
|---|---|---|
| `bitmap` | PoolByteArray string | dug-out cave area, 1 bit per marching-squares corner |
| `entrance_bitmap` | PoolByteArray string | "blast open" entrance area, same encoding (optional in old maps) |
| `ground_color` | ARGB hex | cave floor tint (default opaque `7f7e71`) |
| `wall_color` | ARGB hex | cave wall tint (same default) |
| `texture` | path | cave floor texture; the wall texture path is derived by substituting `floor` → `wall` in the filename |

**Bitmap encoding.** The bitmaps are Godot BitMap bit-data only (no size
header); dimensions are reconstructed as:

```
gridW = round(width*256 / msi.cell_size) + 1 + 2*edgeBuffer   (edgeBuffer = 1)
gridH = round(height*256 / msi.cell_size) + 1 + 2*edgeBuffer
```

With defaults, a 19×19-cell map gives 79×79 samples. Bit layout: linear index
`n = gridW*y + x`; the bit lives in byte `n div 8` at position `n mod 8`,
**LSB-first**. Byte-array length is `gridW*gridH div 8 + 1` (verified: 781
bytes for 79×79). The one-sample edge buffer means sample (1,1) sits at world
(0,0) minus... more precisely, world position of sample `(x,y)` is
`((x,y) − (edgeBuffer,edgeBuffer)) * cell_size` after jitter (render doc §7).

### 4.9 `terrain`

| key | type | meaning |
|---|---|---|
| `enabled` | bool | terrain layer visible |
| `expand_slots` | bool | 8-texture mode: adds `texture_5..texture_8` and `splat2` |
| `smooth_blending` | bool | selects the plain weighted blend instead of the height-aware blend (render doc §4) |
| `texture_1` .. `texture_4` | path | terrain textures for splat channels R, G, B, A |
| `texture_5` .. `texture_8` | path | (only if `expand_slots`) channels R,G,B,A of `splat2` |
| `splat` | PoolByteArray string | raw **RGBA8** image, `width*4 × height*4` texels (**4 samples per grid cell per axis**; one sample per 64 world px). Row-major, 4 bytes per texel in R,G,B,A order. Channel value = weight of the corresponding texture. New maps are filled with (255,0,0,0) = 100% texture_1. Verified: 19×19 map → 76×76×4 = 23104 bytes. |
| `splat2` | PoolByteArray string | (only if `expand_slots`) same layout for textures 5–8. The editor keeps the two splats mutually exclusive per texel. |

World→splat mapping: splat texel = `worldPos/64 + (0.5, 0.5)`.

### 4.10 `water`

| key | type | meaning |
|---|---|---|
| `disable_border` | bool | suppress the shore border line |
| `tree` | dict | polygon tree of all water bodies; **omitted entirely when no water is drawn** (the reference map has only `disable_border`) |

`tree` is a recursive serialization of a Clipper polygon tree. Each node:

| key | type | meaning |
|---|---|---|
| `ref` | int | a runtime hash; ignored on load |
| `polygon` | PoolVector2Array string | contour in world pixels (root node has an empty polygon) |
| `join` | int | Clipper join type: 0 = square, 1 = round, 2 = miter |
| `end` | int | Clipper end type: 0 = closed polygon, 1 = closed line, 2 = open butt, 3 = open square, 4 = open round |
| `is_open` | bool | |
| `deep_color` | ARGB hex | per-body deep-water color (default opaque `3aa19a`) |
| `shallow_color` | ARGB hex | per-body shore color (default opaque `8bceb0`) |
| `blend_distance` | float | shore→deep gradient distance in **grid cells** (default 1.5) |
| `children` | array | nested nodes; odd nesting depth = hole |

Legacy: pre-tree maps stored level-wide `deep_color` / `shallow_color` /
`blend_distance` on the `water` dict; loaders should apply those to every
top-level polygon.

### 4.11 `materials`

Dict keyed by layer id (stringified int) → array of material regions:

| key | type | meaning |
|---|---|---|
| `bitmap` | PoolByteArray string | painted region, same BitMap encoding as cave (§4.8) but with a **fixed cell size of 128** world px (½ grid cell) and the same +1 and edge-buffer terms, i.e. `round(width*256/128) + 1 + 2` per axis |
| `texture` | path | fill texture; the border texture path is derived by substituting `_tile` → `_border` in the filename |
| `smooth` | bool | smooth the region outline (corner-cutting) before drawing the border |

Empty regions are not saved.

### 4.12 `paths`

Array of path dicts (a textured polyline):

| key | type | meaning |
|---|---|---|
| `position`, `rotation`, `scale` | Vector2/float | node transform; `position` equals the first edit point, and `edit_points` are relative to it |
| `edit_points` | PoolVector2Array string | user control points (the rendered curve is corner-cut smoothed from these; render doc §12) |
| `smoothness` | float | smoothing strength (corner-cut factor = `smoothness * 0.5`) |
| `texture` | path | |
| `width` | float | path width in world px (defaults to the texture's pixel height) |
| `layer` | int | z-index |
| `fade_in`, `fade_out` | bool | alpha ramp over the first/last 10% of the line |
| `grow`, `shrink` | bool | width taper at start/end |
| `block_light` | bool | generate a light occluder along the path |
| `loop` | bool | |
| `node_id` | hex string | |
| `prefab_id`, `locked` | optional | |

Paths with fewer than 2 edit points are dropped on save.

### 4.13 `objects`

Array of props. **Array order is draw order within equal z** (earlier entries
draw below later ones; the editor's "send under" simply reorders the array).
There is no y-sort and no sort-id field.

| key | type | meaning |
|---|---|---|
| `position` | Vector2 string | node origin. The sprite is **centered** on this point (texture center = position); rotation pivots here too. No per-asset pivot data exists. |
| `rotation` | float radians | |
| `scale` | Vector2 string | mirroring is baked in as a negative x component |
| `mirror` | bool | horizontal flip; redundant with `scale.x < 0` but both are written |
| `texture` | path | must resolve in the object library or `embedded://`, else the object is dropped on load |
| `layer` | int | z-index |
| `shadow` | bool | drop-shadow sprite behind the object |
| `block_light` | bool | build light occluders from the texture's alpha silhouette (threshold 0.5), centered on the sprite |
| `custom_color` | ARGB hex | only present when set; drives the red-key recolor shader |
| `node_id` | hex string | |
| `prefab_id`, `locked` | optional | |

### 4.14 `lights`

| key | type | meaning |
|---|---|---|
| `position` | Vector2 string | light center |
| `rotation` | float radians | |
| `range` | float | light radius in **grid cells**. Internally: the light texture is scaled so its width equals `range * 512` world px (= `2*range` cells diameter). Saved value = textureScale × textureWidth ÷ 512. |
| `intensity` | float | light energy multiplier |
| `color` | ARGB hex | |
| `texture` | path | light falloff sprite |
| `shadows` | bool | this light casts shadows from occluders |
| `node_id` | hex string | |
| `prefab_id`, `locked` | optional | |

### 4.15 `roofs`

Level-wide settings plus a list:

| key | type | meaning |
|---|---|---|
| `shade` | bool | enable directional face shading (default true) |
| `shade_contrast` | float | shading strength, 0–1 (default 0.5) |
| `sun_direction` | float | sun azimuth in **degrees** (default 45) |
| `roofs` | array | roof entries below |

Per roof:

| key | type | meaning |
|---|---|---|
| `position`, `rotation`, `scale` | | node transform |
| `points` | PoolVector2Array string | the **ridge centerline polyline** (not the outline), local coords |
| `width` | float | perpendicular distance from ridge to eave, world px |
| `type` | int | **0 = Gable, 1 = Hip, 2 = Dormer** |
| `texture` | path | roof tiles texture; edge/ridge/hip trim textures derived by substituting `tiles` → `edge` / `ridge` / `hip` in the filename |
| `node_id` | hex string | |
| `prefab_id`, `locked` | optional | |

### 4.16 `texts` and `texts_vis`

`texts_vis`: bool, visibility of the whole text layer (default true).

Per text entry:

| key | type | meaning |
|---|---|---|
| `text` | string | single-line content |
| `position` | Vector2 string | **top-left** corner of the text box (texts are UI controls, not centered sprites) |
| `font_name` | string | must exist in the app's font list; falls back to the first available font |
| `font_size` | int | nominal size; the control renders at 4× scale, so effective glyph height ≈ `4 * font_size` world px (`font_size` 64 ≈ 1 grid cell) |
| `font_color` | ARGB hex | |
| `box_shape` | int | **0 = None, 1 = Square, 2 = Rounded** |
| `box_border_width` | int | only when `box_shape != 0` |
| `box_background_color`, `box_border_color` | ARGB hex | only when `box_shape != 0` |
| `node_id` | hex string | |

Texts have **no rotation field**.

---

## 5. Format-version behavior

- The format constant is 3; `world.format` is read on load but there is **no
  refusal gate** for other versions.
- The only explicit version branch found: portal `wall_id` is parsed as a
  decimal int when `format < 3` and as a hex string when `format >= 3` — i.e.
  format 3 switched node-id references to hex strings (except `shapes.walls`,
  which remains decimal).
- Robustness affordances (presence checks, not version checks): `tiles` as a
  bare string; optional `patterns`/`roofs`/`texts`/`texts_vis`/
  `entrance_bitmap`/`building_wear`/`embedded`/`trace_image_visible`;
  level-wide legacy water colors; missing `node_id` triggers reassignment
  from the counter; duplicate node ids are dropped or reassigned with a
  warning.

---

## 6. Reference-map cross-checks

Confirmed against a real map (19×19): tab indentation; ARGB colors; hex counters (`"2c5"`, `"13"`); msi
defaults 512 / 0.2 / 64 with hex seed; wall `type` 1 / `joint` 1; splat byte
count 23104 = (19·4)²·4; cave bitmap 781 bytes = ⌊79·79/8⌋+1; 361 tile cells
with −1 empties; portal `wall_distance` values consistent with
`point_index + segment fraction`; `water` containing only `disable_border`
when no water is drawn.
