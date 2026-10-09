import * as THREE from 'three';

export const ARENA_RADIUS = 85;

// Obstacles: [x, z, width, depth, height]
const LAYOUT = [
  [0, 0, 10, 10, 14],
  [-32, 20, 8, 14, 22],
  [32, -20, 8, 14, 22],
  [28, 36, 12, 8, 10],
  [-28, -36, 12, 8, 10],
  [-52, -8, 7, 7, 16],
  [52, 8, 7, 7, 16],
  [0, 52, 14, 6, 8],
  [0, -52, 14, 6, 8],
];

export class Arena {
  constructor(scene) {
    this.radius = ARENA_RADIUS;
    this.boxes = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    // Sky / fog
    scene.background = new THREE.Color(0x0b1424);
    scene.fog = new THREE.Fog(0x0b1424, 90, 260);

    const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x1a1a24, 0.4);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.9);
    sun.position.set(40, 80, 30);
    this.group.add(sun, sun.target);
    this.sun = sun;
    this.buildings = [];

    // Floor: disc with a grid texture drawn on a canvas
    const tex = makeGridTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius + 2, 64),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Outer floor (outside the walls)
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(this.radius + 2, 400, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d1320, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    this.group.add(outer);

    // Wall: translucent energy cylinder + posts
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius, this.radius, 40, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    wall.position.y = 20;
    this.group.add(wall);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x48b4ff });
    for (const y of [0.3, 40]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(this.radius, 0.35, 6, 96), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.group.add(ring);
    }
    const postGeo = new THREE.BoxGeometry(2, 40, 2);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3344, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(Math.sin(a) * (this.radius + 1), 20, Math.cos(a) * (this.radius + 1));
      this.group.add(post);
    }

    // Buildings
    const winTex = makeWindowTexture();
    for (const [x, z, w, d, h] of LAYOUT) {
      const t = winTex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a96a8, map: t, roughness: 0.7, metalness: 0.2, emissive: 0x223355, emissiveIntensity: 0.25 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      const topMat = new THREE.MeshStandardMaterial({ color: 0x3a4250 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), topMat);
      top.position.set(x, h + 0.25, z);
      for (const o of [m, top]) { o.castShadow = o.receiveShadow = true; this.group.add(o); }
      const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h + 0.5 };
      this.boxes.push(box);
      this.buildings.push({ box, mats: [mat, topMat], opacity: 1, want: 1 });
    }

    // Distant skyline (decorative, outside the arena)
    const skyMat = new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + 0.07;
      const r = 150 + (i * 37) % 60;
      const h = 20 + (i * 53) % 60;
      const b = new THREE.Mesh(new THREE.BoxGeometry(14, h, 14), skyMat);
      b.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r);
      this.group.add(b);
    }
    this.dimEnvironment(0.35);
  }

  // Tone down image-based lighting on the static set (RoomEnvironment is bright).
  dimEnvironment(k) {
    this.group.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMapIntensity = k; });
  }

  // Ground height at a point for a body of radius r, given current feet y.
  groundAt(x, z, r, y) {
    let g = 0;
    for (const b of this.boxes) {
      if (x + r * 0.5 > b.minX && x - r * 0.5 < b.maxX && z + r * 0.5 > b.minZ && z - r * 0.5 < b.maxZ && y >= b.h - 0.6) {
        g = Math.max(g, b.h);
      }
    }
    return g;
  }

  // Push a cylinder body (pos = feet) out of boxes and keep it inside the circular wall.
  resolve(pos, r) {
    let hitWall = false;
    for (const b of this.boxes) {
      if (pos.y >= b.h - 0.6) continue; // above the roof
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          // Center inside box: push out along the smallest axis
          const pl = pos.x - b.minX, pr = b.maxX - pos.x, pb = pos.z - b.minZ, pf = b.maxZ - pos.z;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) pos.x = b.minX - r; else if (m === pr) pos.x = b.maxX + r;
          else if (m === pb) pos.z = b.minZ - r; else pos.z = b.maxZ + r;
        }
        hitWall = true;
      }
    }
    const d = Math.hypot(pos.x, pos.z);
    const lim = this.radius - r;
    if (d > lim) { pos.x *= lim / d; pos.z *= lim / d; hitWall = true; }
    return hitWall;
  }

  // Does a point collide with static geometry? (for projectiles)
  pointBlocked(p) {
    if (p.y < 0) return true;
    if (Math.hypot(p.x, p.z) > this.radius) return true;
    for (const b of this.boxes) {
      if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.h) return true;
    }
    return false;
  }

  // Distance along a ray (unit dir) to the first building (boxes inflated by pad) or the floor; Infinity if none within max.
  rayDistance(o, dir, max, pad = 0) {
    let best = max;
    for (const b of this.boxes) {
      const t = rayBox(o, dir, b.minX - pad, b.maxX + pad, -1, b.h + pad, b.minZ - pad, b.maxZ + pad);
      if (t >= 0 && t < best) best = t;
    }
    return best < max ? best : Infinity;
  }

  // Fade buildings that hide the player or the enemy from the camera.
  updateOcclusion(dt, cam, points) {
    for (const bd of this.buildings) {
      const b = bd.box;
      let hide = false;
      for (const p of points) {
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-3) continue;
        _dir.set(dx / len, dy / len, dz / len);
        const t = rayBox(cam, _dir, b.minX, b.maxX, -1, b.h, b.minZ, b.maxZ);
        if (t >= 0 && t < len - 1) { hide = true; break; }
      }
      bd.want = hide ? 0.25 : 1;
      if (bd.opacity !== bd.want) {
        bd.opacity += Math.sign(bd.want - bd.opacity) * Math.min(Math.abs(bd.want - bd.opacity), dt * 4);
        const op = bd.opacity;
        for (const m of bd.mats) {
          const tr = op < 0.999;
          if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
          m.opacity = op;
        }
      }
    }
  }

  // Line of sight test (coarse sampling)
  lineBlocked(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 2);
    const p = new THREE.Vector3();
    for (let i = 1; i < steps; i++) {
      p.lerpVectors(a, b, i / steps);
      if (this.pointBlocked(p)) return true;
    }
    return false;
  }
}

const _dir = new THREE.Vector3();
// Slab test: distance along the ray to the box entry point (0 if starting inside), -1 if missed.
function rayBox(o, d, x0, x1, y0, y1, z0, z1) {
  let tmin = 0, tmax = Infinity;
  const ax = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
  for (const [p, v, lo, hi] of ax) {
    if (Math.abs(v) < 1e-8) { if (p < lo || p > hi) return -1; continue; }
    let t1 = (lo - p) / v, t2 = (hi - p) / v;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#26303d';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#2c3746';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#4a6a8c';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#7f8a9a';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x * 7 + y * 3) % 5 === 0 ? '#ffd98a' : '#2a3a52';
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
