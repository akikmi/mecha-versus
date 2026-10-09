import * as THREE from 'three';
import { MAX_HP } from './mech.js';

const $ = (id) => document.getElementById(id);
const proj = new THREE.Vector3();

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      enemyName: $('enemy-name'), enemyHp: $('enemy-hp'),
      playerName: $('player-name'), playerHp: $('player-hp'), playerHpNum: $('player-hpnum'), boost: $('player-boost'),
      timer: $('timer'), dotsP: $('round-dots-p'), dotsE: $('round-dots-e'),
      lock: $('lock'), lockDist: document.querySelector('#lock .dist'),
      alert: $('alert'), msg: $('center-msg'), dmg: $('dmg-layer'),
      rifle: $('w-rifle'), missile: $('w-missile'), melee: $('w-melee'), special: $('w-special'),
    };
    this.msgT = 0;
    this.cache = {};
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setup(player, enemy, winsNeeded) {
    this.el.playerName.textContent = player.name;
    this.el.enemyName.textContent = 'CPU ' + enemy.name;
    const s = player.stats;
    for (const k of ['rifle', 'missile', 'melee', 'special']) this.el[k].querySelector('.wname').textContent = s[k].name;
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

    const php = player.hp / MAX_HP, ehp = enemy.hp / MAX_HP;
    this.set('php', e.playerHp, 'scale', php.toFixed(3));
    this.set('phpl', e.playerHp, 'low', php < 0.3);
    this.set('phpn', e.playerHpNum, 'text', String(Math.ceil(player.hp)));
    this.set('ehp', e.enemyHp, 'scale', ehp.toFixed(3));
    this.set('ehpl', e.enemyHp, 'low', ehp < 0.3);
    this.set('boost', e.boost, 'scale', (player.boost / player.stats.boostMax).toFixed(3));
    this.set('oh', e.boost, 'oh', player.overheat);
    this.set('timer', e.timer, 'text', String(Math.max(0, Math.ceil(timeLeft))));

    const s = player.stats;
    for (const k of ['rifle', 'missile']) {
      const w = e[k];
      this.set(k + 'a', w.querySelector('.ammo'), 'text', String(player.ammo[k]));
      this.set(k + 'e', w.querySelector('.ammo'), 'empty', player.ammo[k] === 0);
      const r = player.ammo[k] < s[k].ammo ? player.reloadT[k] / s[k].reload : 1;
      this.set(k + 'r', w.querySelector('.reload div'), 'width', Math.round(r * 100) + '%');
    }
    const ch = player.charge / s.special.charge;
    this.set('spa', e.special.querySelector('.ammo'), 'text', ch >= 1 ? 'READY' : Math.floor(ch * 100) + '%');
    this.set('spr', e.special.querySelector('.reload div'), 'width', Math.round(ch * 100) + '%');
    this.set('sprd', e.special, 'ready', ch >= 1);

    // lock-on marker
    proj.copy(enemy.center).project(camera);
    const visible = proj.z < 1 && enemy.alive;
    if (visible) {
      const x = (proj.x * 0.5 + 0.5) * innerWidth, y = (-proj.y * 0.5 + 0.5) * innerHeight;
      e.lock.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const dist = player.distTo(enemy);
      this.set('lockred', e.lock, 'red', dist <= player.stats.redRange);
      this.set('lockd', e.lockDist, 'text', Math.round(dist) + 'm');
    }
    this.set('lockv', e.lock, 'hidden', !visible);

    // incoming homing alert
    let alert = false;
    for (const p of world.weapons.threatsTo(player)) {
      if (p.red && p.homingT > 0 && p.serial === player.stepSerial && p.pos.distanceTo(player.pos) < 45) { alert = true; break; }
    }
    if (enemy.state === 'melee' && enemy.meleePhase === 'lunge') alert = true;
    this.set('alert', e.alert, 'on', alert);
  }
}
