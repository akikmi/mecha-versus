import * as THREE from 'three';
import { Input } from './input.js';
import { Arena } from './arena.js';
import { Mech, STATS } from './mech.js';
import { buildMechModel, MECH_TYPES } from './mechModels.js';
import { Animator } from './anim.js';
import { FollowCamera } from './camera.js';
import { FX } from './fx.js';
import { Weapons } from './weapons.js';
import { AIController, DIFFICULTY } from './ai.js';
import { HUD } from './hud.js';
import { SFX } from './audio.js';
import { GameRenderer } from './render.js';

const WINS_NEEDED = 2;
const ROUND_TIME = 99;
const SETTINGS_KEY = 'mecha-versus-settings';

// ------------------------------------------------------------------ settings (localStorage only)
function loadSettings() {
  const def = { difficulty: 'normal', mech: 'kestrel', muted: false, graphics: 'high' };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (DIFFICULTY[s.difficulty]) def.difficulty = s.difficulty;
    if (MECH_TYPES[s.mech]) def.mech = s.mech;
    def.muted = s.muted === true;
    if (s.graphics === 'low') def.graphics = 'low';
  } catch { /* storage unavailable */ }
  return def;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
const settings = loadSettings();

// ------------------------------------------------------------------ renderer / scene
const params = new URLSearchParams(location.search);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
const gfx = new GameRenderer(document.getElementById('game'), scene, camera, settings.graphics);
const input = new Input();
const arena = new Arena(scene);
gfx.attachSun(arena.sun);
const followCam = new FollowCamera(camera);
followCam.arena = arena;
const hud = new HUD();

const world = { arena, scene, mechs: [] };
world.fx = new FX(scene);
world.weapons = new Weapons(scene, world);
world.audio = new SFX(settings.muted);

addEventListener('resize', () => gfx.resize());

// ------------------------------------------------------------------ showcase models (title / select)
const ROOF_Y = 14.5;
const previews = {};
for (const [i, id] of ['kestrel', 'grendel'].entries()) {
  const m = buildMechModel(id);
  // camera looks from -z, so +x is screen-left: kestrel left, grendel right (matches the cards)
  m.root.position.set(i === 0 ? 2.8 : -2.8, ROOF_Y, 0);
  m.root.rotation.y = Math.PI;
  new Animator(m).reset();
  m.parts.armR.rotation.x = -0.3;
  scene.add(m.root);
  previews[id] = m;
}
function showPreviews(on) { for (const m of Object.values(previews)) m.root.visible = on; }

// ------------------------------------------------------------------ screens & menus
const screens = ['title', 'controls', 'select', 'pause', 'result'];
function showScreen(name) {
  for (const s of screens) document.getElementById(s).classList.toggle('hidden', s !== name);
}

class Menu {
  constructor(id, onAct) {
    this.buttons = [...document.querySelectorAll(`#${id} button`)];
    this.i = 0;
    this.onAct = onAct;
    this.buttons.forEach((b, i) => {
      b.addEventListener('click', () => { this.i = i; this.render(); b.blur(); this.act(); });
      b.addEventListener('mouseenter', () => { this.i = i; this.render(); });
    });
    this.render();
  }
  act() { world.audio?.play('ui'); this.onAct(this.buttons[this.i].dataset.act); }
  render() { this.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.i)); }
  update() {
    if (input.hit('up')) { this.i = (this.i + this.buttons.length - 1) % this.buttons.length; this.render(); world.audio?.play('cursor'); }
    if (input.hit('down')) { this.i = (this.i + 1) % this.buttons.length; this.render(); world.audio?.play('cursor'); }
    if (input.hit('confirm')) this.act();
  }
}

const diffLabel = document.getElementById('diff-label');
const order = ['easy', 'normal', 'hard'];
function renderDiff() { diffLabel.textContent = DIFFICULTY[settings.difficulty].label; }
renderDiff();
const gfxLabel = document.getElementById('gfx-label');
function renderGfx() { gfxLabel.textContent = settings.graphics.toUpperCase(); }
renderGfx();
const soundLabel = document.getElementById('sound-label');
function renderSound() { soundLabel.textContent = settings.muted ? 'OFF' : 'ON'; }
renderSound();

const titleMenu = new Menu('title-menu', (act) => {
  if (act === 'start') setMode('select');
  if (act === 'difficulty') { settings.difficulty = order[(order.indexOf(settings.difficulty) + 1) % 3]; saveSettings(); renderDiff(); }
  if (act === 'controls') setMode('controls');
  if (act === 'graphics') { settings.graphics = settings.graphics === 'high' ? 'low' : 'high'; saveSettings(); gfx.setQuality(settings.graphics); renderGfx(); }
});
const controlsMenu = new Menu('controls', () => setMode('title'));
const pauseMenu = new Menu('pause-menu', (act) => {
  if (act === 'resume') setPaused(false);
  if (act === 'quit') { setPaused(false); endBattle(); setMode('title'); }
});
const resultMenu = new Menu('result-menu', (act) => {
  if (act === 'rematch') startBattle();
  if (act === 'select') { endBattle(); setMode('select'); }
  if (act === 'title') { endBattle(); setMode('title'); }
});

// mech select cards
const cards = [...document.querySelectorAll('#select .card')];
for (const c of cards) {
  const id = c.dataset.mech, t = MECH_TYPES[id], s = STATS[id];
  c.innerHTML = `<div class="role">${t.role}</div><h3>${t.name}</h3><div class="role">${t.kana}</div><p>${t.desc}</p>
    <ul><li>${s.rifle.name} (${s.rifle.ammo}発 / ${s.rifle.dmg}dmg)</li><li>${s.missile.name} (${s.missile.count}連装)</li>
    <li>${s.melee.name} (3段)</li><li>特殊: ${s.special.name} (${s.special.dmg}dmg)</li></ul>`;
  c.addEventListener('click', () => {
    if (settings.mech === id) { world.audio?.play('ui'); startBattle(); return; }
    settings.mech = id; saveSettings(); renderCards(); world.audio?.play('cursor');
  });
}
function renderCards() { for (const c of cards) c.classList.toggle('sel', c.dataset.mech === settings.mech); }
renderCards();

// ------------------------------------------------------------------ game state
let mode = 'title';
let paused = false;
let battle = null;
let orbitT = 0;
let selectSnap = false;

function setMode(m) {
  mode = m;
  if (m === 'title' || m === 'controls' || m === 'select') {
    showScreen(m);
    followCam.resetFov();
    hud.show(false);
    showPreviews(true);
  }
  if (m === 'title') titleMenu.render();
  if (m === 'select') selectSnap = true;
}

function setPaused(p) {
  paused = p;
  showScreen(p ? 'pause' : null);
  world.audio?.setBoost(false);
  if (p) { pauseMenu.i = 0; pauseMenu.render(); }
}

function otherMech(id) { return id === 'kestrel' ? 'grendel' : 'kestrel'; }

function endBattle() {
  if (!battle) return;
  for (const m of [battle.player, battle.enemy]) scene.remove(m.model.root);
  world.weapons.clear();
  world.fx.clear();
  world.mechs = [];
  world.audio?.setBoost(false);
  battle = null;
}

function startBattle() {
  endBattle();
  showScreen(null);
  showPreviews(false);
  const player = new Mech(settings.mech, scene);
  const enemy = new Mech(otherMech(settings.mech), scene);
  player.isPlayer = true;
  player.target = enemy; enemy.target = player;
  world.mechs = [player, enemy];
  battle = {
    player, enemy,
    ai: null,
    round: 0, pw: 0, ew: 0, phase: 'intro', phaseT: 0, timeLeft: ROUND_TIME, hitStop: 0,
    stats: { dealt: 0, taken: 0, hits: 0 },
  };
  hud.setup(player, enemy, WINS_NEEDED);
  hud.show(true);
  mode = 'battle';
  startRound();
}

function startRound() {
  const b = battle;
  b.round++;
  world.weapons.clear();
  world.fx.clear();
  arena.clearScorch();
  b.player.reset(new THREE.Vector3(-20, 0, -62), 0.3);
  b.enemy.reset(new THREE.Vector3(20, 0, 62), Math.PI + 0.3);
  b.ai = new AIController(b.enemy, b.player, world, settings.difficulty);
  b.ai2 = null;
  b.phase = 'intro'; b.phaseT = 0; b.timeLeft = ROUND_TIME; b.msgStage = 0;
  b.koBoom = 0;
  b.hitStop = 0;
  followCam.snap(b.player, b.enemy);
  hud.setRounds(b.pw, b.ew);
  hud.message(b.round === 3 ? 'FINAL ROUND' : `ROUND ${b.round}`, '', 1.0);
  world.audio?.play('round');
}

world.onHit = (attacker, victim, dmg, at, hit = {}) => {
  if (!battle) return;
  const heavy = hit.forceDown || dmg >= 85;
  if (victim === battle.player) { followCam.shake(heavy ? 1.1 : 0.7); battle.stats.taken += dmg; hud.damage(at, dmg, camera, true); }
  else if (attacker === battle.player) { followCam.shake(heavy ? 0.6 : 0.25); battle.stats.dealt += dmg; battle.stats.hits++; hud.damage(at, dmg, camera, false); }
  if (heavy && (victim === battle.player || attacker === battle.player)) followCam.kick(7);
};
// Hit stop: freezes both mechs (and projectiles) for a few frames.
world.hitStop = (sec) => { if (battle) battle.hitStop = Math.max(battle.hitStop, sec); };
world.onShake = (who, a) => followCam.shake(battle && who === battle.player ? a : a * 0.4);

// ------------------------------------------------------------------ player command
const NO_CMD = { move: new THREE.Vector3(), boost: false, boostPressed: false, bd: false, step: null };
// Short input buffer so a step / BD / melee pressed during landing lag or hit stop still comes out.
const buf = { step: null, stepT: 0, melee: 0, bd: 0, shoot: 0, missile: 0, special: 0, overdrive: 0 };
const ONE_SHOTS = ['shoot', 'missile', 'special', 'overdrive'];
function playerCmd(dt) {
  const mv = followCam.toWorld(input.move.x, input.move.z);
  if (input.step) { buf.step = input.step; buf.stepT = 0.15; }
  else if ((buf.stepT -= dt) <= 0) buf.step = null;
  if (input.hit('melee')) buf.melee = 0.12; else buf.melee -= dt;
  if (input.hit('bd')) buf.bd = 0.12; else buf.bd -= dt;
  for (const k of ONE_SHOTS) { if (input.hit(k)) buf[k] = 0.1; else buf[k] -= dt; }
  const step = buf.step ? followCam.toWorld(buf.step.x, buf.step.z) : null;
  return {
    move: mv, boost: input.down('boost'), boostPressed: input.hit('boost'), bd: buf.bd > 0,
    step, shoot: buf.shoot > 0, melee: buf.melee > 0, missile: buf.missile > 0, special: buf.special > 0, overdrive: buf.overdrive > 0,
  };
}
// Clear buffers once the mech has acted on them.
function consumeBuffers(m, prevState, prevSerial, prev) {
  if (m.stepSerial !== prevSerial) buf.step = null;
  if (m.state === 'melee' && (prevState !== 'melee' || m.meleeQueued)) buf.melee = 0;
  if (m.state === 'bd' && prevState !== 'bd') buf.bd = 0;
  if (m.ammo.rifle !== prev.rifle || m.state === 'turnshot') buf.shoot = 0;
  if (m.ammo.missile !== prev.missile) buf.missile = 0;
  if (m.state === 'special') buf.special = 0;
  if (prev.od !== m.overdriveT) buf.overdrive = 0;
}

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

// ------------------------------------------------------------------ battle update
// ?demo = CPU vs CPU attract mode (also handy for testing)
const demo = params.has('demo');

function updateBattle(dt) {
  const b = battle;
  const { player, enemy } = b;
  b.phaseT += dt;
  let timeScale = 1;

  if (b.phase === 'intro') {
    if (b.msgStage === 0 && b.phaseT > 1.1) { b.msgStage = 1; hud.message('READY', '', 0.9); }
    if (b.msgStage === 1 && b.phaseT > 2.0) { b.msgStage = 2; hud.message('GO!', '', 0.7); world.audio?.play('go'); b.phase = 'fight'; b.phaseT = 0; }
  } else if (b.phase === 'fight') {
    b.timeLeft -= dt;
    if (!player.alive || !enemy.alive || b.timeLeft <= 0) {
      let pWin, eWin;
      if (b.timeLeft <= 0 && player.alive && enemy.alive) {
        pWin = player.hp >= enemy.hp; eWin = enemy.hp >= player.hp;
        hud.message('TIME UP', 'ko', 2.5);
      } else {
        pWin = player.alive; eWin = enemy.alive;
        if (!pWin && !eWin) pWin = eWin = true;
        hud.message(pWin && eWin ? 'DOUBLE K.O.' : 'K.O.', 'ko', 2.5);
      }
      if (pWin) b.pw++;
      if (eWin) b.ew++;
      b.phase = 'ko'; b.phaseT = 0;
      world.audio?.play('ko');
      hud.setRounds(b.pw, b.ew);
    }
  } else if (b.phase === 'ko') {
    if (b.phaseT < 1.2) timeScale = 0.3;
    if (b.koBoom < 6 && b.phaseT > b.koBoom * 0.25) {
      b.koBoom++;
      for (const m of [player, enemy]) {
        if (m.alive) continue;
        world.fx.explosion(m.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 1.2);
        world.audio?.play('explode');
        followCam.shake(0.4);
      }
    }
    if (b.phaseT > 3.2) {
      if (b.pw >= WINS_NEEDED || b.ew >= WINS_NEEDED) showResult();
      else startRound();
      return;
    }
  }

  const sdt = dt * timeScale;
  if (b.hitStop > 0) {
    // hit stop: mechs and projectiles freeze, the victim shudders; inputs keep buffering
    b.hitStop -= dt;
    if (b.phase === 'fight' && !demo) playerCmd(0);
    for (const m of [player, enemy]) {
      m.model.root.position.copy(m.pos);
      if (m.flash > 0) m.model.root.position.x += (Math.random() - 0.5) * 0.25;
    }
  } else {
    const ps = player.state, pss = player.stepSerial;
    const prev = { rifle: player.ammo.rifle, missile: player.ammo.missile, od: player.overdriveT };
    let pcmd = NO_CMD;
    if (b.phase === 'fight') pcmd = demo ? (b.ai2 ||= new AIController(player, enemy, world, 'normal')).update(sdt) : playerCmd(sdt);
    player.update(sdt, pcmd, world);
    if (!demo) consumeBuffers(player, ps, pss, prev);
    enemy.update(sdt, b.phase === 'fight' ? b.ai.update(sdt) : NO_CMD, world);
    separate(player, enemy);
    world.weapons.update(sdt);
  }
  world.fx.update(sdt);
  world.audio?.setBoost(player.boosting);
  followCam.update(dt, player, enemy);
  arena.updateOcclusion(dt, camera.position, [player.center, enemy.center]);
  gfx.setShadowFocus(player.pos);
  hud.update(dt, player, enemy, camera, world, b.timeLeft);

  if (input.hit('pause') && b.phase !== 'ko') setPaused(true);
}

function showResult() {
  const b = battle;
  mode = 'result';
  hud.show(false);
  world.audio?.setBoost(false);
  const win = b.pw > b.ew, draw = b.pw === b.ew;
  const t = document.getElementById('result-title');
  t.textContent = draw ? 'DRAW' : win ? 'YOU WIN' : 'YOU LOSE';
  t.className = 'big' + (win || draw ? '' : ' lose');
  document.getElementById('result-score').textContent = `${b.pw} - ${b.ew}`;
  document.getElementById('result-stats').innerHTML =
    `${b.player.name} vs ${b.enemy.name} / CPU ${DIFFICULTY[settings.difficulty].label}<br>` +
    `与えたダメージ ${b.stats.dealt} ・ 受けたダメージ ${b.stats.taken} ・ 命中 ${b.stats.hits}`;
  showScreen('result');
  resultMenu.i = 0; resultMenu.render();
  world.audio?.play(win ? 'win' : 'lose');
}

// ------------------------------------------------------------------ menu-mode camera
function updateMenuCamera(dt) {
  orbitT += dt;
  if (mode === 'select') {
    const sel = settings.mech === 'kestrel' ? 2.8 : -2.8;
    for (const [id, m] of Object.entries(previews)) {
      const on = id === settings.mech;
      m.root.rotation.y += ((on ? Math.PI + Math.sin(orbitT * 0.6) * 0.6 : Math.PI) - m.root.rotation.y) * Math.min(1, 4 * dt);
      for (const f of m.flames) { f.visible = on; f.scale.set(1, 0.6 + Math.random() * 0.4, 1); }
    }
    const want = new THREE.Vector3(sel * 0.5, ROOF_Y + 3.2, -12.5);
    if (selectSnap) { camera.position.copy(want); selectSnap = false; }
    camera.position.lerp(want, Math.min(1, 4 * dt));
    camera.lookAt(sel * 0.5, ROOF_Y + 0.6, 0);
  } else {
    for (const m of Object.values(previews)) { m.root.rotation.y = Math.PI; for (const f of m.flames) f.visible = false; }
    const a = orbitT * 0.08;
    camera.position.set(Math.sin(a) * 48, 26, Math.cos(a) * 48);
    camera.lookAt(0, ROOF_Y + 2, 0);
  }
  arena.updateOcclusion(dt, camera.position, []);
  gfx.setShadowFocus(new THREE.Vector3(0, 0, 0));
  world.fx.update(dt);
}

function updateMenus() {
  if (mode === 'title') titleMenu.update();
  else if (mode === 'controls') { controlsMenu.update(); if (input.hit('back') || input.hit('pause')) setMode('title'); }
  else if (mode === 'select') {
    if (input.hit('left') || input.hit('right')) { settings.mech = otherMech(settings.mech); saveSettings(); renderCards(); world.audio?.play('cursor'); }
    if (input.hit('confirm')) { world.audio?.play('ui'); startBattle(); }
    else if (input.hit('back') || input.hit('pause')) setMode('title');
  } else if (mode === 'result') resultMenu.update();
}

// ------------------------------------------------------------------ main loop
// ?debug shows FPS
const fpsEl = params.has('debug') ? document.getElementById('fps') : null;
if (fpsEl) fpsEl.classList.remove('hidden');
const fpsStat = { frames: 0, t: 0, fps: 0 };
let last = performance.now();
function frame(now) {
  const rawDt = Math.max(0, (now - last) / 1000);
  const dt = Math.min(1 / 30, rawDt);
  last = now;
  fpsStat.frames++; fpsStat.t += rawDt;
  if (fpsStat.t >= 0.5) {
    fpsStat.fps = fpsStat.frames / fpsStat.t; fpsStat.frames = 0; fpsStat.t = 0;
    if (fpsEl) fpsEl.textContent = `${fpsStat.fps.toFixed(0)} FPS ${settings.graphics.toUpperCase()}`;
  }
  input.update();
  arena.update(dt);
  if (input.hit('mute')) {
    settings.muted = !settings.muted; saveSettings();
    world.audio.setMuted(settings.muted);
    renderSound();
  }
  if (mode === 'battle' && battle) {
    if (paused) {
      pauseMenu.update();
      if (input.hit('pause')) setPaused(false);
    } else updateBattle(dt);
  } else if (mode === 'result' && battle) {
    // keep the arena alive behind the result screen
    world.fx.update(dt);
    battle.player.update(dt, NO_CMD, world);
    battle.enemy.update(dt, NO_CMD, world);
    followCam.update(dt, battle.player, battle.enemy);
    gfx.setShadowFocus(battle.player.pos);
    updateMenus();
  } else {
    updateMenuCamera(dt);
    updateMenus();
  }
  gfx.render(dt);
}

setMode('title');
if (demo) startBattle();
gfx.renderer.setAnimationLoop(frame);
window.__game = {
  get battle() { return battle; }, get mode() { return mode; }, world, settings, followCam, camera, arena, gfx, fps: fpsStat,
  setGraphics(q) { settings.graphics = q; gfx.setQuality(q); renderGfx(); },
};
