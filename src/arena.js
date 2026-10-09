import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
// Roads (paint only, laid out between the buildings): vertical x=+-16, horizontal z=+-44.5
const ROADS_X = [-16, 16];
const ROADS_Z = [-44.5, 44.5];
const ROAD_W = 9;
const MAX_SCORCH = 32;

// Dusk palette
const SUN_DIR = new THREE.Vector3(-0.62, 0.36, -0.74).normalize();
const FOG_COLOR = 0x8a6670;

let seed = 11;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

export class Arena {
  constructor(scene) {
    this.radius = ARENA_RADIUS;
    this.boxes = [];
    this.buildings = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, 110, 420);
    this.group.add(makeSky());

    const hemi = new THREE.HemisphereLight(0x8a90d0, 0x4a3234, 0.6);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb27a, 2.7);
    sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.group.add(sun, sun.target);
    this.sun = sun;

    // Floor: one big canvas with roads, crosswalks and sidewalk tiles
    const floorTex = makeFloorTexture(this.radius + 2);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius + 2, 72),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.88, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Outer ground (outside the walls)
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(this.radius + 2, 500, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2228, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    this.group.add(outer);

    // Wall: translucent energy cylinder + posts
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius, this.radius, 40, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    );
    wall.position.y = 20;
    this.group.add(wall);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x48b4ff).multiplyScalar(1.4), toneMapped: false });
    for (const y of [0.3, 40]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(this.radius, 0.3, 6, 96), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.group.add(ring);
    }
    const posts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const g = new THREE.BoxGeometry(1.6, 40, 1.6);
      g.translate(Math.sin(a) * (this.radius + 1), 20, Math.cos(a) * (this.radius + 1));
      posts.push(g);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.45 })));

    // Buildings: facade texture with lit windows (emissive), rooftop equipment, neon signs
    const [facade, facadeLit] = makeFacadeTextures();
    const roofGeos = [], blinkers = [];
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.7, metalness: 0.3 });
    const tints = [0x9aa3b4, 0xb0a596, 0x8f9aa8, 0xa8a0a8, 0x9c9488];
    LAYOUT.forEach(([x, z, w, d, h], bi) => {
      const map = facade.clone(), em = facadeLit.clone();
      for (const t of [map, em]) {
        t.needsUpdate = true;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
        t.offset.set((bi * 0.37) % 1, (bi * 0.61) % 1);
      }
      const mat = new THREE.MeshStandardMaterial({
        color: tints[bi % tints.length], map, roughness: 0.75, metalness: 0.15,
        emissive: 0xffc27a, emissiveMap: em, emissiveIntensity: 1.6,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      const topMat = new THREE.MeshStandardMaterial({ color: 0x3e424c, roughness: 0.85 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), topMat);
      top.position.set(x, h + 0.25, z);
      for (const o of [m, top]) { o.castShadow = o.receiveShadow = true; this.group.add(o); }
      const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h + 0.5 };
      this.boxes.push(box);
      this.buildings.push({ box, mats: [mat, topMat], opacity: 1, want: 1 });

      // rooftop: AC units, a water tank, an antenna mast with a blinking light
      const y0 = h + 0.5;
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const g = new THREE.BoxGeometry(1.2 + rnd(), 0.8 + rnd() * 0.6, 1 + rnd());
        g.translate(x + (rnd() - 0.5) * (w - 2.5), y0 + 0.45, z + (rnd() - 0.5) * (d - 2.5));
        roofGeos.push(g);
      }
      if (rnd() < 0.7) {
        const g = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12);
        g.translate(x - w / 2 + 1.4, y0 + 1.6, z + d / 2 - 1.4);
        roofGeos.push(g);
        for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
          const leg = new THREE.BoxGeometry(0.12, 0.8, 0.12);
          leg.translate(x - w / 2 + 1.4 + ox, y0 + 0.4, z + d / 2 - 1.4 + oz);
          roofGeos.push(leg);
        }
      }
      if (h >= 14) {
        const mast = new THREE.CylinderGeometry(0.08, 0.12, 4.5, 6);
        mast.translate(x + w / 2 - 1, y0 + 2.25, z - d / 2 + 1);
        roofGeos.push(mast);
        blinkers.push(new THREE.Vector3(x + w / 2 - 1, y0 + 4.6, z - d / 2 + 1));
      }
    });
    const roof = new THREE.Mesh(mergeGeometries(roofGeos), roofMat);
    roof.castShadow = roof.receiveShadow = true;
    this.group.add(roof);
    // antenna lights (blink, bloom)
    this.blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3020).multiplyScalar(4), toneMapped: false });
    for (const p of blinkers) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), this.blinkMat);
      b.position.copy(p);
      this.group.add(b);
    }
    this.addNeon();

    // Distant skyline silhouettes with a few lit windows (one merged mesh)
    const skyGeos = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rnd() * 0.05;
      const r = 150 + rnd() * 110;
      const h = 20 + rnd() * 80;
      const w = 10 + rnd() * 12;
      const g = new THREE.BoxGeometry(w, h, w);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 6, uv.getY(k) * h / 6);
      g.rotateY(-a);
      g.translate(Math.sin(a) * r, h / 2, Math.cos(a) * r);
      skyGeos.push(g);
    }
    const skyEm = facadeLit.clone(); skyEm.needsUpdate = true; skyEm.wrapS = skyEm.wrapT = THREE.RepeatWrapping;
    const skyline = new THREE.Mesh(mergeGeometries(skyGeos), new THREE.MeshStandardMaterial({
      color: 0x2a2a38, roughness: 1, emissive: 0xffb070, emissiveMap: skyEm, emissiveIntensity: 0.9,
    }));
    this.group.add(skyline);

    // Scorch decals (ring buffer)
    this.scorchMat = new THREE.MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
    this.scorches = [];
    this.scorchI = 0;

    this.t = 0;
    this.dimEnvironment(0.35);
  }

  addNeon() {
    const signs = [
      // [building index, face (0:+z 1:-z 2:+x 3:-x), text, color, w, h, y]
      [1, 2, 'ARCADE', '#ff4fd8', 6, 1.6, 15],
      [2, 3, '24H', '#4ff0ff', 3, 1.6, 12],
      [0, 0, 'NOODLE', '#ffb040', 6, 1.4, 10],
      [5, 0, 'HOTEL', '#a0ff60', 5, 1.4, 12],
      [6, 1, 'BAR', '#ff5050', 3.5, 1.5, 9],
      [3, 0, 'ネオン', '#7f9bff', 6, 1.6, 7],
      [4, 1, 'CAFE', '#ffd84f', 5, 1.4, 6.5],
    ];
    for (const [bi, face, text, color, w, h, y] of signs) {
      const [bx, bz, bw, bd] = LAYOUT[bi];
      const tex = makeNeonTexture(text, color);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const off = 0.12;
      if (face === 0) { m.position.set(bx, y, bz + bd / 2 + off); }
      else if (face === 1) { m.position.set(bx, y, bz - bd / 2 - off); m.rotation.y = Math.PI; }
      else if (face === 2) { m.position.set(bx + bw / 2 + off, y, bz); m.rotation.y = Math.PI / 2; }
      else { m.position.set(bx - bw / 2 - off, y, bz); m.rotation.y = -Math.PI / 2; }
      this.group.add(m);
    }
  }

  // Tone down image-based lighting on the static set (RoomEnvironment is bright).
  dimEnvironment(k) {
    this.group.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMapIntensity = k; });
  }

  update(dt) {
    this.t += dt;
    const on = (this.t % 1.4) < 0.18;
    this.blinkMat.color.setRGB(on ? 4 : 0.25, on ? 0.5 : 0.03, on ? 0.35 : 0.02);
  }

  // Scorch mark on the floor or a roof where a shot hit.
  addScorch(pos, size = 3) {
    let m = this.scorches[this.scorchI];
    if (!m) {
      m = new THREE.Mesh(this.scorchGeo, this.scorchMat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.group.add(m);
      this.scorches[this.scorchI] = m;
    }
    this.scorchI = (this.scorchI + 1) % MAX_SCORCH;
    m.position.set(pos.x, pos.y + 0.03, pos.z);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    m.visible = true;
  }

  clearScorch() { for (const m of this.scorches) if (m) m.visible = false; }

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

  // Distance along a ray (unit dir) to the first building (boxes inflated by pad); Infinity if none within max.
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

// ------------------------------------------------------------------ sky
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR.clone() },
      zenith: { value: new THREE.Color(0x1b2150) },
      mid: { value: new THREE.Color(0x7a4a78) },
      horizon: { value: new THREE.Color(0xff9a5a) },
      ground: { value: new THREE.Color(FOG_COLOR) },
      sunCol: { value: new THREE.Color(0xffb070) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, zenith, mid, horizon, ground, sunCol;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, sunDir), 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.15, 0.7, h));
        col = mix(col, horizon * 1.2, pow(sd, 5.0) * smoothstep(0.35, 0.0, h) * 0.6);
        col = mix(col, ground, smoothstep(0.0, -0.08, h));
        col += sunCol * (pow(sd, 8.0) * 0.35 + pow(sd, 90.0) * 1.4);
        col += vec3(1.0, 0.85, 0.6) * smoothstep(0.9990, 0.9996, sd) * 8.0; // sun disc (HDR -> bloom)
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12);
          float c = fbm(uv * 1.6 + vec2(3.1, 1.7));
          c = smoothstep(0.52, 0.82, c) * smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.55, 0.9, h));
          vec3 cc = mix(vec3(0.32, 0.2, 0.32), sunCol * 1.4, pow(sd, 2.5) * 0.9 + 0.12);
          col = mix(col, cc, c * 0.8);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// ------------------------------------------------------------------ canvas textures
function makeFloorTexture(R) {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const W = (x) => ((x + R) / (2 * R)) * S; // world -> canvas
  const sc = S / (2 * R);
  // sidewalk / plaza tiles
  g.fillStyle = '#6f6a66';
  g.fillRect(0, 0, S, S);
  const tile = 2.0 * sc;
  for (let y = 0; y < S; y += tile) {
    for (let x = 0; x < S; x += tile) {
      const v = 100 + Math.floor(rnd() * 22);
      g.fillStyle = `rgb(${v + 6},${v},${v - 4})`;
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }
  // asphalt roads
  const asphalt = () => { const v = 44 + Math.floor(rnd() * 8); return `rgb(${v},${v},${v + 4})`; };
  g.fillStyle = asphalt();
  for (const x of ROADS_X) g.fillRect(W(x - ROAD_W / 2), 0, ROAD_W * sc, S);
  for (const z of ROADS_Z) g.fillRect(0, W(z - ROAD_W / 2), S, ROAD_W * sc);
  // asphalt grain
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.floor(rnd() * 40);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    const x = rnd() * S, y = rnd() * S;
    g.fillRect(x, y, 2, 2);
  }
  // curbs
  g.fillStyle = '#9a958e';
  for (const x of ROADS_X) { g.fillRect(W(x - ROAD_W / 2) - 4, 0, 4, S); g.fillRect(W(x + ROAD_W / 2), 0, 4, S); }
  for (const z of ROADS_Z) { g.fillRect(0, W(z - ROAD_W / 2) - 4, S, 4); g.fillRect(0, W(z + ROAD_W / 2), S, 4); }
  // intersections: clear the curbs and paint crosswalks
  const inter = [];
  for (const x of ROADS_X) for (const z of ROADS_Z) inter.push([x, z]);
  for (const [x, z] of inter) {
    g.fillStyle = asphalt();
    g.fillRect(W(x - ROAD_W / 2), W(z - ROAD_W / 2), ROAD_W * sc, ROAD_W * sc);
  }
  // lane markings (dashed center lines), skipping intersections
  g.fillStyle = '#e8d070';
  for (const x of ROADS_X) {
    for (let z = -R; z < R; z += 4) {
      if (ROADS_Z.some((rz) => Math.abs(z + 1 - rz) < ROAD_W / 2 + 3)) continue;
      g.fillRect(W(x) - 3, W(z), 6, 2 * sc);
    }
  }
  for (const z of ROADS_Z) {
    for (let x = -R; x < R; x += 4) {
      if (ROADS_X.some((rx) => Math.abs(x + 1 - rx) < ROAD_W / 2 + 3)) continue;
      g.fillRect(W(x), W(z) - 3, 2 * sc, 6);
    }
  }
  // crosswalks (zebra stripes) on each side of every intersection
  g.fillStyle = 'rgba(235,235,230,0.92)';
  const half = ROAD_W / 2;
  for (const [x, z] of inter) {
    for (let i = -half + 0.5; i < half - 0.4; i += 1.0) {
      for (const side of [-1, 1]) {
        g.fillRect(W(x + i), W(z + side * (half + 0.6)) - 1.2 * sc, 0.5 * sc, 2.4 * sc); // across vertical road
        g.fillRect(W(x + side * (half + 0.6)) - 1.2 * sc, W(z + i), 2.4 * sc, 0.5 * sc); // across horizontal road
      }
    }
  }
  // stop lines + manholes + oil stains
  for (let i = 0; i < 18; i++) {
    const onX = rnd() < 0.5;
    const x = onX ? ROADS_X[Math.floor(rnd() * 2)] + (rnd() - 0.5) * 5 : -R + rnd() * 2 * R;
    const z = onX ? -R + rnd() * 2 * R : ROADS_Z[Math.floor(rnd() * 2)] + (rnd() - 0.5) * 5;
    g.fillStyle = 'rgba(20,20,24,0.35)';
    g.beginPath(); g.ellipse(W(x), W(z), (1 + rnd() * 2) * sc, (0.6 + rnd()) * sc, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 10; i++) {
    const x = ROADS_X[i % 2] + (rnd() - 0.5) * 3, z = -R + rnd() * 2 * R;
    g.strokeStyle = 'rgba(30,30,34,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.arc(W(x), W(z), 0.6 * sc, 0, Math.PI * 2); g.stroke();
  }
  // grime vignette near the wall
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(20,12,16,0.45)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeFacadeTextures() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = e.height = S;
  const h = e.getContext('2d');
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, S, S);
  h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
  // floor bands
  g.fillStyle = '#a8a8a8';
  for (let y = 0; y < S; y += 32) g.fillRect(0, y + 28, S, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const wx = x * 32 + 4, wy = y * 32 + 6;
      g.fillStyle = '#2a3446'; g.fillRect(wx, wy, 24, 18);
      g.fillStyle = '#3c4a62'; g.fillRect(wx, wy, 24, 4);
      const lit = rnd();
      if (lit < 0.42) {
        const warm = rnd() < 0.75;
        const k = 0.55 + rnd() * 0.45;
        h.fillStyle = warm ? `rgba(255,${190 + Math.floor(rnd() * 40)},120,${k})` : `rgba(170,210,255,${k})`;
        h.fillRect(wx + 1, wy + 1, 22, 16);
        g.fillStyle = warm ? '#d8b07a' : '#9ab4d8'; g.fillRect(wx + 1, wy + 1, 22, 16);
        // blinds
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let b = 0; b < 3; b++) g.fillRect(wx + 1, wy + 3 + b * 5, 22, 1);
      }
      g.fillStyle = '#7a7a7a'; g.fillRect(wx + 11, wy, 2, 18); // mullion
    }
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace;
  return [map, em];
}

function makeNeonTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 5;
  g.shadowColor = color; g.shadowBlur = 18;
  g.strokeRect(10, 10, 492, 108);
  g.font = 'bold 76px system-ui, "Hiragino Sans", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(text, 256, 68);
  g.lineWidth = 3;
  g.strokeText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeScorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(8,6,6,0.95)');
  grad.addColorStop(0.45, 'rgba(18,14,12,0.75)');
  grad.addColorStop(1, 'rgba(20,16,14,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // ragged splatter
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 38;
    g.fillStyle = `rgba(10,8,8,${0.3 + rnd() * 0.4})`;
    g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
