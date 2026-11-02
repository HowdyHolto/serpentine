# Serpentine: second-look review (2026-11-02)

## Where it lives

| What | Where |
|---|---|
| Source of truth | GitHub `HowdyHolto/serpentine` (public, "Pattern Generator 1"), branch `main`, HEAD `6a5dbde` |
| Local clone | `Desktop/Claude Stuff/serpentine` (cloned today; there was no local copy anywhere on this Mac) |
| Live site | https://serpentine-app.netlify.app (Netlify project `serpentine-app`, site id `1173e721-344a-45ab-96dc-da1d6de95c43`) |
| Deploy state | Production deploy is commit `6a5dbde`, i.e. the live site == repo HEAD |
| How it was deployed | Via the Netlify MCP from a Claude session (deploy source "api"), not a GitHub build hook. Pushing to GitHub probably will not redeploy by itself. |
| Origin | Bolt.new scaffold (Vite + React 18 + TS + Tailwind + lucide), 5 commits total, last work 2026-05-15 |
| Related | `Experiments/Claude UI Experiments/batch-suite` lists Serpentine as a "soon" tile in the Batch tools suite |

Stack health: `tsc` clean, `vite build` clean (214 kB JS), eslint has 1 error (unused `_e` in Canvas.tsx:381) and 2 warnings (stale `useMemo` deps in Rulers.tsx). No tests.

## What the app does today

A single-page tool: draw a rectangle or ellipse boundary (rulers in mm, 96 dpi), then fill it with a non-crossing serpentine stroke on an occupancy grid whose cell size is `strokeWidth + minGap`. Features that exist and work:

- Three fill modes: Continuous (one line), Multi-Pass (several lines), Wicked Wise (lookahead + backtracking walker)
- 90° / 45° angle modes, rounded or squared turns, corner radius + "Ring Harmony", round or flat caps
- Fixed or random segment length, direction bias, direction-switch frequency, optional gaps along the stroke, seed
- Waypoint editing: drag turns (axis-locked, hairpin pairs move together, min spacing enforced), freeze waypoints (shift-click / marquee) and regenerate only the unfrozen gaps, direction-guide arrows that bias the walker locally
- Resize boundary by edge handles, pan/zoom, keyboard shortcuts, help panel, SVG export

Dead or half-built: the Pen tool button (`P`) is wired to nothing (no Canvas handler, `BoundaryShape.type = 'path'` never used); `AngleMode = 30` exists in the type but has no UI or walker support; `zoomToFit` exists in the hook but nothing calls it; `Target Fill %` has no effect in Continuous/Wicked Wise below 100.

## Measured behaviour (headless, 512×538 px rect, cell 14 → 36×38 grid, 10 seeds)

| Mode | Fill mean | Fill median | Fill min–max | Time |
|---|---|---|---|---|
| Continuous 90°, target 75 | 15% | 10% | 3–65% | 2 ms |
| Wicked Wise 90°, target 75 | 7% | 8% | 2–12% | 8 ms |
| Multi-Pass 90°, target 75 | 59% | 60% | 39–75% | 1 ms |
| Continuous 45°, target 75 | 19% | 25% | 2–42% | 8 ms |
| Wicked Wise 45°, target 75 | 7% | 8% | 1–12% | 17 ms |
| Continuous 90°, target 100 (retry sweep) | 96% | 99% | 63–100% | 500–630 ms |
| Continuous 45°, target 100 (retry sweep) | 95% | 100% | 69–100% | 1.0–1.4 s |
| Wicked Wise 90°, target 100 (retry sweep) | 18% | 18% | 12–30% | 540–670 ms |
| Dense grid (stroke 2, gap 2 → 128×134 cells), Continuous, target 75 | 12% | 4% | 1–77% | 80 ms median, 2.1 s max |

Giant corner arcs (arc radius larger than one cell) at the default Ring Harmony of 1.00: about 12 per generation, max radius 77 px at target 75 and 247 px at target 100. With Ring Harmony 0: zero.

## Root causes (the "math we couldn't nail")

1. **The walker is greedy and self-traps.** `trySerpentineStep` (serpentineGenerator.ts:416) only takes a move if `isMoveSafe` says the remaining free cells stay connected. When no such move exists it falls through to the unsafe fallback (line 423) and splits the free area in two, and from then on it can only ever finish the half it is standing in. That is why median fill is 10%. The 100% "fix" from May is a brute-force sweep of up to 80 seeds that keeps whichever one happened not to trap; when it succeeds it is almost always a plain full-height hairpin (boustrophedon), which is why the 100% result loses all the character of the other seeds.

2. **Wicked Wise terminates at the first unsafe situation.** wickedWiseWalker.ts:277 checks `gridPath[last] === (col,row)` to detect "no fallback move found", but `col,row` were just updated to the fallback cell, so the condition is always true and the loop breaks. The "smart" walker therefore stops earlier than the plain one (7% vs 15%).

3. **Ring Harmony math blows up at long-to-long corners.** pathRenderer.ts:64-65: `propR = (cornerRadius / harmonicR) * maxR` where `maxR = min(len1, len2)/2`. With the defaults (`cornerRadius 7`, `harmonicR 7`) this is `r = maxR`, so a corner between two 200 px legs gets a 100 px radius. That is the huge dome across the top of the 100% result and the blobby loops in the top-right of most patterns. Hairpins look right only because their short leg caps `maxR` at 7.

4. **Arc geometry is only correct for 90° turns.** pathRenderer.ts:72-75 places the tangent points `r` along each leg and uses radius `r`. For a 45° deflection the tangent length should be `r·tan(22.5°)`, for 135° it should be `r·tan(67.5°)`. As written, 45° corners meet the legs with a visible kink and 135° corners get an SVG auto-scaled semicircle bulge.

5. **Grid is anchored top-left, not centered.** occupancyGrid.ts:15-16 uses `floor(width / cell)` and starts at `boundary.x`, so the remainder (up to one full cell) all ends up as extra margin on the right and bottom. Every pattern sits visibly off-center in its boundary.

6. **Ellipse export differs from the preview.** The canvas clips the strokes to the ellipse (Canvas.tsx:560); `buildSvgDocument` does not, so exported ellipse patterns bleed past the boundary by up to half a cell plus half a stroke.

7. **Export units.** svgExport.ts:35 writes unitless `width`/`height`. LightBurn (96 dpi default) will read it at the intended size; Illustrator reads unitless px at 72 ppi and will show it 33% larger. Writing `width="135.5mm"` fixes both.

8. **Gaps are quantised to whole segments.** pathRenderer.ts:116 subtracts entire segment lengths, so a requested 10–25 px gap removes a whole 200 px leg when it lands on a long one.

9. **45° mode is bolted on.** Diagonal moves plus the no-corner-cutting rule starve the walker (mean 19%); the diagonal option is only ever used as a fallback, so the look is "90° pattern with occasional diagonal escapes".

10. **Everything runs on the UI thread.** The 100% sweep already freezes the page for a second; a dense grid at 100% would freeze it for minutes (the first benchmark run of that case had to be killed after 10 minutes). `isMoveSafe` does a full flood fill per candidate per step, so cost is O(cells²) per walker, O(cells³) with Wicked Wise lookahead.

Smaller code-quality notes: `handleWaypointMove` calls `setPaths` inside a `setWaypoints` updater (App.tsx:186,190), a side effect that runs twice under StrictMode; the "Reseeded to reach 13% fill" toast is misleading when the sweep fails; `Direction Bias (V / H)` of 0.30 actually means 70% vertical; `index.html` still has the Bolt OG image and the title "Guided Generative Vector Patterns"; no touch events; no persistence, so a reload loses everything.

## Recommendations

### A. Quick wins (an afternoon, no redesign)

1. Default `ringHarmony` to 0, or cap `propR` at `cellSize / 2` so harmony only affects hairpins. Removes every giant arc.
2. Fix the Wicked Wise early-exit (track a `moved` flag instead of comparing coordinates).
3. Center the grid: `originX = boundary.x + (width - cols*cell) / 2`, same for y.
4. Clip exported strokes to the ellipse (`<clipPath>` in the SVG) and write mm units on the root element.
5. Tangent-correct arcs: `t = r * tan(θ/2)` where θ is the deflection angle.
6. Replace the toast text with "Best coverage 13% after 80 attempts", and hide `Target Fill %` in modes where it does nothing.
7. Wire up the unused `zoomToFit` (fit on boundary create, `0` shortcut), fix the lint error, drop the Bolt metadata, give the page a real title and favicon.

### B. The real fix for fill: stop walking, start tracing

Replace the greedy walker with a **spanning-tree Hamiltonian cycle**. Build a random spanning tree on a half-resolution grid (one node per 2×2 block of cells), then trace around the tree; the trace is a single closed loop that visits every fine cell exactly once, never crosses itself, and never traps. Properties that matter here:

- 100% fill every time, for every seed, in O(cells). No retry sweep, no "couldn't fully fill" toast.
- Character comes from how the tree is grown: Prim with weighted edges gives long straight runs (segment length), a horizontal/vertical weight gives direction bias, local weights give direction guides real teeth instead of only setting the initial heading, and perturbing weights per seed gives real variety without ever losing coverage.
- Works on any mask (rectangle, ellipse, imported path) as long as the coarse grid is connected; odd leftover rows/cols are handled by the centering fix above or by allowing a single "spur" row.
- Cut one edge of the loop to get an open path with two ends (today's look), or keep it closed for inlay channels and pendants, which is a new look the current engine cannot make.
- 45° becomes a post-process: chamfer any corner whose two legs are at least one cell long. Full fill is preserved and the diagonal look is uniform instead of incidental.
- Multi-Pass becomes "cut the loop into N pieces", which gives exact control over the number of paths and their lengths.

Keep today's walker as a "Wander" mode for people who like the sparse, trailing look; the benchmark says that is what it produces.

### C. Performance and robustness

- Move generation into a Web Worker with a cancel button and a time budget; the UI never freezes and dense grids become usable.
- Add vitest with the benchmark above as a regression test (fill ratio, arc radius bound, no self-intersection, every cell visited once).
- Add undo/redo (waypoint drags and freezes are easy to lose) and autosave params + boundary to localStorage, plus a shareable URL encoding seed and params.

### D. Features worth adding (ordered by value for laser and jewelry work)

1. **Numeric boundary entry** in mm (width, height, corner radius) with presets (coaster 100 mm, pendant 40 mm, business card). Drag-to-draw is fine for sketching, useless for a part that has to fit.
2. **Imported boundary**: drop an SVG path (the dormant Pen / `path` type) and rasterise it into the occupancy mask with point-in-polygon per cell. Same machinery gives a working Pen tool for free.
3. **Export for cutting**: SVG in mm with boundary on its own layer/colour (LightBurn reads colours as layers), an "outline" export that offsets the stroke into a closed cut shape for inlays, and DXF.
4. **Seed gallery**: generate 9 or 16 seeds as thumbnails and click one. For a generative tool this is the single biggest usability win.
5. **Symmetry modes** (mirror X, mirror Y, 4-fold) for medallions and pendants, done by generating one quadrant and mirroring the tree.
6. **Variable stroke**: two alternating widths, or width as a function of position, rendered as separate `<g>` groups so a laser can treat them as different power settings.
7. **Closed-loop mode** (comes free with the Hamiltonian cycle) for channel inlay and continuous engraving without end caps.
8. Direction guides that actually weight edges (see B), so an arrow visibly steers the flow in its neighbourhood.

## Changes made 2026-11-02 (uncommitted, in the local clone)

Quick wins A1 to A7 from above, plus two things found while doing them.

- **Corner arcs** (`pathRenderer.ts`): tangent-correct for any deflection angle (`t = R·tan(θ/2)`), and Ring Harmony is now capped at one cell of radius. Max arc radius in the benchmark dropped from 247 px to 14 px. Default Ring Harmony is 0.5.
- **Wicked Wise** (`wickedWiseWalker.ts`): fixed the always-true exit check. That exposed a second problem: its flood-fill "freedom" score was identical for every move that passed the connectivity check, so the mode was a byte-for-byte duplicate of Continuous. It now scores moves with Warnsdorff's rule (fewest onward options) blended 0.2/0.8 with the serpentine preference. Rect fill went from 15% to 46% mean; 45° mode now fills 100% on every seed as a concentric spiral; ellipses do not benefit (9%). It is a wall-hugging look now, distinct from Continuous.
- **Grid centering** (`occupancyGrid.ts`): leftover space is split evenly on both sides; ellipse mask uses the same offset.
- **SVG export** (`svgExport.ts`, new `units.ts`): root `width`/`height` in mm, strokes clipped to the boundary exactly like the preview.
- **Rulers** (`Rulers.tsx`): ticks were only ever generated for world 0..width and went blank when panned; they now follow the pan offset. This was hiding behind the lint warning.
- **UI**: "Target Fill %" is only shown for Multi-Pass; Continuous and Wicked Wise get a "Fill Completely" toggle (the only value that did anything). "Direction Bias (V / H)" is now "Horizontal Bias" (what it actually controls). Toast says "Best coverage N% after retries" instead of "Reseeded to reach N%". Fit-to-view button and `0` shortcut. Waypoint drag no longer sets state inside a state updater.
- **Housekeeping**: title "Serpentine", inline SVG favicon, Bolt OG tags removed, lint clean, typecheck clean, build clean.

Still open from the list: B (Hamiltonian engine), C (worker, tests, persistence), D (features). Continuous mode still self-traps (median 10%) by design of the walker; that is the engine rewrite.

## Corner radius solver (2026-11-02, later)

Holt noticed inner corners going sharp even with an outer radius. Geometry: the slider sets the centerline radius and maxes at half a cell, so the inner edge radius can never exceed half the gap. On a hairpin that is a physical limit (the legs are one gap apart). On an L-corner with empty space inside it was just the renderer not knowing what was around it.

`pathRenderer.ts` now has `solveCornerRadii`: "Corner Radius" is the minimum, and "Ring Harmony" (0..1) lets each corner grow into the room it has. A corner with empty space inside grows until its arc would come within one cell of any other stroke (cap: two cells). A corner nested directly inside a matching corner takes that corner's radius plus one cell, so stacked turns render concentric. Hairpins stay at half a cell. Verified at stroke 26 / gap 6: no overlaps, inner edges rounded everywhere except hairpins. To get rounder hairpins the only lever is the gap: inner radius = gap / 2.

Possible follow-ups: an "Inner Radius" control that drives both corner radius and the minimum gap from one number (what a laser or CNC person actually thinks in); a chamfered hairpin option that steps the lateral out by one extra cell where the neighbouring cell is free.

## D9. Concentric / contour-parallel fill (idea from Holt, 2026-11-02)

A fill mode where the path mimics the boundary (or an inner seed shape) as it works inward, still with hairpins and back-and-forth, with a conformity gradient: faithful to the contour near the edge, increasingly random toward the center, or the reverse from a seed outward. In the spanning-tree engine this is an edge-weighting rule, not a new generator: compute a distance transform over the coarse grid, weight edges by how well they run along iso-distance contours (perpendicular to the distance gradient), and scale that weight by conformity(distance). A seed shape is the same thing with the distance measured from the seed instead of the boundary. The Trace session has been asked to keep edge weights pluggable so this drops in.

Field hook (built with Concentric, 2026-11-02): the contour rule is not tied to the distance transform. `ScalarField` in `traceGenerator.ts` is a value per coarse node plus a central-difference gradient (`gx`, `gy`), its range and a `unit` (the change per coarse step that counts as fully across). `makeScalarField(coarse, values, unit)` builds one from any values; `distanceField(coarse)` is the producer Concentric uses. `createFieldEdgeWeight(params, field, { strength, conformity })` is the generic weight: edges along the field's iso-lines are cheap, edges across its gradient dear, scaled by a per-node `conformity(node, field)` callback. Concentric is that weight over the distance field with conformity = a gradient over normalized depth. A terrain mode is a `heightField(sampler)` with conformity from slope (`hypot(gx, gy)`); a photo mode is an `imageField(imageData, blur, bands)` with conformity from band-edge proximity, and `field.value` bands can also drive Pieces and stroke colour downstream. `EdgeContext.fromDistance/toDistance` stay as they were for weights that want them; the field weights do not use them.

## Pattern modes (2026-11-02)

The panel now leads with a **Mode** control: **Serpentine**, **Concentric**, **Contour**. `GenerationParams.patternMode` picks it; the old `fillMode` is now the engine behind a Serpentine pattern only (Trace by default; Continuous, Multi-Pass and Wicked Wise live under an "Engine" disclosure inside the Serpentine mode, kept for their sparser look). Concentric and Contour always run on Trace, so `usesTrace(params)` in `types.ts` is the one check for "is this the Trace engine" and the generator, the App toast logic and the panel all use it. `createEdgeWeight` in `traceGenerator.ts` switches on the mode. The shared sections (Stroke, Turns, Spacing, Segments, Path, Gaps, Seed) never move when the mode changes; Path holds Closed Loop and Pieces (Trace-only) plus Horizontal Bias and Direction Switch Freq, which shape every mode wherever the contour term is weak.

**Contour** is the terrain mode Holt described: the line follows the iso-lines of a seeded height field like a topographic map, with slope deciding how faithful it is. It is `createContourEdgeWeight`: `createFieldEdgeWeight` over `heightField(coarse, noise)`, where `noise` is 3-octave seeded value noise (`src/engine/noise.ts`) with features `contourScale` px apart, and conformity is `contourConformity(slope, contourSlope, contourInvert)` with slope normalised to the steepest active node. The field weight got a `measure` option: Concentric keeps `'value'` (change in distance over the edge), Contour uses `'direction'` (cosine between the edge and the field gradient), because with `'value'` gentle ground barely steered and the result was a patchwork of axis-aligned domains only on the steep parts; with `'direction'` every slope steers fully and the pattern shows coherent swirl domains and nested rings around each hill. Changing the seed reshapes the terrain.

Parameters (Mode section, Contour): **Strength** (0..1, default 0.8; 0 reproduces Serpentine exactly), **Feature Size** (40..600 px, default 160: how far apart the hills are), **Slope Response** (0..1, default 0.6: 0 follows the terrain everywhere, 1 is faithful on steep ground and loose on flat), **Invert** (faithful on flat ground instead).

Measured (`src/engine/__tests__/contour.test.ts`, 7 seeds, cell 14 unless noted): mean over steps between coarse blocks of 1 − |cos| between the step and the terrain gradient, so 1 along a contour and 0 straight up a slope.

| Setting | Rect 512×538 | Ellipse 400 |
|---|---|---|
| Serpentine | 37% | 36% |
| Contour, strength 1, slope 0 | 61% | 58% |
| Contour default (0.8 / 0.6) | 57% | 55% |
| Contour, strength 1, slope 1 | 53% | 52% |
| Contour, strength 1, slope 1, invert | 58% | 55% |
| Contour, feature size 60 | 60% | 58% |
| Contour, strength 1, cell 6, feature 300 | 61% | 60% |

The 16 contour tests cover the noise (deterministic per seed, 0..1, smooth), the conformity curve, the margin over Serpentine (≥ 0.15 on the rect, ≥ 0.1 on the ellipse, floor 0.55), strength 0 equal to Serpentine, the mode dispatch, and the full Trace invariants for four settings × 5 seeds × both shapes. 126 tests in all.

Known limits: the same 4-connected ceiling as Concentric on a curve (a contour at 45° is a staircase, so scores top out near 60%); at the default cell (14 px) a 480 px boundary only fits one or two hills, so the terrain reads as a few large domains until the stroke and gap shrink or the feature size drops; the frozen-waypoint regeneration still uses the old walker for every mode. Follow-ups: an image field (`imageField(imageData, blur, bands)`, with bands driving Pieces and stroke colour) is the photo mashup, and an inner seed shape for Concentric is a distance field measured from the seed; both are new `ScalarField` producers, no engine change.

## Jitter (2026-11-02)

A **Jitter** slider (Path section, 0..1, default 0) nudges every anchor after generation so lines lean and wobble organically, from Holt's request for a slight haphazard feel without mess. `applyJitter` in `src/engine/jitter.ts` displaces each waypoint by a smooth seeded value-noise field of position (feature size 4 cells, so neighbouring anchors move together and long runs lean rather than zigzag), with the magnitude capped at `jitter × 0.45 × minGap`. Two neighbouring strokes are one gap apart edge to edge, so even opposite nudges leave a tenth of the gap between them, and every segment is straight between anchors, so nothing ever touches or crosses; `jitter.test.ts` checks the minimum centerline distance between non-adjacent segments at full jitter on a rect and an ellipse. The displacement is a function of seed and position, so a closed loop's coincident ends stay coincident. The path structure (end-cap pairs, segment axes) is built from the clean layout before the nudge. The corner solver now treats |cos| < 0.3 as a right angle and cos > 0.9 as the same direction, so tilted corners still get the concentric radius growth. Limits: frozen-waypoint regeneration does not jitter the new anchors; the noise scale is fixed.

## Library: saved arrangements (2026-11-02)

A **Library** panel (toolbar book icon, or L) saves and restores arrangements. An arrangement is the boundary, the full settings including the seed, the direction guides, and also the waypoints, path structure and frozen set, because hand-dragged anchors and frozen points cannot be regenerated from the seed; loading one is therefore exact, not a re-roll. `src/engine/arrangements.ts` holds the model, `createArrangement`, `normaliseArrangement` (validates a parsed object, fills missing settings from `DEFAULT_PARAMS` so saves from older builds load, drops out-of-range frozen indices), `loadArrangements` / `storeArrangements` over `localStorage` under `serpentine.arrangements.v1` (corrupt entries are skipped, a full or blocked storage shows a toast), and `serializeArrangement` / `parseArrangement` / `downloadArrangement` for JSON export and import. `LibraryPanel.tsx` lists entries newest first with a polyline thumbnail, name, mode, seed and date; click to load, export as JSON, delete, or import a JSON file (imported entries are added and loaded). Saving under a frozen edit stores the frozen parameter set. Storage is per browser; export to keep a file. Not built: renaming, reordering, a shareable URL.

## Pen tool, rocks, Pond / Garden terrains, and the Rake mode (2026-11-02)

**Pen tool (P)** now draws polygon boundaries: click to place vertices, click the first vertex (or Enter, or double-click) to close, Escape to cancel. A `'path'` boundary carries its `points` for the fill mask (`OccupancyGrid` keeps a cell when its centre is inside the polygon) and its `pathData` for the outline, the canvas clip and the export clip (`boundaryShapeElement` in `geometry.ts`). Polygons have no resize handles. Concentric follows a polygon's offset contours as it does a rectangle's.

**Rocks (K)** are points the terrain reacts to, each with an elevation (-1..1): click to place, drag to move, shift-click to remove; the panel lists them with an elevation slider for the selected one. They are saved in arrangements and changing them regenerates when they matter.

**Terrains** for Contour and Rake, picked in the panel: *Noise* (seeded hills), *Pond* (a bump per rock, height = elevation, fading over Rock Spread px, optionally over a Terrain Mix of the noise; ripples spread and merge where bumps overlap), *Garden* (distance to the nearest rock, each rock's distance scaled by 2^-elevation so an elevated rock's rings spread wider, with the boundary edge as a rake centre pushed back by (1 - Edge Influence) × half the boundary, so lower influence gives the edge a narrower band without changing ring spacing). `contourField` in `traceGenerator.ts` and `terrainSampler` in `rake.ts` are the two producers (coarse-node and world-coordinate).

**Contour with rocks (Trace engine).** The field weight gained a `bands` term: nodes on discrete contour lines (multiples of `field.unit`, the mean change per coarse step) are cheaper. Honest result: on a 4-connected grid a ring comes out as a nested rounded square, because a circle has no local signature at 45° (both axis steps score the same and straightness wins), so Pond and Garden under Contour give boxy rings around each rock that merge and collide. The 45° staircase limit is the same one Concentric has on an ellipse. Real ripples need the next engine.

**Rake mode** (`src/engine/rake.ts`) draws the terrain's iso-lines as separate lines instead of one serpentine: marching squares over a sample grid of a third of a cell, chained into polylines, smoothed (two Chaikin passes), pruned, simplified (Douglas-Peucker 0.25 px). Over Garden the levels are one cell apart, so lines are exactly one gap apart: true zen-garden ripples that collide along ridges, plus the edge's rake. Over Pond and Noise the levels are spaced so the mean spacing is one cell and lines bunch on steep ground, like a topographic map; `pruneCrowded` then cuts a line wherever it comes within stroke + gap/2 of a line already kept (lowest level first), bridges grazing contacts shorter than that distance instead of cutting, and rejoins a cut ring across its seam, so nothing overlaps. Hysteresis (added later, after Pond rings around a steep rock came out as dashes): a line crowded over more than half its length is dropped whole, since it is the next ring in and a hair too close all round; a crowded stretch shorter than 1.5 cells is bridged unless it comes within the stroke width of the other line, which always cuts; and surviving pieces must be at least 1.5 cells long. On two +1 rocks of spread 200 over a 25% noise mix with Min Length 1 this took the design from 203 lines with 89 under three cells to 120 lines with 14, at the same drawn length and the same closest approach. **Min Length** (cells, default 3) drops the strays left where lines narrow at a junction. **Width Variation** (-1..1) thins the low or the high lines, never above the stroke width, so the gap holds; `renderRakePaths` in `pathRenderer.ts` draws each run as a polyline (Z when its ends meet) with that width, and the exporter groups paths by width as before. Rake lines are waypoint runs ('start' carries the line's level), so the Library, jitter and export work unchanged; waypoint dots are hidden, frozen regeneration is skipped, and Segments, Bias and Switch controls are hidden for Rake since they have no meaning there.

Measured in `rake.test.ts`: garden rings around one rock are one cell apart to within a pixel; an elevated rock has fewer rings; lines stay inside an ellipse and a polygon; after pruning, no two lines come within the stroke width. 156 tests.

Not built: variable width along one Trace line (Rake has width by level instead), colour along the path, shapes along the path, renaming library entries.

## Suggested order

1. Quick wins A1–A7 (restores trust in the output immediately; ship to Netlify).
2. Hamiltonian engine behind a new "Trace" fill mode, with tests; make it the default once it matches on look.
3. Web Worker + seed gallery + numeric boundary.
4. Export for cutting, imported boundaries, symmetry.

## Trace engine (2026-11-02)

Section B is implemented as a new fill mode, **Trace**, in `src/engine/traceGenerator.ts`, and it is now the default. The existing walker modes are unchanged.

How it works: the occupancy grid is built with even dimensions (an odd leftover row or column is trimmed and the grid re-centered, so the pattern stays centered with up to half a cell of extra margin per side). Each 2×2 block of cells is a coarse node; a node exists only where all four cells are inside the mask, and only the largest connected component is used. A spanning tree is grown over the coarse nodes with a randomized Prim whose edge weights come from one pluggable function (`EdgeWeightFn`, context: both nodes, direction, straight-or-turn, run length vs target, distance from the mask edge, guide axis, RNG). The default weights make a straight continuation cheap until the run reaches the target segment length, tilt horizontal vs vertical by Horizontal Bias, and pull edges onto a direction guide's axis within its radius. The loop that hugs the tree at half a block is a Hamiltonian cycle of the fine grid; it is traced in one pass and cut at the cell nearest the bottom-left corner (or kept closed with the Closed Loop toggle). Pieces cuts it into N open paths at straight stretches. 45° is a chamfer of every corner by half a cell, so hairpins become chevrons and coverage is unchanged. The 100% retry sweep never runs for Trace.

Measured (vitest benchmark in `src/engine/__tests__/trace.test.ts`, 512×538 rect, cell 14, 10 seeds):

| Mode | Fill mean | Fill median | Fill min–max | Time (median / max) |
|---|---|---|---|---|
| Trace 90° | 100% | 100% | 100–100% | 0.8 ms / 2.7 ms |
| Trace 45° | 100% | 100% | 100–100% | 0.3 ms / 0.7 ms |
| Trace, ellipse 400×400 | 93% | 93% | 93–93% | 0.1 ms / 0.2 ms |
| Continuous 90°, target 75 | 31% | 38% | 4–76% | 6.8 ms / 20 ms |
| Wicked Wise 90°, target 75 | 41% | 57% | 5–78% | 20 ms / 23 ms |
| Multi-Pass 90°, target 75 | 58% | 60% | 52–66% | 1.0 ms / 2.1 ms |
| Continuous 90°, target 100 (sweep) | 96% | 100% | 73–100% | 604 ms / 764 ms |

The ellipse's missing 7% is the ring of partial blocks along the edge, by construction (a coarse node needs all four cells inside). The 94 tests assert, for rect and ellipse at three cell sizes and seven seeds: every coverable cell visited exactly once, 4-connected closed cycle, no consecutive coincident waypoints, rect fill ratio exactly 1.0, closed loop joins mid-run, pieces cover every cell once, 45° legs are true diagonals, guides pull runs onto their axis, and no retry sweep for Trace.

Known limits: frozen-waypoint regeneration still uses the walker to fill gaps (Trace does not yet respect frozen runs); a closed loop is rendered as a path whose first and last point coincide mid-run rather than an SVG `Z`, which is seamless with round caps and may show a hairline seam with flat caps on screen; editing the start waypoint of a closed loop opens it. A contour-parallel ("concentric") look can be added as another `EdgeWeightFn` that reads `fromDistance`/`toDistance`.

## Concentric (2026-11-02, later)

D9 is implemented as the **Concentric** pattern mode (originally a toggle inside Trace) (`createConcentricEdgeWeight` in `src/engine/traceGenerator.ts`). It is an edge-weighting rule on the same spanning tree, so every Trace guarantee (100% fill, one non-crossing line, Closed Loop, Pieces, 45°) still holds, and `pathRenderer.ts` is untouched.

How it works: `CoarseGrid.distance` is now an exact Euclidean distance transform over the coarse nodes (1 on the outer ring, then 1 + the distance to the nearest ring node; on a rectangle this is the same as the old 4-neighbour BFS, on a curve the contours are smooth offsets instead of diamonds). The concentric weight wraps the default weight and adds `CONTOUR_COST × strength × conformity × (crossing − 0.5)`, where `crossing` is how much the distance changes along the edge (0 along a contour, 1 straight across; on a curve the axis edge nearest the tangent scores lowest). `CONTOUR_COST` (2.5) beats turn + overshoot + jitter, so at full conformity Prim consumes a whole ring before it crosses to the next one. The tree becomes nested C-shaped rings joined by single radial edges, and the loop that hugs it reads as offset rings with a hairpin where each ring breaks. The straightness, Horizontal Bias and guide terms are still there, so segment length and H/V bias shape the result wherever conformity is below 1.

Parameters (Mode section, shown for Concentric):

- **Strength** (0..1, default 0.7): scales the contour term. 0 reproduces the plain Trace exactly; 1 follows the contours as strictly as the grid allows.
- **Falloff** (0..1, default 0.5): conformity gradient over normalized depth (0 at the boundary, 1 at the deepest node). 0 = the same everywhere; 1 = faithful at the edge, falling linearly to no contour term at the center, where the plain Trace look takes over.
- **Invert** (default off): measures depth from the center instead, so the path is faithful to the contours at the core and loosens toward the edge. An inner seed shape would be the same thing with the distance measured from the seed; not built.

Measured (`src/engine/__tests__/concentric.test.ts`, 7 seeds, cell 14): "contour score" is the mean over steps between coarse blocks of 1 − |Δdistance|, by depth band.

| Shape | Setting | Outer third | Middle | Inner third |
|---|---|---|---|---|
| Rect 512×538 | Concentric off | 53% | 61% | 49% |
| Rect | strength 1, falloff 0 | 98% | 98% | 93% |
| Rect | strength 1, falloff 1 | 98% | 97% | 78% |
| Rect | strength 1, falloff 1, invert | 71% | 97% | 93% |
| Rect | default 0.7 / 0.5 | 98% | 98% | 91% |
| Ellipse 400 | Concentric off | 42% | 42% | 42% |
| Ellipse | strength 1, falloff 0 | 65% | 67% | 78% |
| Ellipse | strength 1, falloff 1 | 65% | 64% | 61% |
| Ellipse | strength 1, falloff 1, invert | 49% | 62% | 78% |

The 16 new tests assert those margins per seed for rect and ellipse (on > off by 0.3 / 0.15, falloff lowers the inner third, invert lowers the outer third), that strength 0 and Concentric off give byte-identical output to plain Trace, and the full Trace invariants (every coverable cell once, 4-connected closed cycle, rect fill ratio 1.0) for four concentric settings × 7 seeds × both shapes, plus two on the field hook (a column-ramp field pulls runs vertical; concentric equals the field weight over the distance field). 110 tests in all.

Known limits: a 4-connected path can only follow a curved contour by alternating axis steps, so a circle's score tops out near 65% and its 45° zones show staircases or straight runs rather than arcs; the rings break (hairpin) at one point per ring, opposite where Prim entered it; conformity is linear in depth (no curve shaping); no seed shape yet. Screenshots of each setting are in the side-session notes folder under `concentric-screenshots/`.

## Style layer: length gradients and markers (2026-11-02, later)

A rendering-only layer on top of the geometry: `params.style` (`PathStyle` in `src/types.ts`, defaults in `DEFAULT_STYLE`) colours the lines along their length and places shapes along them. Nothing in it changes a waypoint, so a style edit never regenerates (App keys its regenerate effect on the params minus `style`) and applies even while the path is frozen; old library saves load with the default style (`normaliseArrangement` deep-merges it).

**Model.** Gradient: on/off, two or three hex stops, scope `'whole'` (once across every run in order) or `'per-run'` (restarts on every sub-path: each Piece, Multi-Pass pass or Rake line; gap pieces of one run share it), a **Transition** (`gradientSpread`, 0..1: the fraction of each stop-to-stop interval spent blending, centred, so 1 is a smooth sweep, 0.3 holds each colour and blends briefly between them, and 0 is hard bands with a switch halfway between stops), and a repeat count (mirrored, A→B→A, so a repeat never jumps). Markers: on/off, shape (`dot | square | dash | triangle`), spacing in px, size as a multiple of the stroke width (dot diameter, square side, dash length, triangle height), colour as a hex or `'gradient'` (the gradient colour at that spot, from the stops even when the stroke gradient is off), skew in degrees added to the path tangent, and `overlay` or `replace` for whether the stroke still draws.

**How it works** (`src/engine/pathStyle.ts`). SVG has no gradient-along-a-path, so each rendered run is cut into short pieces by arc length and every piece gets its own `stroke`. The pieces are cut from the renderer's own geometry: `parsePathD` reads the M / L / A / Z output of `renderPaths` back into lines and tangent corner arcs (arc centres recovered from the endpoint form), `slicePath` cuts exact sub-lines and sub-arcs at any arc length (wrapping on a closed loop), and `primitivesToD` writes them out again, so corners stay the solver's arcs. Piece length is one cell (stroke + gap, at least 4 px), stretched only if a design would exceed 6000 pieces. Adjacent pieces overlap by 0.75 px so no seam shows with round or flat caps; the run's real ends keep the chosen cap. Markers are placed at equal arc-length intervals along the same geometry (`n = round(length / spacing)` per run, centred on open runs, from the joint on closed ones) with the tangent angle, and come out as `RenderedMarker`s; `markerGeometry` / `markerTransform` give the canvas and the exporter the same circle, rect, line or polygon. `renderPaths` now tags each path with its `run` index (`RenderedPath.run`) so per-run scope can group gap pieces; `applyPathStyle(paths, params)` is the entry point, with `renderStyledPaths` / `renderMarkers(waypoints, params)` as shortcuts. App keeps the plain geometry in state and derives the styled output with `useMemo`, so Canvas draws `stroke ?? white`, and `buildSvgDocument(boundary, paths, params, markers)` groups paths by width and colour (black when unstyled), writes markers in their own `<g id="markers">`, and leaves the stroke out under `replace`; still mm units, still clipped to the boundary. The Style section of the panel holds the controls (colour inputs are `<input type="color">`); library thumbnails tint with the middle stop when a save has the gradient on.

Measured in `src/engine/__tests__/pathStyle.test.ts` (21 tests): parsed arc centres and lengths, slices that join end to end and sum to the run length, pieces that cover a run and whose red falls and blue rises monotonically, spread values from a plain blend down to two-colour bands, per-run versus whole scope on two runs, gap pieces continuing one gradient, mirrored repeats, a real serpentine, closed loop, 3 pieces and rake split without NaN, marker spacing / count / size / skew / colour on straight runs and a real closed loop, and an export containing the colours, a colour-and-width group per colour, a markers group and no stroke under replace. 177 tests.

Limits: colour is linear in RGB (no perceptual space); the gradient's resolution is one cell, so a very short run is one flat piece at its middle colour; 'whole' scope orders runs as rendered (rake lines by level, pieces by cut order); markers are not thinned where they would overlap at tight corners; a flat-capped piece seam on a sharp arc is covered by the overlap, not a joined outline, so a laser following every piece outline would see the overlaps (export the gradient off for cutting, on for engraving / print). A `dash` marker with `'gradient'` colour at size 1 is invisible over the stroke by design (it matches the line); use `replace` or a fixed colour.
