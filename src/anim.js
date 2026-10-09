// Pose-based animation: each state builds a target pose (joint angles), keyframed over time for
// attacks, and every joint follows its target through a damped spring so motion has weight.
// Skirts and shoulder armor are driven secondarily from the legs and arms.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

const CHANNELS = [
  'rootX', 'rootZ', 'hipY', 'hipsX', 'torsoX', 'torsoY', 'torsoZ', 'headX',
  'armLX', 'armLZ', 'armRX', 'armRZ', 'foreLX', 'foreRX', 'handLX', 'handRX',
  'legLX', 'legLZ', 'legRX', 'legRZ', 'shinL', 'shinR', 'footL', 'footR', 'rifleX',
];

function idlePose() {
  return {
    rootX: 0, rootZ: 0, hipY: -0.05, hipsX: 0, torsoX: 0.04, torsoY: 0, torsoZ: 0, headX: 0,
    armLX: 0.1, armLZ: -0.14, armRX: 0.05, armRZ: 0.14, foreLX: -0.4, foreRX: -0.55, handLX: 0, handRX: 0.3,
    legLX: -0.12, legLZ: -0.06, legRX: -0.08, legRZ: 0.06, shinL: 0.24, shinR: 0.2, footL: null, footR: null, rifleX: 0.25,
  };
}

// Melee keyframes: [t, pose overrides]. t is normalized swing time.
const SWINGS = [
  // 0: horizontal slash
  [[0, { armRX: -1.3, armRZ: 1.4, foreRX: -0.6, handRX: 1.3, torsoY: 0.7, torsoX: 0.05, rootX: 0.1 }],
    [0.3, { armRX: -1.5, armRZ: 1.5, foreRX: -0.5, handRX: 1.3, torsoY: 0.8 }],
    [0.55, { armRX: -1.6, armRZ: -0.9, foreRX: -0.1, handRX: 1.5, torsoY: -0.55, torsoX: 0.2, rootX: 0.2 }],
    [1, { armRX: -1.2, armRZ: -1.2, foreRX: -0.3, handRX: 1.3, torsoY: -0.7, torsoX: 0.15, rootX: 0.1 }]],
  // 1: reverse slash
  [[0, { armRX: -1.4, armRZ: -1.0, foreRX: -0.4, handRX: 1.4, torsoY: -0.6, torsoX: 0.1 }],
    [0.3, { armRX: -1.5, armRZ: -1.2, foreRX: -0.3, handRX: 1.4, torsoY: -0.7 }],
    [0.55, { armRX: -1.7, armRZ: 1.2, foreRX: -0.1, handRX: 1.5, torsoY: 0.6, torsoX: 0.2, rootX: 0.2 }],
    [1, { armRX: -1.3, armRZ: 1.3, foreRX: -0.3, handRX: 1.2, torsoY: 0.7, torsoX: 0.1, rootX: 0.1 }]],
  // 2: overhead finisher
  [[0, { armRX: -2.4, armRZ: 0.2, foreRX: -0.9, handRX: 0.2, torsoX: -0.25, rootX: -0.1, legLX: -0.5, shinL: 0.5, legRX: 0.3 }],
    [0.32, { armRX: -3.0, armRZ: 0.1, foreRX: -0.6, handRX: 0.1, torsoX: -0.35, rootX: -0.12, legLX: -0.55, shinL: 0.5, legRX: 0.35 }],
    [0.55, { armRX: -0.5, armRZ: 0.0, foreRX: -0.1, handRX: 0.9, torsoX: 0.55, rootX: 0.3, legLX: -0.8, shinL: 0.9, legRX: 0.5, shinR: 0.6, hipY: -0.35 }],
    [1, { armRX: -0.3, armRZ: 0.1, foreRX: -0.2, handRX: 0.8, torsoX: 0.45, rootX: 0.2, legLX: -0.7, shinL: 0.8, legRX: 0.4, shinR: 0.5, hipY: -0.3 }]],
];

function sampleKeys(keys, t, pose) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1];
  const k = smooth(clamp((t - t0) / Math.max(1e-4, t1 - t0), 0, 1));
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key] ?? pose[key], vb = b[key] ?? pose[key];
    pose[key] = va + (vb - va) * k;
  }
}

export class Animator {
  constructor(model) {
    this.m = model;
    this.x = {}; this.v = {};
    const p = model.parts;
    this.bind = {
      rootX: [model.root.rotation, 'x'], rootZ: [model.root.rotation, 'z'], hipY: [p.hips.position, 'y', 2.6],
      hipsX: [p.hips.rotation, 'x'], torsoX: [p.torso.rotation, 'x'], torsoY: [p.torso.rotation, 'y'], torsoZ: [p.torso.rotation, 'z'],
      headX: [p.head.rotation, 'x'],
      armLX: [p.armL.rotation, 'x'], armLZ: [p.armL.rotation, 'z'], armRX: [p.armR.rotation, 'x'], armRZ: [p.armR.rotation, 'z'],
      foreLX: [p.foreL.rotation, 'x'], foreRX: [p.foreR.rotation, 'x'], handLX: [p.handL.rotation, 'x'], handRX: [p.handR.rotation, 'x'],
      legLX: [p.legL.rotation, 'x'], legLZ: [p.legL.rotation, 'z'], legRX: [p.legR.rotation, 'x'], legRZ: [p.legR.rotation, 'z'],
      shinL: [p.shinL.rotation, 'x'], shinR: [p.shinR.rotation, 'x'], footL: [p.footL.rotation, 'x'], footR: [p.footR.rotation, 'x'],
      rifleX: [model.rifle.rotation, 'x'],
    };
    const idle = idlePose();
    for (const c of CHANNELS) { this.x[c] = idle[c] ?? 0; this.v[c] = 0; }
    this.walkPhase = 0;
    this.downSpin = 0;
    this.prevState = 'free';
    this.flashK = -1;
    this.flicker = 0;
  }

  // Snap to a pose immediately (round start)
  reset() {
    const idle = idlePose();
    for (const c of CHANNELS) { this.x[c] = idle[c] ?? 0; this.v[c] = 0; }
    this.downSpin = 0;
    this.apply();
  }

  buildPose(dt, mech) {
    const P = idlePose();
    const st = mech.state;
    const hs = Math.hypot(mech.vel.x, mech.vel.z);
    const fx = Math.sin(mech.yaw), fz = Math.cos(mech.yaw);
    const localZ = mech.vel.x * fx + mech.vel.z * fz;
    const localX = mech.vel.x * fz - mech.vel.z * fx; // + = toward model's +x side
    let stiff = 260;

    if (st === 'down' || st === 'dead') {
      stiff = 200;
      P.armLX = -0.9; P.armLZ = -0.6; P.armRX = -0.4; P.armRZ = 0.7; P.legLX = -0.5; P.legRX = 0.2; P.shinL = 0.9; P.shinR = 0.4;
      P.torsoX = -0.3; P.headX = -0.3; P.footL = 0.3; P.footR = 0.3;
    } else if (st === 'hitstun') {
      stiff = 520;
      // reaction depends on where the hit came from (knock dir relative to facing)
      const kf = mech.hitDir.x * fx + mech.hitDir.z * fz; // + = pushed forward (hit from behind)
      const ks = mech.hitDir.x * fz - mech.hitDir.z * fx;
      const f = Math.max(0, 1 - mech.stateT / 0.3);
      const amt = 0.55 + f * 0.4;
      P.torsoX = kf * amt; P.rootX = kf * 0.3 * (0.4 + f); P.headX = kf * 0.4;
      P.torsoZ = -ks * amt * 0.8; P.rootZ = -ks * 0.25;
      P.armLX = -0.7; P.armLZ = -0.6; P.armRX = -0.4; P.armRZ = 0.6; P.foreLX = -0.8;
      P.legLX = kf < 0 ? 0.3 : -0.4; P.shinL = 0.6; P.legRX = kf < 0 ? -0.2 : 0.3; P.shinR = 0.4; P.hipY = -0.2;
    } else if (st === 'bd') {
      // forward lean, legs trailing behind, bank into turns
      const lean = clamp(localZ / mech.stats.dash, -1, 1);
      P.rootX = 0.55 * lean; P.rootZ = clamp(-localX / 20, -0.5, 0.5) + clamp(mech.turnRate * 0.12, -0.35, 0.35);
      P.torsoX = 0.1;
      P.legLX = 0.35; P.legRX = 0.65; P.shinL = 0.65; P.shinR = 0.95; P.footL = 0.55; P.footR = 0.6;
      P.legLZ = -0.12; P.legRZ = 0.12;
      P.armLX = 0.55; P.armLZ = -0.3; P.armRX = 0.4; P.armRZ = 0.3; P.foreLX = -0.3; P.foreRX = -0.3;
      P.hipY = 0;
    } else if (st === 'step') {
      // lean into the step direction, fling the opposite leg
      const sx = clamp(localX / mech.stats.stepSpeed, -1, 1), sz = clamp(localZ / mech.stats.stepSpeed, -1, 1);
      P.rootZ = -sx * 0.55; P.rootX = sz * 0.4;
      P.legLZ = -0.15 + sx * 0.45; P.legRZ = 0.15 + sx * 0.45;
      P.legLX = -0.2 - sz * 0.3; P.legRX = 0.25 - sz * 0.3; P.shinL = 0.5; P.shinR = 0.8; P.footL = 0.4; P.footR = 0.4;
      P.armLZ = -0.5 - sx * 0.3; P.armRZ = 0.5 - sx * 0.3; P.armLX = 0.3; P.armRX = 0.2;
      stiff = 420;
    } else if (st === 'melee') {
      stiff = 700;
      if (mech.meleePhase === 'lunge') {
        P.rootX = 0.55; P.armRX = 0.7; P.armRZ = 0.4; P.foreRX = -0.4; P.handRX = 0.6; P.armLX = 0.4; P.armLZ = -0.4;
        P.legLX = 0.4; P.legRX = 0.7; P.shinL = 0.7; P.shinR = 1.0; P.footL = 0.5; P.footR = 0.5; P.torsoY = 0.3;
      } else {
        const dur = mech.stats.melee.swing + (mech.meleeStage === 2 ? 0.15 : 0);
        sampleKeys(SWINGS[clamp(mech.meleeStage, 0, 2)], clamp(mech.stateT / dur, 0, 1), P);
        P.armLX = -0.3; P.armLZ = -0.5; P.foreLX = -1.0;
        if (!mech.onGround) { P.legLX = -0.4; P.shinL = 0.8; P.legRX = 0.3; P.shinR = 0.7; P.footL = 0.3; P.footR = 0.3; }
      }
    } else if (mech.onGround && (st === 'free' || st === 'turnshot')) {
      if (mech.landLag > 0.03) {
        stiff = 520;
        if (mech.zusa) { // landing slide: lead leg forward, trailing knee low
          P.hipY = -0.55; P.rootX = -0.12; P.legLX = -1.0; P.shinL = 0.45; P.legRX = 0.25; P.shinR = 1.5; P.torsoX = 0.35;
          P.armLX = -0.3; P.armLZ = -0.6; P.armRZ = 0.6;
        } else {
          P.hipY = -0.65; P.legLX = -0.85; P.legRX = -0.85; P.shinL = 1.45; P.shinR = 1.45; P.torsoX = 0.4; P.armLX = -0.3; P.armRX = -0.3;
        }
      } else if (hs > 1 && st === 'free') {
        const k = Math.min(1, hs / 10);
        this.walkPhase += dt * hs * 0.55;
        const s = Math.sin(this.walkPhase), c = Math.cos(this.walkPhase);
        P.legLX = -s * 0.7 * k - 0.05; P.legRX = s * 0.7 * k - 0.05;
        P.shinL = 0.15 + Math.max(0, s) * 1.0 * k; P.shinR = 0.15 + Math.max(0, -s) * 1.0 * k;
        P.armLX = s * 0.4 * k; P.armRX = -s * 0.35 * k;
        P.torsoX = 0.12 * k; P.torsoZ = c * 0.05 * k;
        P.hipY = -0.08 + Math.abs(c) * 0.12 * k;
        stiff = 380;
      } else {
        P.hipY += Math.sin(performance.now() / 650) * 0.025;
        if (st === 'turnshot') { P.legLX = -0.4; P.legRX = 0.3; P.shinL = 0.4; P.shinR = 0.5; P.hipY = -0.2; }
      }
    } else {
      // airborne free / turnshot
      const rising = mech.boosting;
      const lean = clamp(localZ / 30, -1, 1);
      P.rootX = lean * 0.3; P.rootZ = clamp(-localX / 30, -0.4, 0.4);
      if (rising) { P.legLX = 0.15; P.legRX = 0.35; P.shinL = 0.5; P.shinR = 0.7; P.armLZ = -0.35; P.armRZ = 0.35; }
      else { P.legLX = -0.5; P.legRX = 0.1; P.shinL = 0.9; P.shinR = 0.5; P.armLZ = -0.4; P.armRZ = 0.4; P.armLX = -0.1; }
      P.footL = 0.35; P.footR = 0.35;
      if (st === 'turnshot') { P.rootX = 0; P.rootZ = 0; }
    }

    // aiming overrides the gun arm (moving shot, turn shot, special)
    const aiming = (mech.aimT > 0 || st === 'special' || st === 'turnshot') && st !== 'melee' && st !== 'hitstun' && st !== 'down' && st !== 'dead';
    if (aiming) {
      let pitch = 0;
      const t = mech.target;
      if (t) pitch = Math.atan2(t.pos.y - mech.pos.y, Math.max(1, Math.hypot(t.pos.x - mech.pos.x, t.pos.z - mech.pos.z)));
      P.armRX = -Math.PI / 2 - pitch - P.rootX - P.torsoX; P.armRZ = 0.05; P.foreRX = 0; P.handRX = 0; P.rifleX = Math.PI / 2;
      if (st === 'special') {
        if (mech.typeId === 'kestrel') { P.armLX = -1.4; P.armLZ = 0.45; P.foreLX = -0.4; }
        else { P.torsoX = -0.15; P.armLX = 0.2; P.armLZ = -0.5; P.legLX = -0.3; P.legRX = 0.3; P.legLZ = -0.2; P.legRZ = 0.2; P.hipY = -0.25; }
        stiff = 420;
      }
    }

    // keep the soles flat on the ground when standing
    if (mech.onGround && st !== 'down' && st !== 'dead') {
      if (P.footL === null) P.footL = -(P.legLX + P.shinL + P.rootX);
      if (P.footR === null) P.footR = -(P.legRX + P.shinR + P.rootX);
    }
    if (P.footL === null) P.footL = 0.2;
    if (P.footR === null) P.footR = 0.2;
    return { P, stiff };
  }

  update(dt, mech) {
    const m = this.m, p = m.parts, root = m.root;
    root.position.copy(mech.pos);
    root.rotation.order = 'YXZ';
    root.rotation.y = mech.yaw;
    if (dt <= 0) return;

    if (mech.state !== this.prevState) {
      if (mech.state === 'down' || mech.state === 'dead') this.downSpin = this.x.rootX;
      this.prevState = mech.state;
    }
    const { P, stiff } = this.buildPose(dt, mech);
    const w = Math.sqrt(stiff), damp = 2 * 0.72 * w;
    const h = Math.min(dt, 1 / 30);
    for (const c of CHANNELS) {
      const target = P[c];
      this.v[c] += (stiff * (target - this.x[c]) - damp * this.v[c]) * h;
      this.x[c] += this.v[c] * h;
    }
    // down / KO: tumble while airborne, then lie flat (driven directly, not by spring)
    if (mech.state === 'down' || mech.state === 'dead') {
      if (!mech.onGround) this.downSpin -= 8.5 * dt;
      else {
        const flat = -Math.PI / 2 + 0.12;
        const k = Math.round((this.downSpin - flat) / (Math.PI * 2));
        const tgt = flat + k * Math.PI * 2;
        this.downSpin += (tgt - this.downSpin) * Math.min(1, 10 * dt);
      }
      this.x.rootX = this.downSpin; this.v.rootX = 0;
    }
    this.apply();

    // upper body twist + head look
    p.waist.rotation.y = mech.twist;
    let look = 0;
    if (mech.target) {
      let d = Math.atan2(mech.target.pos.x - mech.pos.x, mech.target.pos.z - mech.pos.z) - mech.yaw - mech.twist - this.x.torsoY;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      look = clamp(d, -0.7, 0.7);
    }
    p.head.rotation.y += (look - p.head.rotation.y) * Math.min(1, 12 * dt);
    if (m.monoEye) m.monoEye.position.x += (clamp(look * 0.5, -0.32, 0.32) - m.monoEye.position.x) * Math.min(1, 14 * dt);

    // secondary motion: skirts follow the legs (plus flutter while boosting), shoulder armor follows the arms
    const lL = this.x.legLX, lR = this.x.legRX;
    const flutter = mech.boosting ? Math.sin(performance.now() / 45) * 0.05 : 0;
    p.skirtFL.rotation.x = Math.min(0, lL) * 0.9 + flutter;
    p.skirtFR.rotation.x = Math.min(0, lR) * 0.9 - flutter;
    p.skirtB.rotation.x = Math.max(0, Math.max(lL, lR)) * 0.8 + (mech.state === 'bd' ? 0.35 : 0) + flutter;
    p.skirtL.rotation.z = Math.min(0, this.x.legLZ) * 0.9 - Math.abs(lL) * 0.25;
    p.skirtR.rotation.z = Math.max(0, this.x.legRZ) * 0.9 + Math.abs(lR) * 0.25;
    for (const [sa, ax, az, s] of [[p.shArmL, this.x.armLX, this.x.armLZ, -1], [p.shArmR, this.x.armRX, this.x.armRZ, 1]]) {
      const lift = clamp(-ax, 0, 2.6);
      sa.rotation.z = s * (lift * 0.16 + Math.max(0, s * az) * 0.35);
      sa.rotation.x = clamp(ax, -2.6, 1) * 0.18;
    }

    // weapon visibility: the rifle is stowed while the saber is out
    m.rifle.visible = !m.saber.visible;

    // thruster flames: two-layer cones with flicker
    this.flicker += dt * 40;
    const fl = mech.boosting ? 1.15 + Math.sin(this.flicker) * 0.12 + Math.random() * 0.35 : (mech.onGround ? 0 : 0.3 + Math.random() * 0.08);
    for (const f of m.flames) {
      f.visible = fl > 0.01;
      f.scale.set(1 + (mech.boosting ? Math.random() * 0.15 : 0), fl, 1);
    }

    // hit flash (white emissive) / OVERDRIVE glow, invulnerability blink
    const od = mech.overdriveT > 0 ? 0.25 + Math.sin(performance.now() / 90) * 0.08 : 0;
    const fk = mech.flash > 0 ? mech.flash / 0.16 : 0;
    const e = Math.max(fk * 1.6, od);
    if (Math.abs(e - this.flashK) > 0.005) {
      this.flashK = e;
      for (const mat of m.flashMats) {
        if (fk > 0 || !od) mat.emissive.setScalar(e);
        else mat.emissive.setRGB(e * 1.2, e * 0.35, e * 0.9);
      }
    }
    root.visible = !(mech.invuln > 0 && Math.floor(mech.invuln * 20) % 2 === 0);
  }

  apply() {
    for (const c of CHANNELS) {
      const [o, prop, base] = this.bind[c];
      o[prop] = (base || 0) + this.x[c];
    }
  }
}
