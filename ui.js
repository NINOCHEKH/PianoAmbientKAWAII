/*
 * SYNTH PLAYER · ДРЕЙФ — интерфейс
 * Собирает шесть пультов из шаблона, связывает ручки, фейдеры и кнопки с движком,
 * показывает состояния и реагирует только на реально сыгранные ноты (события движка).
 *
 *   1. Помощники
 *   2. Ручки и фейдеры (класс Control)
 *   3. Строка состояния на дисплее
 *   4. Пульты голосов
 *   5. События движка
 *   6. Транспорт, темп, название трека и запись
 *   7. Окно, меню, справка
 *   8. Спектр и индикатор уровня
 *   9. Старт
 */
(() => {
  'use strict';

  /* ==================== 1. Помощники ==================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  const status = $('#status');
  const E = window.ENGINE;
  const M = window.MUSIC;
  if (!E) {
    status.textContent = 'Не загрузилась звуковая библиотека Tone.js — проверь интернет и обнови страницу.';
    return;
  }

  const LETTERS = ['A', 'B', 'C'];

  function formatValue(value, unit) {
    switch (unit) {
      case 's': return value.toFixed(2) + ' с';
      case 'Hz': return value >= 1000 ? (value / 1000).toFixed(1) + ' кГц' : Math.round(value) + ' Гц';
      case '%': return Math.round(value * 100) + '%';
      case 'oct': return value.toFixed(1) + ' окт';
      case 'x': return value.toFixed(1) + '×';
      default: return String(Math.round(value));
    }
  }

  /* ==================== 2. Ручки и фейдеры ==================== */

  // Одна логика на все регуляторы: тянуть мышью или пальцем, колесо, стрелки, двойной клик — сброс
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
      el.setAttribute('aria-valuemin', String(this.min));
      el.setAttribute('aria-valuemax', String(this.max));
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

    // silent — только показать значение, не сообщая наружу (для синхронизации двух регуляторов)
    set(v, byUser = false, silent = false) {
      this.value = this.step ? Math.round(v / this.step) * this.step : v;
      this.norm = this.toNorm(this.value);
      this.render();
      if (!silent && this.onInput) this.onInput(this.value, byUser);
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
      const isFader = this.kind === 'vfader';
      if (isFader) this.setFromPointer(e);
      // Чувствительность в долях экрана, потому что все размеры в vw
      const travel = Math.max(120, window.innerHeight * 0.22);

      const move = (ev) => {
        if (isFader) return this.setFromPointer(ev);
        const distance = (startY - ev.clientY) + (ev.clientX - startX) * 0.5;
        this.setNorm(startNorm + distance / (ev.shiftKey ? travel * 4 : travel), true);
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

    // Половина ручки фейдера — мёртвая зона у краёв дорожки (размеры в vw, поэтому меряем)
    setFromPointer(e) {
      const r = this.el.getBoundingClientRect();
      const thumb = $('.vfader__thumb', this.el);
      const pad = thumb ? thumb.offsetHeight / 2 : 0;
      this.setNorm(1 - (e.clientY - r.top - pad) / (r.height - 2 * pad), true);
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

  function buildKnob(el, ticks = 11) {
    el.innerHTML = '<div class="knob__ticks"></div><div class="knob__cap"><i></i></div><div class="knob__shine"></div>';
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

  /* ==================== 3. Строка состояния на дисплее ==================== */

  let statusTimer = null;

  function say(html, sticky = false) {
    status.innerHTML = html;
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(sayDefault, 4000);
  }

  function sayDefault() {
    const on = E.channels.filter((c) => c.state.on).map((c) => c.name);
    if (!E.isPlaying()) {
      status.innerHTML = 'Тишина. Нажми <b>▶</b> — заиграют включённые голоса.';
    } else if (!on.length) {
      status.innerHTML = 'Играет пустота — включи голос кнопкой <b>⏻</b> или цифрой <b>1–6</b>.';
    } else {
      const solo = E.channels.find((c) => c.state.solo);
      status.innerHTML = solo
        ? `Solo: <b>${solo.name}</b>. Нажми SOLO ещё раз, чтобы вернуть остальных.`
        : `Звучат: <b>${on.join(', ')}</b>.`;
    }
  }

  /* ==================== 4. Пульты голосов ==================== */

  const template = $('#consoleTemplate');
  const container = $('#consoles');
  const cards = [];

  E.channels.forEach((channel, index) => {
    const fragment = template.content.cloneNode(true);
    const root = $('.console', fragment);
    const ref = (name) => $(`[data-ref="${name}"]`, root);
    root.dataset.voice = channel.def.id;
    root.setAttribute('aria-label', `${index + 1}. ${channel.name}`);

    ref('num').textContent = index + 1;
    ref('name').textContent = channel.name;
    ref('role').textContent = channel.def.role;
    ref('power').setAttribute('aria-label', `Включить: ${channel.name} (${index + 1})`);

    // 16 огоньков такта
    const steps = [];
    for (let i = 0; i < M.STEPS_PER_BAR; i++) {
      const led = document.createElement('span');
      led.className = 'steps__led';
      ref('steps').appendChild(led);
      steps.push(led);
    }

    // Паттерны A B C
    const patternKeys = channel.def.patterns.map((pattern, p) => {
      const key = document.createElement('button');
      key.className = 'pattern-key';
      key.setAttribute('aria-pressed', 'false');
      key.setAttribute('aria-label', `${channel.name}: паттерн ${LETTERS[p]} «${pattern.name}»`);
      key.innerHTML = `<span class="pattern-key__led" aria-hidden="true"></span>
        <span class="pattern-key__letter">${LETTERS[p]}</span>
        <span class="pattern-key__name">${pattern.name}</span>`;
      key.addEventListener('click', () => {
        const s = channel.state;
        const same = s.pendingPattern === null && s.pattern === p && !s.variation;
        E.queuePattern(index, p);
        if (same) return;
        say(E.isPlaying()
          ? `<b>${channel.name}</b> · паттерн ${LETTERS[p]} «${pattern.name}» вступит с начала такта`
          : `<b>${channel.name}</b> · паттерн ${LETTERS[p]} «${pattern.name}»`);
      });
      ref('patterns').appendChild(key);
      return key;
    });

    // Громкость — вертикальный фейдер
    const volumeEl = ref('volume');
    buildVFader(volumeEl);
    const volume = new Control(volumeEl, {
      kind: 'vfader', min: 0, max: 1, value: channel.state.volume, def: 0.8,
      label: `${channel.name}: громкость`, format: (v) => formatValue(v, '%'),
      renderValue: (v) => { ref('volumeValue').textContent = formatValue(v, '%'); },
      onInput: (v, byUser) => {
        E.setVolume(index, v);
        if (byUser) say(`<b>${channel.name}</b> · громкость ${formatValue(v, '%')}`);
      },
    });

    // Три ручки тембра
    const knobs = channel.voice.params.map((param) => {
      const group = document.createElement('div');
      group.className = 'knob-group';
      group.innerHTML = `<div class="knob"></div>
        <span class="knob-group__label">${param.label.toUpperCase()}</span>
        <output class="readout"></output>`;
      const knobEl = $('.knob', group), readout = $('.readout', group);
      buildKnob(knobEl);
      ref('knobs').appendChild(group);
      return new Control(knobEl, {
        min: param.min, max: param.max, curve: param.curve === 'exp' ? 'exp' : 'lin',
        value: channel.state.params[param.id], def: param.value,
        label: `${channel.name}: ${param.label.toLowerCase()}`, format: (v) => formatValue(v, param.unit),
        renderValue: (v) => { readout.textContent = formatValue(v, param.unit); },
        onInput: (v, byUser) => {
          E.setParam(index, param.id, v);
          if (byUser) say(`<b>${channel.name}</b> · ${param.label.toLowerCase()} ${formatValue(v, param.unit)}`);
        },
      });
    });

    // Кнопки
    ref('power').addEventListener('click', () => toggleChannel(index));

    ref('solo').addEventListener('click', () => {
      E.toggleSolo(index);
      say(channel.state.solo
        ? `Solo: <b>${channel.name}</b> — остальные голоса молчат`
        : 'Solo снято — звучат все включённые голоса');
    });

    ref('vary').addEventListener('click', () => {
      E.queueVariation(index);
      say(E.isPlaying()
        ? `<b>${channel.name}</b> · новая вариация вступит с начала такта`
        : `<b>${channel.name}</b> · новая вариация`);
    });

    ref('reset').addEventListener('click', () => {
      E.resetVariation(index);
      say(E.isPlaying()
        ? `<b>${channel.name}</b> · исходный рисунок вернётся с начала такта`
        : `<b>${channel.name}</b> · исходный рисунок`);
    });

    container.appendChild(fragment);
    cards.push({ root, ref, steps, patternKeys, volume, knobs, shownBar: -1, hitTimer: null });
  });

  function toggleChannel(index, value) {
    E.toggle(index, value);
    const channel = E.channels[index];
    say(`<b>${channel.name}</b> — ${channel.state.on ? 'включён' : 'выключен'}`);
  }

  /* --- Отрисовка состояния пульта --- */

  let currentBar = 0;

  // Огоньки показывают рисунок того такта, который сейчас играет у этого голоса
  function renderSteps(index, force = false) {
    const card = cards[index], channel = E.channels[index];
    const barsInCycle = channel.def.length / M.STEPS_PER_BAR;
    const bar = currentBar % barsInCycle;
    if (!force && bar === card.shownBar) return;
    card.shownBar = bar;
    card.steps.forEach((led, i) => {
      const notes = channel.table[bar * M.STEPS_PER_BAR + i];
      const velocity = notes.length ? Math.max(...notes.map((n) => n.vel)) : 0;
      led.classList.toggle('has-note', velocity > 0);
      led.style.setProperty('--v', velocity.toFixed(2));
    });
  }

  function renderChannel(index) {
    const card = cards[index], channel = E.channels[index], s = channel.state;
    const audible = E.isAudible(index);
    const silenced = s.on && !audible;

    card.root.classList.toggle('is-on', s.on);
    card.root.classList.toggle('is-solo', s.solo);
    card.root.classList.toggle('is-silenced', silenced);
    card.ref('power').setAttribute('aria-pressed', String(s.on));
    card.ref('power').setAttribute('aria-label', `${s.on ? 'Выключить' : 'Включить'}: ${channel.name} (${index + 1})`);
    card.ref('solo').setAttribute('aria-pressed', String(s.solo));
    card.ref('state').textContent = s.solo ? 'SOLO' : silenced ? 'ТИХО' : s.on ? 'ON' : 'OFF';

    card.patternKeys.forEach((key, p) => {
      key.setAttribute('aria-pressed', String(p === s.pattern));
      key.classList.toggle('is-pending', p === s.pendingPattern && p !== s.pattern);
    });
    const pattern = channel.def.patterns[s.pattern];
    card.ref('pattern').textContent = `${LETTERS[s.pattern]} · ${pattern.name}${s.variation ? ' ~' : ''}`;

    const varyPending = Boolean(s.pendingVariation && !s.pendingVariation.reset);
    const resetPending = Boolean(s.pendingVariation && s.pendingVariation.reset);
    const vary = card.ref('vary'), reset = card.ref('reset');
    vary.classList.toggle('is-pending', varyPending);
    vary.classList.toggle('is-active', Boolean(s.variation) && !s.pendingVariation);
    reset.disabled = !s.variation && !s.pendingVariation;
    reset.classList.toggle('is-pending', resetPending);

    // Строка под огоньками: что происходит с голосом прямо сейчас
    let note = '', pending = true;
    if (s.pendingPattern !== null && s.pendingPattern !== s.pattern) {
      note = `→ ${LETTERS[s.pendingPattern]} «${channel.def.patterns[s.pendingPattern].name}» с начала такта`;
    } else if (varyPending) note = '→ вариация с начала такта';
    else if (resetPending) note = '→ исходный рисунок с начала такта';
    else {
      pending = false;
      if (silenced) note = 'тихо: Solo у другого голоса';
      else if (!s.on) note = `выключен · ⏻ или клавиша ${index + 1}`;
      else if (s.variation) note = 'играет вариация · ⟲ вернёт исходный';
      else note = E.isPlaying() ? 'играет' : 'готов · ждёт ▶';
    }
    const noteEl = card.ref('note');
    noteEl.textContent = note;
    noteEl.classList.toggle('is-pending', pending);

    renderSteps(index, true);
    renderVoiceCount();
  }

  const renderAll = () => E.channels.forEach((c, i) => renderChannel(i));

  function renderVoiceCount() {
    const audible = E.channels.filter((c, i) => E.isAudible(i)).length;
    $('#voices').textContent = `${audible}/${E.channels.length}`;
  }

  /* ==================== 5. События движка ==================== */

  const bars = $$('#bars li');

  E.on('channel', (index) => renderChannel(index));

  E.on('applied', (index) => {
    renderChannel(index);
    const channel = E.channels[index], s = channel.state;
    const pattern = channel.def.patterns[s.pattern];
    say(`<b>${channel.name}</b> · ${s.variation ? 'вариация паттерна ' : 'паттерн '}${LETTERS[s.pattern]} «${pattern.name}» играет`);
  });

  E.on('step', ({ step, bar, chord, hits }) => {
    const playing = E.isPlaying();
    if (bar !== currentBar || !playing) {
      currentBar = bar;
      cards.forEach((card, i) => renderSteps(i));
    }
    bars.forEach((li, i) => li.classList.toggle('is-now', playing && i === bar % M.CYCLE_BARS));
    $('#chord').textContent = chord;

    const inBar = step % M.STEPS_PER_BAR;
    cards.forEach((card) => card.steps.forEach((led, i) => led.classList.toggle('is-now', playing && i === inBar)));

    // Вспышки — только у голосов, которые действительно сыграли ноту на этом шаге
    hits.forEach(({ index }) => {
      const card = cards[index];
      card.root.classList.add('is-hit');
      card.steps[inBar].classList.add('is-hit');
      clearTimeout(card.hitTimer);
      card.hitTimer = setTimeout(() => {
        card.root.classList.remove('is-hit');
        card.steps.forEach((led) => led.classList.remove('is-hit'));
      }, 110);
    });
  });

  E.on('transport', ({ playing }) => {
    win.classList.toggle('is-playing', playing);
    $('#playBtn').classList.toggle('is-active', playing);
    $('#playBtn').setAttribute('aria-pressed', String(playing));
    if (!playing) {
      cards.forEach((card) => card.steps.forEach((led) => led.classList.remove('is-now', 'is-hit')));
      bars.forEach((li) => li.classList.remove('is-now'));
    }
    renderAll();
    sayDefault();
  });

  /* ==================== 6. Транспорт, темп, название трека и запись ==================== */

  const win = $('#win');

  function play() {
    if (win.classList.contains('is-off') || E.isPlaying()) return;
    E.start();
  }

  function stop() {
    E.stop();
    // Запись дописывает хвост реверберации и эха и заканчивается сама
    if (E.isRecording() && !recordBusy) finishRecording(2000);
  }

  $('#playBtn').addEventListener('click', play);
  $('#stopBtn').addEventListener('click', stop);

  // Темп меняется ручкой ТЕМП, перетаскиванием числа на дисплее или стрелками рядом
  const TEMPO = { min: 60, max: 360, step: 1 };

  function setTempo(bpm, byUser, source) {
    E.setTempo(bpm);
    if (source !== tempoKnob) tempoKnob.set(bpm, false, true);
    if (source !== bpmValue) bpmValue.set(bpm, false, true);
    if (byUser) say(`Темп <b>${bpm}</b> BPM`);
  }

  buildKnob($('#tempoKnob'));
  const tempoKnob = new Control($('#tempoKnob'), {
    ...TEMPO, value: M.BPM, label: 'Темп', format: (v) => v + ' BPM',
    onInput: (v, byUser) => setTempo(v, byUser, tempoKnob),
  });
  const bpmValue = new Control($('#bpm'), {
    ...TEMPO, kind: 'value', value: M.BPM, label: 'Темп, BPM', format: (v) => v + ' BPM',
    renderValue: (v) => { $('#bpm').textContent = v; },
    onInput: (v, byUser) => setTempo(v, byUser, bpmValue),
  });
  $('#bpmDown').addEventListener('click', () => tempoKnob.set(Math.max(TEMPO.min, tempoKnob.value - 1), true));
  $('#bpmUp').addEventListener('click', () => tempoKnob.set(Math.min(TEMPO.max, tempoKnob.value + 1), true));

  $('#key').textContent = M.KEY;

  /* --- Название трека: клик по названию на дисплее, Enter — сохранить, Esc — отменить --- */

  const NAME_KEY = 'drift.trackName';
  const DEFAULT_NAME = 'Дрейф';
  const nameButton = $('#trackName');
  const nameInput = $('#trackInput');
  let trackName = DEFAULT_NAME;

  try { trackName = localStorage.getItem(NAME_KEY) || DEFAULT_NAME; } catch (err) { /* без хранилища — имя по умолчанию */ }

  function showName() {
    nameButton.textContent = trackName;
    nameButton.classList.toggle('is-long', trackName.length > 8 && trackName.length <= 14);
    nameButton.classList.toggle('is-longer', trackName.length > 14);
    $('#titleName').textContent = trackName.toUpperCase();
    document.title = `Air.exe · ${trackName}`;
  }

  function startRename() {
    nameInput.value = trackName;
    nameButton.hidden = true;
    nameInput.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  function finishRename(save) {
    if (nameInput.hidden) return;
    const value = nameInput.value.replace(/\s+/g, ' ').trim();
    if (save && value && value !== trackName) {
      trackName = value;
      try { localStorage.setItem(NAME_KEY, trackName); } catch (err) { /* имя останется до перезагрузки */ }
      say(`Трек называется <b>${escapeHtml(trackName)}</b>`);
    }
    nameInput.hidden = true;
    nameButton.hidden = false;
    showName();
  }

  nameButton.addEventListener('click', startRename);
  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // цифры в названии не включают голоса
    if (e.key === 'Enter') { e.preventDefault(); finishRename(true); nameButton.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); finishRename(false); nameButton.focus(); }
  });
  nameInput.addEventListener('blur', () => finishRename(true));

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Имя файла из названия трека: без запрещённых символов
  function fileName(ext) {
    const base = trackName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'drift';
    return `${base}.${ext}`;
  }

  /* --- Запись: ● пишет то, что звучит на выходе, и отдаёт файл с названием трека --- */

  const recBtn = $('#recBtn');
  let recordBusy = false;
  let recordTail = null;

  function showRecording() {
    const on = E.isRecording();
    recBtn.classList.toggle('is-active', on);
    recBtn.classList.toggle('is-busy', recordBusy);
    recBtn.setAttribute('aria-pressed', String(on));
    recBtn.setAttribute('aria-label', on ? 'Закончить запись' : 'Запись');
    $('#recInfo').hidden = !on;
  }

  async function startRecording() {
    if (recordBusy || E.isRecording()) return;
    if (win.classList.contains('is-off')) return;
    if (!E.canRecord()) {
      say('Этот браузер не умеет записывать звук — попробуй Chrome, Firefox или Safari');
      return;
    }
    recordBusy = true;
    showRecording();
    try {
      await E.startRecording();
      play(); // запись без музыки бессмысленна — сразу включаем
      say(`● Запись <b>${escapeHtml(trackName)}</b>. Нажми ● ещё раз, чтобы закончить`);
    } catch (err) {
      console.warn(err);
      say('Не получилось начать запись');
    }
    recordBusy = false;
    showRecording();
  }

  async function finishRecording(tailMs = 0) {
    if (!E.isRecording() || recordBusy) return;
    recordBusy = true;
    showRecording();
    if (tailMs) {
      say('Музыка остановлена — запись дописывает хвост эха…', true);
      await new Promise((resolve) => { recordTail = setTimeout(resolve, tailMs); });
      recordTail = null;
    }
    let result = null;
    try {
      result = await E.stopRecording();
    } catch (err) {
      console.warn(err);
    }
    recordBusy = false;
    showRecording();
    if (!result || !result.blob || !result.blob.size) {
      say('Запись пустая — ничего не сохранено');
      return;
    }
    await saveFile(fileName(result.ext), result.blob);
  }

  // На claude.ai файл отдаётся через окно подтверждения, в обычном браузере — обычной загрузкой
  async function saveFile(name, blob) {
    let downloads = null;
    try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (err) { downloads = null; }
    if (downloads) {
      try {
        await downloads.save({ filename: name, data: blob });
        say(`Запись сохранена: <b>${escapeHtml(name)}</b>`);
      } catch (err) {
        say(err && err.code === 'declined' ? 'Сохранение отменено' : 'Не получилось сохранить запись');
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Запись сохранена: <b>${escapeHtml(name)}</b>`);
  }

  function toggleRecording() {
    if (E.isRecording()) finishRecording(0);
    else startRecording();
  }

  recBtn.addEventListener('click', toggleRecording);

  /* ==================== 7. Окно, меню, справка ==================== */

  function powerOff() {
    E.stop();
    if (E.isRecording()) finishRecording(0);
    win.classList.add('is-off');
    $('#powerOn').focus();
  }

  $('#powerOn').addEventListener('click', () => {
    win.classList.remove('is-off');
    play();
  });

  let compact = false;
  function toggleCompact() {
    compact = !compact;
    cards.forEach((card) => card.root.classList.toggle('is-compact', compact));
  }

  $('#btnMin').addEventListener('click', toggleCompact);
  $('#btnMax').addEventListener('click', () => runAction('wide'));
  $('#btnClose').addEventListener('click', powerOff);

  // --- Меню ---
  const menubar = $('#menubar');
  let openedMenu = null;

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
    const checked = { knobs: !compact, wide: win.classList.contains('is-wide') };
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
      runAction(item.dataset.action);
    }
  });

  menubar.addEventListener('pointerover', (e) => {
    const button = e.target.closest('.menu__button');
    if (button && openedMenu && button.parentElement !== openedMenu) openMenu(button.parentElement);
  });

  document.addEventListener('pointerdown', (e) => {
    if (openedMenu && !e.target.closest('#menubar')) closeMenus();
  });

  function runAction(action) {
    switch (action) {
      case 'play': if (E.isPlaying()) stop(); else play(); break;
      case 'restart': E.stop(); play(); break;
      case 'record': toggleRecording(); break;
      case 'rename': startRename(); break;
      case 'power': powerOff(); break;
      case 'all-on': E.channels.forEach((c, i) => E.toggle(i, true)); say('Включены все голоса'); break;
      case 'all-off':
        E.channels.forEach((c, i) => { if (c.state.solo) E.toggleSolo(i); });
        E.channels.forEach((c, i) => E.toggle(i, false));
        say('Все голоса выключены');
        break;
      case 'solo-off':
        E.channels.forEach((c, i) => { if (c.state.solo) E.toggleSolo(i); });
        say('Solo снято');
        break;
      case 'originals': E.channels.forEach((c, i) => E.resetVariation(i)); say('Все голоса возвращаются к исходным рисункам'); break;
      case 'sound-reset':
        cards.forEach((card) => { card.volume.set(card.volume.def); card.knobs.forEach((k) => k.set(k.def)); });
        say('Громкость и тембр сброшены');
        break;
      case 'compact': toggleCompact(); break;
      case 'wide': win.classList.toggle('is-wide'); sizeCanvas(); break;
      case 'help': showDialog('КАК ИГРАТЬ', HELP_HTML); break;
      case 'about': showDialog('О ДРЕЙФЕ', ABOUT_HTML); break;
    }
  }

  // --- Справка ---
  const dialog = $('#dlg');

  function showDialog(title, html) {
    $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = html;
    dialog.showModal();
  }
  $('#dlgOk').addEventListener('click', () => dialog.close());
  $('#dlgX').addEventListener('click', () => dialog.close());

  const HELP_HTML = `
    <h3>Начало</h3>
    <p>Нажми ▶ — вступит Туман, медленные аккорды. Остальные голоса добавляй по одному кнопкой ⏻ на пульте или цифрами 1–6.
      Все голоса играют в ми миноре по одному циклу из четырёх тактов, поэтому любое сочетание звучит цельно.</p>
    <h3>Пульт голоса</h3>
    <p>Экран показывает имя, состояние (ON, OFF, SOLO, ТИХО), текущий паттерн и 16 шагов такта. Шаг вспыхивает,
      когда голос действительно сыграл ноту. SOLO оставляет один голос, остальные включённые молчат и штрихуются.</p>
    <h3>Паттерны и вариации</h3>
    <p>A, B, C — три рисунка партии. Во время игры выбранный паттерн ждёт начала такта: кнопка мигает пунктиром,
      на экране написано, что вступит. «Вариация» меняет рисунок, сохраняя характер, «Исходный» возвращает его.</p>
    <h3>Ручки и фейдеры</h3>
    <p>Тяни вверх-вниз или крути колесом. Shift — точнее, двойной клик — сброс. Темп от 60 до 360 BPM — ручкой ТЕМП, числом на дисплее или стрелками.</p>
    <h3>Название и запись</h3>
    <p>Нажми на название на дисплее, впиши своё и нажми Enter — оно запомнится. Красная кнопка ● записывает всё, что звучит,
      и включает музыку, если она стояла. Нажми ● ещё раз или ■ — получишь файл с названием трека (webm, в Safari — mp4).</p>`;

  const ABOUT_HTML = `<p>Synth Player · Дрейф — инструмент для медленной электроники: шесть синтезированных голосов,
    по три паттерна у каждого, общий транспорт, Solo, вариации и смены на границе такта.
    Звук — Tone.js 14.8, музыка и паттерны — оригинальные.</p>`;

  // Цифры 1–6 включают и выключают голоса, Esc закрывает меню
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || dialog.open) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= E.channels.length) {
      e.preventDefault();
      toggleChannel(n - 1);
    }
  });

  /* ==================== 8. Спектр и индикатор уровня ==================== */

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

  const meter = $('#meter');
  const SEGMENTS = 14;
  const segments = Array.from({ length: SEGMENTS }, (_, i) => {
    const seg = document.createElement('i');
    if (i >= SEGMENTS - 3) seg.className = 'is-hot';
    meter.appendChild(seg);
    return seg;
  });

  function draw() {
    requestAnimationFrame(draw);

    // Индикатор уровня на выходе: −48…0 дБ
    const db = E.level();
    const lit = Number.isFinite(db) ? Math.round(clamp01((db + 48) / 48) * SEGMENTS) : 0;
    segments.forEach((seg, i) => seg.classList.toggle('is-lit', i < lit));

    if (E.isRecording()) {
      const t = Math.floor(E.recordingTime());
      $('#recTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }

    if (!canvasWidth) return;
    const w = canvasWidth, h = canvasHeight, mid = h / 2;
    const unit = w / 500;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(190, 215, 255, 0.35)';
    for (let x = 0; x < w; x += 6 * unit) ctx.fillRect(x, mid - 0.5, 3 * unit, 1);

    // Зеркальный спектр: низы в центре, верха по краям
    const spectrum = E.spectrum();
    if (!spectrum || typeof spectrum.length !== 'number') return;
    ctx.fillStyle = LCD_INK;
    ctx.shadowColor = 'rgba(140, 195, 255, 0.8)';
    ctx.shadowBlur = 6 * unit;
    const count = Math.max(20, Math.floor(w / (6 * unit))), barWidth = w / count;
    if (smoothed.length !== count) smoothed = new Array(count).fill(0);
    for (let j = 0; j < count; j++) {
      const distance = Math.abs(j - (count - 1) / 2) / (count / 2);
      const bin = Math.min(spectrum.length - 1, Math.floor(Math.pow(distance, 1.8) * spectrum.length * 0.55) + 1);
      const level = Number.isFinite(spectrum[bin]) ? clamp01((spectrum[bin] + 95) / 70) : 0;
      smoothed[j] = Math.max(level, smoothed[j] * 0.88);
      const barHeight = smoothed[j] * mid * 0.95;
      if (barHeight > 1) ctx.fillRect(j * barWidth + barWidth * 0.2, mid - barHeight, barWidth * 0.6, barHeight * 2);
    }
    ctx.shadowBlur = 0;
  }

  window.addEventListener('resize', sizeCanvas);

  /* ==================== 9. Старт ==================== */

  // Сначала включён только Туман: музыка начинается с фона, остальное добавляется руками
  E.toggle(M.CHANNELS.findIndex((c) => c.id === 'fog'), true);
  showName();
  showRecording();
  renderAll();
  sizeCanvas();
  requestAnimationFrame(draw);
  say('Нажми <b>▶</b> — вступит <b>Туман</b>. Потом добавляй голоса кнопкой <b>⏻</b> или цифрами <b>1–6</b>.', true);
})();
