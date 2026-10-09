import * as THREE from 'three';

// Projectiles (beam / missile / special beam), homing, collision, and melee hit resolution.

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
beamGeo.rotateX(Math.PI / 2); // axis along +Z, centered
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const seg = new THREE.Vector3();

function additive(color, opacity = 1, k = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

// closest distance between point c and segment a-b
function segPointDist(a, b, c) {
  seg.subVectors(b, a);
  const l2 = seg.lengthSq();
  let t = l2 > 0 ? tmp2.subVectors(c, a).dot(seg) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return tmp2.copy(a).addScaledVector(seg, t).distanceTo(c);
}

export class Weapons {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.missileGeo = new THREE.ConeGeometry(0.22, 1.0, 6);
    this.missileGeo.rotateX(Math.PI / 2);
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.4, roughness: 0.5 });
    this.mats = new Map();
  }

  mat(color, op, intensity = 1) {
    const k = color + ':' + op + ':' + intensity;
    if (!this.mats.has(k)) this.mats.set(k, additive(color, op, intensity));
    return this.mats.get(k);
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.obj);
    this.list = [];
  }

  makeBeamObj(color, radius, len) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(beamGeo, this.mat(color, 0.55, 2.4));
    outer.scale.set(radius * 1.6, radius * 1.6, len);
    const core = new THREE.Mesh(beamGeo, this.mat(0xffffff, 0.95, 3));
    core.scale.set(radius * 0.6, radius * 0.6, len * 0.95);
    g.add(outer, core);
    return g;
  }

  spawn(p) {
    p.prev = p.pos.clone();
    p.age = 0;
    this.scene.add(p.obj);
    this.list.push(p);
    return p;
  }

  aimPoint(owner, target) {
    return target ? target.center.clone() : owner.pos.clone().add(owner.aimForward().multiplyScalar(50)).setY(owner.pos.y + 2.8);
  }

  fireBeam(owner, target) {
    const s = owner.stats.rifle;
    const from = owner.model.muzzle.getWorldPosition(new THREE.Vector3());
    // muzzle can lag the aim pose by a frame: fall back to a point in front of the chest
    const chest = owner.pos.clone().setY(owner.pos.y + 3.4).add(owner.aimForward().multiplyScalar(2.2));
    if (from.distanceTo(chest) > 3) from.copy(chest);
    const dir = this.aimPoint(owner, target).sub(from).normalize();
    this.spawn({
      kind: 'beam', owner, target, pos: from, vel: dir.multiplyScalar(s.speed),
      speed: s.speed, turn: s.turn, homingT: s.homing, red: owner.isRedLock(), serial: target ? target.stepSerial : 0,
      hit: { dmg: s.dmg, dv: s.dv, scale: s.scale, stun: 0.45 }, radius: s.radius, life: 1.6, color: s.color,
      obj: this.makeBeamObj(s.color, s.radius * 0.45, s.len),
    });
    this.world.fx?.muzzle(from, s.color);
    this.world.audio?.play('beam', owner.isPlayer ? 1 : 0.6);
  }

  fireMissiles(owner, target) {
    const s = owner.stats.missile;
    const right = new THREE.Vector3(-Math.cos(owner.aimYaw), 0, Math.sin(owner.aimYaw));
    const fwd = owner.aimForward();
    for (let i = 0; i < s.count; i++) {
      const side = (i % 2 === 0 ? 1 : -1) * (1 + Math.floor(i / 2) * 0.5);
      const from = owner.pos.clone().setY(owner.pos.y + 4.4).addScaledVector(right, side * 1.4);
      const vel = fwd.clone().multiplyScalar(0.6).addScaledVector(right, side * 0.5).add(new THREE.Vector3(0, 0.7, 0)).normalize().multiplyScalar(s.speed * 0.7);
      const obj = new THREE.Group();
      const body = new THREE.Mesh(this.missileGeo, this.missileMat);
      const glow = new THREE.Mesh(beamGeo, this.mat(0xffaa44, 0.8, 3));
      glow.scale.set(0.25, 0.25, 0.6); glow.position.z = -0.7;
      obj.add(body, glow);
      this.spawn({
        kind: 'missile', owner, target, pos: from, vel, delay: 0.12 + i * 0.05,
        speed: s.speed, turn: s.turn, homingT: s.homing, red: owner.isRedLock(), serial: target ? target.stepSerial : 0,
        hit: { dmg: s.dmg, dv: s.dv, scale: s.scale, stun: 0.5 }, radius: s.radius, life: 3.0, color: 0xffaa44, obj,
      });
    }
    this.world.audio?.play('missile', owner.isPlayer ? 1 : 0.6);
  }

  fireSpecial(owner, target) {
    const s = owner.stats.special;
    const from = owner.model.specialMuzzle.getWorldPosition(new THREE.Vector3());
    const chest = owner.pos.clone().setY(owner.pos.y + 3.4).add(owner.forward().multiplyScalar(2.5));
    if (from.distanceTo(chest) > 4) from.copy(chest);
    const dir = this.aimPoint(owner, target).sub(from).normalize();
    this.spawn({
      kind: 'special', owner, target, pos: from, vel: dir.multiplyScalar(s.speed),
      speed: s.speed, turn: 0.6, homingT: 0.5, red: owner.isRedLock(), serial: target ? target.stepSerial : 0,
      hit: { dmg: s.dmg, dv: s.dv, scale: s.scale, forceDown: true }, radius: s.radius, life: 1.2, color: s.color,
      obj: this.makeBeamObj(s.color, s.radius * 0.5, 18), pierce: true,
    });
    this.world.fx?.muzzle(from, s.color, 2.2);
    this.world.fx?.ring(from, s.color, 6, 0.4);
    this.world.audio?.play('special', owner.isPlayer ? 1 : 0.7);
    this.world.onShake?.(owner, 0.5);
  }

  meleeHit(attacker, target, hit) {
    const dmg = target.takeHit(hit, attacker);
    if (dmg > 0) {
      const at = target.center.clone();
      // hit stop: freeze both mechs for a few frames (longer on the finisher)
      this.world.hitStop?.(hit.stage === 2 ? 0.12 : 0.07, [attacker, target]);
      this.world.fx?.hitSpark(at, attacker.model.saber.userData.color);
      this.world.audio?.play('slash');
      this.world.onHit?.(attacker, target, dmg, at, hit);
    }
  }

  update(dt) {
    const world = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      p.life -= dt;
      p.prev.copy(p.pos);
      const t = p.target;

      if (p.kind === 'missile') {
        if (p.age > p.delay) {
          // accelerate toward cruise speed
          const sp = Math.min(p.speed, p.vel.length() + 60 * dt);
          p.vel.setLength(sp);
        }
      }
      // homing (only in red lock, cut by target stepping)
      const homingActive = p.red && t && t.alive && p.homingT > 0 && t.stepSerial === p.serial && (p.kind !== 'missile' || p.age > p.delay);
      if (homingActive) {
        p.homingT -= dt;
        const want = tmp.copy(t.center).sub(p.pos).normalize();
        const cur = p.vel.clone().normalize();
        const ang = cur.angleTo(want);
        if (ang > 1e-4) {
          const k = Math.min(1, (p.turn * dt) / ang);
          cur.lerp(want, k).normalize();
          p.vel.copy(cur.multiplyScalar(p.vel.length()));
        }
      }
      p.pos.addScaledVector(p.vel, dt);

      // orientation
      tmp.copy(p.pos).add(p.vel);
      p.obj.position.copy(p.pos);
      p.obj.lookAt(tmp);
      if (p.kind === 'beam' || p.kind === 'special') {
        // center the beam body behind its head
        p.obj.position.addScaledVector(p.vel.clone().normalize(), -(p.kind === 'special' ? 9 : 2.5));
      }
      if (p.kind === 'missile') world.fx?.trail(p.pos, 0xffbb66, 0.35, 0.3);
      if (p.kind === 'special') world.fx?.trail(p.pos, p.color, 1.2, 0.3);

      let dead = p.life <= 0;
      // hit mechs (anyone that isn't the owner)
      if (!dead) {
        for (const m of world.mechs) {
          if (m === p.owner || !m.canBeHit) continue;
          if (p.hitSet && p.hitSet.has(m)) continue;
          const d = segPointDist(p.prev, p.pos, m.center);
          if (d < 2.0 + p.radius) {
            const knock = p.vel.clone().setY(0).normalize();
            const dmg = m.takeHit({ ...p.hit, knock }, p.owner);
            if (dmg > 0) {
              const at = m.center.clone();
              world.fx?.hitSpark(at, p.color);
              if (p.kind === 'missile') world.fx?.explosion(p.pos, 0.5);
              world.audio?.play(p.kind === 'missile' ? 'explode' : 'hit');
              world.onHit?.(p.owner, m, dmg, at, p.hit);
            }
            if (p.pierce) { (p.hitSet ||= new Set()).add(m); } else { dead = true; }
            break;
          }
        }
      }
      // hit terrain
      if (!dead && world.arena.pointBlocked(p.pos)) {
        dead = true;
        // scorch mark if it hit the floor or a roof (not a wall)
        const g = world.arena.groundAt(p.pos.x, p.pos.z, 0, p.prev.y);
        if (p.prev.y - g < 3 && p.pos.y - g < 1.5) world.arena.addScorch(tmp.set(p.pos.x, g, p.pos.z), p.kind === 'special' ? 6 : p.kind === 'missile' ? 3.5 : 2.5);
        if (p.kind === 'missile') { world.fx?.explosion(p.pos, 0.6); world.audio?.play('explode', 0.5); }
        else world.fx?.burst(p.pos, p.color, p.kind === 'special' ? 30 : 10, 10, 0.4, 0.4);
      }
      if (dead) {
        this.scene.remove(p.obj);
        this.list.splice(i, 1);
      }
    }
  }

  // Projectiles currently threatening a given mech (used by the AI to decide dodges)
  threatsTo(m) {
    return this.list.filter((p) => p.owner !== m && p.target === m);
  }
}
