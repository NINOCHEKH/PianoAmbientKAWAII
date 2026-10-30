/*
 * ДРЕЙФ — звуковой движок
 * Голоса и эффекты на Tone.js, общий транспорт, смена паттернов на границе такта,
 * Solo/Mute без щелчков, вариации и защита от перегруза.
 * Интерфейса здесь нет: движок сообщает о событиях через ENGINE.on(...).
 */
(() => {
  'use strict';

  const M = window.MUSIC;
  if (typeof Tone === 'undefined') {
    window.ENGINE = null;
    return;
  }

  const midi = (n) => Tone.Frequency(n, 'midi').toFrequency();
  const sixteenth = () => Tone.Time('16n').toSeconds();
  const RAMP = 0.08; // сек — плавность громкости и эффектов

  /* ---------- Общая шина: компрессор и лимитер против перегруза ---------- */

  const master = new Tone.Gain(0.8);
  const compressor = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.25 });
  const limiter = new Tone.Limiter(-1);
  const meter = new Tone.Meter({ smoothing: 0.8 });
  const analyser = new Tone.Analyser('fft', 256);
  master.chain(compressor, limiter, Tone.Destination);
  limiter.connect(meter);
  limiter.connect(analyser);

  // Общая реверберация и задержка: каналы отправляют в них свою долю сигнала
  const reverbIn = new Tone.Gain(1);
  const reverb = new Tone.Reverb({ decay: 7, preDelay: 0.04, wet: 1 });
  const reverbOut = new Tone.Gain(0.8);
  reverbIn.chain(reverb, reverbOut, master);

  const delayIn = new Tone.Gain(1);
  const delayTone = new Tone.Filter({ type: 'lowpass', frequency: 3200, rolloff: -12 });
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.42, wet: 1 });
  const delayOut = new Tone.Gain(0.6);
  delayIn.chain(delayTone, delay, delayOut, master);
  delayOut.connect(reverbIn);

  /* ---------- Голоса ----------
   * Каждый строитель возвращает:
   *   output   — узел, который идёт в канал
   *   trim     — базовая громкость голоса в дБ (баланс между голосами)
   *   trigger(note, steps, time, velocity)
   *   silence() — заглушить звучащие ноты
   *   params   — 3 параметра тембра: { id, label, min, max, value, curve, unit, apply(v, channel) }
   */
  const VOICES = {
    pulse() {
      const synth = new Tone.MembraneSynth({
        pitchDecay: 0.04, octaves: 5, oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.3 },
      });
      const drive = new Tone.Distortion({ distortion: 0.5, wet: 0.15 });
      const lowpass = new Tone.Filter({ type: 'lowpass', frequency: 900, rolloff: -24 });
      synth.chain(drive, lowpass);
      return {
        output: lowpass,
        trim: -4,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(midi(33), 0.2, time, velocity),
        silence: () => synth.triggerRelease(),
        params: [
          { id: 'decay', label: 'Удар', min: 0.1, max: 1.2, value: 0.45, unit: 's', apply: (v) => { synth.envelope.decay = v; } },
          { id: 'depth', label: 'Глубина', min: 2, max: 8, value: 5, unit: 'oct', apply: (v) => { synth.octaves = v; } },
          { id: 'drive', label: 'Перегруз', min: 0, max: 1, value: 0.15, unit: '%', apply: (v) => drive.wet.rampTo(v, RAMP) },
        ],
      };
    },

    dust() {
      let length = 0.06;
      const synth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: length, sustain: 0, release: 0.02 },
      });
      const highpass = new Tone.Filter({ type: 'highpass', frequency: 6000, Q: 0.7 });
      const panner = new Tone.AutoPanner({ frequency: 0.13, depth: 0.6 }).start();
      synth.chain(highpass, panner);
      return {
        output: panner,
        trim: -12,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(length, time, velocity),
        silence: () => synth.triggerRelease(),
        params: [
          { id: 'bright', label: 'Яркость', min: 1500, max: 12000, value: 6000, curve: 'exp', unit: 'Hz', apply: (v) => highpass.frequency.rampTo(v, RAMP) },
          { id: 'length', label: 'Длина', min: 0.02, max: 0.3, value: 0.06, unit: 's', apply: (v) => { length = v; synth.envelope.decay = v; } },
          { id: 'space', label: 'Пространство', min: 0, max: 1, value: 0.3, unit: '%', apply: (v, ch) => ch.reverbSend.gain.rampTo(v, RAMP) },
        ],
      };
    },

    bass() {
      const synth = new Tone.MonoSynth({
        oscillator: { type: 'triangle' },
        filter: { type: 'lowpass', rolloff: -24, Q: 2 },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.4 },
        filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.4, baseFrequency: 180, octaves: 2.2 },
        portamento: 0.04,
      });
      const warmth = new Tone.Distortion({ distortion: 0.35, wet: 0.2 });
      synth.connect(warmth);
      return {
        output: warmth,
        trim: -6,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(midi(note), steps * sixteenth() * 0.95, time, velocity),
        silence: () => synth.triggerRelease(),
        params: [
          { id: 'cutoff', label: 'Фильтр', min: 60, max: 800, value: 180, curve: 'exp', unit: 'Hz', apply: (v) => { synth.filterEnvelope.baseFrequency = v; } },
          { id: 'glide', label: 'Скольжение', min: 0, max: 0.25, value: 0.04, unit: 's', apply: (v) => { synth.portamento = v; } },
          { id: 'warmth', label: 'Тепло', min: 0, max: 1, value: 0.2, unit: '%', apply: (v) => warmth.wet.rampTo(v, RAMP) },
        ],
      };
    },

    fog() {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
        envelope: { attack: 1.2, decay: 0.6, sustain: 0.75, release: 3 },
      });
      synth.maxPolyphony = 24;
      const lowpass = new Tone.Filter({ type: 'lowpass', frequency: 1400, rolloff: -24, Q: 0.5 });
      const chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 4, depth: 0.6, spread: 180, wet: 0.5 }).start();
      synth.chain(lowpass, chorus);
      return {
        output: chorus,
        trim: -18,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(midi(note), steps * sixteenth(), time, velocity),
        silence: () => synth.releaseAll(),
        params: [
          { id: 'light', label: 'Свет', min: 200, max: 5000, value: 1400, curve: 'exp', unit: 'Hz', apply: (v) => lowpass.frequency.rampTo(v, 0.2) },
          { id: 'width', label: 'Ширина', min: 0, max: 1, value: 0.5, unit: '%', apply: (v) => chorus.wet.rampTo(v, RAMP) },
          { id: 'space', label: 'Пространство', min: 0, max: 1, value: 0.7, unit: '%', apply: (v, ch) => ch.reverbSend.gain.rampTo(v, RAMP) },
        ],
      };
    },

    drops() {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3, modulationIndex: 4,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.4 },
        modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
      });
      synth.maxPolyphony = 16;
      const highpass = new Tone.Filter({ type: 'highpass', frequency: 180 });
      synth.connect(highpass);
      return {
        output: highpass,
        trim: -14,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(midi(note), steps * sixteenth(), time, velocity),
        silence: () => synth.releaseAll(),
        params: [
          { id: 'bright', label: 'Яркость', min: 0.5, max: 14, value: 4, unit: 'x', apply: (v) => synth.set({ modulationIndex: v }) },
          { id: 'length', label: 'Длина', min: 0.08, max: 1.2, value: 0.35, unit: 's', apply: (v) => synth.set({ envelope: { decay: v } }) },
          { id: 'echo', label: 'Эхо', min: 0, max: 1, value: 0.45, unit: '%', apply: (v, ch) => ch.delaySend.gain.rampTo(v, RAMP) },
        ],
      };
    },

    glass() {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.5, modulationIndex: 10,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.001, decay: 2, sustain: 0, release: 2.5 },
        modulationEnvelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1 },
      });
      synth.maxPolyphony = 12;
      return {
        output: synth,
        trim: -16,
        trigger: (note, steps, time, velocity) => synth.triggerAttackRelease(midi(note), steps * sixteenth(), time, velocity),
        silence: () => synth.releaseAll(),
        params: [
          { id: 'metal', label: 'Металл', min: 1.5, max: 6, value: 3.5, unit: 'x', apply: (v) => synth.set({ harmonicity: v }) },
          { id: 'space', label: 'Пространство', min: 0, max: 1, value: 0.65, unit: '%', apply: (v, ch) => ch.reverbSend.gain.rampTo(v, RAMP) },
          { id: 'echo', label: 'Эхо', min: 0, max: 1, value: 0.3, unit: '%', apply: (v, ch) => ch.delaySend.gain.rampTo(v, RAMP) },
        ],
      };
    },
  };

  /* ---------- Канал ---------- */
  // Цепочка: голос → громкость → вкл/выкл/solo → мастер (+ отправки в реверберацию и задержку)

  class Channel {
    constructor(def, index) {
      this.def = def;
      this.index = index;
      this.voice = VOICES[def.id]();

      this.trim = Tone.dbToGain(this.voice.trim);
      this.volumeGain = new Tone.Gain(0);
      this.gate = new Tone.Gain(0);
      this.reverbSend = new Tone.Gain(0.15);
      this.delaySend = new Tone.Gain(0);
      this.voice.output.chain(this.volumeGain, this.gate, master);
      this.gate.connect(this.reverbSend);
      this.gate.connect(this.delaySend);
      this.reverbSend.connect(reverbIn);
      this.delaySend.connect(delayIn);

      this.state = {
        on: false,
        solo: false,
        volume: 0.8,
        pattern: 0,
        pendingPattern: null,   // номер паттерна, который вступит со следующего такта
        variation: null,        // события вариации текущего паттерна, или null — исходный рисунок
        pendingVariation: null, // { events } — новая вариация, { reset: true } — вернуть исходный
        params: {},
      };

      this.voice.params.forEach((p) => this.setParam(p.id, p.value));
      this.setVolume(this.state.volume);
      this.rebuild();
    }

    get name() { return this.def.name; }
    get patternEvents() { return M.expandPattern(this.def, this.def.patterns[this.state.pattern]); }
    get events() { return this.state.variation || this.patternEvents; }

    // Таблица шаг → ноты на всю длину цикла канала
    rebuild() {
      this.table = Array.from({ length: this.def.length }, () => []);
      this.events.forEach((ev) => this.table[ev.step].push(ev));
    }

    setVolume(v) {
      this.state.volume = v;
      this.volumeGain.gain.rampTo(v * v * this.trim * 1.25, RAMP);
    }

    setParam(id, v) {
      const param = this.voice.params.find((p) => p.id === id);
      if (!param) return;
      this.state.params[id] = v;
      param.apply(v, this);
    }

    applyPending() {
      const s = this.state;
      let changed = false;
      if (s.pendingPattern !== null) {
        s.pattern = s.pendingPattern;
        s.pendingPattern = null;
        s.variation = null;
        changed = true;
      }
      if (s.pendingVariation) {
        s.variation = s.pendingVariation.reset ? null : s.pendingVariation.events;
        s.pendingVariation = null;
        changed = true;
      }
      if (changed) this.rebuild();
      return changed;
    }
  }

  const channels = M.CHANNELS.map((def, i) => new Channel(def, i));

  /* ---------- События для интерфейса ---------- */

  const listeners = {};
  const on = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const emit = (type, data) => (listeners[type] || []).forEach((fn) => fn(data));

  /* ---------- Слышимость: вкл/выкл и Solo ---------- */

  const anySolo = () => channels.some((c) => c.state.solo);
  const isAudible = (c) => c.state.on && (!anySolo() || c.state.solo);

  function updateGates() {
    channels.forEach((c) => c.gate.gain.rampTo(isAudible(c) ? 1 : 0, RAMP));
  }

  /* ---------- Транспорт ---------- */

  let playing = false;
  let currentStep = 0;

  function tick(time) {
    const step = Math.round(Tone.Transport.getTicksAtTime(time) / (Tone.Transport.PPQ / 4));
    const bar = Math.floor(step / M.STEPS_PER_BAR);

    // Новые паттерны и вариации вступают только на первой доле такта
    const applied = [];
    if (step % M.STEPS_PER_BAR === 0) {
      channels.forEach((c) => { if (c.applyPending()) applied.push(c.index); });
    }

    const hits = [];
    channels.forEach((c) => {
      if (!isAudible(c)) return;
      const notes = c.table[step % c.def.length];
      if (!notes.length) return;
      notes.forEach((ev) => {
        try { c.voice.trigger(ev.note, ev.dur, time, ev.vel); } catch (err) { console.warn(c.def.id, err); }
      });
      hits.push({ index: c.index, velocity: Math.max(...notes.map((ev) => ev.vel)) });
    });

    Tone.Draw.schedule(() => {
      currentStep = step;
      applied.forEach((index) => emit('applied', index));
      emit('step', { step, bar, chord: M.CHORDS[bar % M.CYCLE_BARS].name, hits });
    }, time);
  }

  new Tone.Loop(tick, '16n').start(0);
  Tone.Transport.bpm.value = M.BPM;
  delay.delayTime.value = (60 / M.BPM) * 0.75;

  async function start() {
    if (playing) return;
    await Tone.start();
    playing = true;
    updateGates();
    Tone.Transport.start('+0.05');
    emit('transport', { playing });
  }

  function stop() {
    if (!playing) return;
    playing = false;
    Tone.Transport.stop();
    channels.forEach((c) => {
      try { c.voice.silence(); } catch (err) { /* already silent */ }
      if (c.applyPending()) emit('applied', c.index);
    });
    currentStep = 0;
    emit('transport', { playing });
    emit('step', { step: 0, bar: 0, chord: M.CHORDS[0].name, hits: [] });
  }

  function setTempo(bpm) {
    Tone.Transport.bpm.rampTo(bpm, 0.25);
    // Эхо идёт в долях такта: при смене темпа пересчитываем время задержки (пунктирная восьмая)
    delay.delayTime.rampTo((60 / bpm) * 0.75, 0.25);
  }

  /* ---------- Запись трека ---------- */

  // Пишем ровно то, что слышно: выход после лимитера. Формат — webm (Chrome, Firefox) или mp4 (Safari)
  const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  let recorder = null;
  let recordStartedAt = 0;

  const canRecord = () => typeof MediaRecorder !== 'undefined' && Boolean(Tone.Recorder);

  async function startRecording() {
    if (!canRecord()) throw new Error('MediaRecorder недоступен');
    await Tone.start();
    if (!recorder) {
      const mimeType = REC_TYPES.find((type) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type));
      recorder = new Tone.Recorder(mimeType ? { mimeType } : {});
      limiter.connect(recorder);
    }
    await recorder.start();
    recordStartedAt = Date.now();
  }

  // Возвращает { blob, ext }; ext подходит для имени файла
  async function stopRecording() {
    const blob = await recorder.stop();
    recordStartedAt = 0;
    const type = (blob && blob.type) || '';
    return { blob, ext: type.includes('mp4') ? 'mp4' : 'webm' };
  }

  const isRecording = () => recordStartedAt > 0;
  const recordingTime = () => (recordStartedAt ? (Date.now() - recordStartedAt) / 1000 : 0);

  /* ---------- Управление каналами ---------- */

  function toggle(index, value) {
    const c = channels[index];
    c.state.on = value === undefined ? !c.state.on : value;
    updateGates();
    emit('channel', index);
  }

  function toggleSolo(index) {
    const c = channels[index];
    c.state.solo = !c.state.solo;
    if (c.state.solo) c.state.on = true; // Solo выключенного канала сразу его включает
    updateGates();
    channels.forEach((ch) => emit('channel', ch.index));
  }

  // Смена паттерна: при игре — со следующего такта, в тишине — сразу
  function queuePattern(index, pattern) {
    const c = channels[index];
    if (pattern === c.state.pattern && c.state.pendingPattern === null && !c.state.variation) return;
    c.state.pendingPattern = pattern === c.state.pattern && !c.state.variation ? null : pattern;
    c.state.pendingVariation = null;
    if (!playing) c.applyPending();
    emit('channel', index);
  }

  function queueVariation(index) {
    const c = channels[index];
    const base = M.expandPattern(c.def, c.def.patterns[c.state.pendingPattern ?? c.state.pattern]);
    const seed = Math.floor(Math.random() * 1e9);
    c.state.pendingVariation = { events: M.varyPattern(c.def, base, seed) };
    if (c.state.pendingPattern !== null) {
      c.state.pattern = c.state.pendingPattern;
      c.state.pendingPattern = null;
    }
    if (!playing) c.applyPending();
    emit('channel', index);
  }

  function resetVariation(index) {
    const c = channels[index];
    if (!c.state.variation && !c.state.pendingVariation) return;
    c.state.pendingVariation = c.state.variation ? { reset: true } : null;
    if (!playing) c.applyPending();
    emit('channel', index);
  }

  function setVolume(index, v) { channels[index].setVolume(v); }
  function setParam(index, id, v) { channels[index].setParam(id, v); }

  // Уровень на выходе в дБ — для индикатора
  const level = () => {
    const v = meter.getValue();
    return typeof v === 'number' ? v : -Infinity;
  };

  // Спектр на выходе (дБ по полосам) — для дисплея
  const spectrum = () => analyser.getValue();

  window.ENGINE = {
    channels, on, start, stop, setTempo, level, spectrum,
    canRecord, startRecording, stopRecording, isRecording, recordingTime,
    toggle, toggleSolo, queuePattern, queueVariation, resetVariation, setVolume, setParam,
    isPlaying: () => playing,
    isAudible: (index) => isAudible(channels[index]),
    anySolo,
    currentStep: () => currentStep,
    _tick: tick, // для проверки расписания без звука
  };
})();
