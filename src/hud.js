import * as THREE from 'three';
import { MAX_HP, OD_MAX, OD_TIME } from './mech.js';

const $ = (id) => document.getElementById(id);
const proj = new THREE.Vector3();
const LOCK_RANGE = 110; // beyond this the cursor turns yellow (out of range)

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      enemyName: $('enemy-name'), enemyHp: $('enemy-hp'), enemyHpNum: $('enemy-hpnum'), enemyOd: $('enemy-od'),
      playerName: $('player-name'), playerHp: $('player-hp'), playerHpNum: $('player-hpnum'), boost: $('player-boost'),
      od: $('player-od'), odState: $('od-state'),
      timer: $('timer'), dotsP: $('round-dots-p'), dotsE: $('round-dots-e'),
      lock: $('lock'), lockDist: document.querySelector('#lock .dist'),
      alert: $('alert'), msg: $('center-msg'), dmg: $('dmg-layer'), flash: $('flash'),
      osa: [...document.querySelectorAll('#offscreen .osa')],
      rifle: $('w-rifle'), missile: $('w-missile'), melee: $('w-melee'), special: $('w-special'),
    };
    this.msgT = 0;
    this.flashV = 0;
    this.cache = {};
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setup(player, enemy, winsNeeded) {
    this.el.playerName.textContent = player.name;
    this.el.enemyName.textContent = 'CPU ' + enemy.name;
    const s = player.stats;
    for (const k of ['rifle', 'missile', 'melee', 'special']) this.el[k].querySelector('.wname').textContent = s[k].name;
    // ammo icons
    for (const k of ['rifle', 'missile']) {
      const pips = this.el[k].querySelector('.pips');
      pips.innerHTML = Array.from({ length: s[k].ammo }, () => '<i></i>').join('');
    }
    this.pips = { rifle: [...this.el.rifle.querySelectorAll('.pips i')], missile: [...this.el.missile.querySelectorAll('.pips i')] };
    const dots = (n) => Array.from({ length: n }, () => '<i></i>').join('');
    this.el.dotsP.innerHTML = dots(winsNeeded);
    this.el.dotsE.innerHTML = dots(winsNeeded);
    this.cache = {};
    this.el.dmg.textContent = '';
  }

  setRounds(pw, ew) {
    this.el.dotsP.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pw));
    this.el.dotsE.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < ew));
  }

  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'scale') el.style.transform = `scaleX(${value})`;
    else if (prop === 'width') el.style.width = value;
    else el.classList.toggle(prop, value);
  }

  message(text, cls = '', duration = 1.2) {
    const m = this.el.msg;
    m.textContent = text;
    m.className = '';
    void m.offsetWidth; // restart animation
    m.className = 'pop ' + cls;
    this.msgT = duration;
  }

  // full-screen white flash (KO, OVERDRIVE)
  flash(v) { this.flashV = Math.max(this.flashV, v); }

  damage(pos, dmg, camera, taken) {
    proj.copy(pos).project(camera);
    if (proj.z > 1) return;
    const d = document.createElement('div');
    d.className = 'dmg' + (taken ? ' taken' : '');
    d.textContent = dmg;
    d.style.left = ((proj.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    d.style.top = ((-proj.y * 0.5 + 0.5) * innerHeight - 30) + 'px';
    this.el.dmg.appendChild(d);
    setTimeout(() => d.remove(), 850);
  }

  update(dt, player, enemy, camera, world, timeLeft) {
    const e = this.el;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) e.msg.textContent = ''; }
    if (this.flashV > 0 || this.cache.flash !== 0) {
      this.flashV = Math.max(0, this.flashV - dt * 2.5);
      const v = Math.round(this.flashV * 100) / 100;
      if (this.cache.flash !== v) { this.cache.flash = v; e.flash.style.opacity = v; }
    }

    const php = player.hp / MAX_HP, ehp = enemy.hp / MAX_HP;
    this.set('php', e.playerHp, 'scale', php.toFixed(3));
    this.set('phpl', e.playerHp, 'low', php < 0.3);
    this.set('phpn', e.playerHpNum, 'text', String(Math.ceil(player.hp)));
    this.set('phpnl', e.playerHpNum.parentElement, 'low', php < 0.3);
    this.set('ehp', e.enemyHp, 'scale', ehp.toFixed(3));
    this.set('ehpl', e.enemyHp, 'low', ehp < 0.3);
    this.set('ehpn', e.enemyHpNum, 'text', String(Math.ceil(enemy.hp)));
    this.set('boost', e.boost, 'scale', (player.boost / player.stats.boostMax).toFixed(3));
    this.set('oh', e.boost, 'oh', player.overheat);
    this.set('timer', e.timer, 'text', String(Math.max(0, Math.ceil(timeLeft))));

    // OVERDRIVE gauges: fill while charging, drain while active
    const odv = (m) => (m.overdriveT > 0 ? m.overdriveT / OD_TIME : m.od / OD_MAX);
    this.set('od', e.od, 'scale', odv(player).toFixed(3));
    this.set('odf', e.od, 'full', player.odReady);
    this.set('oda', e.od, 'active', player.overdriveT > 0);
    this.set('ods', e.odState, 'text', player.overdriveT > 0 ? 'ACTIVE' : player.odReady ? 'READY [O]' : '');
    this.set('eod', e.enemyOd, 'scale', odv(enemy).toFixed(3));
    this.set('eodf', e.enemyOd, 'full', enemy.odReady || enemy.overdriveT > 0);

    const s = player.stats;
    for (const k of ['rifle', 'missile']) {
      const w = e[k];
      const n = player.ammo[k];
      this.pips[k].forEach((p, i) => this.set(`${k}p${i}`, p, 'on', i < n));
      this.set(k + 'e', w.querySelector('.pips'), 'empty', n === 0);
      const r = n < s[k].ammo ? player.reloadT[k] / s[k].reload : 1;
      this.set(k + 'r', w.querySelector('.reload div'), 'width', Math.round(r * 100) + '%');
    }
    const ch = player.charge / s.special.charge;
    this.set('spa', e.special.querySelector('.ammo'), 'text', ch >= 1 ? 'READY' : Math.floor(ch * 100) + '%');
    this.set('spr', e.special.querySelector('.reload div'), 'width', Math.round(ch * 100) + '%');
    this.set('sprd', e.special, 'ready', ch >= 1);

    // lock-on cursor: red = homing, green = no homing, yellow = out of range
    proj.copy(enemy.center).project(camera);
    const visible = proj.z < 1 && enemy.alive && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
    const dist = player.distTo(enemy);
    if (visible) {
      const x = (proj.x * 0.5 + 0.5) * innerWidth, y = (-proj.y * 0.5 + 0.5) * innerHeight;
      e.lock.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      this.set('lockd', e.lockDist, 'text', Math.round(dist) + 'm');
    }
    const red = dist <= player.stats.redRange, far = dist > LOCK_RANGE;
    this.set('lockred', e.lock, 'red', red);
    this.set('locky', e.lock, 'yellow', far);
    this.set('lockv', e.lock, 'hidden', !visible);

    // incoming homing alert + off-screen attack markers ("!" at the screen edge in the threat's direction)
    let alert = false;
    const off = [];
    for (const p of world.weapons.threatsTo(player)) {
      const d = p.pos.distanceTo(player.pos);
      if (p.red && p.homingT > 0 && p.serial === player.stepSerial && d < 45) alert = true;
      if (d < 70 && off.length < e.osa.length) {
        proj.copy(p.pos).project(camera);
        const behind = proj.z > 1;
        if (behind || Math.abs(proj.x) > 1 || Math.abs(proj.y) > 1) off.push({ x: behind ? -proj.x : proj.x, y: behind ? -proj.y : proj.y });
      }
    }
    if (enemy.state === 'melee' && enemy.meleePhase === 'lunge') {
      alert = true;
      proj.copy(enemy.center).project(camera);
      const behind = proj.z > 1;
      if ((behind || Math.abs(proj.x) > 1 || Math.abs(proj.y) > 1) && off.length < e.osa.length) off.push({ x: behind ? -proj.x : proj.x, y: behind ? -proj.y : proj.y });
    }
    this.set('alert', e.alert, 'on', alert);
    e.osa.forEach((el, i) => {
      const o = off[i];
      this.set('osa' + i, el, 'on', !!o);
      if (!o) return;
      const l = Math.max(Math.abs(o.x), Math.abs(o.y), 1e-3);
      const nx = o.x / l * 0.9, ny = o.y / l * 0.85;
      el.style.transform = `translate(${((nx * 0.5 + 0.5) * innerWidth).toFixed(0)}px, ${((-ny * 0.5 + 0.5) * innerHeight).toFixed(0)}px)`;
    });
  }
}
