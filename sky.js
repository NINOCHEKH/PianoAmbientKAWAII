/*
 * AIR.EXE — небо
 * Рисует пушистые кучевые облака на canvas один раз при загрузке и раскладывает их
 * по трём слоям, которые плывут с разной скоростью (анимация — в style.css).
 * Плюс звёздочки-блёстки, которые мерцают каждая в своём ритме.
 * К звуку и интерфейсу отношения не имеет — только декорация.
 */
(() => {
  'use strict';

  const sky = document.querySelector('.sky');
  if (!sky) return;

  // Повторяемый генератор случайных чисел: облака каждый раз одинаковые
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Один «клубок» облака: светлый сверху, серо-голубой снизу, очень мягкий край ---------- */

  const puffCanvas = document.createElement('canvas');
  const puffCtx = puffCanvas.getContext('2d');

  function drawPuff(ctx, x, y, r, shade) {
    const size = Math.ceil(r * 2) + 2;
    puffCanvas.width = size;
    puffCanvas.height = size;
    const c = size / 2;

    const light = puffCtx.createLinearGradient(0, 0, 0, size);
    light.addColorStop(0, '#ffffff');
    light.addColorStop(0.5, '#f7f9fd');
    light.addColorStop(1, `rgb(${196 - shade * 40}, ${204 - shade * 38}, ${220 - shade * 30})`);
    puffCtx.fillStyle = light;
    puffCtx.fillRect(0, 0, size, size);

    // Мягкий край: клубки сливаются друг с другом, а не лежат «бусинами»
    puffCtx.globalCompositeOperation = 'destination-in';
    const edge = puffCtx.createRadialGradient(c, c, 0, c, c, r);
    edge.addColorStop(0, 'rgba(0, 0, 0, 1)');
    edge.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
    edge.addColorStop(0.78, 'rgba(0, 0, 0, 0.6)');
    edge.addColorStop(1, 'rgba(0, 0, 0, 0)');
    puffCtx.fillStyle = edge;
    puffCtx.fillRect(0, 0, size, size);
    puffCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(puffCanvas, x - c, y - c);
  }

  function softDot(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ---------- Кучевое облако: тёмное плоское основание, сверху купол из мягких клубков,
     внутри «ватная» фактура, снизу тень ---------- */

  function makeCloud(seed, width, height, lumpy = 1) {
    const rnd = random(seed);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const base = height * 0.74;

    // Основание — широкое плоское серое облачко
    ctx.save();
    ctx.translate(width / 2, base);
    ctx.scale(1, 0.22);
    softDot(ctx, 0, 0, width * 0.38, 'rgba(176, 186, 206, 1)');
    ctx.restore();

    // Купол из больших клубков и клубки поменьше поверх них
    const puffs = [];
    const count = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const dome = Math.sin(Math.PI * (0.1 + t * 0.8));
      const r = width * (0.085 + 0.1 * dome * (0.8 + rnd() * 0.4));
      const x = width * (0.17 + 0.66 * t) + (rnd() - 0.5) * width * 0.04;
      const y = Math.max(r + 6, base - r * 0.45 - dome * height * (0.1 + rnd() * 0.1));
      puffs.push({ x, y, r, shade: 0.6 });
      const extra = Math.round((1 + rnd() * 1.5) * lumpy);
      for (let k = 0; k < extra; k++) {
        const angle = -Math.PI * (0.25 + rnd() * 0.5);
        const d = r * (0.45 + rnd() * 0.25);
        const rr = r * (0.5 + rnd() * 0.2);
        puffs.push({ x: x + Math.cos(angle) * d, y: Math.max(rr + 4, y + Math.sin(angle) * d), r: rr, shade: 0.2 });
      }
    }
    puffs.sort((a, b) => b.y + b.r - (a.y + a.r));
    puffs.forEach((p) => drawPuff(ctx, p.x, p.y, p.r, p.shade));

    // Ватная фактура и тень — только внутри облака
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 160; i++) {
      const x = width * (0.1 + rnd() * 0.8);
      const y = height * (0.05 + rnd() * 0.75);
      const r = width * (0.015 + rnd() * 0.04);
      const low = y / base;
      softDot(ctx, x, y, r, rnd() < 0.55 - low * 0.3
        ? `rgba(255, 255, 255, ${0.35 + rnd() * 0.3})`
        : `rgba(${130 + rnd() * 30}, ${142 + rnd() * 30}, ${170 + rnd() * 25}, ${0.08 + low * 0.14})`);
    }
    const under = ctx.createLinearGradient(0, base - height * 0.2, 0, base + height * 0.08);
    under.addColorStop(0, 'rgba(120, 134, 165, 0)');
    under.addColorStop(1, 'rgba(105, 118, 150, 0.62)');
    ctx.fillStyle = under;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    // Лёгкое размытие — край как у настоящего облака
    const soft = document.createElement('canvas');
    soft.width = width;
    soft.height = height;
    const softCtx = soft.getContext('2d');
    softCtx.filter = 'blur(1.6px)';
    softCtx.drawImage(canvas, 0, 0);
    return soft.toDataURL('image/png');
  }

  /* ---------- Раскладка по слоям ----------
   * Каждый слой шириной в два экрана: всё, что лежит в первой половине, повторяется
   * во второй (x + 100vw), поэтому, когда слой сдвигается на экран, шва не видно.
   * [зерно, x vw, y vh, ширина vw]
   */
  const LAYERS = {
    far: { lumpy: 0.6, items: [[11, 2, 58, 7], [12, 24, 40, 5], [13, 41, 70, 8], [14, 63, 52, 6], [15, 80, 64, 7], [16, 92, 44, 5], [17, 54, 86, 6]] },
    mid: { lumpy: 1, items: [[21, 6, 22, 17], [22, 33, 50, 14], [23, 58, 18, 16], [24, 79, 46, 15]] },
    near: { lumpy: 1.3, items: [[31, -6, -4, 30], [32, 28, 64, 34], [33, 55, -8, 28], [34, 76, 70, 30]] },
  };

  Object.entries(LAYERS).forEach(([name, layer]) => {
    const el = sky.querySelector(`.sky__layer--${name}`);
    if (!el) return;
    layer.items.forEach(([seed, x, y, w]) => {
      const url = makeCloud(seed, 640, 400, layer.lumpy);
      [0, 100].forEach((offset) => {
        const img = document.createElement('img');
        img.className = 'sky__cloud';
        img.src = url;
        img.alt = '';
        img.style.left = `${x + offset}vw`;
        img.style.top = `${y}vh`;
        img.style.width = `${w}vw`;
        el.appendChild(img);
      });
    });
  });

  /* ---------- Звёздочки: большие с лучами и мелкие точки, каждая мерцает по-своему ---------- */

  const sparkles = sky.querySelector('.sky__sparkles');
  if (sparkles) {
    const rnd = random(77);
    const make = (cls, count) => {
      for (let i = 0; i < count; i++) {
        const x = rnd() * 100, y = rnd() * 100;
        const size = cls === 'spark' ? 2 + rnd() * 3 : 0.18 + rnd() * 0.22;
        const delay = (-rnd() * 4).toFixed(2), duration = (1.6 + rnd() * 2.4).toFixed(2);
        [0, 100].forEach((offset) => {
          const s = document.createElement('i');
          s.className = cls;
          s.style.left = `${x + offset}vw`;
          s.style.top = `${y}vh`;
          s.style.setProperty('--s', `${size}vw`);
          s.style.animationDelay = `${delay}s`;
          s.style.animationDuration = `${duration}s`;
          sparkles.appendChild(s);
        });
      }
    };
    make('spark', 11);
    make('dot', 26);
  }
})();
