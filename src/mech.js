import * as THREE from 'three';
import { buildMechModel, MECH_TYPES } from './mechModels.js';

export const GRAVITY = 32;
export const MAX_HP = 600;
const DOWN_THRESHOLD = 5;

export const STATS = {
  kestrel: {
    walk: 11.5, dash: 30, stepSpeed: 40, boostMax: 100, jump: 13, rise: 11.5, redRange: 52, radius: 1.4,
    rifle: { name: 'BEAM RIFLE', ammo: 7, reload: 3.0, cd: 0.42, dmg: 70, dv: 2.0, scale: 0.8, speed: 100, turn: 2.6, homing: 0.9, radius: 0.55, color: 0x66e6ff, len: 5 },
    missile: { name: 'MICRO MISSILE', ammo: 4, reload: 5, cd: 0.9, count: 2, dmg: 38, dv: 1.5, scale: 0.85, speed: 50, turn: 3.0, homing: 1.6, radius: 0.7 },
    special: { name: 'HYPER BEAM', charge: 12, dmg: 150, dv: 6, scale: 0.6, speed: 170, radius: 2.4, windup: 0.45, recover: 0.5, color: 0x9ff4ff },
    melee: { name: 'BEAM SABER', dmg: [55, 60, 85], dv: [1.2, 1.2, 6], range: 24, lunge: 36, hitRange: 4.2, swing: 0.36 },
  },
  grendel: {
    walk: 10, dash: 27, stepSpeed: 36, boostMax: 92, jump: 12, rise: 10.5, redRange: 56, radius: 1.6,
    rifle: { name: 'HEAVY BEAM', ammo: 5, reload: 3.8, cd: 0.65, dmg: 90, dv: 2.5, scale: 0.75, speed: 85, turn: 2.1, homing: 0.9, radius: 0.8, color: 0xff8a5a, len: 6 },
    missile: { name: 'MISSILE POD', ammo: 3, reload: 6, cd: 1.0, count: 4, dmg: 30, dv: 1.2, scale: 0.88, speed: 46, turn: 2.8, homing: 1.6, radius: 0.7 },
    special: { name: 'TWIN CANNON', charge: 14, dmg: 180, dv: 6, scale: 0.6, speed: 160, radius: 2.8, windup: 0.6, recover: 0.6, color: 0xffb070 },
    melee: { name: 'BEAM AXE', dmg: [68, 72, 95], dv: [1.4, 1.4, 6], range: 20, lunge: 32, hitRange: 4.6, swing: 0.44 },
  },
};

const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Mech {
  constructor(typeId, scene, palette, name) {
    this.typeId = typeId;
    this.info = MECH_TYPES[typeId];
    this.name = name || this.info.name;
    this.stats = STATS[typeId];
    this.model = buildMechModel(typeId, palette);
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = null;
    this.stepSerial = 0;
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    const s = this.stats;
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = MAX_HP;
    this.boost = s.boostMax;
    this.overheat = false;
    this.onGround = true;
    this.state = 'free';
    this.stateT = 0;
    this.landLag = 0;
    this.invuln = 0;
    this.downValue = 0;
    this.comboScale = 1;
    this.recoverT = 0;
    this.aimT = 0;
    this.boosting = false;
    this.dead = false;
    this.ammo = { rifle: s.rifle.ammo, missile: s.missile.ammo };
    this.reloadT = { rifle: 0, missile: 0 };
    this.cd = 0;
    this.charge = 0;
    this.meleeStage = 0;
    this.meleeQueued = false;
    this.meleeHitDone = false;
    this.animPhase = 0;
    this.flash = 0;
    this.model.saber.visible = false;
    this.model.root.rotation.set(0, yaw, 0);
    this.model.root.position.copy(pos);
  }

  get center() { return (this._c || (this._c = new THREE.Vector3())).copy(this.pos).setY(this.pos.y + 2.8); }
  get alive() { return !this.dead; }
  get canBeHit() { return !this.dead && this.invuln <= 0 && this.state !== 'down'; }
  get specialReady() { return this.charge >= this.stats.special.charge; }

  distTo(m) { return this.pos.distanceTo(m.pos); }
  isRedLock() { return this.target && this.distTo(this.target) <= this.stats.redRange; }
  yawTo(m) { return Math.atan2(m.pos.x - this.pos.x, m.pos.z - this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // ---------------------------------------------------------------- update
  update(dt, cmd, world) {
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.cd = Math.max(0, this.cd - dt);
    this.aimT = Math.max(0, this.aimT - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.boosting = false;
    if (!this.dead && this.state !== 'special') this.charge = Math.min(this.stats.special.charge, this.charge + dt);

    // ammo regen
    for (const k of ['rifle', 'missile']) {
      const spec = this.stats[k];
      if (this.ammo[k] < spec.ammo) {
        this.reloadT[k] += dt;
        if (this.reloadT[k] >= spec.reload) { this.reloadT[k] = 0; this.ammo[k]++; }
      } else this.reloadT[k] = 0;
    }

    // combo / down value recovery
    if (this.state === 'free' || this.state === 'dash' || this.state === 'step') {
      this.recoverT += dt;
      if (this.recoverT > 1.0) { this.comboScale = 1; this.downValue = Math.max(0, this.downValue - dt * 2); }
    }

    let gravity = true;
    switch (this.state) {
      case 'dead':
      case 'down':
        this.updateDown(dt, world);
        break;
      case 'hitstun':
        this.vel.x *= Math.exp(-4 * dt); this.vel.z *= Math.exp(-4 * dt);
        if (this.stateT >= this.hitstunT) this.setState('free');
        break;
      case 'step':
        gravity = false;
        this.updateStep(dt, cmd, world);
        break;
      case 'dash':
        gravity = false;
        this.updateDash(dt, cmd, world);
        break;
      case 'melee':
        gravity = false;
        this.updateMelee(dt, cmd, world);
        break;
      case 'special':
        gravity = false;
        this.updateSpecial(dt, cmd, world);
        break;
      default:
        gravity = this.updateFree(dt, cmd, world);
    }

    if (gravity && !this.onGround) this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    // integrate
    this.pos.addScaledVector(this.vel, dt);
    world.arena.resolve(this.pos, this.stats.radius);
    const g = world.arena.groundAt(this.pos.x, this.pos.z, this.stats.radius, this.pos.y);
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (this.vel.y <= 0) {
        if (!this.onGround) this.onLand();
        this.vel.y = 0;
        this.onGround = true;
      }
    } else if (this.pos.y > g + 0.05) {
      this.onGround = false;
    }
    if (this.pos.y > 60) { this.pos.y = 60; this.vel.y = Math.min(this.vel.y, 0); }

    // boost regen on ground
    if (this.onGround && !this.boosting && this.landLag <= 0 && this.state !== 'step' && this.state !== 'dash') {
      this.boost = Math.min(this.stats.boostMax, this.boost + 150 * dt);
      this.overheat = false;
    }

    this.animate(dt);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  onLand() {
    if (this.state === 'free' && this.overheat) this.landLag = 0.5;
    else if (this.state === 'free') this.landLag = 0.06;
  }

  useBoost(amount) {
    this.boost -= amount;
    if (this.boost <= 0) { this.boost = 0; this.overheat = true; }
  }

  faceTarget(dt, rate = 14) {
    if (!this.target) return;
    const want = this.yawTo(this.target);
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, rate * dt);
  }

  // Common action checks (shoot / missile / melee / special / step) usable from free & dash.
  tryActions(cmd, world) {
    if (cmd.step && this.boost > 0 && !this.overheat && this.landLag <= 0) { this.startStep(cmd.step, world); return true; }
    if (cmd.special && this.specialReady && this.target) { this.setState('special'); this.fired = false; this.charge = 0; world.audio?.play('charge'); return true; }
    if (cmd.melee && this.target) { this.startMelee(world); return true; }
    if (cmd.shoot && this.ammo.rifle > 0 && this.cd <= 0 && this.target) {
      this.ammo.rifle--; this.cd = this.stats.rifle.cd; this.aimT = 0.45;
      this.yaw = this.yawTo(this.target);
      world.weapons?.fireBeam(this, this.target);
    } else if (cmd.missile && this.ammo.missile > 0 && this.cd <= 0 && this.target) {
      this.ammo.missile--; this.cd = this.stats.missile.cd; this.aimT = 0.5;
      this.yaw = this.yawTo(this.target);
      world.weapons?.fireMissiles(this, this.target);
    }
    return false;
  }

  updateFree(dt, cmd, world) {
    const s = this.stats;
    if (this.landLag > 0) {
      this.landLag -= dt;
      this.vel.x *= Math.exp(-10 * dt); this.vel.z *= Math.exp(-10 * dt);
      return true;
    }
    if (this.tryActions(cmd, world)) return false;

    const mv = cmd.move;
    const mvLen = Math.hypot(mv.x, mv.z);
    if (cmd.boostPressed && this.onGround && !this.overheat && this.boost > 0) {
      this.vel.y = s.jump; this.onGround = false; this.useBoost(5);
      world.audio?.play('jump');
    }
    const canBoost = cmd.boost && !this.overheat && this.boost > 0 && !this.onGround;
    if (canBoost) {
      this.boosting = true;
      if (mvLen > 0.2) {
        // boost dash keeps altitude
        const k = 1 - Math.exp(-6 * dt);
        this.vel.x += (mv.x / mvLen * s.dash - this.vel.x) * k;
        this.vel.z += (mv.z / mvLen * s.dash - this.vel.z) * k;
        this.vel.y = approach(this.vel.y, 1.0, 50 * dt);
        this.useBoost(30 * dt);
        return false;
      }
      this.vel.y = approach(this.vel.y, s.rise, 60 * dt);
      this.vel.x *= Math.exp(-1.5 * dt); this.vel.z *= Math.exp(-1.5 * dt);
      this.useBoost(26 * dt);
      return false;
    }
    if (this.onGround) {
      const sp = s.walk * (this.aimT > 0 ? 0.45 : 1);
      const k = 1 - Math.exp(-10 * dt);
      this.vel.x += (mv.x * sp - this.vel.x) * k;
      this.vel.z += (mv.z * sp - this.vel.z) * k;
    } else {
      const k = 1 - Math.exp(-1.2 * dt);
      this.vel.x += (mv.x * s.walk * 0.8 - this.vel.x) * k;
      this.vel.z += (mv.z * s.walk * 0.8 - this.vel.z) * k;
    }
    return true;
  }

  startStep(dir, world) {
    const s = this.stats;
    this.setState('step');
    this.stepDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.stepSerial++; // cuts homing of everything aimed at us
    this.useBoost(12);
    this.vel.set(this.stepDir.x * s.stepSpeed, 0, this.stepDir.z * s.stepSpeed);
    this.landLag = 0;
    this.meleeQueued = false;
    this.model.saber.visible = false;
    world.audio?.play('step');
  }

  updateStep(dt, cmd, world) {
    const s = this.stats;
    this.boosting = true;
    if (this.target && this.aimT <= 0) this.faceTarget(dt, 8);
    const sp = s.stepSpeed * (this.stateT < 0.2 ? 1 : 0.6);
    this.vel.x = this.stepDir.x * sp; this.vel.z = this.stepDir.z * sp;
    this.vel.y = 0;
    // shooting during a step is allowed (doesn't cancel)
    if (cmd.shoot || cmd.missile) {
      const c = { ...cmd, step: null, melee: false, special: false };
      this.tryActions(c, world);
    }
    if (this.stateT >= 0.3) {
      if (cmd.stepHold && this.boost > 0 && !this.overheat) { this.setState('dash'); this.dashDir = this.stepDir.clone(); }
      else this.setState('free');
    }
  }

  // Continued boost dash after a step (hold the direction key).
  updateDash(dt, cmd, world) {
    const s = this.stats;
    this.boosting = true;
    const mv = cmd.move;
    const mvLen = Math.hypot(mv.x, mv.z);
    if (mvLen > 0.2) this.dashDir.set(mv.x / mvLen, 0, mv.z / mvLen);
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (this.dashDir.x * s.dash - this.vel.x) * k;
    this.vel.z += (this.dashDir.z * s.dash - this.vel.z) * k;
    this.vel.y = cmd.boost ? approach(this.vel.y, s.rise * 0.6, 40 * dt) : approach(this.vel.y, -0.5, 40 * dt);
    this.useBoost(30 * dt);
    if (this.tryActions({ ...cmd, step: cmd.step }, world)) return;
    if (!cmd.stepHold || this.overheat) { this.setState('free'); }
  }

  // ---------------------------------------------------------------- melee
  startMelee(world) {
    this.setState('melee');
    this.meleeStage = 0;
    this.meleeQueued = false;
    this.meleeHitDone = false;
    this.swingSfx = false;
    const t = this.target;
    const d = t ? this.distTo(t) : 99;
    this.meleePhase = t && t.alive && d <= this.stats.melee.range && d > 3 ? 'lunge' : 'swing';
    this.lungeSerial = t ? t.stepSerial : 0;
    this.model.saber.visible = true;
    world.audio?.play('saberOn');
  }

  updateMelee(dt, cmd, world) {
    const m = this.stats.melee;
    const t = this.target;
    if (cmd.melee) this.meleeQueued = true;
    if (cmd.step && this.boost > 0 && !this.overheat) { this.model.saber.visible = false; this.startStep(cmd.step, world); return; }

    if (this.meleePhase === 'lunge') {
      this.boosting = true;
      const homing = t && t.alive && t.stepSerial === this.lungeSerial;
      if (homing) {
        tmpV.copy(t.pos).sub(this.pos);
        tmpV.y = (t.pos.y - this.pos.y);
        const dist = tmpV.length();
        tmpV.normalize();
        this.vel.copy(tmpV).multiplyScalar(m.lunge);
        this.yaw = Math.atan2(tmpV.x, tmpV.z);
        if (dist < this.stats.radius + t.stats.radius + 0.8) { this.meleePhase = 'swing'; this.stateT = 0; }
      }
      if (this.stateT > 0.8) { this.meleePhase = 'swing'; this.stateT = 0; }
      return;
    }
    // swing
    const dur = m.swing + (this.meleeStage === 2 ? 0.15 : 0);
    if (this.stateT < 0.1 && t) this.faceTarget(dt, 20);
    this.vel.multiplyScalar(Math.exp(-10 * dt));
    if (this.stateT < 0.08) {
      this.forward(tmpV);
      this.vel.x = tmpV.x * 8; this.vel.z = tmpV.z * 8;
    }
    if (!this.swingSfx) { this.swingSfx = true; world.audio?.play('swing'); }
    const active = this.stateT >= dur * 0.3 && this.stateT <= dur * 0.6;
    if (active && !this.meleeHitDone && t && t.canBeHit) {
      tmpV.copy(t.pos).sub(this.pos);
      const dy = Math.abs(tmpV.y);
      tmpV.y = 0;
      const dist = tmpV.length();
      const ang = Math.abs(angleDiff(this.yaw, Math.atan2(tmpV.x, tmpV.z)));
      if (dist < m.hitRange && dy < 4 && ang < 1.3) {
        this.meleeHitDone = true;
        const st = this.meleeStage;
        const knock = tmpV.normalize().clone();
        world.weapons?.meleeHit(this, t, {
          dmg: m.dmg[st], dv: m.dv[st], scale: 0.9, knock, stun: 0.6, forceDown: st === 2, melee: true,
        });
      }
    }
    if (this.stateT >= dur) {
      if (this.meleeQueued && this.meleeStage < 2) {
        this.meleeStage++;
        this.meleeQueued = false;
        this.meleeHitDone = false;
        this.swingSfx = false;
        this.stateT = 0;
        // re-lunge a little if target drifted away
        if (t && this.distTo(t) > m.hitRange && this.distTo(t) < 10) { this.meleePhase = 'lunge'; this.lungeSerial = t.stepSerial; }
      } else if (this.stateT >= dur + 0.18) {
        this.model.saber.visible = false;
        this.setState('free');
      }
    }
  }

  // ---------------------------------------------------------------- special
  updateSpecial(dt, cmd, world) {
    const sp = this.stats.special;
    this.vel.multiplyScalar(Math.exp(-6 * dt));
    this.faceTarget(dt, 10);
    this.aimT = 0.3;
    if (!this.fired && this.stateT >= sp.windup) {
      this.fired = true;
      if (this.target) this.yaw = this.yawTo(this.target);
      world.weapons?.fireSpecial(this, this.target);
    }
    if (this.stateT >= sp.windup + sp.recover) this.setState('free');
  }

  // ---------------------------------------------------------------- damage
  takeHit(hit, attacker) {
    if (!this.canBeHit) return 0;
    const dmg = Math.max(1, Math.round(hit.dmg * this.comboScale));
    this.comboScale = Math.max(0.15, this.comboScale * hit.scale);
    this.recoverT = 0;
    this.hp = Math.max(0, this.hp - dmg);
    this.downValue += hit.dv;
    this.flash = 0.12;
    this.model.saber.visible = false;
    const knock = hit.knock || tmpV.copy(this.pos).sub(attacker.pos).setY(0).normalize();
    if (this.hp <= 0) {
      this.dead = true;
      this.setState('dead');
      this.vel.set(knock.x * 14, 10, knock.z * 14);
      this.onGround = false;
    } else if (this.downValue >= DOWN_THRESHOLD || hit.forceDown) {
      this.setState('down');
      this.vel.set(knock.x * 13, 9, knock.z * 13);
      this.onGround = false;
      this.downValue = 0;
    } else {
      this.setState('hitstun');
      this.hitstunT = hit.stun || 0.45;
      this.vel.set(knock.x * 5, Math.max(this.vel.y * 0.2, 0), knock.z * 5);
    }
    return dmg;
  }

  updateDown(dt) {
    if (this.onGround) {
      this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
      this.downGroundT = (this.downGroundT || 0) + dt;
    } else this.downGroundT = 0;
    if (this.state === 'down' && this.downGroundT > 1.0) {
      this.setState('free');
      this.invuln = 1.2;
      this.comboScale = 1;
      this.downGroundT = 0;
      this.landLag = 0;
    }
  }

  // ---------------------------------------------------------------- animation
  animate(dt) {
    const m = this.model;
    const p = m.parts;
    const root = m.root;
    root.position.copy(this.pos);

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'free' || this.state === 'dash') {
      if (this.aimT > 0 && this.target) this.faceTarget(dt, 18);
      else if (hs > 2 && this.landLag <= 0) this.yaw += angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 10 * dt);
      else if (this.target && this.onGround) this.faceTarget(dt, 3);
    }
    root.rotation.y = this.yaw;

    // reset pose
    let hipsX = 0, torsoX = 0, legLX = 0, legRX = 0, shinL = 0, shinR = 0, armLX = 0, armRX = 0, armRZ = 0, armLZ = 0, rootX = 0, rootZ = 0, rifleX = 0, hipsY = 0;
    const fwd = this.forward(new THREE.Vector3());
    const localZ = this.vel.x * fwd.x + this.vel.z * fwd.z;
    const localX = this.vel.x * fwd.z - this.vel.z * fwd.x;

    if (this.state === 'down' || this.state === 'dead') {
      rootX = -1.35;
      legLX = -0.3; legRX = 0.2; armLX = -0.6; armRX = 0.4;
      hipsY = 0;
    } else if (this.state === 'hitstun') {
      torsoX = -0.5; armLX = -0.8; armRX = -0.5; legLX = 0.3; shinL = 0.4;
    } else if (this.onGround && this.state === 'free') {
      if (this.landLag > 0.1) { hipsY = -0.6; legLX = -0.7; legRX = -0.7; shinL = 1.2; shinR = 1.2; torsoX = 0.3; }
      else if (hs > 1) {
        this.animPhase += dt * hs * 0.55;
        const sw = Math.sin(this.animPhase) * Math.min(1, hs / 10);
        legLX = sw * 0.7; legRX = -sw * 0.7;
        shinL = Math.max(0, -sw) * 0.9 + 0.1; shinR = Math.max(0, sw) * 0.9 + 0.1;
        armLX = -sw * 0.4; armRX = sw * 0.4;
        torsoX = 0.1;
        hipsY = Math.abs(Math.cos(this.animPhase)) * 0.12;
      } else {
        hipsY = Math.sin(performance.now() / 600) * 0.03;
      }
    } else {
      // airborne / dash / step
      const lean = Math.max(-1, Math.min(1, localZ / 30));
      const side = Math.max(-1, Math.min(1, localX / 30));
      rootX = lean * 0.45;
      rootZ = -side * 0.4;
      legLX = 0.3 + lean * 0.4; legRX = 0.1 + lean * 0.5;
      shinL = 0.6; shinR = 0.4;
      armLX = 0.3; armRX = 0.3;
    }

    if (this.state === 'melee') {
      const dur = this.stats.melee.swing;
      const prog = this.meleePhase === 'lunge' ? 0 : Math.min(1, this.stateT / dur);
      if (this.meleePhase === 'lunge') { armRX = -2.6; armRZ = 0.3; rootX = 0.5; legLX = 0.6; legRX = 0.2; shinL = 0.8; }
      else if (this.meleeStage === 0) { armRX = -1.6; armRZ = 1.2 - prog * 2.6; torsoX = 0.2; rifleX = 0.6; }
      else if (this.meleeStage === 1) { armRX = -1.6; armRZ = -1.4 + prog * 2.6; torsoX = 0.2; rifleX = 0.6; }
      else { armRX = -3.0 + prog * 3.2; armRZ = 0; torsoX = -0.2 + prog * 0.6; rifleX = 0.4; }
      armLX = -0.4;
    } else if (this.aimT > 0 || this.state === 'special') {
      armRX = -Math.PI / 2; rifleX = Math.PI / 2;
      if (this.state === 'special') { armLX = -Math.PI / 2 * (this.typeId === 'kestrel' ? 1 : 0.3); torsoX = -0.1; }
    }

    const k = Math.min(1, 16 * dt);
    const L = (obj, prop, v) => { obj[prop] += (v - obj[prop]) * k; };
    L(root.rotation, 'x', rootX); L(root.rotation, 'z', rootZ);
    L(p.hips.position, 'y', 2.55 + hipsY);
    L(p.torso.rotation, 'x', torsoX);
    L(p.legL.rotation, 'x', -legLX); L(p.legR.rotation, 'x', -legRX);
    L(p.shinL.rotation, 'x', shinL); L(p.shinR.rotation, 'x', shinR);
    L(p.armL.rotation, 'x', armLX); L(p.armR.rotation, 'x', armRX);
    L(p.armR.rotation, 'z', armRZ); L(p.armL.rotation, 'z', armLZ);
    L(m.rifle.rotation, 'x', rifleX);

    // thruster flames
    const fl = this.boosting ? 1.2 + Math.random() * 0.6 : (this.onGround ? 0.0 : 0.35);
    for (const f of m.flames) {
      f.visible = fl > 0.01;
      f.scale.set(1, fl, 1);
    }

    // invulnerability blink / hit flash
    root.visible = !(this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0);
  }
}
