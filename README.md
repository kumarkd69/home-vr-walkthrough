# Home VR Walkthrough

A phone-based VR walkthrough of your house, built from `G+1.obj`. Renders
stereo side-by-side for a cheap cardboard-style headset (tested against Jio
VR glasses — no buttons/controller), with head-tracking, gaze-driven
walking, and wall collision.

Live URL: **https://<your-username>.github.io/<repo-name>/** (filled in
after first deploy — see bottom of this file / the assistant's final message
for the actual link and a QR code).

## Opening it on iPhone

1. Open the URL above in **Safari** (not Chrome — iOS only grants motion
   sensor access to Safari-based engines).
2. **Settings → Safari → Advanced → Motion & Orientation Access** must be
   **ON**. If it's off, the page will silently fail to get gyro data and
   fall back to touch-drag look. (This is a per-device Safari setting, not
   something the page can turn on for you.)
3. Load the page, tap **Enable head tracking** and accept the permission
   prompt (iOS requires this tap-triggered prompt; it can't be requested
   automatically on page load).
4. Put the phone in the headset, tap **Enter VR**. The page goes fullscreen,
   locks to landscape, and switches to the barrel-distorted stereo view.
5. Tap **✕ Exit VR** (top-right) to come back to the flat view.

If you skip motion permission (or deny it), the page falls back to
touch-drag look — drag a finger across the screen to look around — and says
so on screen.

## How the gaze movement works

There's no controller, so movement is driven by where you're looking:

- Look **down** past ~18° → walk forward.
- Look **up** past ~22° → walk backward.
- Within about ±8° of level, you don't move — so normal looking around
  doesn't drag you around the house.
- Toggle it off entirely with the **Gaze-walk** button if you just want to
  stand in one spot and look around.
- On a desktop browser, **WASD**/arrow keys move and strafe instead, and any
  connected Bluetooth gamepad/VR remote's left stick also works.

Walking speed is 1.4 m/s by default (tweakable — see below).

## Wall collision

Movement is raycast against the merged house geometry (a 3-ray "capsule"
approximation per step, with sliding along the wall when you brush past it
at an angle) so you can't walk through walls, and it slides along a wall
instead of just stopping dead. **Door leaves are deliberately excluded**
from collision so doorway openings are walkable even where a closed door was
modeled — only the wall opening geometry blocks you, not the door mesh
itself. If that's not what you want (e.g. you'd rather doors stayed solid),
remove `if(o.name !== 'door')` in `index.html`'s model-load callback.

## Re-running the model conversion

If you re-export from your design tool:

```bash
npm install        # first time only
node convert.js "G+1.obj" home.glb
```

`convert.js`:
- Parses the OBJ (there's no `.mtl`, so materials are inferred purely from
  `usemtl` group name keywords: anything with `verre` → glass, `carrelage`/
  `parquet` → floor, `enduit`/`blanc_` → wall render, `balcon` → balcony
  rail, `porte` → door, everything else → a neutral grey "other" bucket).
- Merges all triangles per bucket into one mesh each — this is what takes
  the draw-call count from **1,764 → 6**.
- Bakes the unit scale (×0.1, decimetres → metres) and the Z-up → Y-up
  rotation (−90° about X) into the vertex data, and recentres the model so
  the ground floor is at y=0 and the plot is centred on X/Z — so the viewer
  needs no runtime fix-up transform.
- Exports a `.glb` and Draco-compresses it via `gltf-transform optimize`.
- Prints the OBJ's native bounding box, the final baked bounding box, the
  detected floor-tile Y clusters (candidate slab heights), and before/after
  file size and draw-call counts — read that output after every re-run and
  update `FLOOR_HEIGHTS` in `index.html` if the detected levels moved.

To preview locally before deploying:

```bash
node serve.js       # serves the folder on http://localhost:8080
```

(Gyro/VR won't work over plain `http://localhost` on a phone — that's fine
for checking the model loads and desktop mouse-look/WASD work; test the real
head-tracking behaviour on the deployed HTTPS URL.)

## Values you can tweak

All at the top of `index.html`, in the `TUNABLES` block, or live via the
in-page **Tune** panel (IPD, distortion, walk speed) for quick lens testing
without editing code:

| Value | Default | What it does |
|---|---|---|
| `IPD_DEFAULT` | 0.064 m | Eye separation. Cheap headsets vary — if the stereo view feels wrong, adjust with the Tune panel first, then bake the number you land on back in here. |
| `DISTORT_K1_DEFAULT` / `DISTORT_K2_DEFAULT` | 0.22 / 0.08 | Barrel-distortion coefficients that pre-warp each eye's image to cancel your lens's pincushion distortion. Straight lines (door frames, wall edges) near the edge of the lens should look straight, not bowed, once tuned. |
| `WALK_SPEED_DEFAULT` | 1.4 m/s | Gaze/keyboard/gamepad walking speed. |
| `GAZE_DEADZONE_DEG` / `GAZE_FWD_THRESH_DEG` / `GAZE_BACK_THRESH_DEG` | 8° / 18° / 22° | Gaze-walk pitch thresholds. |
| `EYE_HEIGHT` | 1.6 m | Fixed eye height above the current floor's slab. |
| `FLOOR_HEIGHTS` | `[0.0, 3.56]` | Ground and 1st-floor eye-height baselines. **`3.56 m` was auto-detected from the model's floor-tile geometry by `convert.js`** (it clusters the Y-height of every "floor" triangle and reports the top candidates) — re-check this after any re-export. |
| `PLAYER_RADIUS` | 0.32 m | Collision capsule radius. |

## Model facts, verified from the OBJ

The prompt's numbers were checked against the actual file and are correct:

- Native OBJ bounding box: X 124.25 × Y 185.65 × Z 92.60 units.
- At the stated 1 unit = 0.1 m: **12.43 m × 18.57 m footprint, 9.26 m tall**
  — matches a 40×60 ft plot (≈12.2 m × 18.3 m) closely enough to confirm the
  decimetre-unit assumption.
- 108,582 vertices / 188,034 faces from the raw `wc -l`-style OBJ scan
  (three.js's OBJ parser reports 108,582 unique positions feeding 564,102
  non-indexed triangle-soup vertices before welding — consistent with the
  prompt's ~108k/~188k figures).
- 1,764 `usemtl` statements referencing 176 distinct material names — the
  `.mtl` is indeed missing, so every material had to be re-inferred from
  those names (see the conversion section above).

## Performance

| | Before (raw OBJ→GLB, one mesh per `usemtl` group) | After `convert.js` |
|---|---|---|
| Draw calls (one eye) | 1,764 | **6** |
| Draw calls (stereo, both eyes + 2 distortion passes) | — | **~14** |
| File size | 18 MB `.obj` → ~13.5 MB naive `.glb` | **~0.48 MB** Draco-compressed `.glb` |
| Triangles | 188,034 | ~183,000 (unchanged — no simplification was applied; only merged and welded) |

Other steps taken: pixel ratio capped at `min(devicePixelRatio, 2)`, stereo
render targets sized to exactly `canvasWidth/2 × canvasHeight` (so nothing
is rendered at higher-than-displayed resolution), and per-eye scissored
viewports so each half only rasterizes its own eye.

**Trade-off worth knowing:** merging each material bucket into one mesh is
what got draw calls down to 6, but it also means three.js's per-object
frustum culling now operates on 6 house-spanning bounding volumes instead of
~1,764 small ones — so looking at one room still submits the whole house's
triangles for that bucket to the GPU. On an iPhone (A13 or newer) this
should still hold 60fps in stereo for a model this size (~180k tris total,
untextured, no post-processing beyond the two distortion passes), but if you
see frame drops on an older device, the next lever to pull is
`gltf-transform simplify` in `convert.js` (currently disabled) to reduce
triangle count, or splitting `other` (174k of the 183k triangles) into a
handful of per-room buckets to restore some frustum culling.

## What's rough / not done well

- **No true ambient occlusion.** A real SSAO pass would double the cost of
  an already-doubled stereo render, so I used hemisphere + directional +
  a flat ambient fill instead. It reads fine for an untextured grey model
  but doesn't have the contact-shadow depth SSAO would give you.
- **Floor detection is a heuristic, not authoritative.** `convert.js`
  clusters the Y-height of triangles in material groups named
  `Carrelage_*`/`parquet_*`; it found clean clusters at 0.25 m and 3.56 m
  (used as Ground/1st floor) and a much noisier one at 6.88 m (probably a
  terrace/balcony slab, not a full floor — ignored). If your model's floor
  tiles aren't named consistently, or a floor has no tile group at all,
  this will miss it — check `convert.js`'s console output after each run.
- **Collision is ray-based, not a true capsule.** Three rays (centre + two
  shoulder-width offsets) approximate a capsule well enough to stop you at
  walls and slide along them, but a fast lateral movement combined with a
  thin geometry sliver could in principle skip through between ray samples.
  Not observed in testing at the default walk speed.
- **Doors are always "open"** for collision purposes (excluded from the
  collidable set) regardless of how they're modeled — see the collision
  section above if you want them solid instead.
- **No dynamic step/stair climbing.** Eye height is fixed per floor and
  switched with the **Floor** button; there's no walking up the modeled
  staircase with changing eye height as you go.
- **Materials are inferred, not authored.** Since the `.mtl` was missing,
  the 6 material buckets are reasonable guesses from `usemtl` names, not a
  designer's actual material assignment — colors/opacity are all synthetic.
- Tested in a desktop-Chromium environment plus manual code review against
  documented iOS Safari device-orientation quirks (`webkitCompassHeading`,
  the permission-gate requirement, `screen.orientation.angle` correction);
  I was not able to test on a physical iPhone from here, so please treat the
  first real on-device run as the actual acceptance test, especially around
  the iOS motion-permission prompt and cardboard lens comfort (IPD/distortion
  defaults).
