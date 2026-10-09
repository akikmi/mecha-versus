import * as THREE from 'three';

// Original mech designs built from primitives. Model faces +Z, feet at y=0, ~5.2 units tall.

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, flatShading: true, ...opts });
}
function glow(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function makeFlame(color) {
  const geo = new THREE.ConeGeometry(0.28, 1.6, 8, 1, true);
  geo.translate(0, 0.8, 0); // base at origin (nozzle), tip along +y
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(geo, mat);
  return m;
}

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

function common(root) {
  const parts = {};
  parts.hips = pivot(root, 0, 2.55, 0);
  parts.torso = pivot(parts.hips, 0, 0.3, 0);
  return parts;
}

function buildKestrel(pal = {}) {
  const main = std(pal.main ?? 0xe8ecf2);
  const sub = std(pal.sub ?? 0x2f5fd0);
  const dark = std(0x3a4150);
  const accent = std(pal.accent ?? 0xffb21a);
  const eye = glow(pal.eye ?? 0x5dfcff);
  const root = new THREE.Group();
  const p = common(root);

  p.hips.add(box(1.3, 0.55, 0.85, dark));
  p.hips.add(box(0.5, 0.5, 0.2, sub, 0, -0.1, 0.48));
  // torso
  p.torso.add(box(1.1, 0.6, 0.8, dark, 0, 0.25, 0));
  p.torso.add(box(1.9, 1.05, 1.15, main, 0, 0.95, 0.05));
  p.torso.add(box(1.5, 0.45, 0.25, sub, 0, 1.05, 0.66));
  p.torso.add(box(0.35, 0.25, 0.1, accent, -0.5, 1.2, 0.8));
  p.torso.add(box(0.35, 0.25, 0.1, accent, 0.5, 1.2, 0.8));
  // head
  p.head = pivot(p.torso, 0, 1.65, 0.05);
  p.head.add(box(0.62, 0.58, 0.66, main, 0, 0.22, 0));
  p.head.add(box(0.56, 0.14, 0.08, eye, 0, 0.26, 0.34));
  const crest = box(0.08, 0.45, 0.7, accent, 0, 0.6, -0.05);
  crest.rotation.x = -0.5;
  p.head.add(crest);
  p.head.add(box(0.2, 0.2, 0.3, sub, 0.36, 0.25, -0.05));
  p.head.add(box(0.2, 0.2, 0.3, sub, -0.36, 0.25, -0.05));
  // backpack + thrusters
  p.torso.add(box(1.3, 1.1, 0.55, sub, 0, 0.95, -0.8));
  const flames = [];
  for (const x of [-0.42, 0.42]) {
    const n = cyl(0.22, 0.3, 0.5, dark, x, 0.4, -1.0);
    p.torso.add(n);
    const f = makeFlame(0x7fd4ff);
    f.position.set(x, 0.2, -1.05);
    f.rotation.x = -2.1; // +y -> backward and down
    p.torso.add(f);
    flames.push(f);
  }
  // wings (fins)
  for (const s of [-1, 1]) {
    const fin = box(0.08, 0.3, 1.3, main, s * 0.75, 1.45, -1.1);
    fin.rotation.z = s * 0.35;
    fin.rotation.x = 0.4;
    p.torso.add(fin);
  }
  // arms
  for (const s of [-1, 1]) {
    const sh = pivot(p.torso, s * 1.25, 1.2, 0);
    sh.add(box(0.85, 0.7, 0.95, main, s * 0.1, 0.05, 0));
    sh.add(box(0.9, 0.12, 0.98, sub, s * 0.1, 0.42, 0));
    sh.add(box(0.42, 0.9, 0.45, dark, s * 0.1, -0.6, 0));
    const fore = pivot(sh, s * 0.1, -1.05, 0);
    fore.add(box(0.55, 1.0, 0.6, main, 0, -0.45, 0));
    fore.add(box(0.36, 0.3, 0.36, dark, 0, -1.05, 0.05));
    if (s < 0) { p.armL = sh; p.foreL = fore; } else { p.armR = sh; p.foreR = fore; }
  }
  // rifle in right hand
  const rifle = new THREE.Group();
  rifle.position.set(0, -1.05, 0.3);
  rifle.add(box(0.22, 0.35, 1.9, dark, 0, 0, 0.5));
  rifle.add(box(0.14, 0.14, 0.7, sub, 0, 0.08, 1.7));
  rifle.add(box(0.16, 0.18, 0.5, accent, 0, 0.26, 0.4));
  p.foreR.add(rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.08, 2.1);
  rifle.add(muzzle);
  // shield on left forearm
  const shield = box(0.14, 1.6, 1.0, sub, -0.4, -0.5, 0.15);
  p.foreL.add(shield);
  p.foreL.add(box(0.16, 0.25, 0.6, accent, -0.42, -0.1, 0.15));
  // saber (hidden by default) in right hand
  const saber = makeSaber(pal.saber ?? 0x5dfcff, 3.2, 0.12);
  saber.position.set(0, -1.1, 0.1);
  p.foreR.add(saber);

  legs(p, main, sub, dark, accent);
  return finish(root, p, { muzzle, saber, flames, specialMuzzle: muzzle, rifle });
}

function buildGrendel(pal = {}) {
  const main = std(pal.main ?? 0x8e2a2a);
  const sub = std(pal.sub ?? 0x3b3f4a);
  const dark = std(0x23262e);
  const accent = std(pal.accent ?? 0xd8c27a);
  const eye = glow(pal.eye ?? 0xff5040);
  const root = new THREE.Group();
  const p = common(root);
  root.scale.setScalar(1.08);

  p.hips.add(box(1.6, 0.6, 1.0, dark));
  p.hips.add(box(1.8, 0.35, 0.3, main, 0, -0.15, 0.45));
  // torso: wide and armored
  p.torso.add(box(1.3, 0.6, 0.9, dark, 0, 0.25, 0));
  p.torso.add(box(2.4, 1.2, 1.4, main, 0, 1.0, 0));
  p.torso.add(box(1.9, 0.5, 0.25, sub, 0, 0.75, 0.75));
  p.torso.add(box(0.5, 0.5, 0.2, accent, 0, 1.2, 0.75));
  // head: low, wide with three eye dots
  p.head = pivot(p.torso, 0, 1.65, 0.1);
  p.head.add(box(0.9, 0.5, 0.75, sub, 0, 0.18, 0));
  p.head.add(box(0.8, 0.12, 0.1, dark, 0, 0.2, 0.38));
  for (const x of [-0.25, 0, 0.25]) p.head.add(box(0.12, 0.1, 0.06, eye, x, 0.2, 0.44));
  p.head.add(box(0.15, 0.55, 0.15, accent, 0.42, 0.45, -0.2));
  // backpack + big thrusters
  p.torso.add(box(1.8, 1.2, 0.7, sub, 0, 1.0, -0.95));
  const flames = [];
  for (const x of [-0.6, 0, 0.6]) {
    p.torso.add(cyl(0.25, 0.32, 0.5, dark, x, 0.35, -1.2));
    const f = makeFlame(0xffa040);
    f.position.set(x, 0.15, -1.25);
    f.rotation.x = -2.1; // +y -> backward and down
    p.torso.add(f);
    flames.push(f);
  }
  // shoulder cannons (twin)
  const cannons = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = cyl(0.22, 0.22, 3.2, dark, s * 0.75, 2.0, -0.3, 10);
    c.rotation.x = Math.PI / 2;
    cannons.add(c);
    const cb = box(0.6, 0.6, 1.2, sub, s * 0.75, 2.0, -1.0);
    cannons.add(cb);
  }
  p.torso.add(cannons);
  const specialMuzzle = new THREE.Object3D();
  specialMuzzle.position.set(0, 2.0, 1.4);
  p.torso.add(specialMuzzle);
  // arms: heavy with missile pods on shoulders
  for (const s of [-1, 1]) {
    const sh = pivot(p.torso, s * 1.55, 1.2, 0);
    sh.add(box(1.1, 1.0, 1.3, main, s * 0.15, 0.1, 0));
    const pod = box(0.7, 0.7, 1.0, sub, s * 0.25, 0.85, 0);
    sh.add(pod);
    for (let i = 0; i < 4; i++) sh.add(box(0.14, 0.14, 0.06, glow(0xffd070), s * 0.25 + ((i % 2) - 0.5) * 0.3, 0.85 + (Math.floor(i / 2) - 0.5) * 0.3, 0.52));
    sh.add(box(0.5, 0.9, 0.55, dark, s * 0.15, -0.65, 0));
    const fore = pivot(sh, s * 0.15, -1.1, 0);
    fore.add(box(0.75, 1.1, 0.8, main, 0, -0.5, 0));
    fore.add(box(0.45, 0.35, 0.45, dark, 0, -1.15, 0.05));
    if (s < 0) { p.armL = sh; p.foreL = fore; } else { p.armR = sh; p.foreR = fore; }
  }
  // heavy beam launcher in right hand
  const rifle = new THREE.Group();
  rifle.position.set(0, -1.15, 0.3);
  rifle.add(box(0.4, 0.45, 2.2, dark, 0, 0, 0.6));
  rifle.add(cyl(0.18, 0.18, 0.9, sub, 0, 0.0, 2.0));
  rifle.children[1].rotation.x = Math.PI / 2;
  p.foreR.add(rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 2.5);
  rifle.add(muzzle);
  // beam axe
  const saber = makeSaber(pal.saber ?? 0xff7a30, 2.6, 0.14, true);
  saber.position.set(0, -1.2, 0.1);
  p.foreR.add(saber);

  legs(p, main, sub, dark, accent, 1.2);
  return finish(root, p, { muzzle, saber, flames, specialMuzzle, rifle });
}

function makeSaber(color, len, r, axe = false) {
  const g = new THREE.Group();
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6), std(0x999999));
  hilt.rotation.x = Math.PI / 2;
  g.add(hilt);
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  blade.rotation.x = Math.PI / 2;
  blade.position.z = len / 2 + 0.25;
  g.add(blade);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, len, 6), glow(0xffffff));
  core.rotation.x = Math.PI / 2;
  core.position.z = len / 2 + 0.25;
  g.add(core);
  if (axe) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), blade.material);
    head.position.set(0, 0.35, len + 0.1);
    g.add(head);
  }
  g.visible = false;
  return g;
}

function legs(p, main, sub, dark, accent, w = 1) {
  for (const s of [-1, 1]) {
    const hip = pivot(p.hips, s * 0.45 * w, -0.2, 0);
    hip.add(box(0.6 * w, 1.15, 0.7, dark, 0, -0.55, 0));
    hip.add(box(0.65 * w, 0.6, 0.75, main, 0, -0.35, 0.02));
    const knee = pivot(hip, 0, -1.15, 0);
    knee.add(box(0.75 * w, 1.15, 0.85, main, 0, -0.55, 0));
    knee.add(box(0.5 * w, 0.4, 0.2, sub, 0, -0.15, 0.48));
    knee.add(box(0.8 * w, 0.28, 1.3, dark, 0, -1.08, 0.15));
    knee.add(box(0.3 * w, 0.2, 0.25, accent, 0, -0.9, 0.7));
    if (s < 0) { p.legL = hip; p.shinL = knee; } else { p.legR = hip; p.shinR = knee; }
  }
}

function finish(root, parts, extra) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { root, parts, ...extra };
}
