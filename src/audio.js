// All sound effects are synthesized at runtime with WebAudio (no audio files).

export class SFX {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
    this.last = {};
    const unlock = () => this.unlock();
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // 1s of white noise reused by noise-based sounds
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // looping boost hiss
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    src.connect(bp).connect(this.boostGain).connect(this.master);
    src.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
  }

  setBoost(on) {
    if (!this.ctx) return;
    const g = this.boostGain.gain;
    const target = on ? 0.12 : 0;
    if (this._boostOn === on) return;
    this._boostOn = on;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(target, this.ctx.currentTime, on ? 0.03 : 0.08);
  }

  // ------------------------------------------------------------ primitives
  env(gainNode, t, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(type, f0, f1, dur, vol, t0 = 0, filter = null) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; node.connect(f); node = f; }
    node.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  hiss(type, f0, f1, dur, vol, t0 = 0, q = 1) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ named sounds
  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.03) return;
    this.last[name] = now;
    const v = vol;
    switch (name) {
      case 'beam':
        this.tone('sawtooth', 1900, 260, 0.22, 0.22 * v, 0, { type: 'lowpass', freq: 3500 });
        this.tone('square', 950, 180, 0.16, 0.08 * v);
        this.hiss('highpass', 4000, 1500, 0.12, 0.1 * v);
        break;
      case 'missile':
        this.hiss('bandpass', 400, 1800, 0.35, 0.3 * v, 0, 2);
        this.tone('sine', 140, 60, 0.15, 0.25 * v);
        break;
      case 'hit':
        this.hiss('highpass', 3000, 800, 0.12, 0.35 * v);
        this.tone('sine', 220, 50, 0.18, 0.35 * v);
        break;
      case 'slash':
        this.hiss('bandpass', 2600, 500, 0.16, 0.4 * v, 0, 1.5);
        this.tone('sawtooth', 700, 120, 0.14, 0.15 * v, 0, { type: 'lowpass', freq: 2000 });
        this.tone('sine', 160, 50, 0.2, 0.35 * v);
        break;
      case 'swing':
        this.hiss('bandpass', 700, 2200, 0.13, 0.18 * v, 0, 2);
        break;
      case 'saberOn':
        this.tone('sawtooth', 90, 320, 0.18, 0.12 * v, 0, { type: 'lowpass', freq: 900 });
        break;
      case 'explode':
        this.hiss('lowpass', 1200, 80, 0.9, 0.55 * v);
        this.tone('sine', 90, 28, 0.7, 0.5 * v);
        break;
      case 'step':
        this.hiss('bandpass', 1600, 500, 0.16, 0.25 * v, 0, 1.2);
        break;
      case 'jump':
        this.hiss('bandpass', 500, 1200, 0.14, 0.18 * v, 0, 1);
        break;
      case 'charge':
        this.tone('sine', 300, 1400, 0.45, 0.18 * v);
        this.tone('triangle', 150, 700, 0.45, 0.1 * v);
        break;
      case 'special':
        this.tone('sawtooth', 220, 70, 1.0, 0.3 * v, 0, { type: 'lowpass', freq: 1800 });
        this.hiss('lowpass', 3000, 300, 1.0, 0.4 * v);
        this.tone('sine', 70, 30, 0.8, 0.45 * v);
        break;
      case 'ui':
        this.tone('square', 880, 1320, 0.08, 0.12 * v, 0, { type: 'lowpass', freq: 3000 });
        break;
      case 'cursor':
        this.tone('square', 660, 660, 0.04, 0.08 * v, 0, { type: 'lowpass', freq: 2500 });
        break;
      case 'round':
        this.tone('triangle', 440, 440, 0.15, 0.2 * v);
        this.tone('triangle', 660, 660, 0.25, 0.2 * v, 0.12);
        break;
      case 'go':
        this.tone('sawtooth', 523, 523, 0.3, 0.15 * v, 0, { type: 'lowpass', freq: 2500 });
        this.tone('sawtooth', 784, 784, 0.35, 0.15 * v, 0.02, { type: 'lowpass', freq: 2500 });
        this.tone('sawtooth', 1046, 1046, 0.4, 0.12 * v, 0.04, { type: 'lowpass', freq: 2500 });
        break;
      case 'ko':
        this.tone('sine', 120, 30, 1.2, 0.5 * v);
        this.hiss('lowpass', 2000, 60, 1.4, 0.4 * v);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.18 * v, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.35, 0.16 * v, i * 0.16));
        break;
      default:
        break;
    }
  }
}
