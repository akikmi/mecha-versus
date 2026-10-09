import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original mech designs built in code. Model faces +Z, feet at y=0, ~5.3 units tall.
// Parts are built per joint group and merged by material at the end to keep draw calls low.

export const MECH_TYPES = {
  kestrel: {
    id: 'kestrel',
    name: 'AV-01 KESTREL',
    kana: 'ケストレル',
    role: 'バランス型',
    desc: '機動力と射撃の取り回しに優れた汎用機。連射できるビームライフルと素早い3段格闘が武器。',
  },
  grendel: {
    id: 'grendel',
    name: 'HB-09 GRENDEL',
    kana: 'グレンデル',
    role: '重火力型',
    desc: '肩のキャノンと大型ミサイルポッドで押し込む重装機。足は遅いが一撃が重い。',
  },
};

export function buildMechModel(typeId, palette) {
  return typeId === 'grendel' ? buildGrendel(palette) : buildKestrel(palette);
}

// ------------------------------------------------------------------ textures (generated once)
let _rand = 1;
function rnd() { _rand = (_rand * 16807) % 2147483647; return (_rand - 1) / 2147483646; }

let panelTex = null, roughTex = null;
function panelTextures() {
  if (panelTex) return [panelTex, roughTex];
  _rand = 7;
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = document.createElement('canvas'); r.width = r.height = S;
  const h = r.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  h.fillStyle = '#b4b4b4'; h.fillRect(0, 0, S, S);
  // subtle tonal variation per panel
  const cuts = [0];
  for (let x = 0; x < S;) { x += 40 + Math.floor(rnd() * 70); cuts.push(Math.min(S, x)); }
  for (let i = 0; i < cuts.length - 1; i++) {
    let y = 0;
    while (y < S) {
      const hh = 36 + Math.floor(rnd() * 80);
      const v = 236 + Math.floor(rnd() * 19);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(cuts[i], y, cuts[i + 1] - cuts[i], hh);
      const rv = 160 + Math.floor(rnd() * 50);
      h.fillStyle = `rgb(${rv},${rv},${rv})`;
      h.fillRect(cuts[i], y, cuts[i + 1] - cuts[i], hh);
      // panel line (bottom edge)
      g.fillStyle = 'rgba(40,44,52,0.55)'; g.fillRect(cuts[i], y + hh - 2, cuts[i + 1] - cuts[i], 2);
      h.fillStyle = '#ffffff'; h.fillRect(cuts[i], y + hh - 2, cuts[i + 1] - cuts[i], 2);
      y += hh;
    }
    g.fillStyle = 'rgba(40,44,52,0.55)'; g.fillRect(cuts[i + 1] - 2, 0, 2, S);
    h.fillStyle = '#ffffff'; h.fillRect(cuts[i + 1] - 2, 0, 2, S);
  }
  // rivets and small hatches
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S;
    g.fillStyle = 'rgba(60,64,72,0.5)';
    if (rnd() < 0.6) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
    else { g.strokeStyle = 'rgba(50,54,62,0.5)'; g.lineWidth = 1.2; g.strokeRect(x, y, 10 + rnd() * 14, 6 + rnd() * 8); }
  }
  // edge wear
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 60; i++) g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1);
  panelTex = new THREE.CanvasTexture(c);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  roughTex = new THREE.CanvasTexture(r);
  for (const t of [panelTex, roughTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return [panelTex, roughTex];
}

// Marking decal: unit number + caution stripes on a transparent canvas.
function markingTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 56);
  // caution stripes
  g.save();
  g.beginPath(); g.rect(10, 100, 108, 16); g.clip();
  g.fillStyle = '#f2c230'; g.fillRect(10, 100, 108, 16);
  g.fillStyle = '#1a1a1a';
  for (let x = -20; x < 130; x += 16) { g.beginPath(); g.moveTo(x, 116); g.lineTo(x + 8, 116); g.lineTo(x + 16, 100); g.lineTo(x + 8, 100); g.fill(); }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ materials & primitives
function std(color, opts = {}) {
  const [map, rough] = panelTextures();
  return new THREE.MeshStandardMaterial({ color, map, roughnessMap: rough, roughness: 0.62, metalness: 0.3, envMapIntensity: 0.75, ...opts });
}
function metal(color = 0x8a9099) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.8, envMapIntensity: 0.8 });
}
// Unlit glow parts; HDR color (> 1) so the bloom pass picks them up.
function glow(color, k = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
}
function place(m, x, y, z, rx = 0, ry = 0, rz = 0) {
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
function rbox(w, h, d, mat, x = 0, y = 0, z = 0, r = 0.07) {
  const rad = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return place(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rad), mat), x, y, z);
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  return place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z);
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  return place(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), x, y, z);
}
// Chamfered armor plate: polygon (XY, centered) extruded along Z with a small bevel.
function plate(pts, depth, mat, x = 0, y = 0, z = 0, bevel = 0.04) {
  const sh = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  // planar UVs from the extrude are in shape units; scale down so the panel texture is not too dense
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return place(new THREE.Mesh(geo, mat), x, y, z);
}
function decal(w, h, tex, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.5, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.userData.noShadow = true;
  return place(m, x, y, z, 0, ry, 0);
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function makeFlame(color) {
  const g = new THREE.Group();
  // two nested cones: hot white core + colored outer flame (phase 3 adds flicker)
  const outerGeo = new THREE.ConeGeometry(0.3, 1.8, 10, 1, true); outerGeo.translate(0, 0.9, 0);
  const coreGeo = new THREE.ConeGeometry(0.15, 1.0, 8, 1, true); coreGeo.translate(0, 0.5, 0);
  const add = (geo, c, op) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  g.add(add(outerGeo, new THREE.Color(color).multiplyScalar(2.2), 0.8));
  g.add(add(coreGeo, new THREE.Color(0xffffff).multiplyScalar(3), 0.9));
  g.userData.keep = true;
  return g;
}
function makeSaber(color, len, r, axe = false) {
  const g = new THREE.Group();
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), metal(0x9aa0a8));
  hilt.rotation.x = Math.PI / 2;
  g.add(hilt);
  const bladeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, len, 10), bladeMat);
  blade.rotation.x = Math.PI / 2;
  blade.position.z = len / 2 + 0.25;
  g.add(blade);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.3, len, 6), glow(0xffffff, 4));
  core.rotation.x = Math.PI / 2;
  core.position.z = len / 2 + 0.25;
  g.add(core);
  if (axe) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), bladeMat);
    head.position.set(0, 0.35, len + 0.1);
    g.add(head);
  }
  g.visible = false;
  g.userData.color = color;
  g.userData.keep = true;
  return g;
}

// Hand with a gripping pose: palm + four finger blocks + thumb.
function hand(parent, s, mats, scale = 1) {
  const hd = pivot(parent, 0, -1.0 * scale, 0.02);
  hd.add(rbox(0.32 * scale, 0.3 * scale, 0.36 * scale, mats.dark, 0, -0.12 * scale, 0, 0.05));
  for (let i = 0; i < 4; i++) {
    hd.add(rbox(0.07 * scale, 0.2 * scale, 0.08 * scale, mats.dark, 0.08 * scale * s, -0.33 * scale, (-0.13 + i * 0.087) * scale, 0.025));
  }
  hd.add(rbox(0.08 * scale, 0.16 * scale, 0.09 * scale, mats.dark, -0.13 * scale * s, -0.2 * scale, 0.14 * scale, 0.03));
  return hd;
}

// ------------------------------------------------------------------ shared skeleton
function skeleton(root) {
  const p = {};
  p.hips = pivot(root, 0, 2.6, 0);
  p.waist = pivot(p.hips, 0, 0.3, 0); // upper-body twist joint
  p.torso = pivot(p.waist, 0, 0, 0);
  return p;
}

function legs(p, m, opt = {}) {
  const w = opt.w ?? 1;
  for (const s of [-1, 1]) {
    const hip = pivot(p.hips, s * 0.46 * w, -0.2, 0);
    hip.add(cyl(0.2 * w, 0.2 * w, 0.42 * w, m.metal, 0, 0, 0, 10).rotateZ(Math.PI / 2));
    hip.add(rbox(0.5 * w, 1.0, 0.56, m.dark, 0, -0.55, 0, 0.08));
    hip.add(plate([[-0.3, 0.45], [0.3, 0.45], [0.33, -0.2], [0.2, -0.45], [-0.2, -0.45], [-0.33, -0.2]].map(([a, b]) => [a * w, b]), 0.12, m.main, 0, -0.5, 0.3));
    hip.add(rbox(0.56 * w, 0.4, 0.5, m.main, 0, -0.95, -0.05, 0.06));
    const knee = pivot(hip, 0, -1.15, 0);
    knee.add(cyl(0.2 * w, 0.2 * w, 0.46 * w, m.metal, 0, 0, 0, 10).rotateZ(Math.PI / 2));
    // shin: tapered main armor
    knee.add(plate([[-0.38, 0.1], [0.38, 0.1], [0.42, -0.6], [0.32, -0.95], [-0.32, -0.95], [-0.42, -0.6]].map(([a, b]) => [a * w, b]), 0.72, m.main, 0, -0.05, 0.0));
    knee.add(rbox(0.5 * w, 0.7, 0.3, m.dark, 0, -0.45, -0.38, 0.06)); // calf
    for (let i = 0; i < 3; i++) knee.add(box(0.36 * w, 0.05, 0.06, m.metal, 0, -0.3 - i * 0.14, -0.55)); // calf vents
    // knee armor (chamfered, accent trim)
    knee.add(plate([[-0.26, 0.25], [0.26, 0.25], [0.3, 0], [0, -0.3], [-0.3, 0]].map(([a, b]) => [a * w, b]), 0.12, m.sub, 0, 0.0, 0.42));
    knee.add(box(0.2 * w, 0.08, 0.06, m.accent, 0, 0.12, 0.5));
    const ankle = pivot(knee, 0, -1.0, 0);
    ankle.add(cyl(0.16 * w, 0.16 * w, 0.4 * w, m.metal, 0, 0, 0, 10).rotateZ(Math.PI / 2));
    // foot: instep armor, sole, toe, heel
    ankle.add(rbox(0.62 * w, 0.2, 1.25, m.dark, 0, -0.2, 0.12, 0.06));
    ankle.add(plate([[-0.3, 0.12], [0.3, 0.12], [0.34, -0.1], [-0.34, -0.1]].map(([a, b]) => [a * w, b]), 0.7, m.main, 0, -0.05, 0.25));
    ankle.add(rbox(0.58 * w, 0.16, 0.34, m.accent, 0, -0.18, 0.78, 0.05));
    ankle.add(rbox(0.5 * w, 0.22, 0.3, m.sub, 0, -0.16, -0.48, 0.05));
    if (s < 0) { p.legL = hip; p.shinL = knee; p.footL = ankle; } else { p.legR = hip; p.shinR = knee; p.footR = ankle; }
  }
}

// Front (left/right), side and rear skirts hanging from the hips; animated secondarily.
function skirts(p, m, opt = {}) {
  const w = opt.w ?? 1;
  for (const s of [-1, 1]) {
    const f = pivot(p.hips, s * 0.36 * w, -0.05, 0.5);
    f.add(plate([[-0.28, 0], [0.28, 0], [0.24, -0.62], [-0.18, -0.7]].map(([a, b]) => [a * w * (s > 0 ? -1 : 1), b]), 0.1, m.main, 0, 0, 0.02));
    f.add(box(0.3 * w, 0.06, 0.04, m.accent, 0, -0.5, 0.09));
    const sd = pivot(p.hips, s * 0.78 * w, 0.0, 0);
    sd.add(plate([[-0.3, 0], [0.3, 0], [0.26, -0.7], [-0.26, -0.62]], 0.1, m.sub, 0, 0, 0).rotateY(Math.PI / 2));
    if (s < 0) { p.skirtFL = f; p.skirtL = sd; } else { p.skirtFR = f; p.skirtR = sd; }
  }
  const b = pivot(p.hips, 0, 0, -0.5);
  b.add(plate([[-0.5, 0], [0.5, 0], [0.4, -0.55], [-0.4, -0.55]].map(([a, bb]) => [a * w, bb]), 0.1, m.sub, 0, 0, -0.02));
  p.skirtB = b;
}

// ------------------------------------------------------------------ KESTREL
function buildKestrel(pal = {}) {
  const m = {
    main: std(pal.main ?? 0xd6dbe4),
    sub: std(pal.sub ?? 0x2f5fd0),
    dark: std(0x3a4150, { metalness: 0.45 }),
    accent: std(pal.accent ?? 0xffb21a),
    red: std(0xd8333a),
    metal: metal(),
    eye: glow(pal.eye ?? 0x5dfcff, 3.2),
    vent: glow(0x7fd4ff, 1.6),
  };
  const mark = markingTexture('01', '#2a3550');
  const root = new THREE.Group();
  const p = skeleton(root);

  // hips: block + cockpit-style crotch plate
  p.hips.add(rbox(1.25, 0.5, 0.85, m.dark, 0, 0, 0, 0.08));
  p.hips.add(plate([[-0.22, 0.2], [0.22, 0.2], [0.16, -0.3], [-0.16, -0.3]], 0.16, m.red, 0, -0.08, 0.44));
  skirts(p, m);

  // torso
  p.torso.add(rbox(1.0, 0.5, 0.72, m.dark, 0, 0.2, 0, 0.08)); // abdomen
  for (let i = 0; i < 3; i++) p.torso.add(rbox(0.86, 0.1, 0.1, m.metal, 0, 0.08 + i * 0.13, 0.36, 0.03)); // abdominal ribs
  p.torso.add(rbox(1.9, 1.0, 1.15, m.main, 0, 0.95, 0.0, 0.14)); // chest
  p.torso.add(plate([[-0.75, 0.3], [0.75, 0.3], [0.9, -0.05], [0.55, -0.35], [-0.55, -0.35], [-0.9, -0.05]], 0.2, m.sub, 0, 1.0, 0.56)); // chest plate
  p.torso.add(plate([[-0.18, 0.22], [0.18, 0.22], [0.12, -0.2], [-0.12, -0.2]], 0.1, m.accent, 0, 0.62, 0.66)); // cockpit hatch
  // chest ducts (left/right) with slats
  for (const s of [-1, 1]) {
    p.torso.add(rbox(0.42, 0.3, 0.12, m.dark, s * 0.5, 1.16, 0.68, 0.04));
    for (let i = 0; i < 3; i++) p.torso.add(box(0.36, 0.035, 0.05, m.accent, s * 0.5, 1.06 + i * 0.1, 0.75));
  }
  p.torso.add(rbox(1.3, 0.35, 0.8, m.main, 0, 1.55, -0.05, 0.1)); // collar
  p.torso.add(cyl(0.2, 0.24, 0.3, m.metal, 0, 1.68, 0.05)); // neck

  // head: rounded helmet, visor, single swept crest blade, side sensor pods
  p.head = pivot(p.torso, 0, 1.8, 0.05);
  p.head.add(rbox(0.6, 0.52, 0.64, m.main, 0, 0.2, 0, 0.12));
  p.head.add(rbox(0.5, 0.2, 0.2, m.dark, 0, 0.12, 0.27, 0.05)); // face mask
  p.head.add(box(0.48, 0.07, 0.06, m.eye, 0, 0.26, 0.34)); // visor band
  p.head.add(plate([[0, 0], [0.08, 0], [-0.55, 0.42], [-0.62, 0.36]], 0.05, m.accent, 0, 0.42, 0.18, 0.015).rotateY(-Math.PI / 2)); // crest blade (single, swept back)
  for (const s of [-1, 1]) {
    p.head.add(rbox(0.16, 0.26, 0.34, m.sub, s * 0.36, 0.22, -0.04, 0.05));
    p.head.add(box(0.04, 0.05, 0.12, m.eye, s * 0.45, 0.28, 0.06));
  }

  // backpack: block, two thrusters, wing binders
  p.torso.add(rbox(1.3, 1.1, 0.55, m.sub, 0, 0.95, -0.8, 0.1));
  p.torso.add(rbox(0.9, 0.2, 0.2, m.dark, 0, 1.45, -1.05, 0.05));
  const flames = [];
  for (const x of [-0.4, 0.4]) {
    p.torso.add(cyl(0.2, 0.28, 0.5, m.metal, x, 0.45, -1.0).rotateX(-0.55));
    p.torso.add(cyl(0.16, 0.16, 0.05, m.vent, x, 0.27, -1.1).rotateX(-0.55));
    const f = makeFlame(0x7fd4ff);
    f.position.set(x, 0.24, -1.12);
    f.rotation.x = -2.1; // +y -> backward and down
    p.torso.add(f);
    flames.push(f);
  }
  for (const s of [-1, 1]) {
    const wing = plate([[0, 0.12], [1.1, 0.42], [1.25, 0.25], [0.1, -0.15]].map(([a, b]) => [a * s, b]), 0.08, m.main, s * 0.55, 1.4, -1.0);
    wing.rotation.set(0.25, s * 0.5, 0);
    p.torso.add(wing);
    const tip = plate([[0, 0.1], [0.45, 0.22], [0.5, 0.12], [0.05, -0.05]].map(([a, b]) => [a * s, b]), 0.09, m.sub, s * 1.3, 1.62, -1.48);
    tip.rotation.set(0.25, s * 0.5, 0);
    p.torso.add(tip);
  }

  // arms with shoulder armor on separate pivots (secondary motion)
  for (const s of [-1, 1]) {
    const sa = pivot(p.torso, s * 1.22, 1.32, 0);
    sa.add(plate([[-0.45, 0.32], [0.45, 0.32], [0.5, -0.1], [0.32, -0.42], [-0.32, -0.42], [-0.5, -0.1]], 1.0, m.main, s * 0.12, 0, 0, 0.06).rotateY(Math.PI / 2));
    sa.add(box(0.06, 0.12, 0.96, m.sub, s * 0.58, 0.18, 0));
    sa.add(decal(0.42, 0.42, mark, s * 0.6, -0.08, 0, s * Math.PI / 2));
    const sh = pivot(p.torso, s * 1.22, 1.2, 0);
    sh.add(cyl(0.24, 0.24, 0.42, m.metal, 0, 0, 0, 12).rotateZ(Math.PI / 2));
    sh.add(rbox(0.4, 0.85, 0.44, m.dark, s * 0.08, -0.55, 0, 0.08)); // upper arm
    const fore = pivot(sh, s * 0.08, -1.05, 0);
    fore.add(cyl(0.18, 0.18, 0.44, m.metal, 0, 0, 0, 10).rotateZ(Math.PI / 2));
    fore.add(plate([[-0.3, 0.1], [0.3, 0.1], [0.32, -0.6], [0.22, -0.82], [-0.22, -0.82], [-0.32, -0.6]], 0.6, m.main, 0, -0.08, 0.02));
    fore.add(box(0.5, 0.06, 0.06, m.sub, 0, -0.35, 0.36));
    const hd = hand(fore, s, m);
    if (s < 0) { p.armL = sh; p.foreL = fore; p.handL = hd; p.shArmL = sa; } else { p.armR = sh; p.foreR = fore; p.handR = hd; p.shArmR = sa; }
  }

  // rifle in right hand
  const rifle = new THREE.Group();
  rifle.position.set(0, -0.2, 0.25);
  rifle.add(rbox(0.22, 0.34, 1.6, m.dark, 0, 0, 0.5, 0.05));
  rifle.add(cyl(0.07, 0.07, 0.8, m.metal, 0, 0.06, 1.6).rotateX(Math.PI / 2));
  rifle.add(rbox(0.16, 0.16, 0.5, m.sub, 0, 0.26, 0.45, 0.04)); // scope
  rifle.add(box(0.06, 0.06, 0.06, m.eye, 0, 0.26, 0.72));
  rifle.add(rbox(0.14, 0.32, 0.22, m.accent, 0, -0.28, 0.42, 0.03)); // magazine
  p.handR.add(rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.06, 2.05);
  rifle.add(muzzle);
  // shield on left forearm
  const shield = plate([[-0.55, 0.9], [0.55, 0.9], [0.6, -0.2], [0, -1.05], [-0.6, -0.2]], 0.12, m.main, -0.42, -0.4, 0.2, 0.05);
  shield.rotation.y = -Math.PI / 2;
  p.foreL.add(shield);
  const sm = plate([[-0.3, 0.6], [0.3, 0.6], [0.33, -0.1], [0, -0.6], [-0.33, -0.1]], 0.06, m.sub, -0.52, -0.4, 0.2, 0.03);
  sm.rotation.y = -Math.PI / 2;
  p.foreL.add(sm);
  p.foreL.add(box(0.05, 0.08, 0.5, m.accent, -0.57, 0.05, 0.2));
  // saber in right hand
  const saber = makeSaber(pal.saber ?? 0x5dfcff, 3.2, 0.12);
  saber.position.set(0, -0.25, 0.05);
  p.handR.add(saber);

  legs(p, m);
  return finish(root, p, { muzzle, saber, flames, specialMuzzle: muzzle, rifle, shield, type: 'kestrel' });
}

// ------------------------------------------------------------------ GRENDEL
function buildGrendel(pal = {}) {
  const m = {
    main: std(pal.main ?? 0x9a2c2c),
    sub: std(pal.sub ?? 0x3b3f4a, { metalness: 0.45 }),
    dark: std(0x23262e, { metalness: 0.5 }),
    accent: std(pal.accent ?? 0xd8c27a, { metalness: 0.6, roughness: 0.4 }),
    metal: metal(0x7a7f88),
    eye: glow(pal.eye ?? 0xff5040, 3.5),
    pod: glow(0xffd070, 1.8),
    vent: glow(0xffa040, 1.6),
  };
  const mark = markingTexture('09', '#f0e6d0');
  const root = new THREE.Group();
  const p = skeleton(root);
  root.scale.setScalar(1.08);

  p.hips.add(rbox(1.6, 0.55, 1.0, m.dark, 0, 0, 0, 0.08));
  p.hips.add(plate([[-0.3, 0.2], [0.3, 0.2], [0.2, -0.32], [-0.2, -0.32]], 0.18, m.sub, 0, -0.06, 0.52));
  skirts(p, m, { w: 1.25 });

  // torso: wide and armored, rounded front
  p.torso.add(rbox(1.25, 0.55, 0.85, m.dark, 0, 0.22, 0, 0.08));
  for (let i = 0; i < 3; i++) p.torso.add(rbox(1.0, 0.1, 0.1, m.metal, 0, 0.1 + i * 0.13, 0.42, 0.03));
  p.torso.add(rbox(2.4, 1.15, 1.4, m.main, 0, 1.0, 0, 0.2));
  p.torso.add(plate([[-1.0, 0.25], [1.0, 0.25], [1.1, -0.1], [0.7, -0.38], [-0.7, -0.38], [-1.1, -0.1]], 0.2, m.sub, 0, 0.8, 0.7));
  // chest ducts: large grilles
  for (const s of [-1, 1]) {
    p.torso.add(rbox(0.6, 0.38, 0.14, m.dark, s * 0.6, 1.25, 0.72, 0.05));
    for (let i = 0; i < 4; i++) p.torso.add(box(0.52, 0.035, 0.05, m.metal, s * 0.6, 1.11 + i * 0.09, 0.8));
  }
  p.torso.add(rbox(0.45, 0.4, 0.15, m.accent, 0, 1.3, 0.72, 0.05));
  p.torso.add(cyl(0.3, 0.36, 0.3, m.metal, 0, 1.68, 0.1)); // neck

  // head: low dome with a horizontal slit and a sliding single eye, small blade spike on top
  p.head = pivot(p.torso, 0, 1.8, 0.15);
  p.head.add(rbox(0.95, 0.5, 0.8, m.sub, 0, 0.16, 0, 0.18));
  p.head.add(rbox(0.85, 0.16, 0.12, m.dark, 0, 0.18, 0.38, 0.05)); // eye slit (rail)
  const monoEye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), m.eye);
  monoEye.position.set(0, 0.18, 0.44);
  monoEye.userData.keep = true;
  p.head.add(monoEye);
  p.head.add(rbox(0.3, 0.22, 0.24, m.dark, 0, -0.05, 0.36, 0.05)); // jaw
  p.head.add(plate([[0, 0], [0.1, 0], [0.04, 0.45]], 0.08, m.accent, 0, 0.4, -0.05, 0.02));

  // backpack, three thrusters, twin shoulder cannons
  p.torso.add(rbox(1.8, 1.2, 0.7, m.sub, 0, 1.0, -0.95, 0.12));
  const flames = [];
  for (const x of [-0.6, 0, 0.6]) {
    p.torso.add(cyl(0.24, 0.32, 0.5, m.metal, x, 0.4, -1.2).rotateX(-0.55));
    p.torso.add(cyl(0.2, 0.2, 0.05, m.vent, x, 0.22, -1.32).rotateX(-0.55));
    const f = makeFlame(0xffa040);
    f.position.set(x, 0.18, -1.35);
    f.rotation.x = -2.1;
    p.torso.add(f);
    flames.push(f);
  }
  for (const s of [-1, 1]) {
    p.torso.add(cyl(0.2, 0.24, 3.0, m.dark, s * 0.75, 2.05, -0.2, 12).rotateX(Math.PI / 2));
    p.torso.add(cyl(0.26, 0.26, 0.3, m.accent, s * 0.75, 2.05, 1.2, 12).rotateX(Math.PI / 2));
    p.torso.add(rbox(0.62, 0.62, 1.2, m.sub, s * 0.75, 2.05, -1.0, 0.1));
  }
  const specialMuzzle = new THREE.Object3D();
  specialMuzzle.position.set(0, 2.05, 1.5);
  p.torso.add(specialMuzzle);

  // arms: shoulder armor (spiked) on separate pivots, missile pods on top
  for (const s of [-1, 1]) {
    const sa = pivot(p.torso, s * 1.55, 1.35, 0);
    sa.add(rbox(1.1, 0.95, 1.3, m.main, s * 0.15, 0, 0, 0.18));
    sa.add(decal(0.55, 0.55, mark, s * 0.71, -0.05, 0, s * Math.PI / 2));
    for (const z of [-0.35, 0.05, 0.45]) sa.add(cyl(0.0, 0.12, 0.42, m.metal, s * 0.6, 0.45, z, 8).rotateZ(-s * 0.5)); // spikes
    sa.add(rbox(0.75, 0.6, 1.0, m.sub, s * 0.2, 0.75, 0, 0.08)); // missile pod
    for (let i = 0; i < 4; i++) sa.add(box(0.14, 0.14, 0.06, m.pod, s * 0.2 + ((i % 2) - 0.5) * 0.3, 0.75 + (Math.floor(i / 2) - 0.5) * 0.26, 0.52));
    const sh = pivot(p.torso, s * 1.55, 1.2, 0);
    sh.add(cyl(0.28, 0.28, 0.5, m.metal, 0, 0, 0, 12).rotateZ(Math.PI / 2));
    sh.add(rbox(0.52, 0.9, 0.56, m.dark, s * 0.15, -0.6, 0, 0.08));
    const fore = pivot(sh, s * 0.15, -1.1, 0);
    fore.add(cyl(0.22, 0.22, 0.54, m.metal, 0, 0, 0, 10).rotateZ(Math.PI / 2));
    fore.add(plate([[-0.4, 0.1], [0.4, 0.1], [0.44, -0.65], [0.3, -0.9], [-0.3, -0.9], [-0.44, -0.65]], 0.8, m.main, 0, -0.06, 0.02));
    fore.add(box(0.7, 0.08, 0.08, m.accent, 0, -0.5, 0.45));
    const hd = hand(fore, s, m, 1.15);
    if (s < 0) { p.armL = sh; p.foreL = fore; p.handL = hd; p.shArmL = sa; } else { p.armR = sh; p.foreR = fore; p.handR = hd; p.shArmR = sa; }
  }

  // heavy beam launcher in right hand
  const rifle = new THREE.Group();
  rifle.position.set(0, -0.25, 0.3);
  rifle.add(rbox(0.42, 0.48, 2.1, m.dark, 0, 0, 0.6, 0.08));
  rifle.add(cyl(0.18, 0.18, 0.9, m.metal, 0, 0, 2.05).rotateX(Math.PI / 2));
  rifle.add(rbox(0.3, 0.2, 0.9, m.main, 0, 0.32, 0.5, 0.05));
  rifle.add(box(0.2, 0.06, 0.4, m.vent, 0, 0.0, 1.66));
  p.handR.add(rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 2.5);
  rifle.add(muzzle);
  // beam axe
  const saber = makeSaber(pal.saber ?? 0xff7a30, 2.6, 0.14, true);
  saber.position.set(0, -0.3, 0.05);
  p.handR.add(saber);

  legs(p, m, { w: 1.2 });
  return finish(root, p, { muzzle, saber, flames, specialMuzzle, rifle, monoEye, type: 'grendel' });
}

// ------------------------------------------------------------------ merge + finalize
// Merge static meshes under each joint group by material (one draw call per material per joint).
function mergeGroup(obj) {
  const byMat = new Map();
  for (const c of obj.children) {
    if (!c.isMesh || c.userData.keep || c.children.length) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(c);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((c) => {
      c.updateMatrix();
      let g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
      g.applyMatrix4(c.matrix);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.noShadow = list[0].userData.noShadow;
    for (const c of list) { obj.remove(c); c.geometry.dispose(); }
    for (const g of geos) g.dispose();
    obj.add(mesh);
  }
  for (const c of [...obj.children]) if (!c.isMesh || c.children.length) mergeGroup(c);
}

function finish(root, parts, extra) {
  mergeGroup(root);
  const flashMats = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const lit = o.material.isMeshStandardMaterial;
    o.castShadow = lit && !o.userData.noShadow;
    o.receiveShadow = lit;
    if (lit) flashMats.add(o.material);
  });
  // emissive tint used by OVERDRIVE (phase 3) and hit flash
  return { root, parts, flashMats: [...flashMats], ...extra };
}
