// Keyboard + Gamepad input. Produces abstract actions and a local move vector.
// Local move: x = right, z = forward (relative to camera).

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'boost',
  KeyJ: 'shoot',
  KeyK: 'melee',
  KeyL: 'missile',
  KeyI: 'special',
  Enter: 'confirm',
  Escape: 'pause', KeyP: 'pause',
  Backspace: 'back',
};

const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
const DOUBLE_TAP_MS = 260;

// Standard gamepad mapping
const PAD = { boost: 0, melee: 1, shoot: 2, missile: 3, step: 4, special: 5, shoot2: 7, back: 8, pause: 9 };

export class Input {
  constructor() {
    this.held = new Set();
    this.pressedSet = new Set();
    this.lastTap = {}; // dir -> time
    this.pendingStep = null; // {x,z,dir}
    this.move = { x: 0, z: 0 };
    this.padPrev = [];
    this.padActive = false;
    this.padStepPrev = false;

    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(a);
      this.pressedSet.add(a);
      if (a === 'boost') this.pressedSet.add('confirm'); // Space also confirms in menus
      if (DIRS[a]) {
        const now = performance.now();
        if (this.lastTap[a] && now - this.lastTap[a] < DOUBLE_TAP_MS) {
          this.pendingStep = { x: DIRS[a][0], z: DIRS[a][1], dir: a };
          this.lastTap[a] = 0;
        } else {
          this.lastTap[a] = now;
        }
      }
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      this.held.delete(a);
    });
    addEventListener('blur', () => { this.held.clear(); });
  }

  // Call once per frame before reading.
  update() {
    this.pressed = this.pressedSet;
    this.pressedSet = new Set();
    this.step = this.pendingStep;
    this.pendingStep = null;

    let x = 0, z = 0;
    if (this.held.has('up')) z += 1;
    if (this.held.has('down')) z -= 1;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;

    this.padHeld = new Set();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const dz = 0.25;
      if (Math.hypot(ax, ay) > dz) { x += ax; z += -ay; this.padActive = true; }
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      // dpad as directions for menus
      const dpad = { up: 12, down: 13, left: 14, right: 15 };
      for (const [name, idx] of Object.entries(PAD)) {
        const now = b(idx);
        const act = name === 'shoot2' ? 'shoot' : name;
        if (now) this.padHeld.add(act);
        if (now && !this.padPrev[idx]) { this.pressed.add(act); if (act === 'boost') this.pressed.add('confirm'); }
        this.padPrev[idx] = now;
      }
      for (const [name, idx] of Object.entries(dpad)) {
        const now = b(idx);
        if (now) { this.padHeld.add(name); if (name === 'up') z += 1; if (name === 'down') z -= 1; if (name === 'left') x -= 1; if (name === 'right') x += 1; }
        if (now && !this.padPrev[idx]) this.pressed.add(name);
        this.padPrev[idx] = now;
      }
      // LB + stick = step
      if (this.pressed.has('step') && Math.hypot(x, z) > 0.3) {
        const l = Math.hypot(x, z);
        this.step = { x: x / l, z: z / l, dir: 'pad' };
      }
    }

    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.move.x = x; this.move.z = z;
  }

  down(a) { return this.held.has(a) || (this.padHeld && this.padHeld.has(a)); }
  hit(a) { return this.pressed && this.pressed.has(a); }
  // Whether the key that triggered the current step is still held (for step -> boost dash).
  stepHeld(dir) { return dir === 'pad' ? this.padHeld.has('step') || Math.hypot(this.move.x, this.move.z) > 0.5 : this.held.has(dir); }
}
