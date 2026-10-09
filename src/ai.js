import * as THREE from 'three';

// CPU opponent: distance-based state machine with reaction delay, dodge-steps and difficulty presets.

export const DIFFICULTY = {
  easy:   { label: 'EASY',   react: 0.55, dodge: 0.15, shootGap: [1.8, 3.0], melee: 0.25, step: 0.12, special: 0.3, combo: 0.4, meleeDodge: 0.1 },
  normal: { label: 'NORMAL', react: 0.30, dodge: 0.45, shootGap: [1.0, 1.8], melee: 0.45, step: 0.3,  special: 0.7, combo: 0.75, meleeDodge: 0.35 },
  hard:   { label: 'HARD',   react: 0.16, dodge: 0.75, shootGap: [0.55, 1.1], melee: 0.6, step: 0.5, special: 1.0, combo: 1.0, meleeDodge: 0.65 },
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
  }

  update(dt) {
    const m = this.m, o = this.o, p = this.p;
    const cmd = { move: new THREE.Vector3(), boost: false, boostPressed: false, step: null, stepHold: false, shoot: false, melee: false, missile: false, special: false };
    if (!m.alive || m.state === 'down' || m.state === 'hitstun') return cmd;

    const to = new THREE.Vector3(o.pos.x - m.pos.x, 0, o.pos.z - m.pos.z);
    const dist = to.length();
    const dir = dist > 1e-3 ? to.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const perp = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(this.strafe);
    const oVulnerable = o.alive && o.canBeHit;
    const red = dist <= m.stats.redRange;

    // ---- continue melee combo
    if (m.state === 'melee') {
      cmd.melee = this.comboWill && m.meleePhase === 'swing';
      return cmd;
    }

    // ---- periodic decisions
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = p.react * rand(0.8, 1.4);
      if (Math.random() < 0.25) this.strafe *= -1;
      if (!oVulnerable) this.mode = 'reposition';
      else if (dist > 50) this.mode = 'approach';
      else if (dist > 16) this.mode = 'mid';
      else this.mode = Math.random() < p.melee ? 'melee' : 'retreat';
      if (this.mode === 'mid' && Math.random() < p.step * 0.5 && m.boost > 40) this.pendingDodge = { t: 0, dir: perp.clone() };
    }

    // ---- notice incoming threats and maybe dodge (after reaction time)
    for (const pr of this.world.weapons.threatsTo(m)) {
      if (this.seen.has(pr)) continue;
      const rel = m.center.clone().sub(pr.pos);
      if (rel.length() > 45 || rel.dot(pr.vel) <= 0) continue;
      this.seen.add(pr);
      if (Math.random() < p.dodge && !this.pendingDodge) {
        const side = new THREE.Vector3(pr.vel.z, 0, -pr.vel.x).normalize();
        if (side.dot(perp) < 0) side.negate();
        this.pendingDodge = { t: p.react * rand(0.4, 0.9), dir: side };
      }
    }
    const oMelee = o.state === 'melee';
    if (oMelee && !this.oWasMelee && o.meleePhase === 'lunge') {
      if (Math.random() < p.meleeDodge && !this.pendingDodge) this.pendingDodge = { t: p.react * rand(0.3, 0.7), dir: perp.clone() };
    }
    this.oWasMelee = oMelee;
    if (this.pendingDodge) {
      this.pendingDodge.t -= dt;
      if (this.pendingDodge.t <= 0) {
        if (m.boost > 12 && !m.overheat) { cmd.step = this.pendingDodge.dir; this.strafe = Math.sign(this.pendingDodge.dir.dot(new THREE.Vector3(dir.z, 0, -dir.x))) || 1; }
        this.pendingDodge = null;
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
        if (oVulnerable && dist < m.stats.melee.range && m.state === 'free') {
          cmd.melee = true;
          this.comboWill = Math.random() < p.combo;
          this.mode = 'mid';
        }
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

    // boost management: hop then hold, release when low so we land and refill
    if (wantBoost && !m.overheat) {
      if (m.onGround) { cmd.boostPressed = true; cmd.boost = true; this.boostHold = true; }
      else if (this.boostHold && m.boost > 22) cmd.boost = true;
      else this.boostHold = false;
    } else this.boostHold = false;

    // stuck detection (pressed against a building)
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (cmd.move.lengthSq() > 0.3 && hs < 2 && m.state === 'free') this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 0.8) { this.strafe *= -1; this.stuckT = 0; if (m.onGround && m.boost > 20) { cmd.boostPressed = true; cmd.boost = true; this.boostHold = true; } }

    // ---- attacks
    this.shootT -= dt;
    if (oVulnerable && this.shootT <= 0 && (m.state === 'free' || m.state === 'dash' || m.state === 'step')) {
      const los = !this.world.arena.lineBlocked(m.center.clone(), o.center.clone());
      if (los && (red || Math.random() < 0.3)) {
        if (m.specialReady && red && dist > 18 && Math.random() < p.special) cmd.special = true;
        else if (m.ammo.missile > 0 && Math.random() < 0.3) cmd.missile = true;
        else if (m.ammo.rifle > 0) cmd.shoot = true;
        this.shootT = rand(p.shootGap[0], p.shootGap[1]);
      } else this.shootT = 0.3;
    }
    return cmd;
  }
}
