/*
 * ДРЕЙФ — музыкальные данные
 * Тональность, аккорды, паттерны шести голосов и правила вариаций.
 * Здесь нет звука и интерфейса: только ноты. Менять музыку — только в этом файле.
 *
 * Сетка: 16 шагов в такте (шестнадцатые). Паттерн длиной 16 повторяется каждый такт,
 * паттерн длиной 64 — это цикл из 4 тактов, по такту на аккорд.
 */
(() => {
  'use strict';

  const KEY = 'E MINOR';
  const BPM = 92;
  const STEPS_PER_BAR = 16;
  const CYCLE_BARS = 4;

  // Последовательность аккордов: по такту на аккорд, цикл из 4 тактов.
  // root — нота баса, tones — голоса аккорда снизу вверх (MIDI).
  const CHORDS = [
    { name: 'Em9', root: 40, tones: [52, 55, 59, 62, 66] },
    { name: 'Cmaj7', root: 36, tones: [48, 52, 55, 59, 64] },
    { name: 'Am7', root: 45, tones: [45, 52, 55, 60, 64] },
    { name: 'Bm11', root: 47, tones: [47, 54, 57, 62, 64] },
  ];

  // Все ноты ми минора — вариации мелодии не выходят из этого звукоряда
  const SCALE = [4, 6, 7, 9, 11, 0, 2];
  const inScale = (midi) => SCALE.includes(((midi % 12) + 12) % 12);

  /*
   * Как записан паттерн
   *   perBar: true  — ритм одного такта повторяется во всех тактах цикла (ноты берутся из аккорда такта)
   *   events: { s: шаг, d: длина в шагах, v: громкость 0..1, и одно из:
   *             n — абсолютная нота MIDI,
   *             t — номер звука аккорда (0 — нижний), o — сдвиг в полутонах,
   *             r — интервал от баса аккорда в полутонах }
   *   bar — у событий абсолютных паттернов (perBar: false): номер такта цикла
   */
  const CHANNELS = [
    {
      id: 'pulse',
      name: 'Пульс',
      role: 'бочка · сердцебиение ритма',
      kind: 'drum',
      length: 16,
      patterns: [
        { name: 'сердце', perBar: true, events: [
          { s: 0, v: 1 }, { s: 10, v: 0.55 },
        ] },
        { name: 'шаг', perBar: true, events: [
          { s: 0, v: 1 }, { s: 8, v: 0.8 }, { s: 14, v: 0.35 },
        ] },
        { name: 'ломаный', perBar: true, events: [
          { s: 0, v: 1 }, { s: 6, v: 0.6 }, { s: 9, v: 0.75 }, { s: 14, v: 0.4 },
        ] },
      ],
    },
    {
      id: 'dust',
      name: 'Пыль',
      role: 'шорохи и щелчки',
      kind: 'drum',
      length: 16,
      patterns: [
        { name: 'шорох', perBar: true, events: [
          { s: 2, v: 0.45 }, { s: 6, v: 0.4 }, { s: 7, v: 0.18 }, { s: 10, v: 0.45 }, { s: 14, v: 0.4 }, { s: 15, v: 0.2 },
        ] },
        { name: 'тиканье', perBar: true, events: [
          { s: 0, v: 0.22 }, { s: 2, v: 0.5 }, { s: 4, v: 0.22 }, { s: 6, v: 0.45 },
          { s: 8, v: 0.22 }, { s: 10, v: 0.5 }, { s: 12, v: 0.22 }, { s: 14, v: 0.45 },
        ] },
        { name: 'дождь', perBar: true, events: [
          { s: 1, v: 0.3 }, { s: 2, v: 0.5 }, { s: 5, v: 0.25 }, { s: 6, v: 0.45 }, { s: 9, v: 0.3 },
          { s: 10, v: 0.5 }, { s: 11, v: 0.2 }, { s: 13, v: 0.3 }, { s: 14, v: 0.45 }, { s: 15, v: 0.25 },
        ] },
      ],
    },
    {
      id: 'bass',
      name: 'Глубина',
      role: 'бас · корни аккордов',
      kind: 'bass',
      length: 64,
      patterns: [
        { name: 'опора', perBar: true, events: [
          { s: 0, r: 0, d: 14, v: 0.9 },
        ] },
        { name: 'шаг', perBar: true, events: [
          { s: 0, r: 0, d: 6, v: 0.9 }, { s: 8, r: 0, d: 4, v: 0.7 }, { s: 12, r: 7, d: 3, v: 0.6 },
        ] },
        { name: 'пульс', perBar: true, events: [
          { s: 0, r: 0, d: 2, v: 0.9 }, { s: 3, r: 0, d: 2, v: 0.6 }, { s: 6, r: 12, d: 2, v: 0.55 },
          { s: 8, r: 0, d: 2, v: 0.8 }, { s: 11, r: 7, d: 2, v: 0.55 }, { s: 14, r: 0, d: 2, v: 0.6 },
        ] },
      ],
    },
    {
      id: 'fog',
      name: 'Туман',
      role: 'пэд · медленные аккорды',
      kind: 'chord',
      length: 64,
      patterns: [
        { name: 'долгий', perBar: true, events: [0, 1, 2, 3, 4].map((t) => ({ s: 0, t, d: 16, v: 0.5 })) },
        { name: 'дыхание', perBar: true, events: [
          ...[0, 1, 2, 3, 4].map((t) => ({ s: 0, t, d: 6, v: 0.45 })),
          ...[2, 3, 4].map((t) => ({ s: 8, t, d: 6, v: 0.35 })),
        ] },
        { name: 'прозрачный', perBar: true, events: [0, 2, 4].map((t) => ({ s: 0, t, d: 10, v: 0.42 })) },
      ],
    },
    {
      id: 'drops',
      name: 'Капли',
      role: 'арпеджио · щипок с эхом',
      kind: 'arp',
      length: 64,
      patterns: [
        { name: 'капель', perBar: true, events: [
          { s: 0, t: 0, o: 12, d: 2, v: 0.6 }, { s: 3, t: 2, o: 12, d: 2, v: 0.45 }, { s: 6, t: 4, o: 12, d: 2, v: 0.5 },
          { s: 8, t: 1, o: 12, d: 2, v: 0.55 }, { s: 11, t: 3, o: 12, d: 2, v: 0.45 }, { s: 14, t: 2, o: 12, d: 2, v: 0.4 },
        ] },
        { name: 'лестница', perBar: true, events: [0, 1, 2, 3, 4, 3, 2, 1].map((t, i) => ({
          s: i, t, o: 12, d: 1, v: [0.6, 0.45, 0.5, 0.45, 0.55, 0.4, 0.45, 0.35][i],
        })) },
        { name: 'редкие', perBar: true, events: [
          { s: 4, t: 4, o: 12, d: 4, v: 0.55 }, { s: 13, t: 2, o: 12, d: 3, v: 0.4 },
        ] },
      ],
    },
    {
      id: 'glass',
      name: 'Стекло',
      role: 'колокольчики · мелодия',
      kind: 'melody',
      length: 64,
      patterns: [
        { name: 'вопрос', perBar: false, events: [
          { bar: 0, s: 0, n: 76, d: 6, v: 0.7 }, { bar: 0, s: 8, n: 79, d: 4, v: 0.5 }, { bar: 0, s: 12, n: 74, d: 4, v: 0.45 },
          { bar: 1, s: 4, n: 71, d: 10, v: 0.6 },
          { bar: 2, s: 0, n: 81, d: 6, v: 0.65 }, { bar: 2, s: 8, n: 79, d: 4, v: 0.5 }, { bar: 2, s: 12, n: 76, d: 4, v: 0.45 },
          { bar: 3, s: 0, n: 74, d: 12, v: 0.6 },
        ] },
        { name: 'ответ', perBar: false, events: [
          { bar: 0, s: 0, n: 83, d: 8, v: 0.6 },
          { bar: 1, s: 8, n: 79, d: 8, v: 0.5 },
          { bar: 2, s: 0, n: 76, d: 6, v: 0.55 }, { bar: 2, s: 10, n: 72, d: 4, v: 0.45 },
          { bar: 3, s: 6, n: 78, d: 10, v: 0.5 },
        ] },
        { name: 'кольцо', perBar: true, events: [
          { s: 0, t: 4, o: 12, d: 6, v: 0.45 }, { s: 6, t: 3, o: 12, d: 6, v: 0.35 }, { s: 12, t: 2, o: 12, d: 4, v: 0.3 },
        ] },
      ],
    },
  ];

  /* ---------- Развёртка паттерна в список нот ---------- */

  // Нота события в конкретном такте цикла
  function resolveNote(ev, bar) {
    const chord = CHORDS[bar % CYCLE_BARS];
    if (ev.n !== undefined) return ev.n;
    if (ev.t !== undefined) return chord.tones[ev.t] + (ev.o || 0);
    if (ev.r !== undefined) return chord.root + ev.r;
    return null; // ударные: нота задаётся звуком
  }

  // Список событий { step, note, dur, vel } на всю длину канала
  function expandPattern(channel, pattern) {
    const out = [];
    const bars = channel.length / STEPS_PER_BAR;
    if (pattern.perBar) {
      for (let bar = 0; bar < bars; bar++) {
        pattern.events.forEach((ev) => out.push({
          step: bar * STEPS_PER_BAR + ev.s, note: resolveNote(ev, bar), dur: ev.d || 1, vel: ev.v,
        }));
      }
    } else {
      pattern.events.forEach((ev) => out.push({
        step: ev.bar * STEPS_PER_BAR + ev.s, note: resolveNote(ev, ev.bar), dur: ev.d || 1, vel: ev.v,
      }));
    }
    return out.sort((a, b) => a.step - b.step);
  }

  /* ---------- Вариации ---------- */
  // Вариация меняет рисунок, но сохраняет характер партии и гармонию:
  // ударные теряют или получают призрачные удары, бас меняет октаву и квинту,
  // аккорды меняют расположение, арпеджио — порядок звуков, мелодия — соседние звуки аккорда.

  function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pick = (list, random) => list[Math.floor(random() * list.length)];
  const clampVel = (v) => Math.min(1, Math.max(0.12, v));

  function varyDrums(events, length, random) {
    // Первая доля каждого такта не трогается — на ней держится ритм
    let out = events.filter((ev) => ev.step % STEPS_PER_BAR === 0 || random() > 0.22);
    const taken = new Set(out.map((ev) => ev.step));
    const ghosts = 1 + Math.floor(random() * 3);
    for (let i = 0; i < ghosts; i++) {
      const step = Math.floor(random() * length);
      if (step % STEPS_PER_BAR !== 0 && !taken.has(step)) {
        out.push({ step, note: null, dur: 1, vel: 0.18 + random() * 0.2 });
        taken.add(step);
      }
    }
    out = out.map((ev) => Object.assign({}, ev, { vel: clampVel(ev.vel + (random() - 0.5) * 0.15) }));
    return out;
  }

  function varyBass(events, random) {
    return events.map((ev) => {
      const bar = Math.floor(ev.step / STEPS_PER_BAR);
      const root = CHORDS[bar % CYCLE_BARS].root;
      if (ev.step % STEPS_PER_BAR === 0) return ev;
      const roll = random();
      if (roll < 0.4) return Object.assign({}, ev, { note: root + pick([0, 7, 12], random) });
      return ev;
    });
  }

  function varyChords(events, random) {
    // Каждый аккорд: часть звуков переезжает на октаву вверх, иногда один звук выпадает
    const byStep = new Map();
    events.forEach((ev) => {
      if (!byStep.has(ev.step)) byStep.set(ev.step, []);
      byStep.get(ev.step).push(ev);
    });
    const out = [];
    byStep.forEach((group) => {
      group.forEach((ev, i) => {
        if (group.length > 2 && i > 0 && random() < 0.2) return;
        const lifted = random() < 0.35 && ev.note + 12 <= 74 ? ev.note + 12 : ev.note;
        out.push(Object.assign({}, ev, { note: lifted }));
      });
    });
    return out.sort((a, b) => a.step - b.step);
  }

  function varyArp(events, random) {
    // Ритм тот же, звуки аккорда в другом порядке
    return events
      .filter(() => random() > 0.12)
      .map((ev) => {
        const bar = Math.floor(ev.step / STEPS_PER_BAR);
        const tones = CHORDS[bar % CYCLE_BARS].tones;
        return Object.assign({}, ev, { note: pick(tones, random) + 12 });
      });
  }

  function varyMelody(events, random) {
    // Каждая нота может смениться ближайшим звуком аккорда этого такта (в пределах кварты)
    return events.map((ev) => {
      if (random() > 0.45) return ev;
      const bar = Math.floor(ev.step / STEPS_PER_BAR);
      const tones = CHORDS[bar % CYCLE_BARS].tones;
      const options = [];
      [12, 24].forEach((oct) => tones.forEach((t) => {
        const n = t + oct;
        if (n !== ev.note && Math.abs(n - ev.note) <= 5 && n >= 67 && n <= 86 && inScale(n)) options.push(n);
      }));
      return options.length ? Object.assign({}, ev, { note: pick(options, random) }) : ev;
    });
  }

  function varyPattern(channel, events, seed) {
    const random = makeRandom(seed);
    switch (channel.kind) {
      case 'drum': return varyDrums(events, channel.length, random);
      case 'bass': return varyBass(events, random);
      case 'chord': return varyChords(events, random);
      case 'arp': return varyArp(events, random);
      case 'melody': return varyMelody(events, random);
      default: return events;
    }
  }

  window.MUSIC = {
    KEY, BPM, STEPS_PER_BAR, CYCLE_BARS, CHORDS, CHANNELS,
    expandPattern, varyPattern,
  };
})();
