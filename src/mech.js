import * as THREE from 'three';
import { buildMechModel, MECH_TYPES } from './mechModels.js';
import { Animator } from './anim.js';

export const GRAVITY = 32;
export const MAX_HP = 600;
const DOWN_THRESHOLD = 5;
export const OD_MAX = 100;
export const OD_TIME = 8;
export const TWIST_MAX = THREE.MathUtils.degToRad(100); // upper-body twist limit

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

function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Mech {
  constructor(typeId, scene, palette, name) {
    this.typeId = typeId;
    this.info = MECH_TYPES[typeId];
    this.name = name || this.info.name;
    this.stats = STATS[typeId];
    this.model = buildMechModel(typeId, palette);
    this.anim = new Animator(this.model);
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
    this.twist = 0;
    this.hp = MAX_HP;
    this.boost = s.boostMax;
    this.overheat = false;
    this.onGround = true;
    this.state = 'free';
    this.stateT = 0;
    this.landLag = 0;
    this.zusa = false;
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
    this.hitDir = new THREE.Vector3(0, 0, 1);
    this.dashDir = new THREE.Vector3(0, 0, 1);
    this.turnRate = 0;
    this.hidden = false;
    this.overdriveT = 0;
    this.od = 0;
    this.guardHit = false;
    this.meleeKind = 'n';
    this.meleeSide = 1;
    this.model.saber.visible = false;
    this.model.root.rotation.set(0, yaw, 0);
    this.model.root.position.copy(pos);
    this.model.parts.waist.rotation.y = 0;
    this.anim.reset();
  }

  get center() { return (this._c || (this._c = new THREE.Vector3())).copy(this.pos).setY(this.pos.y + 2.8); }
  get alive() { return !this.dead; }
  get canBeHit() { return !this.dead && this.invuln <= 0 && this.state !== 'down'; }
  get specialReady() { return this.charge >= this.stats.special.charge; }
  get aimYaw() { return this.yaw + this.twist; }
  // fast movement states (camera FOV widening, AI)
  get dashing() { return this.state === 'bd' || this.state === 'step'; }
  // OVERDRIVE: mobility multiplier and damage bonus
  get mul() { return this.overdriveT > 0 ? 1.2 : 1; }
  get odReady() { return this.od >= OD_MAX && this.overdriveT <= 0; }

  distTo(m) { return this.pos.distanceTo(m.pos); }
  isRedLock() { return this.target && this.distTo(this.target) <= this.stats.redRange; }
  yawTo(m) { return Math.atan2(m.pos.x - this.pos.x, m.pos.z - this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  aimForward(out = new THREE.Vector3()) { const a = this.aimYaw; return out.set(Math.sin(a), 0, Math.cos(a)); }
  // Is the target within the upper-body twist range of the lower body?
  targetInTwist() { return !this.target || Math.abs(angleDiff(this.yaw, this.yawTo(this.target))) <= TWIST_MAX; }

  // ---------------------------------------------------------------- update
  update(dt, cmd, world) {
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.cd = Math.max(0, this.cd - dt);
    this.aimT = Math.max(0, this.aimT - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.boosting = false;
    if (this.overdriveT > 0) this.overdriveT = Math.max(0, this.overdriveT - dt);
    if (cmd.overdrive && this.odReady && !this.dead && this.state !== 'down') this.activateOverdrive(world);
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
    if (this.state === 'free' || this.state === 'bd' || this.state === 'step') {
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
      case 'bd':
        gravity = false;
        this.updateBD(dt, cmd, world);
        break;
      case 'turnshot':
        gravity = this.updateTurnShot(dt, cmd, world);
        break;
      case 'melee':
        gravity = false;
        this.updateMelee(dt, cmd, world);
        break;
      case 'special':
        gravity = false;
        this.updateSpecial(dt, cmd, world);
        break;
      case 'guard':
        gravity = this.updateGuard(dt, cmd, world);
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
    if (this.onGround && !this.boosting && this.landLag <= 0 && this.state !== 'step' && this.state !== 'bd') {
      this.boost = Math.min(this.stats.boostMax, this.boost + 150 * dt);
      this.overheat = false;
    }

    this.updateFacing(dt);
    this.animate(dt);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  onLand() {
    if (this.state !== 'free') return;
    if (this.overheat) { this.landLag = 0.5; this.zusa = false; }
    else {
      // "zusa": a short landing slide that keeps some momentum
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.zusa = hs > 6;
      this.landLag = this.zusa ? 0.16 : 0.06;
    }
  }

  useBoost(amount) {
    this.boost -= amount * (this.overdriveT > 0 ? 0.6 : 1);
    if (this.boost <= 0) { this.boost = 0; this.overheat = true; }
  }

  canDash() { return this.boost > 0 && !this.overheat && this.landLag <= 0; }

  faceTarget(dt, rate = 14) {
    if (!this.target) return;
    const want = this.yawTo(this.target);
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, rate * dt);
  }

  activateOverdrive(world) {
    this.overdriveT = OD_TIME;
    this.od = 0;
    this.boost = this.stats.boostMax;
    this.overheat = false;
    this.invuln = Math.max(this.invuln, 0.5);
    this.landLag = 0;
    if (this.state === 'hitstun') { this.setState('free'); this.vel.multiplyScalar(0.2); } // burst out of a combo
    world.audio?.play('overdrive', this.isPlayer ? 1 : 0.7);
    world.onOverdrive?.(this);
  }

  // Common action checks usable from free / bd / step.
  tryActions(cmd, world, allow = {}) {
    if (cmd.step && this.canDash() && allow.step !== false) { this.startStep(cmd.step, world); return true; }
    if (cmd.bd && this.canDash() && allow.bd !== false) { this.startBD(cmd, world); return true; }
    if (cmd.special && this.specialReady && this.target) { this.setState('special'); this.fired = false; this.charge = 0; world.audio?.play('charge'); return true; }
    if (cmd.melee && this.target) { this.startMelee(world, cmd.meleeDir, cmd.meleeSide); return true; }
    if (cmd.shoot && this.ammo.rifle > 0 && this.cd <= 0 && this.target) return this.shoot('rifle', world);
    if (cmd.missile && this.ammo.missile > 0 && this.cd <= 0 && this.target) return this.shoot('missile', world);
    return false;
  }

  // Moving shot if the target is inside the twist range, otherwise a turn-around shot that stops the feet.
  shoot(kind, world) {
    if (!this.targetInTwist()) {
      this.setState('turnshot');
      this.turnKind = kind;
      this.fired = false;
      return true;
    }
    this.fire(kind, world);
    return false;
  }

  fire(kind, world) {
    const s = this.stats[kind];
    this.ammo[kind]--; this.cd = s.cd; this.aimT = kind === 'rifle' ? 0.45 : 0.5;
    if (kind === 'rifle') world.weapons?.fireBeam(this, this.target);
    else world.weapons?.fireMissiles(this, this.target);
  }

  updateFree(dt, cmd, world) {
    const s = this.stats;
    if (this.landLag > 0) {
      this.landLag -= dt;
      const f = this.zusa ? 3.2 : 10;
      this.vel.x *= Math.exp(-f * dt); this.vel.z *= Math.exp(-f * dt);
      if (this.landLag <= 0) this.zusa = false;
      return true;
    }
    if (this.tryActions(cmd, world)) return false;

    const mv = cmd.move;
    const mvLen = Math.hypot(mv.x, mv.z);
    if (cmd.boostPressed && this.onGround && !this.overheat && this.boost > 0) {
      this.vel.y = s.jump * this.mul; this.onGround = false; this.useBoost(5);
      world.audio?.play('jump');
    }
    const canBoost = cmd.boost && !this.overheat && this.boost > 0 && !this.onGround;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (canBoost) {
      // boost rise. Horizontal speed is preserved (inertial jump after a BD), input only steers.
      this.boosting = true;
      this.vel.y = approach(this.vel.y, s.rise * this.mul, 60 * dt);
      this.airSteer(dt, mv, mvLen, hs, 0.3, 1.6);
      this.useBoost(24 * dt);
      return false;
    }
    if (this.onGround) {
      const sp = s.walk * this.mul * (this.aimT > 0 ? 0.7 : 1);
      const k = 1 - Math.exp(-10 * dt);
      this.vel.x += (mv.x * sp - this.vel.x) * k;
      this.vel.z += (mv.z * sp - this.vel.z) * k;
    } else {
      this.airSteer(dt, mv, mvLen, hs, 0.9, 1.2);
    }
    return true;
  }

  // Air control: decay towards walk speed slowly, steer the direction with the stick.
  airSteer(dt, mv, mvLen, hs, drag, steer) {
    const s = this.stats;
    if (hs > s.walk * 0.8) { const k = Math.exp(-drag * dt); this.vel.x *= k; this.vel.z *= k; }
    if (mvLen > 0.2) {
      const sp = Math.max(Math.hypot(this.vel.x, this.vel.z), s.walk * 0.8);
      const k = 1 - Math.exp(-steer * dt);
      this.vel.x += (mv.x / mvLen * sp - this.vel.x) * k;
      this.vel.z += (mv.z / mvLen * sp - this.vel.z) * k;
    }
  }

  // ---------------------------------------------------------------- step (homing cut)
  startStep(dir, world) {
    const s = this.stats;
    this.setState('step');
    this.stepDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.stepSerial++; // cuts homing of everything aimed at us
    this.useBoost(12);
    this.vel.set(this.stepDir.x * s.stepSpeed * this.mul, 0, this.stepDir.z * s.stepSpeed * this.mul);
    this.landLag = 0;
    this.meleeQueued = false;
    this.model.saber.visible = false;
    world.audio?.play('step');
  }

  updateStep(dt, cmd, world) {
    const s = this.stats;
    this.boosting = true;
    if (this.target) this.faceTarget(dt, 8);
    const sp = s.stepSpeed * this.mul * (this.stateT < 0.2 ? 1 : 0.6);
    this.vel.x = this.stepDir.x * sp; this.vel.z = this.stepDir.z * sp;
    this.vel.y = 0;
    // step -> BD cancel, moving shots during a step
    if (cmd.bd && this.stateT > 0.08 && this.boost > 0 && !this.overheat) { this.startBD(cmd, world); return; }
    if (cmd.shoot || cmd.missile) this.tryActions({ ...cmd, step: null, bd: false, melee: false, special: false }, world);
    if (this.state === 'step' && this.stateT >= 0.3) this.setState('free');
  }

  // ---------------------------------------------------------------- boost dash
  startBD(cmd, world) {
    const s = this.stats;
    const mv = cmd.move;
    const l = mv ? Math.hypot(mv.x, mv.z) : 0;
    if (l > 0.2) this.dashDir.set(mv.x / l, 0, mv.z / l);
    else if (this.target) { this.dashDir.set(this.target.pos.x - this.pos.x, 0, this.target.pos.z - this.pos.z); if (this.dashDir.lengthSq() < 1e-4) this.forward(this.dashDir); this.dashDir.normalize(); }
    else this.forward(this.dashDir);
    this.setState('bd');
    this.useBoost(8);
    this.landLag = 0;
    this.meleeQueued = false;
    this.model.saber.visible = false;
    this.vel.x = this.dashDir.x * s.dash * this.mul * 0.9; this.vel.z = this.dashDir.z * s.dash * this.mul * 0.9;
    this.vel.y = Math.max(this.vel.y, this.onGround ? 1.5 : 0);
    world.audio?.play('step');
  }

  updateBD(dt, cmd, world) {
    const s = this.stats;
    this.boosting = true;
    const mv = cmd.move;
    const mvLen = Math.hypot(mv.x, mv.z);
    if (mvLen > 0.2) {
      // curve towards the stick direction with a limited turn rate
      const cur = Math.atan2(this.dashDir.x, this.dashDir.z);
      const want = Math.atan2(mv.x, mv.z);
      const d = angleDiff(cur, want);
      const turn = clamp(d, -3.0 * dt, 3.0 * dt);
      this.turnRate = dt > 0 ? turn / dt : 0;
      const a = cur + turn;
      this.dashDir.set(Math.sin(a), 0, Math.cos(a));
    } else this.turnRate = 0;
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (this.dashDir.x * s.dash * this.mul - this.vel.x) * k;
    this.vel.z += (this.dashDir.z * s.dash * this.mul - this.vel.z) * k;
    this.vel.y = approach(this.vel.y, -0.4, 30 * dt);
    this.useBoost(28 * dt);
    if (this.tryActions(cmd, world, { bd: false })) return;
    if (!cmd.boost || this.overheat) this.setState('free');
  }

  // ---------------------------------------------------------------- turn-around shot
  updateTurnShot(dt, cmd, world) {
    // feet stop, whole body turns to the target, then fires
    this.vel.x *= Math.exp(-9 * dt); this.vel.z *= Math.exp(-9 * dt);
    if (!this.onGround && this.stateT < 0.45) this.vel.y = approach(this.vel.y, 0, 60 * dt);
    this.faceTarget(dt, 16);
    if (!this.fired && this.stateT >= 0.2) {
      this.fired = true;
      if (this.target) this.yaw = this.yawTo(this.target);
      if (this.ammo[this.turnKind] > 0) this.fire(this.turnKind, world);
    }
    if (this.fired) {
      // shot -> step / BD cancel
      if (cmd.step && this.canDash()) { this.startStep(cmd.step, world); return false; }
      if (cmd.bd && this.canDash()) { this.startBD(cmd, world); return false; }
    }
    if (this.stateT >= 0.6) this.setState('free');
    return this.stateT >= 0.45;
  }

  // ---------------------------------------------------------------- melee
  // kind: 'n' neutral 3-hit (finisher launches), 's' side (curving approach, finisher blows away),
  //       'f' forward thrust (single heavy hit), 'b' back = shield guard
  startMelee(world, kind = 'n', side = 1) {
    if (kind === 'b') { this.startGuard(world); return; }
    this.setState('melee');
    this.meleeKind = kind || 'n';
    this.meleeSide = side || 1;
    this.meleeStage = 0;
    this.meleeQueued = false;
    this.meleeHitDone = false;
    this.swingSfx = false;
    const t = this.target;
    const d = t ? this.distTo(t) : 99;
    const range = this.stats.melee.range * (kind === 'f' ? 1.2 : 1);
    this.meleePhase = t && t.alive && d <= range && d > 3 ? 'lunge' : 'swing';
    this.lungeSerial = t ? t.stepSerial : 0;
    this.model.saber.visible = true;
    world.audio?.play('saberOn');
  }

  endMelee() { this.model.saber.visible = false; }

  meleeDur() {
    const m = this.stats.melee;
    if (this.meleeKind === 'f') return m.swing + 0.12;
    return m.swing + (this.meleeStage === 2 ? 0.15 : 0);
  }

  updateMelee(dt, cmd, world) {
    const m = this.stats.melee;
    const t = this.target;
    if (cmd.melee) this.meleeQueued = true;
    // cancel routes: melee -> step, melee -> BD, melee (after a hit) -> sub-shot (missiles)
    if (cmd.step && this.boost > 0 && !this.overheat) { this.endMelee(); this.startStep(cmd.step, world); return; }
    if (cmd.bd && this.boost > 0 && !this.overheat) { this.endMelee(); this.startBD(cmd, world); return; }
    if (cmd.missile && this.meleeHitDone && this.ammo.missile > 0 && t) {
      this.endMelee();
      this.setState('free');
      this.yaw = this.yawTo(t);
      this.ammo.missile--; this.cd = this.stats.missile.cd; this.aimT = 0.5;
      world.weapons?.fireMissiles(this, t);
      return;
    }

    if (this.meleePhase === 'lunge') {
      this.boosting = true;
      const homing = t && t.alive && t.stepSerial === this.lungeSerial;
      if (homing) {
        tmpV.copy(t.pos).sub(this.pos);
        const dy = t.pos.y - this.pos.y;
        tmpV.y = 0;
        const dist = Math.hypot(tmpV.length(), dy);
        const flat = tmpV.length();
        let a = Math.atan2(tmpV.x, tmpV.z);
        // side melee: curve around the target (sidesteps shots without a step)
        if (this.meleeKind === 's') a += this.meleeSide * clamp(flat / m.range, 0, 1) * 1.15;
        const sp = m.lunge * this.mul * (this.meleeKind === 'f' ? 1.3 : this.meleeKind === 's' ? 1.05 : 1);
        this.vel.set(Math.sin(a) * sp, clamp(dy * 3, -sp, sp), Math.cos(a) * sp);
        this.yaw = this.meleeKind === 's' ? Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : a;
        if (dist < this.stats.radius + t.stats.radius + (this.meleeKind === 'f' ? 1.6 : 0.8)) { this.meleePhase = 'swing'; this.stateT = 0; }
      }
      if (this.stateT > (this.meleeKind === 's' ? 1.0 : 0.8)) { this.meleePhase = 'swing'; this.stateT = 0; }
      return;
    }
    // swing
    const dur = this.meleeDur();
    if (this.stateT < 0.1 && t) this.faceTarget(dt, 20);
    this.vel.multiplyScalar(Math.exp(-10 * dt));
    if (this.stateT < 0.08) {
      this.forward(tmpV);
      const push = this.meleeKind === 'f' ? 16 : 8;
      this.vel.x = tmpV.x * push; this.vel.z = tmpV.z * push;
    }
    if (!this.swingSfx) { this.swingSfx = true; world.audio?.play('swing'); }
    const active = this.stateT >= dur * 0.3 && this.stateT <= dur * 0.6;
    if (active && !this.meleeHitDone && t && t.canBeHit) {
      tmpV.copy(t.pos).sub(this.pos);
      const dy = Math.abs(tmpV.y);
      tmpV.y = 0;
      const dist = tmpV.length();
      const ang = Math.abs(angleDiff(this.yaw, Math.atan2(tmpV.x, tmpV.z)));
      const reach = m.hitRange * (this.meleeKind === 'f' ? 1.3 : 1);
      if (dist < reach && dy < 4 && ang < 1.3) {
        this.meleeHitDone = true;
        const st = this.meleeStage;
        const knock = tmpV.normalize().clone();
        const fin = this.meleeKind === 'f' || st === 2;
        world.weapons?.meleeHit(this, t, {
          dmg: this.meleeKind === 'f' ? Math.round(m.dmg[2] * 1.05) : m.dmg[st],
          dv: this.meleeKind === 'f' ? 6 : m.dv[st], scale: 0.9, knock, stun: 0.6, forceDown: fin, melee: true, stage: fin ? 2 : st,
          launch: this.meleeKind === 'n' && st === 2, blow: (this.meleeKind === 's' && st === 2) || this.meleeKind === 'f',
        });
      }
    }
    if (this.stateT >= dur) {
      if (this.meleeQueued && this.meleeStage < 2 && this.meleeKind !== 'f') {
        this.meleeStage++;
        this.meleeQueued = false;
        this.meleeHitDone = false;
        this.swingSfx = false;
        this.stateT = 0;
        // re-lunge a little if target drifted away
        if (t && this.distTo(t) > m.hitRange && this.distTo(t) < 10) { this.meleePhase = 'lunge'; this.lungeSerial = t.stepSerial; }
      } else if (this.stateT >= dur + 0.18) {
        this.endMelee();
        this.setState('free');
      }
    }
  }

  // ---------------------------------------------------------------- shield guard (back + melee)
  startGuard(world) {
    this.setState('guard');
    this.model.saber.visible = false;
    world.audio?.play('step', 0.6);
  }

  // Blocks shots and melee from the front (+-75 deg) for its duration.
  isGuarding(from) {
    if (this.state !== 'guard' || this.stateT > 0.85) return false;
    return Math.abs(angleDiff(this.yaw, Math.atan2(from.x - this.pos.x, from.z - this.pos.z))) < 1.3;
  }

  updateGuard(dt, cmd, world) {
    this.vel.x *= Math.exp(-8 * dt); this.vel.z *= Math.exp(-8 * dt);
    if (!this.onGround) this.vel.y = approach(this.vel.y, -2, 30 * dt);
    this.faceTarget(dt, 14);
    if (this.stateT > 0.2) {
      if (cmd.step && this.canDash()) { this.startStep(cmd.step, world); return false; }
      if (cmd.bd && this.canDash()) { this.startBD(cmd, world); return false; }
    }
    if (this.stateT >= 0.95) this.setState('free');
    return false;
  }

  // ---------------------------------------------------------------- special (stop shot)
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
    if (this.fired && this.stateT >= sp.windup + 0.1) {
      if (cmd.step && this.canDash()) { this.startStep(cmd.step, world); return; }
      if (cmd.bd && this.canDash()) { this.startBD(cmd, world); return; }
    }
    if (this.stateT >= sp.windup + sp.recover) this.setState('free');
  }

  // ---------------------------------------------------------------- damage
  takeHit(hit, attacker) {
    if (!this.canBeHit) return 0;
    // shield guard: block hits from the front (projectiles use their position, melee the attacker's)
    const from = hit.from || attacker.pos;
    if (this.isGuarding(from)) {
      this.guardHit = true;
      this.stateT = Math.min(this.stateT, 0.5); // a blocked hit extends the guard a little
      if (hit.melee) { attacker.vel.multiplyScalar(-0.3); attacker.endMelee?.(); attacker.setState('hitstun'); attacker.hitstunT = 0.35; }
      return 0;
    }
    const odMul = attacker && attacker.overdriveT > 0 ? 1.15 : 1;
    const dmg = Math.max(1, Math.round(hit.dmg * this.comboScale * odMul));
    // OVERDRIVE gauge fills both when dealing and taking damage
    if (this.overdriveT <= 0) this.od = Math.min(OD_MAX, this.od + dmg * 0.2);
    if (attacker && attacker.overdriveT <= 0) attacker.od = Math.min(OD_MAX, attacker.od + dmg * 0.14);
    this.comboScale = Math.max(0.15, this.comboScale * hit.scale);
    this.recoverT = 0;
    this.hp = Math.max(0, this.hp - dmg);
    this.downValue += hit.dv;
    this.flash = 0.16;
    this.model.saber.visible = false;
    const knock = hit.knock || tmpV.copy(this.pos).sub(attacker.pos).setY(0).normalize();
    this.hitDir.set(knock.x, 0, knock.z);
    if (this.hp <= 0) {
      this.dead = true;
      this.setState('dead');
      this.vel.set(knock.x * 14, 10, knock.z * 14);
      this.onGround = false;
    } else if (this.downValue >= DOWN_THRESHOLD || hit.forceDown) {
      this.setState('down');
      if (hit.launch) this.vel.set(knock.x * 4, 17, knock.z * 4); // launcher: knocked up into the air
      else if (hit.blow) this.vel.set(knock.x * 28, 7, knock.z * 28); // blow-away
      else this.vel.set(knock.x * 13, 9, knock.z * 13);
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

  // ---------------------------------------------------------------- facing / twist
  // Lower body (this.yaw) follows the movement, upper body (this.twist) tracks the target within +-100 deg.
  updateFacing(dt) {
    const st = this.state;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (st === 'bd') {
      this.yaw += angleDiff(this.yaw, Math.atan2(this.dashDir.x, this.dashDir.z)) * Math.min(1, 12 * dt);
    } else if (st === 'free') {
      if (this.onGround) {
        if (hs > 2 && this.landLag <= 0) this.yaw += angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 10 * dt);
        else if (this.target && this.aimT <= 0) this.faceTarget(dt, 4);
      } else if (hs > 4) this.yaw += angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 4 * dt);
      else if (this.target) this.faceTarget(dt, 3);
    }
    let want = 0;
    if (this.target && !this.dead && (st === 'free' || st === 'bd' || st === 'step')) {
      want = clamp(angleDiff(this.yaw, this.yawTo(this.target)), -TWIST_MAX, TWIST_MAX);
    }
    this.twist += (want - this.twist) * Math.min(1, (this.aimT > 0 ? 20 : 9) * dt);
  }

  // ---------------------------------------------------------------- animation (see anim.js)
  animate(dt) { this.anim.update(dt, this); }
}

