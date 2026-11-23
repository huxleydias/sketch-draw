# Sketch draw: o efeito de carregamento "UI sendo gerada"

Guia para reproduzir o efeito de carregamento do Atlas (PunkMetrics) com HTML, CSS e JavaScript puro, sem framework e sem dependências. A primeira parte descreve o efeito para quem desenha, a segunda é a especificação técnica, e o código está em [`sketch-draw.js`](sketch-draw.js), com uma demo em [`index.html`](index.html).

**Resumo:** enquanto um componente carrega, ele não aparece de repente. Uma planta técnica pontilhada se monta em volta dele, uma caneta traça o contorno e, quando o conteúdo chega, cada peça interna é rascunhada antes de o componente real surgir, do desfocado para o nítido. Com o conteúdo já pronto, tudo leva cerca de 0,9 s.

---

## 1. Como o efeito se comporta

### A ideia

A tela não carrega: ela é desenhada. A referência é uma prancheta de arquiteto ou uma ferramenta de CAD plotando a interface antes de ela existir. O usuário vê que algo está sendo construído para ele, e não uma tela em branco ou um spinner genérico.

### A sequência, em linguagem de design

1. **Papel milimetrado.** Uma grade de pontos aparece a partir do centro do componente e se espalha numa onda circular até passar das bordas. A frente da onda brilha um pouco mais. Os pontos que já estão no lugar cintilam devagar, cada um no seu ritmo, e somem aos poucos na margem.
2. **Linhas-guia.** As quatro bordas do componente viram guias pontilhadas que nascem do meio e se esticam para além dos cantos, como as linhas de cota de um desenho técnico. No canto de cima aparece uma etiqueta em fonte mono com o tamanho e o tempo decorrido: `293 × 180  t+0.42s`.
3. **A marca.** No centro, a logo aparece em pontilhado (meio-tom), com 60% de opacidade, desde o primeiro quadro. Ela diz "isso é nosso e está chegando".
4. **O contorno.** Duas canetas saem juntas do topo-centro, uma para cada lado, contornam os cantos arredondados e se encontram no meio da base. A ponta de cada caneta é um ponto que brilha, e uma leitura de coordenadas (`150 180`) acompanha a ponta.
5. **Espera.** Se o conteúdo ainda não chegou, a planta fica pronta e "respirando": os pontos continuam cintilando e o relógio da etiqueta continua contando. O efeito não finge que terminou.
6. **Rascunho do conteúdo.** Quando o conteúdo chega, a marca se dissolve ponto a ponto, em ordem aleatória. Ao mesmo tempo, a caneta rascunha cada peça interna, de cima para baixo: o contorno de cada caixa, botão e campo, uma linha pontilhada para cada linha de texto (com as pontas marcadas) e o traço dos ícones. O desenho é lido do próprio componente, então o rascunho coincide com o que vai aparecer.
7. **Revelação.** O componente real surge, saindo de desfocado e transparente para nítido e opaco, enquanto a planta desaparece suavemente. Não sobra nada: o overlay é removido e o elemento volta exatamente ao estilo original.

### Personalidade

| Atributo | Como aparece |
|---|---|
| Técnico e preciso | pontilhado, cotas, coordenadas, fonte mono, contagem de tempo |
| Silencioso | uma cor só (a cor do texto do tema), pontos com 10 a 22% de opacidade; só a frente da onda e as pontas das canetas brilham |
| Rápido | cerca de 0,9 s quando o conteúdo já está pronto |
| Honesto | segue o estado real: segura enquanto espera de verdade e só monta o conteúdo quando ele chega |
| Nunca bloqueia | qualquer clique, tecla ou foco encerra o efeito na hora |
| Sem rastro | some por completo e devolve o elemento intacto |

### Princípios

- **O efeito segue o estado, não um relógio fixo.** A planta significa "estou esperando"; o rascunho das peças significa "chegou, estou montando".
- **O rascunho é do componente real.** As peças internas vêm da leitura do DOM, não de um desenho genérico.
- **Funciona nos dois temas.** A cor vem do token de texto (`--foreground`): pontos escuros no tema claro, claros no escuro.
- **Respeita quem pede menos movimento.** Com `prefers-reduced-motion`, o efeito vira um fade curto.

---

## 2. Linha do tempo

Tempo em milissegundos desde o primeiro quadro. A coluna da direita mostra o caso em que o conteúdo já está pronto ao começar (`complete` no instante 0).

| Camada | Início → fim | Conteúdo pronto (ms) |
|---|---|---|
| Elemento real fica invisível e o overlay é criado | 0 | 0 |
| Marca central em pontos, 60% | desde o início | 0 |
| Onda de pontos da grade | 80 → 480 | 80 → 480 |
| Guias + etiqueta de medida | 100 → 420 | 100 → 420 |
| Contorno (duas metades) + coordenadas | 160 → 560 | 160 → 560 |
| Marca se dissolve | `max(220, C)` → +400 | 220 → 620 |
| Peças internas em cascata | `max(360, C)` → +187 (inícios) e +153 (cada traço) | 360 → ~720 |
| Reveal do elemento real (400 ms) | `max(520, C + 160)` | 520 → 920 |
| Fade da planta (260 ms) | `max(640, C + 280)` | 640 → 900 |
| Fim: overlay removido e estilos restaurados | `max(fim do fade, fim do reveal)` | ~920 |
| Teto da espera (força o `complete`) | 8.000 | — |

`C` é o instante em que o conteúdo chegou (`complete()`). Os pisos (220, 360, 520, 640) garantem que, mesmo com conteúdo instantâneo, a planta chegue a se formar antes de ir embora.

---

## 3. Especificação técnica

### 3.1 Arquitetura

```
container (position: relative)                         ← recebe o overlay
├── alvo (o componente real)                           ← opacity: 0 (+ blur 6px) durante o efeito
└── div.sketch-gen  [aria-hidden, pointer-events:none] ← absolute, z-index 30
    └── canvas                                          ← alvo + 44 px de margem em cada lado
```

- **Alvo:** recebe `opacity: 0` (e `filter: blur(6px)` no reveal `fade`) como estilo inline. Os valores originais de `opacity`, `filter`, `clip-path` e `transition` são guardados e restaurados no fim.
- **Overlay:** uma `div` absoluta dentro de um **container posicionado que não é o alvo**. Se ficar dentro do alvo, some junto com ele (opacidade 0). O tamanho é o do alvo mais 44 px de cada lado, e a posição é `rect(alvo) − rect(container) − 44`.
- **Uma única `<canvas>`** por efeito, com 100% do overlay.
- **Sistema de coordenadas:** `ctx.setTransform(dpr, 0, 0, dpr, 44·dpr, 44·dpr)`. O ponto (0,0) é o canto superior esquerdo do alvo, e a margem fica em coordenadas negativas.
- **Loop:** `setTimeout(delay)` → `requestAnimationFrame` (cria o overlay e mede) → um `rAF` por quadro. O tempo `e` conta desde o primeiro quadro.
- **`ResizeObserver` no alvo:** se o tamanho muda no meio (o conteúdo chegou e o card cresceu), a geometria é refeita no quadro seguinte.

### 3.2 Canvas, densidade e cor

- **DPR** = `devicePixelRatio`, limitado a 2 e também a `√(1.500.000 / área_css)`, sem cair abaixo de 1. Isso impõe um teto de 1,5 megapixel por canvas; os traços têm 1 px, então cair de densidade num card enorme não aparece.
- **Cor:** a canvas não entende `var()` nem `color-mix()`. O motor aplica `color: var(--foreground)` no overlay, lê `getComputedStyle(layer).color` uma vez e usa o resultado. O brilho é a mesma cor com 85% de alpha e `shadowBlur = 3·dpr`.
- **Etiquetas:** `9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

### 3.3 Curvas e funções auxiliares

| Função | Definição | Uso |
|---|---|---|
| `seg(t, a, b)` | progresso 0→1 entre `a` e `b`, limitado; início infinito dá 0 | todo marco da linha do tempo |
| `ease(x)` | `cubic-bezier(0.22, 1, 0.36, 1)` (token `--ease-smooth-out`), resolvida em JS por bisseção (20 iterações) | onda, guias, contorno, peças, reveal `scan` |
| `smooth(x)` | smoothstep `x²(3 − 2x)` | fade da planta |
| `hash(n)` | `fract(sin(n·127,1 + 311,7) · 43758,5453)` | aleatoriedade determinística por ponto |

`Math.random()` não entra no quadro: com `hash` o mesmo ponto cintila igual em todo quadro e o efeito tem a mesma cara em toda execução.

### 3.4 Camada 1: grade de pontos

- **Passo:** 15 px. Se a grade passar de 1.400 pontos, o passo cresce: `G = max(15, ceil(15 · √(pontos / 1400)))`.
- **Área:** o alvo mais a margem de 44 px, alinhada em múltiplos do passo a partir de (0,0).
- **Pré-calculado por ponto** (em `Float32Array`):
  - `d`: distância ao centro do alvo;
  - `edge = 1 − clamp(distância para fora do alvo / 44)`: some suavemente na margem;
  - `base = 0,10 + 0,12·hash`: opacidade de repouso entre 10% e 22%;
  - `ph`, uma fase aleatória, e `tr = 120 a 280`, o período da cintilação.
- **Por quadro:**
  - `frente = ease(seg(e, 80, 480)) · dMax · 1,09`; o ponto aparece quando `frente > d`;
  - `crista = max(0, 1 − (frente − d) / 24)`: faixa de 24 px atrás da frente que brilha;
  - `cintilação = 0,75 + 0,25·sin(e / tr + ph)`;
  - `alpha = (base·cintilação + 0,8·crista) · edge · (crista > 0,35 ? 1 : 0,55) · fade`;
  - raio 1,1 px.
- **Otimização:** o alpha é quantizado em 16 níveis, com um `Path2D` por nível. A grade inteira custa no máximo 16 `fill()` por quadro.

### 3.5 Camada 2: guias e etiqueta de medida

- **Quatro linhas:** as bordas de cima, de baixo, da esquerda e da direita do alvo, prolongadas 44 px para a margem. Crescem do ponto médio para as pontas com `g = ease(seg(e, 100, 420))`.
- **Pontilhado:** `lineWidth 1,4` + `lineCap: round` + `setLineDash([0, 5])` desenha um ponto redondo a cada 5 px. Alpha `0,5·g·fade`.
- **Etiqueta:** `"W × H  t+0.00s"` em (0, −10), alpha 0,45. Funciona como relógio: na espera, mostra há quanto tempo o componente está carregando.

### 3.6 Camada 3: marca central em pontos

- **Fonte:** paths SVG da logo (viewBox 166 × 150), convertidos em `Path2D`. Para usar outra marca, passe `{ w, h, paths }`; `mark: null` desliga a camada.
- **Escala:** `s = min(48/w, 48/h, 0,4·min(W, H) / max(w, h))`. A marca cabe em 48 px e nunca passa de 40% do menor lado do alvo.
- **Meio-tom:** grade hexagonal com passo de 2,4 px (linhas a cada `2,4 · 0,866`), pontos de raio 0,8 px. Um ponto só entra se couber **inteiro** num path: o motor testa o centro e os quatro pontos cardeais a 0,8 px com `isPointInPath` numa canvas de sonda. Isso preserva os vãos entre as peças da logo. O resultado fica em cache por escala.
- **Opacidade:** 0,6 desde o primeiro quadro.
- **Dissolução:** cada ponto tem um limiar `th = hash(x·1,7 + y·9,3)`. Com `dp = seg(e, max(220, C), +400)`, o raio fica `0,8 · clamp((th·0,75 + 0,25 − dp) / 0,25)`. Cada ponto encolhe numa faixa de 25% do progresso e some na sua vez, em ordem aleatória.

### 3.7 Camada 4: contorno

- **Forma:** duas metades do retângulo arredondado (raio = `border-top-left-radius` do alvo). As duas saem do topo-centro, uma no sentido horário e outra no anti-horário, e terminam no centro da base.
- **Geometria:** a polilinha (arcos em segmentos de cerca de 3 px) é reamostrada em pontos a cada 4 px, calculados uma vez.
- **Por quadro:** `p = ease(seg(e, 160, 560))`. O motor desenha os primeiros `ceil(p·n)` pontos (raio 0,8, alpha 0,5) e, enquanto `p < 1`, um ponto brilhante na ponta (raio 2,24, com glow).
- **Coordenadas:** `"XXX YYY"` (três dígitos com zeros à esquerda) a (+6, −6) da ponta da metade direita, alpha 0,45.

### 3.8 Camada 5: peças internas (leitura do DOM)

Quando o conteúdo completa, o motor lê o DOM do alvo, com teto de 600 nós e 40 peças, em coordenadas relativas ao alvo:

| Peça | Critério | Desenho |
|---|---|---|
| **Caixa** | fundo com alpha > 0,02, borda, `background-image`, ou tag de mídia/form (`IMG`, `CANVAS`, `VIDEO`, `INPUT`, `BUTTON`, `TEXTAREA`, `SELECT`). Fica de fora o que ocupa mais de 60% da área do alvo (é fundo) ou tem `filter: blur` | contorno em duas metades, pontos a cada 3,5 px, raio 0,7 |
| **Texto** | cada nó de texto; `Range.getClientRects()` dá uma linha por linha renderizada (retângulos com o topo a menos de 2 px um do outro são unidos) | traço horizontal a 56% da altura da linha, pontos a cada 3,5 px, raio 0,8, com pontos brilhantes de raio 1,7 no início e, ao terminar, no fim |
| **Ícone** | `<svg>` de até 160 × 160 px; até 6 formas (`path`, `circle`, `rect`...) fora de `defs/clipPath/mask/symbol` | amostrado com `getTotalLength`, `getPointAtLength` e `getScreenCTM`, um ponto a cada 3,5 px de tela (máximo 80); SVG maior (gráfico) fica de fora |

- `data-gen-ignore` num elemento tira a subárvore dele da leitura.
- **Cascata:** as peças são ordenadas de cima para baixo e da esquerda para a direita. A peça `i` de `n` começa em `max(360, C) + (i / (n − 1)) · 187 ms`. Cada traço dura 153 ms, e os traços da mesma peça entram com 20 ms de diferença. O desenho é o mesmo do contorno (pontos com a ponta brilhante).

### 3.9 Reveal e limpeza

- **Reveal** em `max(520, C + 160)`:
  - `fade` (padrão): `transition: opacity 400ms, filter 400ms` com `--ease-smooth-out`; a opacidade volta ao original e o `blur(6px)` sai;
  - `scan`: a opacidade volta e um `clip-path: inset(0 0 X% 0)` vai de 100% a 0 em 400 ms com `ease`, recalculado a cada quadro (uma cortina de cima para baixo).
- **Limpeza** em `max(640, C + 280)`: `fade = 1 − smooth(seg(e, início, início + 260))` multiplica pontos, guias, contorno e peças.
- **Fim** em `max(fim da limpeza, reveal + 400)`: o motor cancela o `rAF`, remove o overlay, zera `canvas.width` e `canvas.height` (o bitmap é liberado na hora, sem esperar o coletor), restaura os estilos inline e resolve a promise com `"done"`.

### 3.10 Espera (streaming) e teto

- Com `complete: false`, a planta se forma e fica respirando até `handle.complete()`.
- Durante a espera (depois de 560 ms sem `complete`), o motor pinta um quadro sim e um não, porque só a cintilação muda. O custo cai pela metade.
- **Teto de 8 s:** conteúdo que nunca completa não deixa o elemento escondido para sempre; o motor força o `complete`.
- Chamar `generate` de novo no mesmo elemento cancela o efeito anterior.

### 3.11 Variações

- **`variant: "stroke"` (linhas de um diagrama):** para um `<path>` SVG que liga dois elementos. Margem de 8 px, sem grade, guias, marca ou blur. O path é amostrado em pontos de tela a cada 4 px (máximo 600) e o pontilhado cresce da origem ao destino em [160, 560] ms, com a ponta brilhante. A linha real aparece por baixo no reveal.
- **`follow: true` (alvo que se move por transform, como pan e zoom):** a cada quadro o motor relê a posição do alvo. Se ele só andou, reposiciona o overlay; se mudou de tamanho, refaz a geometria. O overlay fica fora da camada com transform, então os pontos mantêm o mesmo tamanho em qualquer zoom.

---

## 4. Orquestração de muitos elementos

Para uma página com vários cards, use `SketchDraw.auto(el, opts)` em vez de `generate`:

- **Espera escondido até entrar na tela.** O elemento fica com `opacity: 0` e `data-gen-pending`. Um único `IntersectionObserver` atende a página inteira (threshold 0,15).
- **Stagger:** 40 ms (`--duration-stagger`) entre o início de efeitos seguidos, com teto de 400 ms. O décimo primeiro card não espera mais que 400 ms.
- **Teto por faixa (`lane`):** no máximo `maxRunning` efeitos ao mesmo tempo (padrão 6). O excedente aparece direto, sem efeito. No Atlas: 12 para as telas do canvas, 24 para as linhas, 8 para os widgets do dashboard.
- **Faixas separadas por tipo,** para as linhas não ocuparem as vagas das telas, e um `extraDelay`: as linhas entram 240 ms depois e ligam telas que já estão se formando.
- **Saiu da tela no meio:** o efeito termina na hora e solta a canvas.
- **Qualquer `pointerdown`, `keydown` ou `focusin`** (em captura) encerra todos os efeitos em curso. O usuário nunca espera a animação.
- **Failsafe de 4 s:** se o observer nunca respondeu (página que não está pintando), o elemento aparece direto.
- **Aba oculta** (`document.hidden`): o efeito não roda.
- **Não repetir:** no Atlas, um elemento já desenhado não repete ao remontar a tela, por uma memória de chaves (`Set`) que fica fora do motor. No JS puro, guarde as chaves você mesmo e só chame `auto` para as novas.

---

## 5. Acessibilidade

- **`prefers-reduced-motion: reduce`:** sem planta; o elemento entra com um fade de opacidade de 250 ms (`--duration-fast`).
- **Overlay `aria-hidden="true"` e `pointer-events: none`:** não intercepta clique nem aparece para leitores de tela.
- O elemento real fica no DOM o tempo todo, só invisível. Com `auto()`, focar nele por teclado encerra o efeito (`focusin`).

---

## 6. Performance: por que canvas e não SVG

A primeira versão usava SVG: até 1.400 `<circle>` por componente, reescritos a cada quadro, e uma `<mask>` por traço. Medido no catálogo de eventos do Atlas: **+3.350 nós no DOM e 14 vezes mais layout e recálculo de estilo**. A versão em canvas:

- calcula a geometria uma vez em `Float32Array` (e de novo só se o tamanho mudar); o quadro só pinta;
- não chama `getPointAtLength` nem lê layout dentro do quadro (exceto no `follow`);
- desenha a grade com no máximo 16 `fill()` e cada traço com um `Path2D`;
- tem tetos: 1,5 MP de canvas, 1.400 pontos de grade, 40 peças, 600 nós lidos;
- lê os tokens de motion uma vez por página e guarda em cache os `Path2D` da marca e os pontos da marca por escala;
- pinta metade dos quadros na espera;
- libera o bitmap da canvas no fim.

---

## 7. API

### `SketchDraw.generate(el, opts) → handle`

| Opção | Padrão | Descrição |
|---|---|---|
| `container` | `document.body` | elemento posicionado que recebe o overlay (nunca o próprio alvo) |
| `complete` | `false` | o conteúdo já está pronto; sem isso a planta espera `handle.complete()` |
| `delay` | `0` | atraso antes de começar (ms) |
| `reveal` | `"fade"` | `"fade"` (opacidade + desfoque) ou `"scan"` (cortina de cima para baixo) |
| `variant` | `"box"` | `"box"` (planta completa) ou `"stroke"` (só o traço de um `<path>`) |
| `follow` | `false` | o alvo se move por transform (pan e zoom) |
| `mark` | logo do Atlas | `{ w, h, paths: [d, ...] }` em coordenadas do viewBox; `null` desliga |
| `color` | `var(--foreground)` | cor da planta (qualquer cor CSS) |
| `timeScale` | `1` | câmera lenta para depurar (`10` = dez vezes mais devagar; não afeta a transição CSS do reveal) |

| Handle | Descrição |
|---|---|
| `complete()` | o conteúdo chegou: dissolve a marca, rascunha as peças e revela |
| `cancel()` | encerra na hora e mostra o elemento |
| `finished` | `Promise<"done" \| "cancelled">` |

### `SketchDraw.auto(el, opts) → controle`

Aceita as opções de `generate` mais `lane` (`"default"`), `maxRunning` (`6`) e `extraDelay` (`0`). Devolve `{ complete(), cancel(), finished }`, e `finished` também pode resolver com `"skipped"` (passou do teto, aba oculta ou failsafe).

### Tokens CSS lidos (todos opcionais, com fallback)

```css
:root {
  --foreground: #141414;                            /* cor da planta */
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1); /* curva de tudo */
  --duration-slow: 400ms;                           /* reveal */
  --duration-fast: 250ms;                           /* fade do movimento reduzido */
  --duration-stagger: 40ms;                         /* intervalo entre efeitos no auto() */
}
```

### Uso mínimo

```html
<div class="board" style="position: relative">
  <article id="card">…</article>
</div>

<script src="sketch-draw.js"></script>
<script>
  const card = document.getElementById("card");
  const h = SketchDraw.generate(card, { container: document.querySelector(".board") });

  fetch("/api/dados")
    .then((r) => r.json())
    .then(render)              // preenche o card
    .finally(() => h.complete()); // erro também completa: o card de erro é revelado
</script>
```

---

## 8. Arquivos e como rodar

| Arquivo | O que é |
|---|---|
| [`sketch-draw.js`](sketch-draw.js) | o motor, sem dependências; expõe `window.SketchDraw` |
| [`index.html`](index.html) | demo: quatro cards, rodar de novo, simular um carregamento de 2,5 s e alternar o tema |
| [`skills/sketch-draw/`](skills/sketch-draw/) | skill para agentes de IA (Claude Code e compatíveis) aplicarem o efeito num projeto |

**Demo:** clone o repositório e abra o `index.html` no navegador. Funciona direto do disco, sem servidor.

```bash
git clone https://github.com/huxleydias/sketch-draw.git
```

```bash
open sketch-draw/index.html
```

**No seu projeto:** copie o `sketch-draw.js` e carregue com `<script src="sketch-draw.js"></script>`. Com bundler (Vite, webpack), importe pelo efeito colateral: `import "./sketch-draw.js";` define `window.SketchDraw`.

**Skill para agentes:** no Claude Code, copie a pasta do skill para os seus skills. Depois é só pedir ao agente algo como "coloca o efeito sketch draw no carregamento dos cards".

```bash
cp -r sketch-draw/skills/sketch-draw ~/.claude/skills/
```

---

## 9. Ajustes e armadilhas

- **Overlay dentro do alvo some junto.** O alvo fica com opacidade 0; o `container` tem que ser um ancestral (ou vizinho posicionado), nunca o próprio alvo.
- **Container com `overflow: hidden`** corta a margem de 44 px da planta. Deixe folga ou use um container maior.
- **Container com borda** desloca o overlay pela espessura da borda (o `absolute` é relativo à área de padding). Prefira um container sem borda.
- **Container que rola:** o motor não soma o `scrollTop` e o `scrollLeft` do container. Se ele já estiver rolado quando o efeito começa, some esses valores ao posicionar, ou use um container que não role.
- **A cor é lida uma vez por efeito.** Trocar o tema no meio não muda a cor de um efeito em curso; o próximo já sai certo.
- **Câmera lenta:** `timeScale: 10` deixa o efeito dez vezes mais lento para inspecionar quadro a quadro. A transição CSS do reveal continua em 400 ms.
- **Outra marca:** passe `mark: { w, h, paths }` com o viewBox e os `d` dos paths, ou edite `DEFAULT_MARK`. Peças muito finas na escala final (menos de 3 px) podem perder pontos no meio-tom; engrosse a marca ou desligue com `mark: null`.
- **Ritmo:** todos os marcos estão em `SketchDraw.T`. Para mudar a velocidade, escale os números juntos; mexer num só quebra a ordem das camadas.
- **Erro também completa.** Chame `complete()` no `finally`: um componente de erro também é revelado. Sem isso, o teto de 8 s é que solta o elemento.

---

## Licença

[MIT](LICENSE).
