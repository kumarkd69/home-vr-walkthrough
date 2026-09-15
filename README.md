# Home VR Walkthrough

A phone-based VR walkthrough of your house, built from `G+1.obj`. Renders
stereo side-by-side for a cheap cardboard-style headset (tested against Jio
VR glasses — no buttons/controller), with head-tracking, gaze-driven
walking, and wall collision.

Live URL: **https://kumarkd69.github.io/home-vr-walkthrough/**
(scan the QR code sent alongside this file, or open the link directly).

## Opening it on iPhone

1. Open the URL above in **Safari** (not Chrome — iOS only grants motion
   sensor access to Safari-based engines).
2. **Settings → Safari → Advanced → Motion & Orientation Access** must be
   **ON**. If it's off, the page will silently fail to get gyro data and
   fall back to touch-drag look. (This is a per-device Safari setting, not
   something the page can turn on for you.)
3. Load the page, tap **Enable head tracking** and accept the permission
   prompt (iOS requires this tap-triggered prompt; it can't be requested
   automatically on page load). This grants **both** orientation and motion —
   the gyroscope needs the second one.
4. Tap **Enter VR**, then you get a **6-second countdown** — use it to put the
   phone in the headset and hold your head level, looking straight ahead. It
   measures how the phone is sitting and calibrates to it. If the view is ever
   tilted or facing the wrong way, look straight ahead and tap **Recentre** to
   redo it.
5. Tap **✕ Exit VR** (top-right) to come back to the flat view.

If you skip motion permission (or deny it), the page falls back to
touch-drag look — drag a finger across the screen to look around — and says
so on screen.

## How the gaze movement works

There's no controller, so movement is driven by where you're looking:

- Look **down** past ~18° → walk **towards whatever you were just looking at**.
- Look anywhere else — level, up, sideways → you **stop**. Looking up is just
  looking up; it never walks you backwards.
- Toggle it off entirely with the **Gaze-walk** button if you just want to
  stand in one spot and look around.
- To go **backwards**, use the ▼ button on screen, a bound remote button, or
  S / down-arrow on a keyboard.
- On a desktop browser, **WASD**/arrow keys move and strafe instead, and any
  connected Bluetooth gamepad/VR remote's left stick also works.

Walking speed is 1.4 m/s by default (tweakable — see below).

## Why the view flickered to a back view when you looked up

The horizon is exactly where iOS has to switch how it encodes your
orientation, and all three of alpha/beta/gamma jump by ~180° at the same
moment:

```
head  0°  ->  alpha  90.0   beta    0.0   gamma -90.0
head +5°  ->  alpha -90.0   beta -180.0   gamma +85.0
```

Composed together those jumps cancel perfectly — but only if all three land in
the same sample. Alpha comes from the slower, heavily filtered magnetometer
pipeline, so for a frame or two it hasn't caught up yet. Measured, with alpha
lagging a single sample, the computed heading swings a **full 180° and back**:
the view snapping round to face backwards precisely as you look up.

That step is physically impossible between two samples (it would be thousands
of degrees per second), so it's now recognised for what it is — an encoding
artefact, not a head movement — and the last good heading is held until the
values settle. Verified in check 12: raw heading jumps 180°, de-glitched
heading jumps 0°.

Separately, every orientation change now eases in over ~24ms instead of being
applied in one step, so nothing in the view moves a whole frame at a time.
That's short enough not to read as lag (an instantaneous 30° step settles in
88ms; real head movement is continuous, so the practical lag is the 24ms).

## Using it without a headset (e.g. for parents)

Just open the link on a phone and use the **on-screen arrow buttons**
(▲ forward, ▼ back, ◀ ▶ sidestep). Drag a finger on the picture to look
around. No headset, no permissions, no controller needed — tap
**Skip — use touch-drag look** on the first screen and go.

## Why looking down walked you AWAY from things

This one was a plain bug in my code, present since the first version.

`head` is a `THREE.Object3D`, and **`Object3D.getWorldDirection()` returns the
object's +Z axis — which points *behind* the viewer.** Only `Camera` overrides
it to return the direction you're looking. The movement code used it, so the
walk vector pointed backwards, while `currentPitchRad()` (which decides
forward vs back) correctly used −Z. The two disagreed by 180°.

So: look at the sofa → look down → walk directly away from the sofa. It
mirrored sidestepping too. Fixed, and check 11 in `tracking-test.mjs` now
asserts the two agree so it can't come back.

If it's ever still backwards for you, **Tune → Swap gaze walk direction**
flips it in one tap.

## Why it was slow / not real time

Two separate causes, both measured:

1. **Collision was raycasting the entire house every frame.** three.js has no
   acceleration structure, so each ray tested all ~190k triangles. Measured on
   a fast desktop: **60fps standing still, 30fps the moment you moved** — on a
   phone rendering in stereo, far worse. Fixed by building a slim per-floor
   collision set (only wall-like triangles within the band your body actually
   occupies) and bucketing it into a 0.5m grid, so a step tests a few hundred
   triangles instead of 190,000. Back to a solid **60fps while moving**, with
   collision behaviour verified identical (blocked at the same wall, same free
   travel elsewhere).
2. **Head tracking was easing toward gravity instead of following it.** With
   no gyroscope the orientation was being nudged 35% per reading, which reads
   as lag. iOS already smooths these values, so it now snaps straight to them.

## Why you couldn't look left and right

Yaw came *only* from the gyroscope, and the gyroscope was never arriving — so
turning your head did nothing at all, and the view only responded to tilt.
Two fixes:

- **The permission request was wrong.** `DeviceMotionEvent.requestPermission()`
  (the one that gates the *gyroscope*) was being fired at the same moment as
  the orientation request. Firing a second request while a prompt is already
  up gets it rejected, leaving orientation working and the gyro silently dead.
  Motion is now requested first, on its own.
- **There's now a fallback.** If the gyroscope still isn't available, yaw is
  taken from the compass/alpha composition instead, so looking left and right
  works regardless. Verified: yaw tracks 1:1 with heading, horizon stays level.

The diagnostics panel shows which mode you're in — `track:fusion` (gyro),
`track:gravity-only(no gyro!)`, or `track:legacy`.

## First: turn OFF Portrait Orientation Lock

Swipe down from the top-right of the screen and tap the padlock icon so it's
off. This matters more than it sounds — see below.

## Why the view tilted/turned weirdly (the second bug)

iOS Safari **cannot lock or control screen orientation from a web page**. If
you have Portrait Orientation Lock switched on, Safari keeps the page in
portrait and keeps reporting `screen.orientation.angle === 0` — even while the
phone is physically sideways in the headset. Any code that trusts that value
(the previous version did, and so does essentially every cardboard demo)
rotates the entire world by 90°. Measured:

```
head turned  -30°  ->  horizon tilt: trusting the OS  90°   measuring gravity  0.00°
head turned    0°  ->  horizon tilt: trusting the OS  90°   measuring gravity  0.00°
head turned  +30°  ->  horizon tilt: trusting the OS  90°   measuring gravity  0.00°
```

A permanent 90° roll is exactly "weirdly turning / tilting" — and because the
world is rotated a quarter turn, your head *pitch* becomes view *roll*, which
is also why looking down walked you backwards.

**The fix: stop asking the OS and measure it.** While you look straight ahead
the viewing axis is horizontal, so gravity lies in the plane of the screen —
and its direction in that plane *is* the phone's rotation in the headset. That
is a physical measurement nothing can misreport. Verified for every mounting
(check 9) and against the rotation-lock scenario (check 10).

Because of this the app now **calibrates**: when you tap Enter VR you get a
6-second countdown to get the phone into the headset and hold your head level,
then it measures. **Recentre** re-runs the same measurement any time.

If rotation lock is still on, the 3D view is corrected anyway (the canvas is
rotated to compensate) and you'll get an on-screen warning — but the buttons
and text overlays can't rotate with it, so they'll read sideways. Hence: turn
the lock off.

## Why head tracking flipped when you looked up (the first bug)

This was a real bug with a specific, findable cause — worth writing down
because almost every three.js cardboard example on the internet has it.

`deviceorientation` reports **alpha / beta / gamma**, a Z-X'-Y'' Euler
decomposition, and gamma is clamped to ±90°. A phone lying in a headset, in
landscape, looking at the horizon sits at **beta = 0, gamma = −90** — exactly
on gamma's boundary, which is also the gimbal-lock configuration of that
decomposition. So the moment you pitch your head above horizontal, iOS has no
choice but to switch to the other valid encoding of the same pose. Measured
from the actual math (`tracking-test.mjs`, check 7):

```
head -5°  ->  alpha   90.0   beta     0.0   gamma  -85.0
head  0°  ->  alpha   90.0   beta     0.0   gamma  -90.0
head +5°  ->  alpha  -90.0   beta  -180.0   gamma  +85.0     <-- all three jump
```

All three values jump ~180° simultaneously, right at the horizon. In exact
arithmetic those jumps cancel perfectly. In reality they don't: alpha comes
from the heavily-filtered magnetometer/heading pipeline and lags behind
beta/gamma. Simulating just **3° of alpha lag gives up to 180° of view error**
(check 8) — that is your "when I look up it switches to the back angle", and
it's why you couldn't look up at all: the failure sits right at eye level.

No amount of smoothing or glitch-rejection fixes that, because the data isn't
glitching — the *representation* is degenerate there. So tracking was rebuilt:

- **Pitch and roll** come from the **gravity direction**, computed from beta
  and gamma only. Gravity is a physical direction, not a decomposition
  artifact — and it's provably identical for *both* encodings of a pose
  (verified to 1e-16 in check 2), so it sails straight through the jump.
- **Rotation** is carried by **integrating the gyroscope**
  (`devicemotion.rotationRate`) into a quaternion. Integrating angular
  velocity never decomposes into Euler angles, so there's no singularity
  anywhere — you can look straight up, straight down, or roll over.
- Gravity continuously pulls the integrated orientation back to true vertical,
  so gyro drift in pitch/roll can't accumulate.
- **alpha is never read at all.** That also makes tracking immune to indoor
  magnetic interference, which is a genuine problem inside a house.

Yaw drift is handled by the **Recentre** button, which now simply makes
wherever you're looking the new "forward".

Verified end-to-end in `tracking-test.mjs`: pitch is recovered to within
0.000° across a −80°…+85° sweep, look-down correctly reads as negative pitch
(so **look down = walk forward**), and a full 90° gyro sweep to straight-up
has no discontinuity (largest single step 0.9°).

Two escape hatches remain in **Tune** in case your phone's axes differ from
the spec: **Invert look up/down**, **Invert turning**, and **Legacy head
tracking** (the old method) — all saved on your phone.

> Note: this now requires **motion** permission as well as orientation
> permission. Earlier versions only asked for orientation, which is why the
> gyroscope wasn't available. Both are requested on the same tap.

## Using the IRUSU (or similar) Bluetooth VR remote

**Your remote is currently in the wrong mode, and no web page can fix that
from software.** You reported: A = volume down, X = volume up, Y = mute,
B = Home (double-press = app switcher), joystick = nothing.

Those are **HID consumer-control codes**. iOS consumes them at the system
level — they change the ringer volume and open the app switcher no matter
what app is in front. They are never delivered to Safari, so no JavaScript,
in this page or any other, can see them. Nothing I write can intercept
volume, mute, or Home.

These generic VR remotes (IRUSU, VR BOX, Shinecon — all the same reference
design) ship with **several switchable HID modes**, typically something like
music/media, mouse/pointer, and game. Yours is in media mode. The mode is
changed with a **key combination on the remote itself**, usually a modifier
button (the `@`-looking one, or the power button) **held together with one of
A/B/X/Y for a few seconds**, sometimes needing a re-pair afterwards.

I don't know the exact combo for your specific unit and won't guess — check
the slip of paper in the box, or try each modifier + face button held ~3
seconds, re-pairing in **Settings → Bluetooth** if it drops.

**How to tell instantly whether you've found a mode that works:** open
**Tune** and watch the *Remote / controller* section while you press buttons.

- **"last key" changes** → the remote is in a keyboard-style mode. This is the
  best outcome on iOS. Use **Learn buttons** (below).
- **"pressed [...]" shows button numbers** → it's a real Gamepad. The stick
  already walks and strafes; face buttons work too. Note that iOS Safari only
  exposes *some* controllers to the Gamepad API, so this mode may simply not
  appear even if the remote offers it.
- **"last key" shows `mouse button N`** → the remote is in **mouse mode**, and
  that works too — those buttons are bindable with **Learn buttons**. Of the
  modes these remotes offer, mouse mode is often the easiest to get working in
  Safari, so it's worth hunting for.
- **Neither changes, ever** → still in media mode; nothing reaches the page.

### Learn buttons — mapping A/X/Y/B exactly how you wanted

Once *anything* from the remote reaches the page, tap **Learn buttons** in
Tune. It asks for four presses in order — **FORWARD, BACK, LEFT, RIGHT** — and
binds whatever arrives for each, whether that's a keyboard code or a gamepad
button index. So press **A** for forward, **X** for back, **B** for left and
**Y** for right, exactly as you asked, and that's your mapping. It's saved on
your phone and survives reloads.

If the remote turns out to have no mode that talks to Safari, gaze-walk is
still the fully working path — and it should behave properly now.

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
| Invert look up/down | off | Tune panel, not code — flips the pitch axis if your phone reports it mirrored. Saved to your phone. |
| Invert turning | off | Tune panel — same idea for the turn axis. |
| Legacy head tracking | off | Tune panel — reverts to the old alpha/beta/gamma method described above. Only useful if fusion misbehaves on your device. |
| Learn buttons | unset | Tune panel — binds your remote's buttons to forward/back/left/right. Saved to your phone. |

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
- **Yaw drifts slowly.** Heading now comes purely from gyro integration, and
  gyros drift — expect "forward" to wander a few degrees over some minutes.
  That's the deliberate trade for immunity to indoor magnetic interference;
  tap **Recentre** when it bothers you.
- **Still not tested on a physical iPhone.** The tracking maths is verified
  numerically end-to-end (`node tracking-test.mjs`, 10 checks) against
  synthetic but physically exact device poses, and the browser wiring was
  verified by injecting synthetic sensor events (view roll goes 90° → 0° on
  calibration, canvas rotates, buffer swaps to landscape) — but a simulation
  of a sensor is not a sensor. The remaining on-device risks are axis-sign
  conventions (hence the Invert toggles) and lens comfort.
- **The UI overlays don't rotate with the canvas** when Portrait Orientation
  Lock is on. The 3D view is corrected, the buttons aren't. Turning the lock
  off is the fix; the app tells you so when it detects it.
- **Yaw is not compass-referenced**, so "forward" is whatever you were facing
  at calibration, and it drifts slowly. Recentre resets it.
- **The remote may simply not be usable.** If none of its HID modes talk to
  Safari, that's a hardware/iOS limitation, not something the page can work
  around. See the remote section above.
