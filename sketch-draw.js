/*!
 * sketch-draw.js — efeito "UI sendo gerada" (sketch draw) em HTML/CSS/JS puro.
 * Sem dependências. Expõe window.SketchDraw = { generate, auto, reducedMotion, DEFAULT_MARK, T }.
 *
 * Uma única <canvas> por elemento, num overlay absoluto que transborda o alvo. A geometria
 * é calculada uma vez em Float32Array; cada frame só pinta. A canvas é liberada no fim.
 */
(function (global) {
  "use strict";

  /* ───────────── Coreografia: marcos em ms a partir do início do efeito ───────────── */
  const T = {
    logoHold: 220,       // a marca central fica inteira ao menos até aqui
    logoDissolve: 400,   // duração da dissolução da marca
    dots: [80, 480],     // onda de pontos da grade: início → fim
    guides: [100, 420],  // guias pontilhadas crescendo do centro de cada linha
    outline: [160, 560], // contorno do elemento (duas metades a partir do topo-centro)
    partsMin: 360,       // partes internas nunca começam antes disso
    partsLen: 340,       // janela da cascata de partes internas
    revealMin: 520,      // reveal do elemento real nunca antes disso
    revealAfter: 160,    // ...e no mínimo 160 ms depois do "complete"
    cleanMin: 640,       // limpeza da planta nunca antes disso
    cleanAfter: 280,     // ...e no mínimo 280 ms depois do "complete"
    cleanLen: 260,       // duração do fade da planta
    holdMax: 8000,       // conteúdo que nunca "completa" não segura o elemento escondido para sempre
  };

  const GRID = 15;            // passo da grade de pontos (px)
  const MARGIN = 44;          // quanto a planta transborda o elemento (px)
  const STROKE_MARGIN = 8;    // variante "stroke": só cabe o traço e o brilho da ponta
  const STROKE_GAP = 4;       // espaçamento do pontilhado da linha (px de tela)
  const STROKE_MAX_DOTS = 600;
  const MAX_DOTS = 1400;      // teto de pontos da grade (acima disso o passo cresce)
  const MAX_PARTS = 40;       // teto de partes internas desenhadas
  const MAX_NODES = 600;      // teto de nós do DOM lidos pelo scan
  const PIXEL_BUDGET = 1.5e6; // teto de pixels da canvas (acima disso o DPR cai)
  const LOGO_MAX = 48;        // caixa máxima da marca central (px)
  const LOGO_GAP = 2.4;       // passo da grade hexagonal da marca (px)
  const LOGO_DOT = 0.8;       // raio dos pontos da marca (px)
  const LOGO_ALPHA = 0.6;     // opacidade da marca
  const LOGO_SOFT = 0.25;     // largura da faixa de dissolução de cada ponto (0–1)
  const TAU = 6.2832;

  /* Marca central desenhada em pontos: paths SVG num viewBox w × h. Troque pela sua. */
  const DEFAULT_MARK = {
    w: 166,
    h: 150,
    paths: [
      "M58.0088 0L107.009 27V150L58.0771 122L58.0088 0Z",
      "M3.00288 142.5C3.00288 142.5 0.00878906 143 0.00287868 139.5C-0.0030317 136 0.00161017 37.5 0.00287868 34C0.00414719 30.5 3.00288 28.9998 3.00288 28.9998L51.0029 0V122L3.00288 142.5Z",
      "M162.009 7.02466C162.009 7.02466 165.003 6.52466 165.009 10.0247C165.015 13.5247 165.01 112.025 165.009 115.525C165.008 119.025 162.009 120.525 162.009 120.525L114.009 149.525V27.5249L162.009 7.02466Z",
    ],
  };

  /* ───────────────────────────── Utilitários ───────────────────────────── */

  const clamp = (v) => Math.max(0, Math.min(1, v));
  /** Progresso 0→1 entre `a` e `b`. Início infinito (ainda não completou) dá 0, não NaN. */
  const seg = (t, a, b) => (b > a ? clamp((t - a) / (b - a)) : t >= a ? 1 : 0);
  /** Smoothstep. */
  const smooth = (x) => x * x * (3 - 2 * x);
  const pad = (v) => String(Math.max(0, Math.round(v))).padStart(3, "0");
  /** Pseudoaleatório determinístico 0–1: o mesmo ponto cintila igual em todo frame. */
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** cubic-bezier(x1, y1, x2, y2) do CSS como função JS (bisseção em t). */
  function cubicBezier(x1, y1, x2, y2) {
    const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
    const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = 0.5;
      for (let i = 0; i < 20; i++) {
        t = (lo + hi) / 2;
        if (bx(t) < x) lo = t;
        else hi = t;
      }
      return by(t);
    };
  }

  /* Tokens de motion lidos uma vez por página (com fallback): curva do traço e duração do reveal. */
  let tokens = null;
  function motion() {
    if (tokens) return tokens;
    const css = getComputedStyle(document.documentElement);
    const m = css.getPropertyValue("--ease-smooth-out").match(/cubic-bezier\(([^)]+)\)/);
    const n = m ? m[1].split(",").map(Number) : null;
    const raw = css.getPropertyValue("--duration-slow").trim();
    const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
    tokens = {
      ease: n && n.length === 4 && n.every(Number.isFinite) ? cubicBezier(n[0], n[1], n[2], n[3]) : cubicBezier(0.22, 1, 0.36, 1),
      revealMs: Number.isFinite(ms) ? ms : 400,
    };
    return tokens;
  }

  function rgba(color, a) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    const p = m ? m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).join(",") : "255,255,255";
    return `rgba(${p},${a})`;
  }

  /* ───────────────────────────── Geometria ───────────────────────────── */

  /** Reamostra uma polilinha densa em pontos a cada `gap` px de comprimento. */
  function resample(v, gap) {
    const out = [v[0], v[1]];
    let carry = 0;
    for (let i = 2; i < v.length; i += 2) {
      const x0 = v[i - 2], y0 = v[i - 1];
      const dx = v[i] - x0, dy = v[i + 1] - y0;
      const len = Math.hypot(dx, dy);
      let d = gap - carry;
      while (d <= len) {
        out.push(x0 + (dx * d) / len, y0 + (dy * d) / len);
        d += gap;
      }
      carry = len - (d - gap);
    }
    return Float32Array.from(out);
  }

  function arc(v, cx, cy, r, a0, a1) {
    const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / 3));
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      v.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  }

  /** Meio retângulo arredondado a partir do topo-centro; as duas metades juntas fecham o contorno. */
  function halfRect(x, y, w, h, r, right, gap) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const P = Math.PI;
    const v = [x + w / 2, y];
    if (right) {
      v.push(x + w - r, y);
      arc(v, x + w - r, y + r, r, -P / 2, 0);
      v.push(x + w, y + h - r);
      arc(v, x + w - r, y + h - r, r, 0, P / 2);
    } else {
      v.push(x + r, y);
      arc(v, x + r, y + r, r, -P / 2, -P);
      v.push(x, y + h - r);
      arc(v, x + r, y + h - r, r, P, P / 2);
    }
    v.push(x + w / 2, y + h);
    return resample(v, gap);
  }

  const segment = (x0, y0, x1, y1, gap) => resample([x0, y0, x1, y1], gap);

  function alphaOf(color) {
    const m = String(color).match(/rgba?\(([^)]+)\)/);
    if (!m) return color && color !== "transparent" ? 1 : 0;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 4) return 1;
    return /%$/.test(p[3]) ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
  }

  /** Amostra o traço de um SVGGeometryElement em pontos de tela, relativos a `box`. */
  function sampleSvg(s, box, step, maxN, minN) {
    const m = s.getScreenCTM();
    let len = 0;
    try {
      len = s.getTotalLength();
    } catch {
      return null;
    }
    if (!m || !len) return null;
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const n = Math.min(maxN, Math.max(minN, Math.ceil((len * scale) / step)));
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const p = s.getPointAtLength((len * k) / (n - 1));
      pts[k * 2] = m.a * p.x + m.c * p.y + m.e - box.left;
      pts[k * 2 + 1] = m.b * p.x + m.d * p.y + m.f - box.top;
    }
    return pts;
  }

  /** Lê o elemento e devolve as partes desenháveis: caixas, linhas de texto e ícones SVG pequenos. */
  function scanParts(el, maxParts) {
    const box = el.getBoundingClientRect();
    const area = box.width * box.height;
    const parts = [];
    const nodes = el.querySelectorAll("*");
    const limit = Math.min(nodes.length, MAX_NODES);

    for (let i = 0; i < limit && parts.length < maxParts; i++) {
      const node = nodes[i];
      if (node instanceof SVGElement && !(node instanceof SVGSVGElement)) continue;
      if (node.closest("[data-gen-ignore]")) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(node);
      if (cs.visibility === "hidden") continue;
      const x = r.left - box.left;
      const y = r.top - box.top;

      // SVG pequeno é ícone: amostra até 6 traços. Gráfico grande fica de fora.
      if (node instanceof SVGSVGElement) {
        if (r.width <= 160 && r.height <= 160) {
          const wires = [];
          node.querySelectorAll("path,circle,ellipse,rect,line,polyline,polygon").forEach((s) => {
            if (s.closest("defs,clipPath,mask,symbol") || wires.length >= 6) return;
            const pts = sampleSvg(s, box, 3.5, 80, 2);
            if (pts) wires.push({ dots: pts, r: 0.7 });
          });
          if (wires.length) parts.push({ x, y, wires });
        }
        continue;
      }

      // Caixas: fundo, borda, imagem ou mídia/form. O que passa de 60% da área é fundo e fica de fora.
      const big = r.width * r.height > area * 0.6;
      const media = /^(IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(node.tagName);
      const visible = alphaOf(cs.backgroundColor) > 0.02 || parseFloat(cs.borderTopWidth) > 0 || cs.backgroundImage !== "none" || media;
      if (!big && !/blur/.test(cs.filter) && visible) {
        const rad = parseFloat(cs.borderTopLeftRadius) || 0;
        parts.push({ x, y, wires: [true, false].map((right) => ({ dots: halfRect(x, y, r.width, r.height, rad, right, 3.5), r: 0.7 })) });
      }

      // Texto: uma linha pontilhada por linha renderizada, com as pontas marcadas.
      node.childNodes.forEach((t) => {
        if (t.nodeType !== 3 || !t.textContent.trim()) return;
        const range = document.createRange();
        range.selectNodeContents(t);
        const lines = [];
        for (const lr of Array.from(range.getClientRects())) {
          if (lr.width < 2) continue;
          const last = lines[lines.length - 1];
          const ly = lr.top - box.top;
          if (last && Math.abs(last.y - ly) < 2) last.x2 = Math.max(last.x2, lr.right - box.left);
          else lines.push({ x: lr.left - box.left, x2: lr.right - box.left, y: ly, h: lr.height });
        }
        if (lines.length) {
          parts.push({
            x: lines[0].x,
            y: lines[0].y,
            wires: lines.map((ln) => {
              const yy = ln.y + ln.h * 0.56;
              return { dots: segment(ln.x, yy, ln.x2, yy, 3.5), r: 0.8, caps: true };
            }),
          });
        }
      });
    }
    // De cima para baixo, da esquerda para a direita: é a ordem da cascata.
    return parts.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /* ───────────────────────────── Marca central ───────────────────────────── */

  const markCache = new WeakMap();
  function compileMark(mark) {
    let c = markCache.get(mark);
    if (!c) {
      c = { paths: mark.paths.map((d) => new Path2D(d)), w: mark.w, h: mark.h, dots: new Map() };
      markCache.set(mark, c);
    }
    return c;
  }

  /* Pontos que preenchem a marca numa escala: grade hexagonal, só os pontos que cabem INTEIROS
     num dos paths (assim os vãos entre as peças continuam visíveis), e o limiar de dissolução
     de cada ponto. Calculado uma vez por escala. */
  let probe;
  const PROBE = [[0, 0], [-LOGO_DOT, 0], [LOGO_DOT, 0], [0, -LOGO_DOT], [0, LOGO_DOT]];
  function markDots(lg, s) {
    const key = Math.round(s * 1000);
    const hit = lg.dots.get(key);
    if (hit) return hit;
    if (probe === undefined) probe = document.createElement("canvas").getContext("2d");
    const xs = [];
    const rowH = LOGO_GAP * 0.866;
    const W = lg.w * s;
    const H = lg.h * s;
    if (probe) {
      for (let row = 0, y = rowH / 2; y < H; row++, y += rowH)
        for (let x = row % 2 ? LOGO_GAP : LOGO_GAP / 2; x < W; x += LOGO_GAP)
          if (lg.paths.some((p) => PROBE.every(([dx, dy]) => probe.isPointInPath(p, (x + dx) / s, (y + dy) / s)))) xs.push(x, y);
    }
    const n = xs.length / 2;
    const th = new Float32Array(n);
    for (let i = 0; i < n; i++) th[i] = hash(xs[i * 2] * 1.7 + xs[i * 2 + 1] * 9.3);
    const dots = { xy: Float32Array.from(xs), th };
    lg.dots.set(key, dots);
    return dots;
  }

  /* ───────────────────────────── Grade de pontos ───────────────────────────── */

  function buildGrid(w, h) {
    const span = ((w + 2 * MARGIN) / GRID) * ((h + 2 * MARGIN) / GRID);
    const G = Math.max(GRID, Math.ceil(GRID * Math.sqrt(span / MAX_DOTS)));
    const start = -Math.floor(MARGIN / G) * G;
    const xs = [];
    for (let x = start; x <= w + MARGIN; x += G) for (let y = start; y <= h + MARGIN; y += G) xs.push(x, y);
    const n = xs.length / 2;
    const g = { xy: Float32Array.from(xs), d: new Float32Array(n), edge: new Float32Array(n), base: new Float32Array(n), ph: new Float32Array(n), tr: new Float32Array(n), maxD: 0 };
    for (let i = 0; i < n; i++) {
      const x = xs[i * 2];
      const y = xs[i * 2 + 1];
      const seed = x * 7.13 + y * 3.71;
      g.d[i] = Math.hypot(x - w / 2, y - h / 2);                          // distância ao centro
      g.edge[i] = 1 - clamp(Math.max(0, -x, x - w, -y, y - h) / MARGIN);  // some na margem
      g.base[i] = 0.1 + 0.12 * hash(seed);                                // opacidade base 0,10–0,22
      g.ph[i] = hash(seed + 1) * TAU;                                     // fase da cintilação
      g.tr[i] = 120 + 160 * hash(seed + 2);                               // período da cintilação
      if (g.d[i] > g.maxD) g.maxD = g.d[i];
    }
    return g;
  }

  const EMPTY_GRID = { xy: new Float32Array(0), d: new Float32Array(0), edge: new Float32Array(0), base: new Float32Array(0), ph: new Float32Array(0), tr: new Float32Array(0), maxD: 0 };

  /* ───────────────────────────── Layout do overlay ───────────────────────────── */

  /** Canto do overlay no container: o alvo menos a margem onde a planta transborda. */
  function place(el, container, margin) {
    const b = el.getBoundingClientRect();
    const origin = container ? container.getBoundingClientRect() : { left: -scrollX, top: -scrollY };
    return { b, left: b.left - origin.left - margin, top: b.top - origin.top - margin };
  }

  function measure(run, container) {
    const M = run.margin;
    const { b, left, top } = place(run.el, container, M);
    const w = b.width;
    const h = b.height;
    const px = (w + 2 * M) * (h + 2 * M);
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / px)));
    Object.assign(run.layer.style, { left: `${left}px`, top: `${top}px`, width: `${w + 2 * M}px`, height: `${h + 2 * M}px` });
    run.canvas.width = Math.round((w + 2 * M) * dpr);
    run.canvas.height = Math.round((h + 2 * M) * dpr);
    return { b, w, h, dpr, left, top };
  }

  /** Variante "stroke": o traço do <path> em pontos de tela, da origem ao destino. */
  function strokeWire(el, b) {
    const path = el instanceof SVGGeometryElement ? el : el.querySelector("path");
    const pts = path && sampleSvg(path, b, STROKE_GAP, STROKE_MAX_DOTS, 2);
    return { dots: pts || new Float32Array(0), r: 0.8 };
  }

  /** `follow`: o alvo andou (pan) → só reposiciona; mudou de tamanho (zoom) → refaz a planta. */
  function follow(run, container) {
    const { b, left, top } = place(run.el, container, run.margin);
    if (Math.abs(b.width - run.w) > 0.5 || Math.abs(b.height - run.h) > 0.5) {
      run.dirty = true;
      return;
    }
    if (Math.abs(left - run.left) < 0.25 && Math.abs(top - run.top) < 0.25) return;
    run.left = left;
    run.top = top;
    Object.assign(run.layer.style, { left: `${left}px`, top: `${top}px` });
  }

  /** Agenda a cascata de partes internas: cada parte começa um pouco depois da anterior. */
  function schedule(run, at) {
    if (run.variant === "stroke") {
      run.parts = [];
      return;
    }
    const parts = scanParts(run.el, MAX_PARTS);
    const n = parts.length;
    const start = Math.max(T.partsMin, at);
    run.parts = [];
    parts.forEach((part, i) => {
      const t0 = start + (n > 1 ? i / (n - 1) : 0) * T.partsLen * 0.55;
      part.wires.forEach((wire, j) => run.parts.push({ wire, start: t0 + j * 20, dur: T.partsLen * 0.45 }));
    });
  }

  function relayout(run, container) {
    const { b, w, h, dpr, left, top } = measure(run, container);
    Object.assign(run, { w, h, dpr, left, top });
    if (run.variant === "stroke") {
      run.grid = EMPTY_GRID;
      run.outline = [strokeWire(run.el, b)];
      run.dirty = false;
      return;
    }
    run.grid = buildGrid(w, h);
    const radius = parseFloat(getComputedStyle(run.el).borderTopLeftRadius) || 0;
    run.outline = [true, false].map((right) => ({ dots: halfRect(0, 0, w, h, radius, right, 4), r: 0.8 }));
    if (run.parts && run.completeAt !== null) schedule(run, run.completeAt);
    run.dirty = false;
  }

  /* ───────────────────────────── Pintura ───────────────────────────── */

  function dotsPath(path, xy, count, r) {
    for (let k = 0; k < count; k++) {
      const x = xy[k * 2];
      const y = xy[k * 2 + 1];
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, TAU);
    }
  }

  function glowDot(run, x, y, r, a) {
    const { ctx } = run;
    ctx.globalAlpha = a;
    ctx.shadowBlur = 3 * run.dpr;
    ctx.shadowColor = run.glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /** Traço pontilhado desenhado até `p` (0–1), com o ponto brilhante na ponta e as tampas das linhas de texto. */
  function drawWire(run, wire, p, alpha) {
    if (p <= 0 || !wire.dots.length) return;
    const n = wire.dots.length / 2;
    const k = Math.max(1, Math.min(n, Math.ceil(p * n)));
    const path = new Path2D();
    dotsPath(path, wire.dots, k, wire.r);
    run.ctx.globalAlpha = 0.5 * alpha;
    run.ctx.fill(path);
    if (p < 1) glowDot(run, wire.dots[(k - 1) * 2], wire.dots[(k - 1) * 2 + 1], wire.r * 2.8, alpha);
    if (wire.caps) {
      glowDot(run, wire.dots[0], wire.dots[1], 1.7, alpha);
      if (p >= 1) glowDot(run, wire.dots[(n - 1) * 2], wire.dots[(n - 1) * 2 + 1], 1.7, alpha);
    }
  }

  function paint(run, e) {
    const { ctx, w, h, grid } = run;
    const { ease } = motion();
    const cleanStart = run.completeAt === null ? Infinity : Math.max(T.cleanMin, run.completeAt + T.cleanAfter);
    const fade = 1 - smooth(seg(e, cleanStart, cleanStart + T.cleanLen));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, run.canvas.width, run.canvas.height);
    // Origem (0,0) = canto superior esquerdo do ALVO; a margem fica em coordenadas negativas.
    ctx.setTransform(run.dpr, 0, 0, run.dpr, run.margin * run.dpr, run.margin * run.dpr);
    ctx.fillStyle = run.fg;
    ctx.strokeStyle = run.fg;

    // Variante linha: só o traço crescendo da origem ao destino.
    if (run.variant === "stroke") {
      for (const wire of run.outline) drawWire(run, wire, ease(seg(e, T.outline[0], T.outline[1])), fade);
      ctx.globalAlpha = 1;
      return;
    }

    // 1. Pontos: onda radial do centro com crista brilhante. Alpha quantizado em 16 faixas = 16 fills por frame.
    const front = ease(seg(e, T.dots[0], T.dots[1])) * grid.maxD * 1.09;
    const buckets = new Array(17).fill(null);
    const n = grid.d.length;
    for (let i = 0; i < n; i++) {
      const behind = front - grid.d[i];
      if (behind <= 0) continue;
      const crest = Math.max(0, 1 - behind / 24);
      const twinkle = 0.75 + 0.25 * Math.sin(e / grid.tr[i] + grid.ph[i]);
      const a = (grid.base[i] * twinkle + crest * 0.8) * grid.edge[i] * (crest > 0.35 ? 1 : 0.55) * fade;
      const b = Math.min(16, Math.round(a * 16));
      if (b <= 0) continue;
      const path = (buckets[b] ??= new Path2D());
      const x = grid.xy[i * 2];
      const y = grid.xy[i * 2 + 1];
      path.moveTo(x + 1.1, y);
      path.arc(x, y, 1.1, 0, TAU);
    }
    for (let b = 1; b <= 16; b++) {
      if (!buckets[b]) continue;
      ctx.globalAlpha = b / 16;
      ctx.fill(buckets[b]);
    }

    // 2. Guias pontilhadas (as 4 linhas das bordas, prolongadas na margem) crescendo do centro, e label de medida.
    const g = ease(seg(e, T.guides[0], T.guides[1]));
    const gp = g * fade;
    if (gp > 0) {
      ctx.globalAlpha = 0.5 * gp;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.setLineDash([0, 5]); // traço 0 + lineCap round = pontos a cada 5 px
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of [
        [-MARGIN, 0, w + MARGIN, 0],
        [-MARGIN, h, w + MARGIN, h],
        [0, -MARGIN, 0, h + MARGIN],
        [w, -MARGIN, w, h + MARGIN],
      ]) {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        ctx.moveTo(cx + (x1 - cx) * g, cy + (y1 - cy) * g);
        ctx.lineTo(cx + (x2 - cx) * g, cy + (y2 - cy) * g);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.45 * gp;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.fillText(`${Math.round(w)} × ${Math.round(h)}  t+${(e / 1000).toFixed(2)}s`, 0, -10);
    }

    // 3. Marca central em pontos, a 60% desde o primeiro frame. Quando completa, cada ponto
    //    encolhe e some na sua vez (limiar aleatório), até a marca se dissolver por inteiro.
    if (run.mark) {
      const lg = run.mark;
      const s = Math.min(LOGO_MAX / lg.w, LOGO_MAX / lg.h, (0.4 * Math.min(w, h)) / Math.max(lg.w, lg.h));
      const dissolveAt = run.completeAt === null ? Infinity : Math.max(T.logoHold, run.completeAt);
      const dp = seg(e, dissolveAt, dissolveAt + T.logoDissolve);
      if (dp < 1 && s > 0) {
        const dots = markDots(lg, s);
        const ox = w / 2 - (lg.w * s) / 2;
        const oy = h / 2 - (lg.h * s) / 2;
        const path = new Path2D();
        for (let i = 0; i < dots.th.length; i++) {
          const v = clamp((dots.th[i] * (1 - LOGO_SOFT) + LOGO_SOFT - dp) / LOGO_SOFT);
          if (v <= 0) continue;
          const r = LOGO_DOT * v;
          const x = ox + dots.xy[i * 2];
          const y = oy + dots.xy[i * 2 + 1];
          path.moveTo(x + r, y);
          path.arc(x, y, r, 0, TAU);
        }
        ctx.globalAlpha = LOGO_ALPHA;
        ctx.fill(path);
      }
    }

    // 4. Contorno em duas metades a partir do topo-centro, com as coordenadas seguindo a ponta.
    const po = ease(seg(e, T.outline[0], T.outline[1]));
    for (const wire of run.outline) drawWire(run, wire, po, fade);
    if (po > 0 && po < 1) {
      const o = run.outline[0];
      const k = Math.max(0, Math.ceil(po * (o.dots.length / 2)) - 1);
      const x = o.dots[k * 2];
      const y = o.dots[k * 2 + 1];
      ctx.globalAlpha = 0.45 * fade;
      ctx.fillText(`${pad(x)} ${pad(y)}`, x + 6, y - 6);
    }

    // 5. Partes internas em cascata (só depois que o conteúdo completou).
    if (run.parts) for (const p of run.parts) drawWire(run, p.wire, ease(seg(e, p.start, p.start + p.dur)), fade);

    ctx.globalAlpha = 1;
  }

  /* ───────────────────────────── API: um elemento ───────────────────────────── */

  /**
   * Roda o efeito num elemento.
   * @param {HTMLElement|SVGElement} el  alvo: fica invisível e é revelado no fim.
   * @param {object} [opts]
   * @param {number}  [opts.delay=0]        atraso antes de começar (ms)
   * @param {"fade"|"scan"} [opts.reveal="fade"]  fade+desfoque, ou cortina de cima para baixo
   * @param {HTMLElement} [opts.container]  elemento posicionado que recebe o overlay (padrão: body)
   * @param {boolean} [opts.complete=false] o conteúdo já está pronto (sem streaming)
   * @param {boolean} [opts.follow=false]   o alvo anda por transform (pan/zoom): reposiciona a cada frame
   * @param {"box"|"stroke"} [opts.variant="box"]  caixa completa, ou só o traço de um <path>
   * @param {{w:number,h:number,paths:string[]}|null} [opts.mark]  marca central (null desliga)
   * @param {string}  [opts.color]          cor da planta (padrão: var(--foreground), senão a cor herdada)
   * @param {number}  [opts.timeScale=1]    câmera lenta para depurar (2 = metade da velocidade)
   * @returns {{element, finished: Promise<"done"|"cancelled">, cancel(): void, complete(): void}}
   */
  function generate(target, opts = {}) {
    const el = target;
    if (el.__sketchGen) el.__sketchGen.cancel();
    const reveal = opts.reveal || "fade";
    const variant = opts.variant || "box";
    const container = opts.container || null;
    const timeScale = opts.timeScale > 0 ? opts.timeScale : 1;
    const markDef = opts.mark === undefined ? DEFAULT_MARK : opts.mark;
    const prev = { opacity: el.style.opacity, filter: el.style.filter, clipPath: el.style.clipPath, transition: el.style.transition };
    let resolve;
    const finished = new Promise((r) => (resolve = r));
    let raf = 0;
    let timer = 0;
    let run = null;
    let ro = null;
    let done = false;
    let completeEarly = !!opts.complete;
    let t0 = 0;

    function finish(reason) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (ro) ro.disconnect();
      if (run) {
        // Solta o bitmap na hora, sem esperar o coletor.
        run.canvas.width = 0;
        run.canvas.height = 0;
        run.layer.remove();
      }
      Object.assign(el.style, prev);
      el.__sketchGen = null;
      resolve(reason);
    }

    const handle = {
      element: el,
      finished,
      cancel: () => finish("cancelled"),
      complete: () => {
        if (run && run.completeAt === null) run.completeAt = (performance.now() - t0) / timeScale;
        else completeEarly = true;
      },
    };
    el.__sketchGen = handle;
    el.style.opacity = "0";

    // Movimento reduzido: sem planta, só um fade curto.
    if (reducedMotion()) {
      timer = setTimeout(() => {
        el.style.transition = "opacity var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1))";
        el.style.opacity = prev.opacity;
        timer = setTimeout(() => finish("done"), 300);
      }, opts.delay || 0);
      return handle;
    }

    timer = setTimeout(() => {
      raf = requestAnimationFrame((now) => {
        if (done) return;
        const layer = document.createElement("div");
        layer.className = "sketch-gen";
        layer.setAttribute("aria-hidden", "true");
        // Estilo inline: o overlay funciona sem depender de CSS da página.
        Object.assign(layer.style, { position: "absolute", zIndex: "30", pointerEvents: "none" });
        const canvas = document.createElement("canvas");
        Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
        layer.appendChild(canvas);
        (container || document.body).appendChild(layer);
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish("cancelled");
        // Cor do tema resolvida uma vez: a canvas não entende var() nem color-mix().
        layer.style.color = opts.color || "var(--foreground, currentColor)";
        const fg = getComputedStyle(layer).color;
        layer.style.color = "";
        run = {
          el, variant, reveal, layer, canvas, ctx, fg,
          margin: variant === "stroke" ? STROKE_MARGIN : MARGIN,
          mark: variant === "box" && markDef ? compileMark(markDef) : null,
          glow: rgba(fg, 0.85),
          dpr: 1, w: 0, h: 0, left: 0, top: 0,
          grid: EMPTY_GRID, outline: [], parts: null,
          completeAt: completeEarly ? 0 : null,
          revealed: false, dirty: false,
        };
        relayout(run, container);
        // Reveal "fade": o elemento volta de desfocado para nítido junto com a opacidade.
        if (reveal === "fade" && variant === "box") el.style.filter = "blur(6px)";
        // Tamanho muda no meio (conteúdo chegando): refaz a planta no próximo frame.
        ro = new ResizeObserver(() => {
          if (run) run.dirty = true;
        });
        ro.observe(el);
        t0 = now;
        let frame = 0;
        const tick = (time) => {
          if (done || !run) return;
          const e = (time - t0) / timeScale;
          if (opts.follow && !run.dirty) follow(run, container);
          if (run.dirty) relayout(run, container);
          if (run.completeAt === null && e > T.holdMax) run.completeAt = e;
          if (run.completeAt !== null && !run.parts) schedule(run, run.completeAt);
          const holding = run.completeAt === null && e > T.outline[1];
          frame++;
          // Segurando (esperando o conteúdo), metade dos frames basta: só a cintilação muda.
          if (!holding || frame % 2 === 0) paint(run, e);

          if (run.completeAt !== null) {
            const revealAt = Math.max(T.revealMin, run.completeAt + T.revealAfter);
            const cleanStart = Math.max(T.cleanMin, run.completeAt + T.cleanAfter);
            const { revealMs, ease } = motion();
            if (e >= revealAt && !run.revealed) {
              run.revealed = true;
              if (reveal === "fade") {
                const tr = "var(--duration-slow, 400ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1))";
                el.style.transition = `opacity ${tr}, filter ${tr}`;
                el.style.opacity = prev.opacity;
                el.style.filter = prev.filter;
              } else {
                el.style.opacity = prev.opacity;
              }
            }
            if (reveal === "scan" && run.revealed) {
              const rp = ease(clamp((e - revealAt) / revealMs));
              el.style.clipPath = rp >= 1 ? prev.clipPath : `inset(0 0 ${((1 - rp) * 100).toFixed(2)}% 0)`;
            }
            if (e >= Math.max(cleanStart + T.cleanLen, revealAt + revealMs)) return finish("done");
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    }, opts.delay || 0);

    return handle;
  }

  /* ───────────────────── API: vários elementos (orquestração) ─────────────────────
     - um IntersectionObserver para a página inteira, não um por elemento;
     - stagger global de 40 ms entre efeitos, com teto de 400 ms;
     - no máximo `maxRunning` efeitos ao mesmo tempo por faixa (`lane`); o excedente aparece direto;
     - elemento que sai da tela no meio termina na hora e solta a canvas;
     - qualquer clique, tecla ou foco na página encerra todos os efeitos em curso;
     - failsafe de 4 s: página que não pinta (aba em segundo plano) mostra o elemento direto. */

  const STAGGER_CAP_MS = 400;
  let staggerMs = null;
  let lastSlot = 0;
  function staggerDelay() {
    if (staggerMs === null) {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--duration-stagger").trim();
      staggerMs = raw.endsWith("ms") ? parseFloat(raw) : 40;
    }
    const now = performance.now();
    const slot = Math.min(Math.max(now, lastSlot + staggerMs), now + STAGGER_CAP_MS);
    lastSlot = slot;
    return slot - now;
  }

  const running = new Map();
  let total = 0;
  let listening = false;
  const EVENTS = ["pointerdown", "keydown", "focusin"];
  function skipAll() {
    for (const lane of running.values()) for (const h of [...lane]) h.cancel();
  }
  const busy = (lane) => (running.get(lane) ? running.get(lane).size : 0);
  function track(h, laneKey) {
    let lane = running.get(laneKey);
    if (!lane) running.set(laneKey, (lane = new Set()));
    lane.add(h);
    total++;
    if (!listening) {
      EVENTS.forEach((t) => document.addEventListener(t, skipAll, true));
      listening = true;
    }
    h.finished.then(() => {
      lane.delete(h);
      total--;
      if (!total && listening) {
        EVENTS.forEach((t) => document.removeEventListener(t, skipAll, true));
        listening = false;
      }
    });
  }

  const watchers = new Map();
  let io = null;
  function observe(el, cb) {
    io = io || new IntersectionObserver((entries) => {
      for (const e of entries) {
        const w = watchers.get(e.target);
        if (w) w(e.isIntersecting);
      }
    }, { threshold: 0.15 });
    watchers.set(el, cb);
    io.observe(el);
    return () => {
      if (watchers.delete(el)) io.unobserve(el);
    };
  }

  /**
   * Liga o efeito a um elemento e deixa a orquestração decidir quando rodar:
   * espera escondido até entrar na tela, respeita stagger e teto por faixa.
   * Aceita as mesmas opções de `generate`, mais `lane`, `maxRunning` e `extraDelay`.
   * @returns {{complete(): void, cancel(): void, finished: Promise<"done"|"cancelled"|"skipped">}}
   */
  function auto(el, opts = {}) {
    const { lane = "default", maxRunning = 6, extraDelay = 0, ...rest } = opts;
    let handle = null;
    let isComplete = !!rest.complete;
    let resolve;
    const finished = new Promise((r) => (resolve = r));
    // Aba oculta ou navegador sem observer: mostra direto em vez de esconder à toa.
    if (document.hidden || typeof IntersectionObserver === "undefined") {
      resolve("skipped");
      return { complete() {}, cancel() {}, finished };
    }
    const pendingOpacity = el.style.opacity;
    el.setAttribute("data-gen-pending", "");
    el.style.opacity = "0";
    const show = () => {
      if (!el.hasAttribute("data-gen-pending")) return;
      el.removeAttribute("data-gen-pending");
      el.style.opacity = pendingOpacity;
    };
    let reported = false;
    const stop = observe(el, (visible) => {
      reported = true;
      if (!visible || handle) return;
      stop();
      show();
      if (busy(lane) >= maxRunning) return resolve("skipped");
      const h = generate(el, { ...rest, complete: isComplete, delay: staggerDelay() + extraDelay });
      handle = h;
      track(h, lane);
      // Saiu da tela no meio: termina já e solta a canvas.
      const stopOff = observe(el, (still) => {
        if (!still) h.cancel();
      });
      h.finished.then((r) => {
        stopOff();
        resolve(r);
      });
    });
    const failsafe = setTimeout(() => {
      if (handle || (reported && !document.hidden)) return;
      stop();
      show();
      resolve("skipped");
    }, 4000);
    return {
      finished,
      complete() {
        isComplete = true;
        if (handle) handle.complete();
      },
      cancel() {
        clearTimeout(failsafe);
        stop();
        if (handle) handle.cancel();
        show();
        resolve("cancelled");
      },
    };
  }

  global.SketchDraw = { generate, auto, reducedMotion, DEFAULT_MARK, T };
})(window);
