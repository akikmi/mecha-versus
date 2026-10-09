import * as THREE from 'three';

const MAX = 600;
const dummy = new THREE.Object3D();
const col = new THREE.Color();

// Pooled additive particles (single InstancedMesh) + shockwave rings + flashes.
export class FX {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      dummy.scale.setScalar(0); dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, col.set(0xffffff));
    }
    scene.add(this.mesh);
    this.parts = [];
    for (let i = 0; i < MAX; i++) this.parts.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, drag: 0, grav: 0, color: new THREE.Color() });
    this.next = 0;
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    // Fixed pool of point lights (adding/removing lights would force shader recompiles)
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      scene.add(l);
      this.flashes.push({ l, life: 0, max: 1, intensity: 0 });
    }
  }

  spawn(pos, vel, color, size, life, drag = 2, grav = 0) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % MAX;
    p.pos.copy(pos); p.vel.copy(vel); p.color.set(color);
    p.size = size; p.life = p.max = life; p.drag = drag; p.grav = grav;
  }

  burst(pos, color, count = 12, speed = 10, size = 0.3, life = 0.4) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.spawn(pos, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), 3, -6);
    }
  }

  hitSpark(pos, color) {
    this.burst(pos, 0xffffff, 6, 14, 0.25, 0.25);
    this.burst(pos, color, 14, 12, 0.35, 0.45);
    this.ring(pos, color, 4, 0.25);
    this.light(pos, color, 6, 0.12);
  }

  explosion(pos, scale = 1) {
    this.burst(pos, 0xffe0a0, Math.round(25 * scale), 16 * scale, 0.8 * scale, 0.6);
    this.burst(pos, 0xff6a20, Math.round(30 * scale), 10 * scale, 1.0 * scale, 0.9);
    this.burst(pos, 0x553322, Math.round(14 * scale), 5 * scale, 1.2 * scale, 1.4);
    this.ring(pos, 0xffaa55, 10 * scale, 0.5);
    this.light(pos, 0xffaa55, 20 * scale, 0.3);
  }

  muzzle(pos, color, size = 0.7) {
    this.spawn(pos, new THREE.Vector3(), 0xffffff, size, 0.08, 0);
    this.spawn(pos, new THREE.Vector3(), color, size * 1.8, 0.12, 0);
    this.light(pos, color, 5, 0.08);
  }

  trail(pos, color, size = 0.35, life = 0.25) {
    this.spawn(pos, new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)), color, size, life, 1);
  }

  ring(pos, color, radius, life) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
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
    for (const r of this.rings) { this.scene.remove(r.m); r.m.material.dispose(); }
    this.rings = [];
    for (const f of this.flashes) { f.life = 0; f.l.intensity = 0; }
  }
}
