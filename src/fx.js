import * as THREE from 'three';

const MAX = 700;
const MAX_SMOKE = 160;
const MAX_DEBRIS = 60;
const dummy = new THREE.Object3D();
const col = new THREE.Color();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();

// Pooled particles: additive sparks/glow (one InstancedMesh), alpha-blended smoke/dust (one InstancedMesh),
// lit debris chunks (one InstancedMesh), shockwave rings and a fixed pool of flash lights.
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.mesh = this.makePool(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAX);
    this.parts = [];
    for (let i = 0; i < MAX; i++) this.parts.push({ life: 0, max: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, drag: 0, grav: 0, color: new THREE.Color() });
    this.next = 0;

    this.smokeMesh = this.makePool(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }), MAX_SMOKE);
    this.smoke = [];
    for (let i = 0; i < MAX_SMOKE; i++) this.smoke.push({ life: 0, max: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, grow: 1, color: new THREE.Color() });
    this.nextSmoke = 0;

    this.debrisMesh = this.makePool(new THREE.BoxGeometry(1, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4 }), MAX_DEBRIS);
    this.debrisMesh.castShadow = true;
    this.debris = [];
    for (let i = 0; i < MAX_DEBRIS; i++) this.debris.push({ life: 0, max: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 1 });
    this.nextDebris = 0;

    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    // Fixed pool of point lights (adding/removing lights would force shader recompiles)
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      scene.add(l);
      this.flashes.push({ l, life: 0, max: 1, intensity: 0 });
    }
    this.screenFlash = null; // set by main (DOM overlay)
  }

  makePool(geo, mat, n) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    dummy.position.set(0, -999, 0); dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, col.set(0xffffff)); }
    this.scene.add(mesh);
    return mesh;
  }

  spawn(pos, vel, color, size, life, drag = 2, grav = 0) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % MAX;
    p.pos.copy(pos); p.vel.copy(vel); p.color.set(color);
    p.size = size; p.life = p.max = life; p.drag = drag; p.grav = grav;
  }

  // alpha-blended puff: dust, smoke
  puff(pos, vel, color, size, life, grow = 2.2) {
    const p = this.smoke[this.nextSmoke];
    this.nextSmoke = (this.nextSmoke + 1) % MAX_SMOKE;
    p.pos.copy(pos); p.vel.copy(vel); p.color.set(color);
    p.size = size; p.grow = grow; p.life = p.max = life;
  }

  chunk(pos, vel, size, life) {
    const p = this.debris[this.nextDebris];
    this.nextDebris = (this.nextDebris + 1) % MAX_DEBRIS;
    p.pos.copy(pos); p.vel.copy(vel);
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    p.size = size; p.life = p.max = life;
  }

  burst(pos, color, count = 12, speed = 10, size = 0.3, life = 0.4) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.spawn(pos, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), 3, -6);
    }
  }

  smokeBurst(pos, color, count, speed, size, life) {
    for (let i = 0; i < count; i++) {
      tv.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.puff(pos, tv, color, size * (0.6 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6));
    }
  }

  // sparks + smoke + shockwave ring
  hitSpark(pos, color) {
    this.burst(pos, 0xffffff, 8, 16, 0.22, 0.25);
    this.burst(pos, color, 16, 12, 0.35, 0.45);
    // streaking sparks (small, fast, gravity)
    for (let i = 0; i < 10; i++) {
      tv.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(18 + Math.random() * 14);
      this.spawn(pos, tv, 0xffd080, 0.12, 0.35 + Math.random() * 0.2, 1.5, -30);
    }
    this.smokeBurst(pos, 0x8a8480, 4, 3, 0.7, 0.9);
    this.ring(pos, color, 5, 0.28);
    this.light(pos, color, 6, 0.12);
  }

  guardSpark(pos, color = 0x9fe8ff) {
    this.burst(pos, 0xffffff, 10, 18, 0.2, 0.2);
    this.burst(pos, color, 12, 10, 0.3, 0.3);
    this.ring(pos, color, 3.5, 0.2);
    this.light(pos, color, 5, 0.1);
  }

  explosion(pos, scale = 1) {
    this.burst(pos, 0xffe0a0, Math.round(25 * scale), 16 * scale, 0.8 * scale, 0.6);
    this.burst(pos, 0xff6a20, Math.round(30 * scale), 10 * scale, 1.0 * scale, 0.9);
    this.smokeBurst(pos, 0x5a5250, Math.round(8 * scale), 5 * scale, 1.4 * scale, 1.6);
    this.ring(pos, 0xffaa55, 10 * scale, 0.5);
    this.light(pos, 0xffaa55, 20 * scale, 0.3);
  }

  // KO: big fireball, flying debris, white flash
  bigExplosion(pos) {
    this.explosion(pos, 2.2);
    this.burst(pos, 0xffffff, 30, 26, 0.6, 0.35);
    for (let i = 0; i < 16; i++) {
      tv.set(Math.random() - 0.5, 0.4 + Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 16);
      this.chunk(pos, tv, 0.3 + Math.random() * 0.45, 2.2 + Math.random());
    }
    this.ring(pos, 0xffffff, 22, 0.6);
    this.light(pos, 0xffe0b0, 60, 0.5);
    this.screenFlash?.(0.9);
  }

  muzzle(pos, color, size = 0.7) {
    this.spawn(pos, new THREE.Vector3(), 0xffffff, size, 0.08, 0);
    this.spawn(pos, new THREE.Vector3(), color, size * 1.8, 0.12, 0);
    for (let i = 0; i < 4; i++) { tv.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8); this.spawn(pos, tv, color, size * 0.4, 0.15, 4); }
    this.light(pos, color, 5, 0.08);
  }

  trail(pos, color, size = 0.35, life = 0.25) {
    this.spawn(pos, new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)), color, size, life, 1);
  }

  // afterglow left behind along a beam's path this frame
  beamTrail(a, b, color, size) {
    for (let i = 0; i < 3; i++) {
      tv.lerpVectors(a, b, Math.random());
      this.spawn(tv, tv2.set(0, 0, 0), color, size * (0.6 + Math.random() * 0.5), 0.22, 0);
    }
  }

  ring(pos, color, radius, life) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(pos);
    m.lookAt(pos.x + Math.random() - 0.5, pos.y + 1, pos.z + Math.random() - 0.5);
    this.scene.add(m);
    this.rings.push({ m, life, max: life, radius });
  }

  light(pos, color, intensity, life) {
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.life < f.life) f = x;
    f.l.position.copy(pos); f.l.color.set(color);
    f.life = f.max = life; f.intensity = intensity * 10;
  }

  update(dt) {
    const mesh = this.mesh;
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (p.life <= 0) {
        if (p.max > 0) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); p.max = 0; }
        continue;
      }
      p.life -= dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y += p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      const k = Math.max(0, p.life / p.max);
      dummy.position.copy(p.pos);
      dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
      dummy.rotation.set(p.life * 7, p.life * 5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.copy(p.color).multiplyScalar(k * 2);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const sm = this.smokeMesh;
    for (let i = 0; i < MAX_SMOKE; i++) {
      const p = this.smoke[i];
      if (p.life <= 0) {
        if (p.max > 0) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix); p.max = 0; }
        continue;
      }
      p.life -= dt;
      p.vel.multiplyScalar(Math.exp(-2.5 * dt));
      p.vel.y += 1.2 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const age = 1 - p.life / p.max;
      // grow, then shrink away at the end (no per-instance opacity)
      const s = p.size * (0.5 + age * p.grow) * Math.min(1, (p.life / p.max) * 3);
      dummy.position.copy(p.pos);
      dummy.scale.setScalar(Math.max(0, s));
      dummy.rotation.set(age * 2, age * 3, 0);
      dummy.updateMatrix();
      sm.setMatrixAt(i, dummy.matrix);
      sm.setColorAt(i, p.color);
    }
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;

    const dm = this.debrisMesh;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const p = this.debris[i];
      if (p.life <= 0) {
        if (p.max > 0) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); dummy.updateMatrix(); dm.setMatrixAt(i, dummy.matrix); p.max = 0; }
        continue;
      }
      p.life -= dt;
      p.vel.y -= 28 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.2) { p.pos.y = 0.2; p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin.multiplyScalar(0.6); }
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      if (Math.random() < 0.3 && p.life > p.max * 0.5) this.puff(p.pos, tv.set(0, 1, 0), 0x3a3634, 0.5, 0.6, 1.5);
      dummy.position.copy(p.pos);
      dummy.rotation.copy(p.rot);
      dummy.scale.setScalar(p.size * Math.min(1, p.life * 2));
      dummy.updateMatrix();
      dm.setMatrixAt(i, dummy.matrix);
      dm.setColorAt(i, col.set(0x4a4c52));
    }
    dm.instanceMatrix.needsUpdate = true;
    if (dm.instanceColor) dm.instanceColor.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(0.5 + r.radius * k);
      r.m.material.opacity = Math.max(0, 1 - k);
      if (r.life <= 0) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.l.intensity = f.life > 0 ? f.intensity * (f.life / f.max) : 0;
    }
  }

  clear() {
    for (const p of this.parts) p.life = Math.min(p.life, 0.0001);
    for (const p of this.smoke) p.life = Math.min(p.life, 0.0001);
    for (const p of this.debris) p.life = Math.min(p.life, 0.0001);
    for (const r of this.rings) { this.scene.remove(r.m); r.m.material.dispose(); }
    this.rings = [];
    for (const f of this.flashes) { f.life = 0; f.l.intensity = 0; }
  }
}

// ------------------------------------------------------------------ per-mech trails
const RIB_N = 22;

// Camera-facing ribbon that follows an anchor (boost trails from shoulders and feet).
class Ribbon {
  constructor(scene, color, width) {
    this.pts = Array.from({ length: RIB_N }, () => new THREE.Vector3());
    this.width = width;
    this.color = new THREE.Color(color).multiplyScalar(1.6);
    this.strength = 0;
    this.primed = false;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(RIB_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(RIB_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const idx = [];
    for (let i = 0; i < RIB_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt, anchor, active, camPos) {
    if (!this.primed || (!active && this.strength <= 0)) { for (const p of this.pts) p.copy(anchor); this.primed = true; }
    this.strength = active ? Math.min(1, this.strength + dt * 6) : Math.max(0, this.strength - dt * 3);
    this.mesh.visible = this.strength > 0.01;
    if (!this.mesh.visible) return;
    for (let i = RIB_N - 1; i > 0; i--) this.pts[i].copy(this.pts[i - 1]);
    this.pts[0].copy(anchor);
    const pos = this.posAttr.array, c = this.colAttr.array;
    for (let i = 0; i < RIB_N; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(RIB_N - 1, i + 1)], o = this.pts[Math.max(0, i - 1)];
      tv.subVectors(o, q);
      if (tv.lengthSq() < 1e-6) tv.set(0, 0, 1);
      tv2.subVectors(camPos, p);
      tv.cross(tv2).normalize();
      const f = 1 - i / (RIB_N - 1);
      const w = this.width * (0.25 + 0.75 * f);
      pos[i * 6] = p.x + tv.x * w; pos[i * 6 + 1] = p.y + tv.y * w; pos[i * 6 + 2] = p.z + tv.z * w;
      pos[i * 6 + 3] = p.x - tv.x * w; pos[i * 6 + 4] = p.y - tv.y * w; pos[i * 6 + 5] = p.z - tv.z * w;
      const k = f * f * this.strength;
      for (const o2 of [0, 3]) { c[i * 6 + o2] = this.color.r * k; c[i * 6 + o2 + 1] = this.color.g * k; c[i * 6 + o2 + 2] = this.color.b * k; }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// Step afterimages (3 additive ghost copies of the model), BD boost ribbons, ground dust.
export class MechTrails {
  constructor(scene, mech, color) {
    this.scene = scene;
    this.mech = mech;
    this.color = color;
    const src = mech.model.root;
    this.srcNodes = [];
    src.traverse((o) => this.srcNodes.push(o));
    this.ghosts = [];
    for (let i = 0; i < 3; i++) {
      const g = src.clone(true);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const nodes = [];
      g.traverse((o) => { nodes.push(o); if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
      g.visible = false;
      scene.add(g);
      this.ghosts.push({ root: g, nodes, mat, life: 0 });
    }
    this.nextGhost = 0;
    this.lastSerial = mech.stepSerial;
    this.ghostTimer = -1;
    this.ghostCount = 0;
    const p = mech.model.parts;
    this.ribbons = [
      [new Ribbon(scene, color, 0.32), p.shArmL], [new Ribbon(scene, color, 0.32), p.shArmR],
      [new Ribbon(scene, color, 0.24), p.footL], [new Ribbon(scene, color, 0.24), p.footR],
    ];
    this.dustT = 0;
  }

  snapshot() {
    const g = this.ghosts[this.nextGhost];
    this.nextGhost = (this.nextGhost + 1) % this.ghosts.length;
    const n = Math.min(g.nodes.length, this.srcNodes.length);
    for (let i = 0; i < n; i++) {
      const s = this.srcNodes[i], d = g.nodes[i];
      d.position.copy(s.position); d.quaternion.copy(s.quaternion); d.scale.copy(s.scale); d.visible = s.visible;
    }
    g.root.visible = true;
    g.life = 0.32;
  }

  update(dt, fx, camPos) {
    const m = this.mech;
    // afterimages: 3 snapshots spaced through each new step
    if (m.stepSerial !== this.lastSerial) { this.lastSerial = m.stepSerial; this.ghostTimer = 0; this.ghostCount = 0; }
    if (this.ghostTimer >= 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0 && this.ghostCount < 3) { this.snapshot(); this.ghostCount++; this.ghostTimer = 0.07; }
      if (this.ghostCount >= 3) this.ghostTimer = -1;
    }
    for (const g of this.ghosts) {
      if (g.life <= 0) { g.root.visible = false; continue; }
      g.life -= dt;
      g.mat.opacity = Math.max(0, g.life / 0.32) * 0.55;
    }
    // boost ribbons while dashing (and during OVERDRIVE boosts)
    const active = m.alive && (m.state === 'bd' || (m.meleePhase === 'lunge' && m.state === 'melee') || (m.overdriveT > 0 && m.boosting));
    for (const [r, anchor] of this.ribbons) r.update(dt, anchor.getWorldPosition(tv2.set(0, 0, 0)).clone(), active, camPos);
    // ground dust when dashing low
    if ((m.state === 'bd' || m.state === 'step') && m.pos.y < 2.0 && m.onGroundish !== false) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.035;
        tv.set(m.pos.x + (Math.random() - 0.5) * 1.6, 0.4, m.pos.z + (Math.random() - 0.5) * 1.6);
        tv2.set(-m.vel.x * 0.15 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, -m.vel.z * 0.15 + (Math.random() - 0.5) * 3);
        fx.puff(tv, tv2, 0xb0a090, 0.45, 0.7, 3.2);
      }
    }
  }

  hide() { for (const g of this.ghosts) { g.life = 0; g.root.visible = false; } for (const [r] of this.ribbons) { r.strength = 0; r.primed = false; r.mesh.visible = false; } }

  dispose() {
    for (const g of this.ghosts) { this.scene.remove(g.root); g.mat.dispose(); }
    for (const [r] of this.ribbons) r.dispose(this.scene);
  }
}
