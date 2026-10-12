/*
 * Synth Player — script
 * Two synths (A and B) on Tone.js, each with its own keyboard, effects chain,
 * equalizer and volume. Controls on the panel edit the synth that is selected.
 *
 * Contents
 *   1. Helpers
 *   2. Controls (knobs, faders, dragged values)
 *   3. Audio: effects, voices, the Engine class, presets
 *   4. Panel: display, controls, FX rack
 *   5. Keyboards and computer keys
 *   6. MIDI input and MIDI files
 *   7. Transport and demo loop
 *   8. Window, menus, dialog
 *   9. Visualizer
 *  10. Start
 */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => root.querySelectorAll(selector);

  const lcdName = $('#lcdName');
  if (typeof Tone === 'undefined') {
    lcdName.textContent = 'NO AUDIO LIB';
    return;
  }

  /* ==================== 1. Helpers ==================== */

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const isBlack = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);
  const noteName = (midi) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  const freq = (midi) => Tone.Frequency(midi, 'midi').toFrequency();

  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const isObject = (o) => o && typeof o === 'object' && !Array.isArray(o);
  function deepMerge(target, source) {
    for (const key in source) {
      target[key] = isObject(source[key])
        ? deepMerge(isObject(target[key]) ? target[key] : {}, source[key])
        : source[key];
    }
    return target;
  }

  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  const pct = (v) => Math.round(v * 100) + '%';
  const hz = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz');
  const db = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
  const ms = (v) => Math.round(v * 1000) + ' ms';

  const state = {
    edit: 0,          // which synth the panel edits: 0 = A, 1 = B
    key: 0,           // key of the demo loop (0 = C)
    channel: 0,       // MIDI channel filter, 0 = all
    power: true,
    labels: true,
    rack: true,
    viz: 'spectrum',
  };

  // Short message on the display, then back to the preset name
  let flashTimer = null;
  function flash(text) {
    lcdName.textContent = text;
    lcdName.classList.add('is-message');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      lcdName.classList.remove('is-message');
      lcdName.textContent = currentEngine().presetName;
    }, 1300);
  }

  /* ==================== 2. Controls ==================== */

  // One class for knobs, faders and the BPM value.
  // kind: 'knob' | 'value' (drag up/down) | 'hfader' | 'vfader' (click or drag along the track)
  class Control {
    constructor(el, options) {
      Object.assign(this, {
        min: 0, max: 1, step: 0, curve: 'lin', kind: 'knob', label: '',
        format: (v) => v.toFixed(2), onInput: null, renderValue: null,
      }, options);
      this.el = el;
      this.value = options.value;
      this.def = options.def !== undefined ? options.def : options.value;
      this.norm = this.toNorm(this.value);

      el.setAttribute('role', 'slider');
      el.setAttribute('aria-label', this.label);
      el.tabIndex = 0;
      el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.setNorm(this.norm - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03), true);
      }, { passive: false });
      el.addEventListener('keydown', (e) => this.onKey(e));
      el.addEventListener('dblclick', () => this.set(this.def, true));
      this.render();
    }

    toNorm(v) {
      const n = this.curve === 'exp'
        ? Math.log(v / this.min) / Math.log(this.max / this.min)
        : (v - this.min) / (this.max - this.min);
      return clamp01(n);
    }

    fromNorm(n) {
      let v = this.curve === 'exp'
        ? this.min * Math.pow(this.max / this.min, n)
        : this.min + (this.max - this.min) * n;
      if (this.step) v = Math.round(v / this.step) * this.step;
      return v;
    }

    setNorm(n, byUser) {
      this.norm = clamp01(n);
      const v = this.fromNorm(this.norm);
      const changed = v !== this.value;
      this.value = v;
      this.render();
      if (changed && this.onInput) this.onInput(v, byUser);
    }

    set(v, byUser = false) {
      this.norm = this.toNorm(v);
      this.value = this.step ? Math.round(v / this.step) * this.step : v;
      this.render();
      if (this.onInput) this.onInput(this.value, byUser);
    }

    render() {
      const n = this.toNorm(this.value);
      this.el.style.setProperty('--n', n);
      if (this.kind === 'knob') this.el.style.setProperty('--rot', (-135 + 270 * n) + 'deg');
      if (this.renderValue) this.renderValue(this.value);
      this.el.setAttribute('aria-valuenow', String(+this.value.toFixed(3)));
      this.el.setAttribute('aria-valuetext', this.format(this.value));
    }

    onPointerDown(e) {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.el.focus({ preventScroll: true });
      this.el.setPointerCapture(e.pointerId);

      const startX = e.clientX, startY = e.clientY, startNorm = this.norm;
      const isFader = this.kind === 'hfader' || this.kind === 'vfader';
      if (isFader) this.setFromPointer(e);

      const move = (ev) => {
        if (isFader) return this.setFromPointer(ev);
        const distance = (startY - ev.clientY) + (ev.clientX - startX) * 0.5;
        this.setNorm(startNorm + distance / (ev.shiftKey ? 700 : 170), true);
      };
      const up = () => {
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
      };
      this.el.addEventListener('pointermove', move);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    }

    // The thumb's half size is the dead zone at both ends of the track (sizes are in vw, so measure it)
    setFromPointer(e) {
      const r = this.el.getBoundingClientRect();
      const thumb = this.el.querySelector('[class$="__thumb"]');
      if (this.kind === 'vfader') {
        const pad = thumb ? thumb.offsetHeight / 2 : 0;
        this.setNorm(1 - (e.clientY - r.top - pad) / (r.height - 2 * pad), true);
      } else {
        const pad = thumb ? thumb.offsetWidth / 2 : 0;
        this.setNorm((e.clientX - r.left - pad) / (r.width - 2 * pad), true);
      }
    }

    onKey(e) {
      const big = e.shiftKey ? 0.1 : 0.02;
      const step = this.step ? Math.max(big, this.step / (this.max - this.min)) : big;
      const n = this.toNorm(this.value);
      const next = {
        ArrowUp: n + step, ArrowRight: n + step,
        ArrowDown: n - step, ArrowLeft: n - step,
        Home: 0, End: 1,
      }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.setNorm(next, true);
    }
  }

  function buildKnob(el, ticks = 11, small = false) {
    el.innerHTML = '<div class="knob__ticks"></div><div class="knob__cap"><i></i></div><div class="knob__shine"></div>';
    el.classList.toggle('knob--small', small);
    const ring = el.firstChild;
    for (let i = 0; i < ticks; i++) {
      const tick = document.createElement('span');
      tick.style.setProperty('--a', (-135 + 270 * i / (ticks - 1)) + 'deg');
      ring.appendChild(tick);
    }
  }

  function buildVFader(el) {
    el.innerHTML = '<div class="vfader__ticks"></div><div class="vfader__track"><div class="vfader__fill"></div></div><div class="vfader__thumb"></div>';
  }

  /* ==================== 3. Audio ==================== */

  // Shared output: both synths → master → limiter → speakers + analysers
  const master = new Tone.Gain(0.85);
  const limiter = new Tone.Limiter(-1);
  const fft = new Tone.Analyser('fft', 256);
  const waveform = new Tone.Analyser('waveform', 512);
  master.connect(limiter);
  limiter.toDestination();
  limiter.connect(fft);
  limiter.connect(waveform);

  // --- Effects built from plain nodes, so they work without AudioWorklet ---
  class CustomEffect {
    constructor() {
      this.isCustom = true;
      this.input = new Tone.Gain(1);
      this.mix = new Tone.CrossFade(0.5);
      this.output = this.mix;
      this.wet = this.mix.fade;
      this.input.connect(this.mix.a);
    }
  }

  class BitCrusher extends CustomEffect {
    constructor(bits) {
      super();
      this.shaper = new Tone.WaveShaper((x) => x, 4096);
      this.input.connect(this.shaper);
      this.shaper.connect(this.mix.b);
      this.bits = bits;
    }
    set bits(b) {
      this._bits = b;
      const steps = Math.pow(2, b - 1);
      this.shaper.setMap((x) => Math.round(x * steps) / steps);
    }
    get bits() { return this._bits; }
  }

  class Freeverb extends CustomEffect {
    constructor() {
      super();
      this.sum = new Tone.Gain(0.06);
      this.feedbacks = [];
      this.lowpasses = [];
      [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].forEach((samples) => {
        const delay = new Tone.Delay(samples / 44100, 0.1);
        const lowpass = new Tone.Filter({ type: 'lowpass', frequency: 3000, rolloff: -12, Q: 0 });
        const feedback = new Tone.Gain(0.8);
        this.input.connect(delay);
        delay.connect(lowpass);
        lowpass.connect(feedback);
        feedback.connect(delay);
        delay.connect(this.sum);
        this.feedbacks.push(feedback);
        this.lowpasses.push(lowpass);
      });
      const allpasses = [225, 556, 441, 341].map((f) => new Tone.Filter({ type: 'allpass', frequency: f }));
      this.sum.chain(...allpasses, this.mix.b);
      this.roomSize = 0.8;
      this.dampening = 3000;
    }
    set roomSize(v) { this._room = v; this.feedbacks.forEach((g) => { g.gain.value = 0.7 + v * 0.28; }); }
    get roomSize() { return this._room; }
    set dampening(v) { this._damp = v; this.lowpasses.forEach((f) => { f.frequency.value = v; }); }
    get dampening() { return this._damp; }
  }

  class JCReverb extends CustomEffect {
    constructor() {
      super();
      const allpasses = [347, 113, 37].map((f) => new Tone.Filter({ type: 'allpass', frequency: f }));
      this.input.chain(...allpasses);
      this.sum = new Tone.Gain(0.12);
      this.feedbacks = [];
      [1687, 1601, 2053, 2251].forEach((samples) => {
        const delay = new Tone.Delay(samples / 25000, 0.2);
        const feedback = new Tone.Gain(0.7);
        allpasses[2].connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(this.sum);
        this.feedbacks.push(feedback);
      });
      this.sum.connect(this.mix.b);
      this.roomSize = 0.5;
    }
    set roomSize(v) { this._room = v; this.feedbacks.forEach((g) => { g.gain.value = 0.5 + v * 0.42; }); }
    get roomSize() { return this._room; }
  }

  // --- Effect list: how to make each one and which knobs it has ---
  const rate = (def, min = 0.05, max = 10) => ({ key: 'frequency', label: 'RATE', min, max, curve: 'exp', def, format: (v) => v.toFixed(2) + ' Hz' });
  const depth = (def) => ({ key: 'depth', label: 'DEPTH', min: 0, max: 1, def, format: pct });
  const time = (def) => ({ key: 'delayTime', label: 'TIME', min: 0.03, max: 1, curve: 'exp', def, format: ms });
  const feedback = (def) => ({ key: 'feedback', label: 'FDBK', min: 0, max: 0.9, def, format: pct });
  const signed = (unit) => (v) => (v > 0 ? '+' : '') + v + unit;

  const EFFECTS = [
    { id: 'pitch', name: 'Pitch Shift', make: () => new Tone.PitchShifter({ pitch: 7, windowSize: 0.1 }),
      params: [{ key: 'pitch', label: 'PITCH', min: -12, max: 12, step: 1, def: 7, format: signed(' st') }] },
    { id: 'freqshift', name: 'Freq Shifter', make: () => new Tone.FrequencyShifter(40),
      params: [{ key: 'frequency', label: 'SHIFT', min: -400, max: 400, step: 1, def: 40, format: signed(' Hz') }] },
    { id: 'dist', name: 'Distortion', make: () => new Tone.Distortion({ distortion: 0.4, oversample: '2x' }),
      params: [{ key: 'distortion', label: 'DRIVE', min: 0, max: 1, def: 0.4, format: pct }] },
    { id: 'cheby', name: 'Chebyshev', make: () => new Tone.Chebyshev(20),
      params: [{ key: 'order', label: 'ORDER', min: 1, max: 60, step: 1, def: 20, format: String }] },
    { id: 'crush', name: 'Bit Crusher', make: () => new BitCrusher(4),
      params: [{ key: 'bits', label: 'BITS', min: 1, max: 12, step: 1, def: 4, format: (v) => v + ' bit' }] },
    { id: 'wah', name: 'Auto Wah', make: () => new Tone.AutoWah({ baseFrequency: 100, octaves: 6, sensitivity: -20, Q: 4 }),
      params: [
        { key: 'baseFrequency', label: 'BASE', min: 50, max: 800, curve: 'exp', def: 100, format: hz },
        { key: 'sensitivity', label: 'SENS', min: -40, max: 0, def: -20, format: (v) => Math.round(v) + ' dB' },
      ] },
    { id: 'autofilter', name: 'Auto Filter', make: () => new Tone.AutoFilter({ frequency: 2, depth: 0.8, baseFrequency: 200, octaves: 3 }).start(),
      params: [rate(2), depth(0.8)] },
    { id: 'phaser', name: 'Phaser', make: () => new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350 }),
      params: [rate(0.5), { key: 'octaves', label: 'RANGE', min: 1, max: 6, step: 1, def: 3, format: (v) => v + ' oct' }] },
    { id: 'chorus', name: 'Chorus', make: () => new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, spread: 180 }).start(),
      params: [rate(1.5), depth(0.7)] },
    { id: 'vibrato', name: 'Vibrato', make: () => new Tone.Vibrato({ frequency: 5, depth: 0.1 }),
      params: [rate(5, 0.1, 20), depth(0.1)] },
    { id: 'tremolo', name: 'Tremolo', make: () => new Tone.Tremolo({ frequency: 6, depth: 0.7, spread: 0 }).start(),
      params: [rate(6, 0.1, 20), depth(0.7)] },
    { id: 'panner', name: 'Auto Panner', make: () => new Tone.AutoPanner({ frequency: 1, depth: 1 }).start(),
      params: [rate(1), depth(1)] },
    { id: 'widener', name: 'Stereo Widener', make: () => new Tone.StereoWidener(0.7),
      params: [{ key: 'width', label: 'WIDTH', min: 0, max: 1, def: 0.7, format: pct }] },
    { id: 'delay', name: 'Feedback Delay', make: () => new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.35 }),
      params: [time(0.25), feedback(0.35)] },
    { id: 'pingpong', name: 'Ping Pong', make: () => new Tone.PingPongDelay({ delayTime: 0.25, feedback: 0.4 }),
      params: [time(0.25), feedback(0.4)] },
    { id: 'freeverb', name: 'Freeverb', make: () => new Freeverb(),
      params: [
        { key: 'roomSize', label: 'ROOM', min: 0, max: 0.97, def: 0.8, format: pct },
        { key: 'dampening', label: 'DAMP', min: 500, max: 10000, curve: 'exp', def: 3000, format: hz },
      ] },
    { id: 'jcreverb', name: 'JC Reverb', make: () => new JCReverb(),
      params: [{ key: 'roomSize', label: 'ROOM', min: 0, max: 1, def: 0.5, format: pct }] },
  ];
  const MIX_PARAM = { key: 'wet', label: 'MIX', min: 0, max: 1, def: 0.5, format: pct };

  const defaultValues = (fx) => {
    const values = { wet: 0.5 };
    fx.params.forEach((p) => { values[p.key] = p.def; });
    return values;
  };

  function setParam(node, key, value) {
    if (key === 'wet') { node.wet.value = value; return; }
    const target = node[key];
    if (target && typeof target === 'object' && 'value' in target) target.value = value;
    else node[key] = value;
  }

  function applyEffectValues(slot) {
    if (!slot.node) return;
    for (const key in slot.values) {
      try { setParam(slot.node, key, slot.values[key]); } catch (err) { console.warn(slot.fx.id, key, err); }
    }
  }

  // Effect nodes are created on first use
  function effectNode(slot) {
    if (!slot.node) {
      slot.node = slot.fx.make();
      applyEffectValues(slot);
    }
    return slot.node;
  }
  const nodeInput = (node) => (node.isCustom ? node.input : node);
  const nodeOutput = (node) => (node.isCustom ? node.output : node);

  // --- Voices ---
  const WAVES = [['SINE', 'sine'], ['TRIANGLE', 'triangle'], ['SAW', 'sawtooth'], ['SQUARE', 'square'], ['FAT SAW', 'fatsawtooth'], ['FAT SQR', 'fatsquare']];
  const WAVE_TYPES = {
    osc: WAVES.map(([label, type]) => ({ label, set: { oscillator: { type } } })),
    duo: WAVES.map(([label, type]) => ({ label, set: { voice0: { oscillator: { type } }, voice1: { oscillator: { type } } } })),
    metal: [
      { label: 'BRIGHT', set: { harmonicity: 5.1, modulationIndex: 32, resonance: 4000 } },
      { label: 'DARK', set: { harmonicity: 5.1, modulationIndex: 16, resonance: 900 } },
      { label: 'GONG', set: { harmonicity: 3.1, modulationIndex: 12, resonance: 1800 } },
    ],
    noise: ['white', 'pink', 'brown'].map((type) => ({ label: type.toUpperCase(), set: { noise: { type } } })),
  };

  const VOICES = {
    PIANO: { cls: 'Synth', family: 'osc', volume: -8, defaultType: 'TRIANGLE',
      base: { oscillator: { type: 'triangle' }, envelope: { attack: 0.004, decay: 1.4, sustain: 0.1, release: 1.2 } } },
    SYNTH: { cls: 'Synth', family: 'osc', volume: -10, defaultType: 'TRIANGLE',
      base: { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.8 } } },
    AM: { cls: 'AMSynth', family: 'osc', volume: -8, defaultType: 'SINE',
      base: { harmonicity: 2, envelope: { attack: 0.02, decay: 0.4, sustain: 0.6, release: 1.2 } } },
    FM: { cls: 'FMSynth', family: 'osc', volume: -10, defaultType: 'SINE',
      base: { harmonicity: 3, modulationIndex: 10, envelope: { attack: 0.01, decay: 0.6, sustain: 0.4, release: 1.2 } } },
    DUO: { cls: 'DuoSynth', family: 'duo', volume: -14, defaultType: 'SAW',
      base: { vibratoAmount: 0.3, vibratoRate: 5, harmonicity: 1.5,
        voice0: { envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.6 } },
        voice1: { envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.6 } } } },
    MONO: { cls: 'MonoSynth', family: 'osc', volume: -12, defaultType: 'SAW',
      base: { oscillator: { type: 'sawtooth' }, filter: { Q: 6, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.004, decay: 0.25, sustain: 0.5, release: 0.4 },
        filterEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.2, release: 0.5, baseFrequency: 120, octaves: 4.5 } } },
    PLUCK: { cls: 'MonoSynth', family: 'osc', volume: -10, defaultType: 'SQUARE',
      base: { oscillator: { type: 'square' }, filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.25 },
        filterEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.2, baseFrequency: 300, octaves: 4 } } },
    MEMBRANE: { cls: 'MembraneSynth', family: 'osc', volume: -6, defaultType: 'SINE',
      base: { pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.8 } } },
    METAL: { cls: 'MetalSynth', family: 'metal', volume: -24, defaultType: 'BRIGHT',
      base: { harmonicity: 5.1, modulationIndex: 24, resonance: 3000, octaves: 1.5, envelope: { attack: 0.001, decay: 0.8, release: 0.4 } } },
    NOISE: { custom: true, family: 'noise', defaultType: 'PINK' },
  };
  const VOICE_ORDER = Object.keys(VOICES);

  // Every voice has the same small interface: attack, release, attackRelease, releaseAll, set, setPoly, dispose
  function makePolyVoice(spec, options, polyphony) {
    const synth = new Tone.PolySynth(Tone[spec.cls], options);
    synth.maxPolyphony = polyphony;
    synth.volume.value = spec.volume;
    return {
      output: synth,
      attack: (n, velocity, t) => synth.triggerAttack(freq(n), t, velocity),
      release: (n, t) => synth.triggerRelease(freq(n), t),
      attackRelease: (n, duration, t, velocity) => synth.triggerAttackRelease(freq(n), duration, t, velocity),
      releaseAll: () => synth.releaseAll(),
      set: (o) => synth.set(o),
      setPoly: (p) => { synth.maxPolyphony = p; },
      dispose: () => synth.dispose(),
    };
  }

  // Noise through a resonant band-pass that follows the last held note
  function makeNoiseVoice() {
    const noise = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.25, decay: 0.2, sustain: 0.8, release: 1.4 } });
    const filter = new Tone.Filter({ type: 'bandpass', frequency: 440, Q: 14 });
    const output = new Tone.Gain(3.5);
    noise.connect(filter);
    filter.connect(output);
    let held = [];
    return {
      output,
      attack: (n, velocity, t) => {
        held.push(n);
        filter.frequency.setValueAtTime(freq(n), t);
        if (held.length === 1) noise.triggerAttack(t, velocity);
      },
      release: (n, t) => {
        held = held.filter((x) => x !== n);
        if (!held.length) noise.triggerRelease(t);
        else filter.frequency.setValueAtTime(freq(held[held.length - 1]), t);
      },
      attackRelease: (n, duration, t, velocity) => {
        filter.frequency.setValueAtTime(freq(n), t);
        noise.triggerAttackRelease(duration, t, velocity);
      },
      releaseAll: () => { held = []; noise.triggerRelease(); },
      set: (o) => noise.set(o),
      setPoly: () => {},
      dispose: () => { noise.dispose(); filter.dispose(); output.dispose(); },
    };
  }

  // --- One complete synth: voice → tone → FX rack → EQ → air → reverb → level → master ---
  class Engine {
    constructor(id) {
      this.id = id;
      this.name = 'AB'[id];
      this.preset = -1;
      this.presetName = '';
      this.voiceName = 'SYNTH';
      this.voiceOptions = {};
      this.typeIndex = 0;
      this.polyphony = 16;
      this.selectedFx = 'chorus';
      this.params = { volume: 0.72, low: 0, mid: 0, high: 0, air: 0, reverb: 0.3, tone: 9000 };
      this.voice = null;

      this.voiceBus = new Tone.Gain(1);
      this.toneFilter = new Tone.Filter({ type: 'lowpass', frequency: 12000, rolloff: -12, Q: 0.7 });
      this.chainIn = new Tone.Gain(1);
      this.chainOut = new Tone.Gain(1);
      this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 250, highFrequency: 3000 });
      this.air = new Tone.Filter({ type: 'highshelf', frequency: 9000, gain: 0 });
      this.reverb = new Tone.Reverb({ decay: 3.5, preDelay: 0.02 });
      this.reverb.wet.value = 0.3;
      this.level = new Tone.Gain(0.72);

      this.voiceBus.connect(this.toneFilter);
      this.toneFilter.connect(this.chainIn);
      this.chainOut.chain(this.eq, this.air, this.reverb, this.level, master);

      this.effects = {};
      EFFECTS.forEach((fx) => { this.effects[fx.id] = { fx, on: false, node: null, values: defaultValues(fx) }; });
      this.rewire();
    }

    apply(key, value) {
      this.params[key] = value;
      switch (key) {
        case 'volume': this.level.gain.rampTo(value * value * 1.4, 0.05); break;
        case 'low': case 'mid': case 'high': this.eq[key].rampTo(value, 0.05); break;
        case 'air': this.air.gain.rampTo(value, 0.05); break;
        case 'reverb': this.reverb.wet.rampTo(value, 0.05); break;
        case 'tone': this.toneFilter.frequency.rampTo(value, 0.05); break;
      }
    }

    // Connect the switched-on effects in rack order
    rewire() {
      this.chainIn.disconnect();
      EFFECTS.forEach((fx) => {
        const slot = this.effects[fx.id];
        if (slot.node) nodeOutput(slot.node).disconnect();
      });
      let previous = this.chainIn;
      EFFECTS.forEach((fx) => {
        const slot = this.effects[fx.id];
        if (!slot.on) return;
        const node = effectNode(slot);
        previous.connect(nodeInput(node));
        previous = nodeOutput(node);
      });
      previous.connect(this.chainOut);
    }

    buildVoice(name, options = {}) {
      if (this.voice) {
        const old = this.voice;
        try { old.releaseAll(); } catch (err) { /* already silent */ }
        setTimeout(() => { try { old.output.disconnect(); old.dispose(); } catch (err) { /* gone */ } }, 80);
      }
      const spec = VOICES[name];
      try {
        this.voice = spec.custom ? makeNoiseVoice() : makePolyVoice(spec, deepMerge(clone(spec.base), options), this.polyphony);
        this.voiceName = name;
      } catch (err) {
        console.error(err);
        this.voice = makePolyVoice(VOICES.SYNTH, clone(VOICES.SYNTH.base), this.polyphony);
        this.voiceName = 'SYNTH';
        flash('VOICE ERROR');
      }
      this.voiceOptions = options;
      this.voice.output.connect(this.voiceBus);
    }

    waveTypes() { return WAVE_TYPES[VOICES[this.voiceName].family]; }

    applyWaveType() {
      const list = this.waveTypes();
      this.typeIndex = ((this.typeIndex % list.length) + list.length) % list.length;
      try { this.voice.set(list[this.typeIndex].set); } catch (err) { console.warn(err); }
    }

    waveLabel() { return this.waveTypes()[this.typeIndex].label; }

    loadPreset(preset, index) {
      this.preset = index;
      this.presetName = preset.name;
      this.buildVoice(preset.voice, preset.options || {});
      this.typeIndex = Math.max(0, this.waveTypes().findIndex((t) => t.label === preset.type));
      this.applyWaveType();
      this.apply('tone', preset.tone);
      this.apply('reverb', preset.reverb);
      ['low', 'mid', 'high', 'air'].forEach((band, i) => this.apply(band, preset.eq[i]));

      for (const id in this.effects) {
        const slot = this.effects[id];
        slot.on = false;
        slot.values = defaultValues(slot.fx);
      }
      for (const id in preset.fx) {
        const slot = this.effects[id];
        if (!slot) continue;
        slot.on = true;
        Object.assign(slot.values, preset.fx[id]);
      }
      for (const id in this.effects) applyEffectValues(this.effects[id]);
      this.rewire();

      const first = Object.keys(preset.fx)[0];
      if (first) this.selectedFx = first;
    }

    copyFrom(other) {
      this.preset = other.preset;
      this.presetName = other.presetName;
      this.polyphony = other.polyphony;
      this.selectedFx = other.selectedFx;
      this.buildVoice(other.voiceName, clone(other.voiceOptions));
      this.typeIndex = other.typeIndex;
      this.applyWaveType();
      for (const key in other.params) this.apply(key, other.params[key]);
      for (const id in this.effects) {
        const slot = this.effects[id], source = other.effects[id];
        slot.on = source.on;
        slot.values = clone(source.values);
        applyEffectValues(slot);
      }
      this.rewire();
    }

    allNotesOff() {
      try { if (this.voice) this.voice.releaseAll(); } catch (err) { /* silent */ }
    }
  }

  // --- Presets ---
  const INIT_PATCH = { name: 'INIT PATCH', voice: 'SYNTH', type: 'TRIANGLE', tone: 20000, reverb: 0.15, eq: [0, 0, 0, 0], fx: {} };

  const PRESETS = [
    { name: 'SOFT KEYS', voice: 'PIANO', type: 'TRIANGLE', tone: 9000, reverb: 0.3, eq: [1, 0, 1.5, 2],
      fx: { chorus: { wet: 0.25, frequency: 0.8, depth: 0.4 } } },
    { name: 'WARM PAD', voice: 'SYNTH', type: 'FAT SAW', tone: 2200, reverb: 0.55, eq: [2, 0, -2, 0],
      options: { envelope: { attack: 0.8, decay: 0.6, sustain: 0.85, release: 3 } },
      fx: { chorus: { wet: 0.5 }, phaser: { wet: 0.2, frequency: 0.2 } } },
    { name: 'GLASS BELL', voice: 'FM', type: 'SINE', tone: 16000, reverb: 0.45, eq: [-2, 0, 2, 4],
      options: { harmonicity: 3.01, modulationIndex: 14,
        envelope: { attack: 0.001, decay: 2.4, sustain: 0, release: 2.4 },
        modulationEnvelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1 } },
      fx: { pingpong: { wet: 0.3, delayTime: 0.375, feedback: 0.35 } } },
    { name: 'ACID BASS', voice: 'MONO', type: 'SAW', tone: 8000, reverb: 0.05, eq: [3, 1, 0, 0],
      fx: { dist: { wet: 0.5, distortion: 0.55 }, delay: { wet: 0.15, delayTime: 0.1875, feedback: 0.25 } } },
    { name: 'AM DREAM', voice: 'AM', type: 'TRIANGLE', tone: 6000, reverb: 0.5, eq: [0, 1, 0, 2],
      options: { harmonicity: 1.5, envelope: { attack: 0.2, decay: 0.5, sustain: 0.7, release: 2 } },
      fx: { tremolo: { wet: 0.6, frequency: 4, depth: 0.6 }, panner: { wet: 0.5, frequency: 0.3 } } },
    { name: 'DUO LEAD', voice: 'DUO', type: 'SAW', tone: 7000, reverb: 0.25, eq: [0, 2, 1, 0],
      fx: { vibrato: { wet: 0.4, frequency: 5.5, depth: 0.08 }, delay: { wet: 0.25, delayTime: 0.25, feedback: 0.3 } } },
    { name: 'PLUCKY', voice: 'PLUCK', type: 'SQUARE', tone: 9000, reverb: 0.3, eq: [0, 0, 2, 2],
      fx: { pingpong: { wet: 0.35, delayTime: 0.1875, feedback: 0.4 }, widener: { wet: 1, width: 0.75 } } },
    { name: '808 DRUMS', voice: 'MEMBRANE', type: 'SINE', tone: 12000, reverb: 0.15, eq: [4, 0, 0, 0],
      fx: { dist: { wet: 0.2, distortion: 0.3 } } },
    { name: 'METAL CLANG', voice: 'METAL', type: 'GONG', tone: 12000, reverb: 0.5, eq: [0, 0, 0, 0],
      fx: { freqshift: { wet: 0.3, frequency: -30 }, jcreverb: { wet: 0.3, roomSize: 0.6 } } },
    { name: 'LO-FI TAPE', voice: 'PIANO', type: 'TRIANGLE', tone: 3500, reverb: 0.2, eq: [2, -1, -3, -6],
      options: { envelope: { attack: 0.01, decay: 1.5, sustain: 0.2, release: 1.5 } },
      fx: { crush: { wet: 0.6, bits: 5 }, autofilter: { wet: 0.3, frequency: 0.25, depth: 0.4 }, vibrato: { wet: 0.6, frequency: 1.2, depth: 0.15 } } },
    { name: 'SPACE ECHO', voice: 'FM', type: 'TRIANGLE', tone: 7000, reverb: 0.3, eq: [0, 0, 0, 3],
      options: { harmonicity: 2, modulationIndex: 4, envelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 3 } },
      fx: { phaser: { wet: 0.4, frequency: 0.3, octaves: 4 }, pingpong: { wet: 0.4, delayTime: 0.375, feedback: 0.6 }, freeverb: { wet: 0.4, roomSize: 0.9, dampening: 4000 } } },
    { name: 'WOBBLE', voice: 'MONO', type: 'FAT SAW', tone: 10000, reverb: 0.1, eq: [4, 0, 0, 0],
      options: { envelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5 }, filterEnvelope: { baseFrequency: 400, octaves: 2, sustain: 0.6 } },
      fx: { wah: { wet: 0.3 }, autofilter: { wet: 1, frequency: 4, depth: 0.9 } } },
    { name: 'WIND CHOIR', voice: 'NOISE', type: 'PINK', tone: 8000, reverb: 0.6, eq: [0, 2, 0, 2],
      fx: { panner: { wet: 0.8, frequency: 0.15 }, jcreverb: { wet: 0.4, roomSize: 0.8 } } },
    { name: 'ROBOT', voice: 'SYNTH', type: 'SQUARE', tone: 9000, reverb: 0.15, eq: [0, 3, 0, 0],
      options: { envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 } },
      fx: { pitch: { wet: 0.5, pitch: -12 }, cheby: { wet: 0.4, order: 30 }, widener: { wet: 1, width: 0.6 } } },
  ];

  const engines = [new Engine(0), new Engine(1)];
  const currentEngine = () => engines[state.edit];
  const allNotesOff = () => engines.forEach((e) => e.allNotesOff());

  /* ==================== 4. Panel ==================== */

  const win = $('#win');
  const withName = (text) => currentEngine().name + ' ' + text;

  // --- Volume, EQ, Reverb, Tone and BPM ---
  const controls = {};

  controls.volume = new Control($('#volFader'), {
    kind: 'hfader', value: 0.72, label: 'Volume', format: pct,
    onInput: (v, byUser) => {
      currentEngine().apply('volume', v);
      if (byUser) flash(withName('VOLUME ' + pct(v)));
    },
  });

  [['low', '#eqLow'], ['mid', '#eqMid'], ['high', '#eqHigh'], ['air', '#eqAir']].forEach(([band, selector]) => {
    const el = $(selector);
    buildVFader(el);
    controls[band] = new Control(el, {
      kind: 'vfader', min: -12, max: 12, value: 0, label: band.toUpperCase() + ' EQ', format: db,
      onInput: (v, byUser) => {
        currentEngine().apply(band, v);
        if (byUser) flash(withName(band.toUpperCase() + ' ' + db(v)));
      },
    });
  });

  buildKnob($('#knReverb'));
  controls.reverb = new Control($('#knReverb'), {
    min: 0, max: 1, value: 0.3, label: 'Reverb', format: pct,
    onInput: (v, byUser) => {
      currentEngine().apply('reverb', v);
      if (byUser) flash(withName('REVERB ' + pct(v)));
    },
  });

  buildKnob($('#knTone'));
  controls.tone = new Control($('#knTone'), {
    min: 200, max: 20000, curve: 'exp', value: 9000, label: 'Tone', format: hz,
    onInput: (v, byUser) => {
      currentEngine().apply('tone', v);
      if (byUser) flash(withName('TONE ' + hz(v)));
    },
  });

  controls.bpm = new Control($('#bpm'), {
    kind: 'value', min: 40, max: 240, step: 1, value: 120, label: 'Tempo', format: (v) => v + ' BPM',
    renderValue: (v) => { $('#bpm').textContent = v; },
    onInput: (v) => { Tone.Transport.bpm.value = v; },
  });

  // --- FX rack ---
  const rackGrid = $('#rackGrid');
  EFFECTS.forEach((fx) => {
    const cell = document.createElement('div');
    cell.className = 'fx-cell';
    cell.dataset.id = fx.id;
    cell.innerHTML = `<button class="fx-cell__led" aria-label="${fx.name}: вкл/выкл" aria-pressed="false"></button>`
      + `<button class="fx-cell__name">${fx.name}</button>`;
    rackGrid.appendChild(cell);
  });

  rackGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('.fx-cell');
    if (!cell) return;
    if (e.target.closest('.fx-cell__led')) {
      toggleEffect(cell.dataset.id);
    } else {
      currentEngine().selectedFx = cell.dataset.id;
      buildEffectEditor();
      renderRack();
    }
  });

  $('#fxPower').addEventListener('click', () => toggleEffect(currentEngine().selectedFx));

  function toggleEffect(id) {
    const engine = currentEngine(), slot = engine.effects[id];
    slot.on = !slot.on;
    engine.rewire();
    engine.selectedFx = id;
    flash(withName(slot.fx.name.toUpperCase() + (slot.on ? ' ON' : ' OFF')));
    buildEffectEditor();
    renderRack();
  }

  function renderRack() {
    const engine = currentEngine();
    $$('.fx-cell', rackGrid).forEach((cell) => {
      const slot = engine.effects[cell.dataset.id];
      cell.classList.toggle('is-on', slot.on);
      cell.classList.toggle('is-selected', cell.dataset.id === engine.selectedFx);
      $('.fx-cell__led', cell).setAttribute('aria-pressed', String(slot.on));
    });
    const slot = engine.effects[engine.selectedFx];
    $('#fxPower').setAttribute('aria-pressed', String(slot.on));
    $('#fxPower').textContent = slot.on ? 'ON' : 'OFF';
  }

  // Knobs of the selected effect. Turning a knob of a switched-off effect switches it on.
  function buildEffectEditor() {
    const engine = currentEngine(), slot = engine.effects[engine.selectedFx], box = $('#fxKnobs');
    $('#fxTitle').textContent = slot.fx.name.toUpperCase();
    box.innerHTML = '';

    [MIX_PARAM, ...slot.fx.params].forEach((param) => {
      const group = document.createElement('div');
      group.className = 'knob-group';
      const knob = document.createElement('div');
      knob.className = 'knob';
      buildKnob(knob, 9, true);
      const label = document.createElement('span');
      label.className = 'knob-group__label';
      label.textContent = param.label;
      group.append(knob, label);
      box.appendChild(group);

      new Control(knob, {
        min: param.min, max: param.max, step: param.step || 0, curve: param.curve || 'lin',
        value: slot.values[param.key], def: param.def, format: param.format,
        label: slot.fx.name + ' ' + param.label,
        onInput: (v, byUser) => {
          slot.values[param.key] = v;
          if (byUser && !slot.on) {
            slot.on = true;
            engine.rewire();
            renderRack();
          }
          if (slot.node) {
            try { setParam(slot.node, param.key, v); } catch (err) { console.warn(err); }
          }
          if (byUser) flash(engine.name + ' ' + slot.fx.name.toUpperCase() + ' ' + param.label + ' ' + param.format(v));
        },
      });
    });
  }

  // --- Display and synth selection ---
  function updateDisplay() {
    const engine = currentEngine();
    if (!lcdName.classList.contains('is-message')) lcdName.textContent = engine.presetName;
    $('#polyBtn').textContent = engine.voiceName === 'NOISE' ? '1' : engine.polyphony;
    $('#voiceBtn').textContent = engine.voiceName;
    $('#typeBtn').textContent = engine.waveLabel();
    $('#keyVal').textContent = NOTE_NAMES[state.key];
    $('#chVal').textContent = state.channel === 0 ? 'ALL' : state.channel;
    $('#engA').setAttribute('aria-pressed', String(state.edit === 0));
    $('#engB').setAttribute('aria-pressed', String(state.edit === 1));
    $$('.tag').forEach((tag) => { tag.textContent = engine.name; });
    win.classList.toggle('edit-b', state.edit === 1);
    keyboards.forEach((kb) => kb.renderHead());
  }

  // Move the panel controls to the values of the selected synth
  function syncControls() {
    const engine = currentEngine();
    ['volume', 'low', 'mid', 'high', 'air', 'reverb', 'tone'].forEach((key) => controls[key].set(engine.params[key]));
    buildEffectEditor();
    renderRack();
  }

  function loadPreset(preset, index) {
    currentEngine().loadPreset(preset, index);
    syncControls();
    lcdName.classList.remove('is-message');
    clearTimeout(flashTimer);
    updateDisplay();
    refreshMenuChecks();
  }

  function stepPreset(direction) {
    const engine = currentEngine();
    const index = engine.preset < 0 ? 0 : (engine.preset + direction + PRESETS.length) % PRESETS.length;
    loadPreset(PRESETS[index], index);
  }

  function selectEngine(id) {
    if (state.edit !== id) {
      state.edit = id;
      syncControls();
      updateDisplay();
      refreshMenuChecks();
    }
    flash('EDIT SYNTH ' + currentEngine().name);
  }

  function copyEngine() {
    const source = currentEngine(), target = engines[1 - state.edit];
    target.copyFrom(source);
    updateDisplay();
    flash('COPIED ' + source.name + ' TO ' + target.name);
  }

  $('#engA').addEventListener('click', () => selectEngine(0));
  $('#engB').addEventListener('click', () => selectEngine(1));
  $('#prevPreset').addEventListener('click', () => stepPreset(-1));
  $('#nextPreset').addEventListener('click', () => stepPreset(1));
  lcdName.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu($('#presetMenu').parentElement);
  });

  $('#voiceBtn').addEventListener('click', () => {
    const engine = currentEngine();
    const next = VOICE_ORDER[(VOICE_ORDER.indexOf(engine.voiceName) + 1) % VOICE_ORDER.length];
    engine.buildVoice(next);
    engine.typeIndex = Math.max(0, engine.waveTypes().findIndex((t) => t.label === VOICES[next].defaultType));
    engine.applyWaveType();
    updateDisplay();
    flash(withName('VOICE ' + next));
  });

  $('#typeBtn').addEventListener('click', () => {
    const engine = currentEngine();
    engine.typeIndex++;
    engine.applyWaveType();
    updateDisplay();
    flash(withName('TYPE ' + engine.waveLabel()));
  });

  $('#polyBtn').addEventListener('click', () => {
    const engine = currentEngine(), options = [4, 8, 16, 32];
    engine.polyphony = options[(options.indexOf(engine.polyphony) + 1) % options.length];
    engine.voice.setPoly(engine.polyphony);
    updateDisplay();
    flash(withName('POLY ' + engine.polyphony));
  });

  $('#keyBtn').addEventListener('click', () => {
    state.key = (state.key + 1) % 12;
    updateDisplay();
    flash('LOOP KEY ' + NOTE_NAMES[state.key]);
  });

  $('#chBtn').addEventListener('click', () => {
    state.channel = (state.channel + 1) % 17;
    updateDisplay();
    flash(state.channel ? 'MIDI CH ' + state.channel : 'MIDI CH ALL');
  });

  /* ==================== 5. Keyboards ==================== */

  // Computer keys: the Q row plays keyboard A, the Z row plays keyboard B (layout-independent codes)
  const Q_ROW = { KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11,
    KeyI: 12, Digit9: 13, KeyO: 14, Digit0: 15, KeyP: 16, BracketLeft: 17, Equal: 18, BracketRight: 19 };
  const Z_ROW = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16 };
  const KEY_SYMBOLS = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
  const keyCaption = (code) => KEY_SYMBOLS[code] || code.replace('Key', '').replace('Digit', '');

  const RANGE = 36; // three octaves
  const BLACK_KEY_NUDGE = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

  function startAudio() {
    if (Tone.context.state !== 'running') Tone.start();
  }

  // Lower on the key = louder
  const velocityAt = (e, key) => {
    const r = key.getBoundingClientRect();
    return Math.min(1, 0.4 + 0.6 * (e.clientY - r.top) / r.height);
  };

  class Keyboard {
    constructor(wrap, engine, octave, row) {
      this.wrap = wrap;
      this.keys = $('.keys', wrap);
      this.engine = engine;
      this.octave = octave;
      this.row = row;
      this.held = new Map();      // midi note → how many sources hold it
      this.pointers = new Map();  // pointer id → midi note

      $('.kb__select', wrap).addEventListener('click', () => selectEngine(engine.id));
      $$('.kb__oct', wrap).forEach((btn) => btn.addEventListener('click', () => this.shiftOctave(+btn.dataset.d)));

      this.keys.addEventListener('pointerdown', (e) => {
        const key = e.target.closest('.key');
        if (!key) return;
        e.preventDefault();
        this.keys.setPointerCapture(e.pointerId);
        const note = +key.dataset.note;
        this.pointers.set(e.pointerId, note);
        this.noteOn(note, velocityAt(e, key));
      });

      // Sliding across keys plays them one after another
      this.keys.addEventListener('pointermove', (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const key = hit && hit.closest('.key');
        const note = key && this.keys.contains(key) ? +key.dataset.note : null;
        const was = this.pointers.get(e.pointerId);
        if (note === was) return;
        if (was != null) this.noteOff(was);
        if (note != null) this.noteOn(note, velocityAt(e, key));
        this.pointers.set(e.pointerId, note);
      });

      const end = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        const note = this.pointers.get(e.pointerId);
        if (note != null) this.noteOff(note);
        this.pointers.delete(e.pointerId);
      };
      this.keys.addEventListener('pointerup', end);
      this.keys.addEventListener('pointercancel', end);
    }

    lowest() { return 12 * (this.octave + 1); }

    build() {
      const from = this.lowest(), to = from + RANGE;
      const whites = [];
      for (let m = from; m <= to; m++) if (!isBlack(m)) whites.push(m);
      const whiteWidth = 100 / whites.length, blackWidth = whiteWidth * 0.6;

      this.keys.innerHTML = '';
      for (let m = from; m <= to; m++) {
        const key = document.createElement('div');
        key.dataset.note = m;
        key.innerHTML = '<span class="key__label"></span>';
        if (isBlack(m)) {
          const i = whites.indexOf(m - 1);
          key.className = 'key key--black';
          key.style.left = ((i + 1) * whiteWidth - blackWidth / 2 + BLACK_KEY_NUDGE[m % 12] * whiteWidth) + '%';
          key.style.width = blackWidth + '%';
        } else {
          key.className = 'key key--white';
          key.style.left = (whites.indexOf(m) * whiteWidth) + '%';
          key.style.width = whiteWidth + '%';
        }
        this.keys.appendChild(key);
      }
      for (const code in this.row) {
        const key = this.keyEl(from + this.row[code]);
        if (key) $('.key__label', key).textContent = keyCaption(code);
      }
      this.renderHead();
    }

    renderHead() {
      const from = this.lowest();
      $('.kb__preset', this.wrap).textContent = this.engine.presetName;
      $('.kb__range', this.wrap).textContent = noteName(from) + '–' + noteName(from + RANGE);
      this.wrap.classList.toggle('is-selected', state.edit === this.engine.id);
    }

    keyEl(note) { return $(`.key[data-note="${note}"]`, this.keys); }

    shiftOctave(direction) {
      const octave = Math.min(6, Math.max(0, this.octave + direction));
      if (octave === this.octave) return;
      this.releaseAll();
      this.octave = octave;
      this.build();
      flash(this.engine.name + ' OCTAVE ' + noteName(this.lowest()));
    }

    noteOn(note, velocity = 0.8) {
      if (!state.power) return;
      startAudio();
      const count = this.held.get(note) || 0;
      this.held.set(note, count + 1);
      if (count) return;
      try { this.engine.voice.attack(note, velocity, Tone.immediate()); } catch (err) { console.warn(err); }
      const key = this.keyEl(note);
      if (key) key.classList.add('is-down');
    }

    noteOff(note) {
      const count = this.held.get(note) || 0;
      if (!count) return;
      if (count > 1) { this.held.set(note, count - 1); return; }
      this.held.delete(note);
      try { this.engine.voice.release(note, Tone.immediate()); } catch (err) { /* already released */ }
      const key = this.keyEl(note);
      if (key) key.classList.remove('is-down');
    }

    releaseAll() {
      [...this.held.keys()].forEach((note) => { this.held.set(note, 1); this.noteOff(note); });
      this.pointers.clear();
    }

    // Light a key while the loop or a MIDI file plays it
    flashKey(note, duration = 160) {
      const key = this.keyEl(note);
      if (!key) return;
      key.classList.add('is-flash');
      clearTimeout(key.flashTimer);
      key.flashTimer = setTimeout(() => key.classList.remove('is-flash'), duration);
    }
  }

  const keyboards = [
    new Keyboard($('#kbA'), engines[0], 4, Q_ROW),
    new Keyboard($('#kbB'), engines[1], 2, Z_ROW),
  ];
  const keyboardOf = (engine) => keyboards[engine.id];
  const shiftOctave = (direction) => keyboardOf(currentEngine()).shiftOctave(direction);

  // --- Computer keyboard ---
  const pressedCodes = new Map(); // key code → { keyboard, note }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeMenus(); return; }
    if (dialog.open) return;

    const onSlider = e.target instanceof Element && e.target.closest('[role="slider"]');
    if (!onSlider && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      shiftOctave(e.code === 'ArrowLeft' ? -1 : 1);
      return;
    }

    const keyboard = e.code in Q_ROW ? keyboards[0] : e.code in Z_ROW ? keyboards[1] : null;
    if (!keyboard) return;
    e.preventDefault();
    if (e.repeat || pressedCodes.has(e.code)) return;
    const note = keyboard.lowest() + keyboard.row[e.code];
    pressedCodes.set(e.code, { keyboard, note });
    keyboard.noteOn(note, 0.8);
  });

  window.addEventListener('keyup', (e) => {
    const pressed = pressedCodes.get(e.code);
    if (!pressed) return;
    pressedCodes.delete(e.code);
    pressed.keyboard.noteOff(pressed.note);
  });

  window.addEventListener('blur', () => {
    pressedCodes.forEach((p) => p.keyboard.noteOff(p.note));
    pressedCodes.clear();
  });

  /* ==================== 6. MIDI ==================== */

  // --- MIDI keyboard: plays the selected synth ---
  function connectMidi() {
    if (!navigator.requestMIDIAccess) { flash('NO MIDI SUPPORT'); return; }
    navigator.requestMIDIAccess()
      .then((access) => {
        const bind = () => access.inputs.forEach((input) => { input.onmidimessage = onMidiMessage; });
        bind();
        access.onstatechange = bind;
        flash(access.inputs.size ? 'MIDI READY' : 'NO MIDI DEVICE');
      })
      .catch(() => flash('MIDI BLOCKED'));
  }

  function onMidiMessage(e) {
    const [status, note, velocity] = e.data;
    const command = status & 0xf0, channel = (status & 0x0f) + 1;
    if (state.channel !== 0 && channel !== state.channel) return;
    const keyboard = keyboardOf(currentEngine());
    if (command === 0x90 && velocity > 0) keyboard.noteOn(note, velocity / 127);
    else if (command === 0x80 || (command === 0x90 && velocity === 0)) keyboard.noteOff(note);
  }

  // --- MIDI files: a small Standard MIDI File reader ---
  function parseMidi(buffer) {
    const view = new DataView(buffer);
    let p = 0;
    const u8 = () => view.getUint8(p++);
    const u16 = () => { const v = view.getUint16(p); p += 2; return v; };
    const u32 = () => { const v = view.getUint32(p); p += 4; return v; };
    const tag = () => { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(u8()); return s; };
    const varLength = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    if (tag() !== 'MThd') throw new Error('not a MIDI file');
    const headerLength = u32();
    u16(); // format
    const trackCount = u16(), division = u16();
    p += headerLength - 6;
    if (division & 0x8000) throw new Error('SMPTE timing is not supported');

    const notes = [];
    let tempo = null;
    for (let track = 0; track < trackCount && p < view.byteLength; track++) {
      const id = tag(), length = u32(), end = p + length;
      if (id !== 'MTrk') { p = end; continue; }
      let tick = 0, status = 0;
      const open = {};
      while (p < end) {
        tick += varLength();
        if (view.getUint8(p) & 0x80) status = u8();
        if (status === 0xff) {                         // meta event
          const type = u8(), len = varLength();
          if (type === 0x51 && tempo === null) tempo = (view.getUint8(p) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p + 2);
          p += len;
          status = 0;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {      // sysex
          p += varLength();
          status = 0;
          continue;
        }
        const command = status & 0xf0, channel = status & 0x0f;
        const a = u8(), b = (command === 0xc0 || command === 0xd0) ? 0 : u8();
        if (channel === 9) continue;                    // skip drums
        if (command === 0x90 && b > 0) {
          (open[a] = open[a] || []).push({ tick, velocity: b });
        } else if (command === 0x80 || (command === 0x90 && b === 0)) {
          const start = open[a] && open[a].shift();
          if (start) notes.push({ midi: a, tick: start.tick, duration: Math.max(1, tick - start.tick), velocity: start.velocity / 127, track });
        }
      }
      p = end;
    }
    notes.sort((x, y) => x.tick - y.tick);
    return { notes, ppq: division, bpm: tempo ? 60000000 / tempo : 120 };
  }

  const song = { part: null, endEvent: null, name: '' };

  function unloadSong() {
    if (song.part) { song.part.dispose(); song.part = null; }
    if (song.endEvent !== null) { Tone.Transport.clear(song.endEvent); song.endEvent = null; }
    demoLoop.mute = false;
    $('#songName').textContent = 'DEMO LOOP';
    $('#songDemo').hidden = true;
  }

  // Two or more tracks: first track → A, second → B. One track: notes below C4 → B.
  async function loadSongFile(file) {
    if (!file) return;
    try {
      const data = parseMidi(await file.arrayBuffer());
      if (!data.notes.length) { flash('NO NOTES IN FILE'); return; }

      Tone.Transport.stop();
      allNotesOff();
      unloadSong();

      const scale = Tone.Transport.PPQ / data.ppq;
      const tracks = [...new Set(data.notes.map((n) => n.track))];
      const synthFor = (n) => (tracks.length > 1 ? tracks.indexOf(n.track) % 2 : (n.midi < 60 ? 1 : 0));
      const events = data.notes.map((n) => ({
        time: Math.round(n.tick * scale) + 'i',
        duration: Math.max(1, Math.round(n.duration * scale)) + 'i',
        midi: n.midi,
        velocity: n.velocity,
        synth: synthFor(n),
      }));

      song.part = new Tone.Part((t, ev) => {
        playScheduled(engines[ev.synth], ev.midi, ev.duration, t, ev.velocity);
        const lit = Math.max(120, Tone.Time(ev.duration).toSeconds() * 1000);
        Tone.Draw.schedule(() => keyboards[ev.synth].flashKey(ev.midi, lit), t);
      }, events).start(0);

      const last = data.notes[data.notes.length - 1];
      const endTick = Math.round((last.tick + last.duration) * scale) + Tone.Transport.PPQ;
      song.endEvent = Tone.Transport.schedule((t) => Tone.Draw.schedule(() => { stop(); flash('SONG END'); }, t), endTick + 'i');

      demoLoop.mute = true;
      controls.bpm.set(Math.min(240, Math.max(40, Math.round(data.bpm))));
      song.name = file.name.replace(/\.(mid|midi)$/i, '').toUpperCase();
      $('#songName').textContent = song.name;
      $('#songDemo').hidden = false;
      setTransportButtons();
      flash('SONG LOADED');
    } catch (err) {
      console.error(err);
      flash('CANNOT READ FILE');
    }
  }

  const songFile = $('#songFile');
  $('#songLoad').addEventListener('click', () => songFile.click());
  songFile.addEventListener('change', () => {
    loadSongFile(songFile.files[0]);
    songFile.value = '';
  });
  $('#songDemo').addEventListener('click', () => {
    stop();
    unloadSong();
    flash('DEMO LOOP');
  });

  // Drop a .mid file anywhere on the window
  win.addEventListener('dragover', (e) => { e.preventDefault(); win.classList.add('is-dragover'); });
  win.addEventListener('dragleave', (e) => { if (!win.contains(e.relatedTarget)) win.classList.remove('is-dragover'); });
  win.addEventListener('drop', (e) => {
    e.preventDefault();
    win.classList.remove('is-dragover');
    loadSongFile(e.dataTransfer.files[0]);
  });

  /* ==================== 7. Transport ==================== */

  function playScheduled(engine, note, duration, time, velocity) {
    try { engine.voice.attackRelease(note, duration, time, velocity); } catch (err) { /* voice is being swapped */ }
  }

  // Demo loop: arpeggio on synth A, bass on synth B
  const CHORDS = [[0, 4, 7, 12], [9, 12, 16, 21], [5, 9, 12, 17], [7, 11, 14, 19]];
  const ARPEGGIO = [0, 1, 2, 3, 2, 1, 2, 3];

  const demoLoop = new Tone.Sequence((t, step) => {
    const chord = CHORDS[Math.floor(step / 8) % 4];
    const root = 60 + state.key;
    const note = root + chord[ARPEGGIO[step % 8]];
    const bass = root - 12 + chord[0];
    const onBeat = step % 8 === 0;
    playScheduled(engines[0], note, '8n', t, 0.7);
    if (onBeat) playScheduled(engines[1], bass, '2n', t, 0.6);
    Tone.Draw.schedule(() => {
      keyboards[0].flashKey(note);
      if (onBeat) keyboards[1].flashKey(bass);
    }, t);
  }, [...Array(32).keys()], '8n').start(0);

  function setTransportButtons() {
    const status = Tone.Transport.state;
    $('#playBtn').classList.toggle('is-active', status === 'started');
    $('#pauseBtn').classList.toggle('is-active', status === 'paused');
  }

  async function play() {
    if (!state.power) return;
    await Tone.start();
    Tone.Transport.start();
    setTransportButtons();
    flash(song.part ? 'PLAY ' + song.name : 'PLAY LOOP');
  }

  function pause() {
    if (Tone.Transport.state !== 'started') return;
    Tone.Transport.pause();
    allNotesOff();
    setTransportButtons();
    flash('PAUSED');
  }

  function stop() {
    Tone.Transport.stop();
    allNotesOff();
    setTransportButtons();
    flash('STOPPED');
  }

  function panic() {
    Tone.Transport.stop();
    setTransportButtons();
    allNotesOff();
    keyboards.forEach((kb) => kb.releaseAll());
    pressedCodes.clear();
    $$('.key.is-down').forEach((key) => key.classList.remove('is-down'));
  }

  $('#playBtn').addEventListener('click', play);
  $('#pauseBtn').addEventListener('click', pause);
  $('#stopBtn').addEventListener('click', stop);

  /* ==================== 8. Window, menus, dialog ==================== */

  function powerOff() {
    panic();
    state.power = false;
    win.classList.add('is-off');
    $('#powerOn').focus();
  }

  $('#btnMin').addEventListener('click', () => win.classList.toggle('is-collapsed'));
  $('#btnMax').addEventListener('click', () => {
    win.classList.toggle('is-wide');
    sizeCanvas();
  });
  $('#btnClose').addEventListener('click', powerOff);
  $('#powerOn').addEventListener('click', () => {
    state.power = true;
    win.classList.remove('is-off');
    startAudio();
    flash('HELLO');
  });

  // --- Menus ---
  const menubar = $('#menubar');
  let openedMenu = null;

  PRESETS.forEach((preset, i) => {
    const item = document.createElement('button');
    item.className = 'menu__item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.action = 'preset';
    item.dataset.arg = i;
    item.dataset.check = 'preset-' + i;
    item.textContent = preset.name;
    $('#presetMenu').appendChild(item);
  });

  function closeMenus() {
    $$('.menu.is-open', menubar).forEach((menu) => {
      menu.classList.remove('is-open');
      $('.menu__button', menu).setAttribute('aria-expanded', 'false');
    });
    openedMenu = null;
  }

  function openMenu(menu) {
    closeMenus();
    menu.classList.add('is-open');
    $('.menu__button', menu).setAttribute('aria-expanded', 'true');
    openedMenu = menu;
    refreshMenuChecks();
  }

  function refreshMenuChecks() {
    const checked = {
      labels: state.labels,
      rack: state.rack,
      'viz-spectrum': state.viz === 'spectrum',
      'viz-wave': state.viz === 'wave',
      'edit-0': state.edit === 0,
      'edit-1': state.edit === 1,
    };
    PRESETS.forEach((p, i) => { checked['preset-' + i] = currentEngine().preset === i; });
    $$('[data-check]', menubar).forEach((el) => el.setAttribute('aria-checked', String(!!checked[el.dataset.check])));
  }

  menubar.addEventListener('click', (e) => {
    const button = e.target.closest('.menu__button');
    if (button) {
      const menu = button.parentElement;
      if (menu.classList.contains('is-open')) closeMenus();
      else openMenu(menu);
      return;
    }
    const item = e.target.closest('[data-action]');
    if (item) {
      closeMenus();
      runAction(item.dataset.action, item.dataset.arg);
    }
  });

  // While a menu is open, hovering another title opens that one
  menubar.addEventListener('pointerover', (e) => {
    const button = e.target.closest('.menu__button');
    if (button && openedMenu && button.parentElement !== openedMenu) openMenu(button.parentElement);
  });

  document.addEventListener('pointerdown', (e) => {
    if (openedMenu && !e.target.closest('#menubar')) closeMenus();
  });

  function runAction(action, arg) {
    switch (action) {
      case 'init': loadPreset(INIT_PATCH, -1); break;
      case 'openSong': songFile.click(); break;
      case 'panic': panic(); flash('ALL NOTES OFF'); break;
      case 'power': powerOff(); break;
      case 'preset': loadPreset(PRESETS[+arg], +arg); break;
      case 'edit': selectEngine(+arg); break;
      case 'copy': copyEngine(); break;
      case 'octDown': shiftOctave(-1); break;
      case 'octUp': shiftOctave(1); break;
      case 'midi': connectMidi(); break;
      case 'labels':
        state.labels = !state.labels;
        $$('.keys').forEach((k) => k.classList.toggle('has-labels', state.labels));
        break;
      case 'rack':
        state.rack = !state.rack;
        $('#rack').hidden = !state.rack;
        break;
      case 'viz': state.viz = arg; break;
      case 'help': showDialog('KEYBOARD SHORTCUTS', HELP_HTML); break;
      case 'about': showDialog('ABOUT', ABOUT_HTML); break;
    }
    refreshMenuChecks();
  }

  // --- Dialog ---
  const dialog = $('#dlg');

  function showDialog(title, html) {
    $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = html;
    dialog.showModal();
  }
  $('#dlgOk').addEventListener('click', () => dialog.close());
  $('#dlgX').addEventListener('click', () => dialog.close());

  const HELP_HTML = `
    <h3>Две клавиатуры</h3>
    <p>Верхняя клавиатура (синяя, A) играет синтом A, нижняя (фиолетовая, B) — синтом B.
      С компьютера: ряд <kbd>Q</kbd> <kbd>2</kbd> <kbd>W</kbd> <kbd>3</kbd> <kbd>E</kbd> … — клавиатура A,
      ряд <kbd>Z</kbd> <kbd>S</kbd> <kbd>X</kbd> <kbd>D</kbd> <kbd>C</kbd> … — клавиатура B. Работает в любой раскладке.
      Мышкой можно вести по клавишам; чем ниже нажимаешь на клавишу, тем громче.</p>
    <p>Кнопки − и + у клавиатуры двигают её октаву, стрелки <kbd>←</kbd> <kbd>→</kbd> — октаву выбранного синта.</p>
    <h3>Какой синт настраивать</h3>
    <p>Клик по названию над клавиатурой или SYNTH A / B на дисплее. Ручки, эквалайзер и FX rack меняют выбранный синт;
      MIDI-клавиатура тоже играет им.</p>
    <h3>Песни</h3>
    <p>LOAD MIDI или перетащи .mid на окно. Первая дорожка играет на A, вторая на B; если дорожка одна, всё ниже C4 уходит на B.
      DEMO возвращает демо-луп: арпеджио на A, бас на B.</p>
    <h3>Ручки и фейдеры</h3>
    <p>Тяни вверх-вниз или крути колесом. <kbd>Shift</kbd> — точная настройка, двойной клик — сброс.</p>
    <h3>Дисплей</h3>
    <p>Стрелки листают пресеты. VOICE, TYPE, POLY, KEY и CH переключаются кликом, BPM тянется вверх-вниз.</p>
    <h3>FX rack</h3>
    <p>Точка слева включает эффект, клик по названию открывает его ручки. Если покрутить ручку выключенного эффекта, он включится сам.</p>`;

  const ABOUT_HTML = `<p>Synth Player — два синтезатора с двумя клавиатурами, 10 голосов, 17 эффектов,
    4-полосный эквалайзер и демо-луп. Звук на Tone.js 14.8.</p>`;

  /* ==================== 9. Visualizer ==================== */

  const canvas = $('#viz');
  const ctx = canvas.getContext('2d');
  const LCD_INK = getComputedStyle(document.documentElement).getPropertyValue('--lcd-ink').trim() || '#d9e9ff';
  let canvasWidth = 0, canvasHeight = 0, smoothed = [];

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvasWidth = canvas.clientWidth;
    canvasHeight = canvas.clientHeight;
    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!canvasWidth) return;
    const w = canvasWidth, h = canvasHeight, mid = h / 2;
    const unit = w / 580; // spacing scales with the display, like the vw layout

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(190, 215, 255, 0.35)';
    for (let x = 0; x < w; x += 6 * unit) ctx.fillRect(x, mid - 0.5, 3 * unit, 1);

    ctx.fillStyle = LCD_INK;
    ctx.strokeStyle = LCD_INK;
    ctx.shadowColor = 'rgba(140, 195, 255, 0.8)';
    ctx.shadowBlur = 6 * unit;

    if (state.viz === 'wave') {
      const samples = waveform.getValue();
      ctx.lineWidth = 2 * unit;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = i / (samples.length - 1) * w, y = mid - s * mid * 0.9;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    } else {
      // Mirrored spectrum: low frequencies in the middle, highs at the edges
      const spectrum = fft.getValue();
      const bars = Math.max(20, Math.floor(w / (6 * unit))), barWidth = w / bars;
      if (smoothed.length !== bars) smoothed = new Array(bars).fill(0);
      for (let j = 0; j < bars; j++) {
        const distance = Math.abs(j - (bars - 1) / 2) / (bars / 2);
        const bin = Math.min(spectrum.length - 1, Math.floor(Math.pow(distance, 1.8) * spectrum.length * 0.55) + 1);
        const level = Number.isFinite(spectrum[bin]) ? clamp01((spectrum[bin] + 95) / 70) : 0;
        smoothed[j] = Math.max(level, smoothed[j] * 0.88);
        const barHeight = smoothed[j] * mid * 0.95;
        if (barHeight > 1) ctx.fillRect(j * barWidth + barWidth * 0.2, mid - barHeight, barWidth * 0.6, barHeight * 2);
      }
    }
    ctx.shadowBlur = 0;
  }

  window.addEventListener('resize', sizeCanvas);

  /* ==================== 10. Start ==================== */

  // Browsers only allow sound after the first click or key press
  ['pointerdown', 'keydown'].forEach((type) => window.addEventListener(type, startAudio, { once: true, capture: true }));

  Tone.Transport.bpm.value = 120;
  engines[1].loadPreset(PRESETS[3], 3); // B: ACID BASS
  loadPreset(PRESETS[0], 0);            // A: SOFT KEYS
  keyboards.forEach((kb) => kb.build());
  updateDisplay();
  sizeCanvas();
  requestAnimationFrame(draw);
})();
