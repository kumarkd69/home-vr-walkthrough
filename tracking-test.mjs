/**
 * Verifies the head-tracking math in index.html against synthetic, physically
 * exact device poses — specifically through the landscape gimbal-lock region
 * where the old Euler method breaks.
 */
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// ---- the exact code under test, lifted from index.html ---------------------
const qSensorToWorld = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

function gravityFromBetaGamma(betaDeg, gammaDeg) {
  const b = betaDeg * D2R, g = gammaDeg * D2R;
  return new THREE.Vector3(
     Math.sin(g) * Math.cos(b),
    -Math.sin(b),
    -Math.cos(g) * Math.cos(b)
  ).normalize();
}

function seedFromGravity(gravDev) {
  const q = new THREE.Quaternion();
  q.multiply(new THREE.Quaternion().setFromUnitVectors(gravDev, new THREE.Vector3(0, 0, -1)));
  return q;
}

function correctWithGravity(qDS, gravDev, strength) {
  const gPred = new THREE.Vector3(0, 0, -1).applyQuaternion(qDS.clone().invert());
  const corr = new THREE.Quaternion().setFromUnitVectors(gravDev, gPred);
  if (strength >= 1) qDS.multiply(corr);
  else qDS.multiply(new THREE.Quaternion().identity().slerp(corr, strength));
  return qDS;
}

function composeHead(qDS, screenAngleDeg) {
  return new THREE.Quaternion()
    .copy(qSensorToWorld)
    .multiply(qDS)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngleDeg * D2R));
}

// legacy path (what every three.js cardboard demo does), for comparison
function legacyHead(alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(betaDeg * D2R, alphaDeg * D2R, -gammaDeg * D2R, 'YXZ'));
  q.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngleDeg * D2R));
  return q;
}

// ---- synthetic ground truth ------------------------------------------------
// Phone in a headset, landscape, user facing north, pitched up by theta.
// Sensor world S: X east, Y north, Z up.  Camera frame C == device frame
// rotated about the view axis by phi (the physical landscape rotation).
const PHI = -90;                 // physical landscape rotation of the phone
const SCREEN_ANGLE = -PHI;       // what the OS should report for that rotation

function truePose(thetaDeg) {
  const t = thetaDeg * D2R;
  const f = new THREE.Vector3(0, Math.cos(t), Math.sin(t));   // look direction
  const u = new THREE.Vector3(0, -Math.sin(t), Math.cos(t));  // camera up
  const r = new THREE.Vector3(1, 0, 0);                       // camera right
  // R_C (camera -> S) has columns [r, u, -f]
  const mC = new THREE.Matrix4().makeBasis(r, u, f.clone().negate());
  const qC = new THREE.Quaternion().setFromRotationMatrix(mC);
  // device = camera rotated by phi about the view axis
  const qD = qC.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -PHI * D2R));
  return { qC, qD };
}

// What the OS reports: decompose R_true = Rz(alpha)Rx(beta)Ry(gamma).
// three.js 'ZXY' order is exactly that composition. It clamps beta rather than
// gamma, so we also build the *other* valid solution (the one the W3C spec's
// clamping picks) to prove both encode the same gravity.
function reportedAngles(qD) {
  const e = new THREE.Euler().setFromQuaternion(qD, 'ZXY');
  const a = e.z * R2D, b = e.x * R2D, g = e.y * R2D;
  const alt = { alpha: a + 180, beta: 180 - b, gamma: g + 180 };
  return { primary: { alpha: a, beta: b, gamma: g }, alt };
}

function pitchOf(qHead) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(qHead);
  return Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) * R2D;
}

// ---------------------------------------------------------------------------
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL ' + msg); } };

console.log('1. Is the headset resting pose really at gamma = ±90 (the degenerate spot)?');
{
  const { qD } = truePose(0);
  const { primary, alt } = reportedAngles(qD);
  console.log(`   level, landscape -> spec-convention angles: beta=${alt.beta.toFixed(1)} gamma=${((alt.gamma+180)%360-180).toFixed(1)}`);
  console.log(`   (three.js-convention decomposition: beta=${primary.beta.toFixed(1)} gamma=${primary.gamma.toFixed(1)})`);
  const g = Math.abs(((primary.gamma + 180) % 360) - 180);
  ok(Math.abs(Math.abs(primary.gamma) - 90) < 1 || Math.abs(Math.abs(alt.gamma % 360) - 90) < 1 || Math.abs(primary.beta) > 89,
     'expected a gimbal-degenerate resting pose');
}

console.log('\n2. Gravity formula matches true gravity, and is identical for BOTH');
console.log('   valid representations of the same pose (the key robustness claim):');
{
  let maxErr = 0, maxAltErr = 0;
  for (let theta = -85; theta <= 85; theta += 5) {
    const { qD } = truePose(theta);
    const trueG = new THREE.Vector3(0, 0, -1).applyQuaternion(qD.clone().invert());
    const { primary, alt } = reportedAngles(qD);
    maxErr = Math.max(maxErr, gravityFromBetaGamma(primary.beta, primary.gamma).distanceTo(trueG));
    maxAltErr = Math.max(maxAltErr, gravityFromBetaGamma(alt.beta, alt.gamma).distanceTo(trueG));
  }
  console.log(`   max error, representation A: ${maxErr.toExponential(2)}`);
  console.log(`   max error, representation B: ${maxAltErr.toExponential(2)}`);
  ok(maxErr < 1e-9, 'gravity formula wrong for representation A');
  ok(maxAltErr < 1e-9, 'gravity formula wrong for representation B');
}

console.log('\n3. Recovered pitch vs true pitch, sweeping head pitch through the');
console.log('   degenerate region (fusion path vs the legacy Euler path):');
{
  let worstFusion = 0, worstLegacy = 0;
  const rows = [];
  for (let theta = -80; theta <= 85; theta += 5) {
    const { qD } = truePose(theta);
    const { primary } = reportedAngles(qD);
    const grav = gravityFromBetaGamma(primary.beta, primary.gamma);

    // fusion: seed from gravity, then settle with full-strength correction
    let qDS = seedFromGravity(grav);
    for (let i = 0; i < 5; i++) correctWithGravity(qDS, grav, 1);
    const fusionPitch = pitchOf(composeHead(qDS, SCREEN_ANGLE));

    const legacyPitch = pitchOf(legacyHead(primary.alpha, primary.beta, primary.gamma, SCREEN_ANGLE));

    const fErr = Math.abs(fusionPitch - theta);
    const lErr = Math.abs(legacyPitch - theta);
    worstFusion = Math.max(worstFusion, fErr);
    worstLegacy = Math.max(worstLegacy, lErr);
    if (theta % 20 === 0)
      rows.push(`   true ${String(theta).padStart(4)}°  ->  fusion ${fusionPitch.toFixed(1).padStart(6)}°   legacy ${legacyPitch.toFixed(1).padStart(7)}°`);
  }
  rows.forEach(r => console.log(r));
  console.log(`   worst pitch error — fusion: ${worstFusion.toFixed(3)}°   legacy: ${worstLegacy.toFixed(1)}°`);
  ok(worstFusion < 0.01, 'fusion pitch recovery is wrong');
}

console.log('\n4. Looking DOWN must give negative pitch (that is what drives');
console.log('   "look down = walk forward"):');
{
  for (const theta of [-40, -20, 20, 40]) {
    const { qD } = truePose(theta);
    const { primary } = reportedAngles(qD);
    const grav = gravityFromBetaGamma(primary.beta, primary.gamma);
    let qDS = seedFromGravity(grav);
    correctWithGravity(qDS, grav, 1);
    const p = pitchOf(composeHead(qDS, SCREEN_ANGLE));
    console.log(`   head ${theta > 0 ? 'up  ' : 'down'} ${Math.abs(theta)}°  ->  reported pitch ${p.toFixed(1)}°  =>  ${p < 0 ? 'FORWARD' : 'backward'}`);
    ok(Math.sign(p) === Math.sign(theta), 'pitch sign inverted');
  }
}

console.log('\n5. Gyro integration tracks a pitch-up sweep with no flip at any angle:');
{
  // start level, integrate +30 deg/s of head-pitch-up for 3s in 100 steps
  const { qD } = truePose(0);
  const { primary } = reportedAngles(qD);
  let qDS = seedFromGravity(gravityFromBetaGamma(primary.beta, primary.gamma));

  // head pitch-up = rotation about the camera's local X axis (negative = up in
  // three.js camera terms? camera pitch up is +X rotation). In device coords
  // that axis is Rz(-phi) applied to camera X.
  // v_D = Rz(phi) * v_C  (matches truePose: qD = qC * Rz(-phi))
  const axisCam = new THREE.Vector3(1, 0, 0);
  const axisDev = axisCam.clone().applyQuaternion(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), PHI * D2R));

  const dt = 0.03, rate = 30 * D2R;
  let last = pitchOf(composeHead(qDS, SCREEN_ANGLE));
  let maxJump = 0, final = last;
  for (let i = 0; i < 100; i++) {
    qDS.multiply(new THREE.Quaternion().setFromAxisAngle(axisDev, rate * dt));
    const p = pitchOf(composeHead(qDS, SCREEN_ANGLE));
    maxJump = Math.max(maxJump, Math.abs(p - last));
    last = p; final = p;
  }
  console.log(`   integrated to ${final.toFixed(1)}° pitch; largest single-step jump ${maxJump.toFixed(2)}°`);
  ok(maxJump < 2, 'gyro integration produced a discontinuity');
  ok(final > 80, 'gyro integration did not reach a steep look-up');
}

console.log('\n6. Both valid representations compose to the SAME rotation, so with');
console.log('   mathematically exact inputs legacy is fine too:');
{
  for (const theta of [0, 5, 10]) {
    const { qD } = truePose(theta);
    const { primary, alt } = reportedAngles(qD);
    const qlA = legacyHead(primary.alpha, primary.beta, primary.gamma, SCREEN_ANGLE);
    const qlB = legacyHead(alt.alpha, alt.beta, alt.gamma, SCREEN_ANGLE);
    console.log(`   true ${String(theta).padStart(3)}°: legacy A vs B differ by ${(qlA.angleTo(qlB)*R2D).toFixed(2)}°`);
  }
  console.log('   -> so representation-switching alone does NOT explain the bug.');
}

const wrap180 = a => ((a % 360) + 540) % 360 - 180;
// the triple iOS actually reports: the spec clamps GAMMA to [-90,90]
function specAngles(qD) {
  const { primary, alt } = reportedAngles(qD);
  const g = wrap180(primary.gamma);
  if (Math.abs(g) <= 90) return { alpha: wrap180(primary.alpha), beta: wrap180(primary.beta), gamma: g };
  return { alpha: wrap180(alt.alpha), beta: wrap180(alt.beta), gamma: wrap180(alt.gamma) };
}

console.log('\n7. What the OS actually reports as you pitch your head up, in the');
console.log('   spec convention (gamma clamped to ±90) — watch beta and gamma:');
{
  for (let theta = -10; theta <= 10; theta += 5) {
    const s = specAngles(truePose(theta).qD);
    console.log(`   head ${String(theta).padStart(3)}°  ->  alpha ${s.alpha.toFixed(1).padStart(7)}  beta ${s.beta.toFixed(1).padStart(7)}  gamma ${s.gamma.toFixed(1).padStart(6)}`);
  }
}

console.log('\n8. REALISTIC failure mode: alpha comes from the heavily-filtered');
console.log('   magnetometer/heading and lags behind beta/gamma. Simulate 100ms of');
console.log('   alpha lag during a head turn and measure resulting view error:');
{
  let worstLegacy = 0, worstFusion = 0;
  for (let theta = -30; theta <= 30; theta += 2) {
    const now = specAngles(truePose(theta).qD);
    const lagged = specAngles(truePose(theta - 3).qD);   // alpha from 3° ago
    const truth = composeHead(
      seedFromGravity(gravityFromBetaGamma(now.beta, now.gamma)), SCREEN_ANGLE);

    const legacyLagged = legacyHead(lagged.alpha, now.beta, now.gamma, SCREEN_ANGLE);
    const legacyClean  = legacyHead(now.alpha, now.beta, now.gamma, SCREEN_ANGLE);
    worstLegacy = Math.max(worstLegacy, legacyClean.angleTo(legacyLagged) * R2D);

    // fusion never reads alpha at all, so alpha lag cannot affect it
    const fusionLagged = composeHead(
      seedFromGravity(gravityFromBetaGamma(now.beta, now.gamma)), SCREEN_ANGLE);
    worstFusion = Math.max(worstFusion, truth.angleTo(fusionLagged) * R2D);
  }
  console.log(`   worst view error from 3° of alpha lag — legacy: ${worstLegacy.toFixed(1)}°   fusion: ${worstFusion.toFixed(1)}°`);
  ok(worstFusion < 1e-4, 'fusion should be completely immune to alpha');   // float noise only
}

// ---------------------------------------------------------------------------
// The mount angle: measured from gravity instead of trusted from
// screen.orientation.angle (which iOS rotation lock makes unreliable).
function calibrateMount(gravDev) {
  const gx = gravDev.x, gy = gravDev.y;
  if (Math.hypot(gx, gy) < 0.25) return null;
  return Math.atan2(gx, -gy);
}
function composeHeadWithMount(qDS, mountRad) {
  return new THREE.Quaternion()
    .copy(qSensorToWorld)
    .multiply(qDS)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), mountRad));
}
// How far the rendered "up" is fromtrue world up — i.e. how tilted the horizon
// looks to the person wearing the headset. Direct and unambiguous, unlike an
// Euler roll term which degenerates at 90°.
function horizonTiltDeg(qHead) {
  const imageUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qHead);
  return imageUp.angleTo(new THREE.Vector3(0, 1, 0)) * R2D;
}

console.log('\n9. Mount angle measured from gravity reproduces the true physical');
console.log('   rotation of the phone in the headset, for every mounting:');
{
  for (const phi of [0, 90, -90, 180]) {
    // phone level, looking north, mounted at rotation phi
    const t = 0;
    const f = new THREE.Vector3(0, Math.cos(t), Math.sin(t));
    const u = new THREE.Vector3(0, -Math.sin(t), Math.cos(t));
    const r = new THREE.Vector3(1, 0, 0);
    const qC = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
    const qD = qC.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -phi * D2R));
    const grav = new THREE.Vector3(0, 0, -1).applyQuaternion(qD.clone().invert());
    const m = calibrateMount(grav);
    console.log(`   phone mounted at ${String(phi).padStart(4)}°  ->  measured ${(m * R2D).toFixed(1).padStart(6)}°`);
    ok(Math.abs(wrap180(m * R2D - phi)) < 0.01, `mount angle wrong for phi=${phi}`);
  }
}

console.log('\n10. THE ROTATION-LOCK BUG: phone sideways in the headset, but iOS');
console.log('    Portrait Orientation Lock keeps reporting screen angle = 0.');
console.log('    Does the horizon stay level as you turn your head?');
{
  const PHI2 = -90;                 // phone physically sideways
  const LOCKED_SCREEN_ANGLE = 0;    // what iOS reports with rotation lock on

  let worstOld = 0, worstNew = 0;
  for (let yawDeg = -60; yawDeg <= 60; yawDeg += 10) {
    // level head, turned by yawDeg
    const y = yawDeg * D2R;
    const f = new THREE.Vector3(Math.sin(y), Math.cos(y), 0);
    const u = new THREE.Vector3(0, 0, 1);
    const r = new THREE.Vector3().crossVectors(f, u).normalize();   // right-handed: r x u = -f
    const qC = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
    const qD = qC.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -PHI2 * D2R));
    const grav = new THREE.Vector3(0, 0, -1).applyQuaternion(qD.clone().invert());

    // OLD: trust screen.orientation.angle  ->  term is Rz(-screenAngle) = Rz(0)
    const oldTilt = horizonTiltDeg(composeHeadWithMount(qD, -LOCKED_SCREEN_ANGLE * D2R));
    // NEW: measure the mount from gravity
    const newTilt = horizonTiltDeg(composeHeadWithMount(qD, calibrateMount(grav)));

    worstOld = Math.max(worstOld, oldTilt);
    worstNew = Math.max(worstNew, newTilt);
    if (yawDeg % 30 === 0)
      console.log(`    head turned ${String(yawDeg).padStart(4)}°  ->  horizon tilt: old ${oldTilt.toFixed(0).padStart(4)}°   new ${newTilt.toFixed(2).padStart(5)}°`);
  }
  console.log(`    worst horizon tilt — trusting the OS: ${worstOld.toFixed(0)}°   measuring gravity: ${worstNew.toFixed(2)}°`);
  ok(worstNew < 0.01, 'measured mount angle still leaves the horizon tilted');
  ok(worstOld > 80, 'expected the OS-trusting path to be badly tilted');
}

console.log('\n11. REGRESSION: the movement direction must be the way you are LOOKING.');
console.log('    Object3D.getWorldDirection() returns +Z (behind you); only Camera');
console.log('    overrides it to return the view direction. Using it for movement');
console.log('    is why looking down walked you AWAY from what you were facing.');
{
  const head = new THREE.Object3D();
  head.quaternion.identity();
  head.updateWorldMatrix(true, false);

  const viaGetWorldDirection = new THREE.Vector3();
  head.getWorldDirection(viaGetWorldDirection);
  const viaMinusZ = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);

  console.log(`    Object3D.getWorldDirection -> ${viaGetWorldDirection.toArray().map(n=>n.toFixed(0))}`);
  console.log(`    correct forward (-Z)       -> ${viaMinusZ.toArray().map(n=>n.toFixed(0))}`);
  ok(viaGetWorldDirection.z > 0.99, 'expected Object3D.getWorldDirection to be +Z');
  ok(viaMinusZ.z < -0.99, 'expected the corrected forward to be -Z');
  ok(viaGetWorldDirection.dot(viaMinusZ) < 0, 'the two must be opposite — that was the bug');

  // and the strafe axis derived from forward must be the viewer's right (+X)
  const right = new THREE.Vector3(-viaMinusZ.z, 0, viaMinusZ.x).normalize();
  console.log(`    right derived from forward -> ${right.toArray().map(n=>n.toFixed(0))}`);
  ok(right.x > 0.99, 'strafe right should be +X for a camera facing -Z');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
