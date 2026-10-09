import * as THREE from 'three';
import { Input } from './input.js';
import { Arena } from './arena.js';
import { Mech } from './mech.js';
import { FollowCamera } from './camera.js';
import { FX } from './fx.js';
import { Weapons } from './weapons.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
const input = new Input();
const arena = new Arena(scene);
const followCam = new FollowCamera(camera);

const player = new Mech('kestrel', scene);
const enemy = new Mech('grendel', scene);
player.target = enemy; enemy.target = player;
player.reset(new THREE.Vector3(0, 0, -45), 0);
enemy.reset(new THREE.Vector3(0, 0, 45), Math.PI);
player.isPlayer = true;
const world = { arena, scene, mechs: [player, enemy] };
world.fx = new FX(scene);
world.weapons = new Weapons(scene, world);
world.onHit = (attacker, victim, dmg) => {
  if (victim === player) followCam.shake(0.6);
  else if (attacker === player) followCam.shake(0.25);
};
world.onShake = (who, a) => followCam.shake(who === player ? a : a * 0.4);
followCam.snap(player, enemy);

const idle = { move: { x: 0, z: 0 }, boost: false, boostPressed: false, step: null, stepHold: false };

// Short input buffer so a step/melee pressed during landing lag still comes out.
const buf = { step: null, stepT: 0, stepDir: null, melee: 0 };
function playerCmd(dt) {
  const mv = followCam.toWorld(input.move.x, input.move.z);
  if (input.step) { buf.step = input.step; buf.stepT = 0.15; buf.stepDir = input.step.dir; }
  else if ((buf.stepT -= dt) <= 0) buf.step = null;
  if (input.hit('melee')) buf.melee = 0.12; else buf.melee -= dt;
  const step = buf.step ? followCam.toWorld(buf.step.x, buf.step.z) : null;
  return {
    move: mv, boost: input.down('boost'), boostPressed: input.hit('boost'),
    step, stepHold: buf.stepDir ? input.stepHeld(buf.stepDir) : false,
    shoot: input.hit('shoot'), melee: buf.melee > 0, missile: input.hit('missile'), special: input.hit('special'),
  };
}
// Clear buffers once the mech has acted on them.
function consumeBuffers(m, prevState, prevSerial) {
  if (m.stepSerial !== prevSerial) buf.step = null;
  if (m.state === 'melee' && (prevState !== 'melee' || m.meleeQueued)) buf.melee = 0;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// keep the two mechs from overlapping
function separate(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz), min = a.stats.radius + b.stats.radius;
  if (d < min && Math.abs(a.pos.y - b.pos.y) < 4.5 && d > 1e-4) {
    const push = (min - d) / 2;
    a.pos.x -= dx / d * push; a.pos.z -= dz / d * push;
    b.pos.x += dx / d * push; b.pos.z += dz / d * push;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000));
  last = now;
  input.update();
  const ps = player.state, pss = player.stepSerial;
  player.update(dt, playerCmd(dt), world);
  consumeBuffers(player, ps, pss);
  enemy.update(dt, idle, world);
  separate(player, enemy);
  world.weapons.update(dt);
  world.fx.update(dt);
  followCam.update(dt, player, enemy);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
window.__game = { player, enemy, world };
