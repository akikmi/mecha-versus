import * as THREE from 'three';

// CPU opponent: distance-based state machine with reaction delay, dodge-steps, BD / inertial jumps,
// melee variations, shield guard, OVERDRIVE and difficulty presets.
// Hard additionally uses cancel routes and avoids turn-around shots.

export const DIFFICULTY = {
  easy:   { label: 'EASY',   react: 0.55, dodge: 0.15, shootGap: [1.8, 3.0], melee: 0.25, step: 0.12, special: 0.3, combo: 0.4, meleeDodge: 0.1, guard: 0.05, sideMelee: 0.2, ij: 0.15, cancel: 0, noTurnShot: false },
  normal: { label: 'NORMAL', react: 0.30, dodge: 0.45, shootGap: [1.0, 1.8], melee: 0.45, step: 0.3,  special: 0.7, combo: 0.75, meleeDodge: 0.35, guard: 0.25, sideMelee: 0.45, ij: 0.35, cancel: 0.3, noTurnShot: false },
  hard:   { label: 'HARD',   react: 0.16, dodge: 0.75, shootGap: [0.55, 1.1], melee: 0.6, step: 0.5, special: 1.0, combo: 1.0, meleeDodge: 0.65, guard: 0.45, sideMelee: 0.65, ij: 0.6, cancel: 0.9, noTurnShot: true },
};

const rand = (a, b) => a + Math.random() * (b - a);

export class AIController {
  constructor(mech, opponent, world, difficulty = 'normal') {
    this.m = mech;
    this.o = opponent;
    this.world = world;
    this.p = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.thinkT = 0;
    this.shootT = rand(1, 2);
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.mode = 'approach';
    this.boostHold = false;
    this.seen = new WeakSet();
    this.pendingDodge = null;
    this.stuckT = 0;
    this.oWasMelee = false;
    this.comboWill = true;
    this.ijPhase = 0; // inertial jump: 1 = release boost for a frame, 2 = press and hold
    this.ijT = 0;
    this.prevState = 'free';
    this.prevHits = 0;
  }

  emptyCmd() {
    return { move: new THREE.Vector3(), boost: false, boostPressed: false, bd: false, step: null, shoot: false, melee: false, meleeDir: 'n', meleeSide: 1, missile: false, special: false, overdrive: false };
  }

  update(dt) {
    const m = this.m, o = this.o, p = this.p;
    const cmd = this.emptyCmd();
    if (!m.alive) return cmd;
    // OVERDRIVE: burst out of a combo, or go aggressive when ahead / low
    if (m.odReady && (m.state === 'hitstun' ? Math.random() < p.cancel + 0.2 : (m.hp < 300 || o.hp < 250) && Math.random() < 0.02)) cmd.overdrive = true;
    if (m.state === 'down' || m.state === 'hitstun') return cmd;

    const to = new THREE.Vector3(o.pos.x - m.pos.x, 0, o.pos.z - m.pos.z);
    const dist = to.length();
    const dir = dist > 1e-3 ? to.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const perp = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(this.strafe);
    const oVulnerable = o.alive && o.canBeHit;
    const red = dist <= m.stats.redRange;

    // ---- melee in progress: continue the combo, cancel routes on Hard
    if (m.state === 'melee') {
      if (m.meleeHitDone && m.meleeStage === 1 && Math.random() < p.cancel * 0.08 && m.ammo.missile > 0) cmd.missile = true; // melee -> missile
      else if (m.meleeHitDone && (m.meleeStage === 2 || m.meleeKind === 'f') && Math.random() < p.cancel * 0.1 && m.boost > 30) { cmd.bd = true; cmd.boost = true; cmd.move.copy(perp); this.boostHold = true; } // finisher -> BD
      else cmd.melee = this.comboWill && m.meleePhase === 'swing';
      return cmd;
    }
    // special fired -> step cancel (Hard)
    if (m.state === 'special' && m.fired && Math.random() < p.cancel * 0.2 && m.boost > 15) { cmd.step = perp.clone(); return cmd; }

    // ---- periodic decisions
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = p.react * rand(0.8, 1.4);
      if (Math.random() < 0.25) this.strafe *= -1;
      if (!oVulnerable) this.mode = 'reposition';
      else if (dist > 50) this.mode = 'approach';
      else if (dist > 16) this.mode = Math.random() < p.melee * 0.25 && dist < m.stats.melee.range ? 'melee' : 'mid';
      else this.mode = Math.random() < p.melee ? 'melee' : 'retreat';
      if (this.mode === 'mid' && Math.random() < p.step * 0.5 && m.boost > 40) this.pendingDodge = { t: 0, dir: perp.clone() };
    }

    // ---- notice incoming threats: step, or shield guard if low on boost
    for (const pr of this.world.weapons.threatsTo(m)) {
      if (this.seen.has(pr)) continue;
      const rel = m.center.clone().sub(pr.pos);
      if (rel.length() > 45 || rel.dot(pr.vel) <= 0) continue;
      this.seen.add(pr);
      if (!this.pendingDodge && (m.boost < 20 || m.overheat) && m.state === 'free' && Math.random() < p.guard) {
        this.pendingDodge = { t: p.react * rand(0.3, 0.6), guard: true };
      } else if (Math.random() < p.dodge && !this.pendingDodge) {
        const side = new THREE.Vector3(pr.vel.z, 0, -pr.vel.x).normalize();
        if (side.dot(perp) < 0) side.negate();
        this.pendingDodge = { t: p.react * rand(0.4, 0.9), dir: side };
      }
    }
    const oMelee = o.state === 'melee';
    if (oMelee && !this.oWasMelee && o.meleePhase === 'lunge' && !this.pendingDodge) {
      const r = Math.random();
      if (r < p.guard * 0.8) this.pendingDodge = { t: p.react * rand(0.2, 0.5), guard: true };
      else if (r < p.guard * 0.8 + p.meleeDodge) this.pendingDodge = { t: p.react * rand(0.3, 0.7), dir: perp.clone() };
    }
    this.oWasMelee = oMelee;
    if (this.pendingDodge) {
      this.pendingDodge.t -= dt;
      if (this.pendingDodge.t <= 0) {
        if (this.pendingDodge.guard) { if (m.state === 'free' || m.state === 'bd') { cmd.melee = true; cmd.meleeDir = 'b'; } }
        else if (m.boost > 12 && !m.overheat) { cmd.step = this.pendingDodge.dir; this.strafe = Math.sign(this.pendingDodge.dir.dot(new THREE.Vector3(dir.z, 0, -dir.x))) || 1; }
        this.pendingDodge = null;
        if (cmd.melee) return cmd;
      }
    }

    // ---- movement by mode
    const nearWall = Math.hypot(m.pos.x, m.pos.z) > this.world.arena.radius - 12;
    let wantBoost = false;
    switch (this.mode) {
      case 'approach':
        cmd.move.copy(dir).multiplyScalar(0.9).addScaledVector(perp, 0.35);
        wantBoost = m.boost > 30;
        break;
      case 'mid':
        cmd.move.copy(perp).addScaledVector(dir, dist > 32 ? 0.4 : -0.15);
        wantBoost = m.boost > 55 && Math.random() < 0.6;
        break;
      case 'melee':
        cmd.move.copy(dir);
        if (oVulnerable && dist < m.stats.melee.range * 1.15 && (m.state === 'free' || m.state === 'bd')) {
          cmd.melee = true;
          // choose the melee type: side (curves past shots), forward thrust at range, neutral combo up close
          const r = Math.random();
          if (dist > 12 && r < p.sideMelee) { cmd.meleeDir = 's'; cmd.meleeSide = this.strafe; }
          else if (dist > 10 && r < p.sideMelee + 0.25) cmd.meleeDir = 'f';
          else cmd.meleeDir = 'n';
          this.comboWill = Math.random() < p.combo;
          this.mode = 'mid';
        } else wantBoost = dist > 10 && m.boost > 30;
        break;
      case 'retreat':
        cmd.move.copy(dir).negate().addScaledVector(perp, 0.8);
        wantBoost = m.boost > 35;
        break;
      case 'reposition':
        cmd.move.copy(perp).addScaledVector(dir, dist > 30 ? 0.5 : -0.6);
        break;
    }
    if (nearWall) cmd.move.add(new THREE.Vector3(-m.pos.x, 0, -m.pos.z).normalize().multiplyScalar(0.8));
    if (cmd.move.lengthSq() > 1) cmd.move.normalize();

    // ---- boost management: BD and hold it; sometimes an inertial jump out of the BD
    if (this.ijPhase === 1) { this.ijPhase = 2; this.ijT = rand(0.25, 0.5); cmd.boost = false; }
    else if (this.ijPhase === 2) {
      this.ijT -= dt;
      cmd.boost = true;
      if (this.ijT <= 0 || m.boost < 15) { this.ijPhase = 0; this.boostHold = false; }
    } else if (wantBoost && !m.overheat) {
      if (!this.boostHold && m.state === 'free' && m.landLag <= 0 && m.boost > 35) { cmd.bd = true; cmd.boost = true; this.boostHold = true; }
      else if (this.boostHold && m.boost > 22 && (m.state === 'bd' || m.state === 'step')) {
        cmd.boost = true;
        if (m.state === 'bd' && m.stateT > 0.35 && m.boost > 40 && Math.random() < p.ij * dt * 2) { this.ijPhase = 1; cmd.boost = false; }
      } else this.boostHold = false;
    } else this.boostHold = false;

    // stuck detection (pressed against a building)
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (cmd.move.lengthSq() > 0.3 && hs < 2 && m.state === 'free') this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 0.8) { this.strafe *= -1; this.stuckT = 0; if (m.onGround && m.boost > 20) { cmd.boostPressed = true; cmd.boost = true; this.jumpT = 0.5; } }
    if (this.jumpT > 0) { this.jumpT -= dt; cmd.boost = true; }

    // ---- attacks
    this.shootT -= dt;
    if (oVulnerable && this.shootT <= 0 && (m.state === 'free' || m.state === 'bd' || m.state === 'step')) {
      const los = !this.world.arena.lineBlocked(m.center.clone(), o.center.clone());
      // Hard avoids turn-around shots (they stop the feet): wait until the target is within the twist range
      if (p.noTurnShot && !m.targetInTwist()) { this.shootT = 0.15; }
      else if (los && (red || Math.random() < 0.3)) {
        if (m.specialReady && red && dist > 18 && Math.random() < p.special) cmd.special = true;
        else if (m.ammo.missile > 0 && Math.random() < 0.3) cmd.missile = true;
        else if (m.ammo.rifle > 0) cmd.shoot = true;
        this.shootT = rand(p.shootGap[0], p.shootGap[1]);
      } else this.shootT = 0.3;
    }
    // Hard: cancel a turn-around shot right after it fires
    if (m.state === 'turnshot' && m.fired && Math.random() < p.cancel * 0.3 && m.boost > 15) cmd.step = perp.clone();
    return cmd;
  }
}
