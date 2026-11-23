---
name: sketch-draw
description: Aplica o efeito de carregamento "sketch draw" (UI sendo gerada) em páginas e componentes web com o sketch-draw.js, em JS puro e sem dependências. Enquanto o conteúdo carrega, uma planta técnica pontilhada se monta em volta do elemento, uma caneta traça o contorno e as peças internas; quando os dados chegam, o elemento real surge do desfocado para o nítido. Use este skill sempre que o usuário pedir loading, skeleton ou placeholder animado com cara de blueprint, wireframe sendo desenhado, "sketch draw", "UI sendo gerada", animação de entrada de cards, widgets ou dashboards enquanto os dados carregam, ou quiser reproduzir o efeito de carregamento do Atlas/PunkMetrics, mesmo que não diga "sketch draw" (por exemplo "loading que desenha o card", "blueprint loading animation", "draw-in skeleton effect").
---

# Sketch draw

O efeito troca o "aparecer de repente" por "ser desenhado". O motor é um arquivo só, `assets/sketch-draw.js`, que expõe `window.SketchDraw`. Ele esconde o elemento alvo, pinta a planta numa `<canvas>` sobreposta e revela o elemento quando o conteúdo chega. Não há pacote npm: o arquivo é copiado para o projeto.

Leia `references/guia.md` quando precisar ajustar o ritmo, entender uma camada (grade, guias, marca, contorno, peças internas) ou portar o efeito. Para aplicar o efeito, este arquivo basta.

## Como aplicar

### 1. Copie o motor para o projeto

Copie `assets/sketch-draw.js` para a pasta de arquivos estáticos do projeto (`public/`, `static/`, `assets/vendor/`...).

- HTML puro: `<script src="/sketch-draw.js"></script>` antes do código que usa o efeito.
- Com bundler (Vite, webpack, Next no cliente): `import "./sketch-draw.js";` em código que roda só no navegador. O arquivo é um IIFE que escreve em `window`; no servidor (SSR) ele quebraria, então importe dentro de um componente de cliente ou de um `useEffect`.
- TypeScript: declare o global, por exemplo `declare global { interface Window { SketchDraw: any } }`, ou tipe só o que usar.

### 2. Escolha o container do overlay

O overlay (a `<canvas>`) entra num elemento posicionado que você passa em `container`. As regras existem porque o overlay é `position: absolute` e transborda o alvo em 44 px:

- **Nunca o próprio alvo.** O alvo fica com `opacity: 0` durante o efeito, e o overlay sumiria junto.
- **Posicionado** (`position: relative` ou `absolute`), em geral o grid ou a seção que contém os cards.
- **Sem `overflow: hidden`** perto das bordas, ou a planta é cortada. Deixe folga de 44 px.
- **Sem borda**: o `absolute` conta a partir da área de padding, e uma borda desloca o overlay pela espessura dela.

Sem `container`, o overlay vai para o `body`, o que funciona em páginas que não rolam dentro de containers.

### 3. Ligue o efeito ao estado real de carregamento

Este é o ponto que mais importa. O efeito não é uma animação de duração fixa: a planta significa "estou esperando" e segura até o conteúdo chegar. Então:

```js
const h = SketchDraw.generate(card, { container: board });   // complete: false é o padrão

fetch("/api/dados")
  .then((r) => r.json())
  .then(render)
  .finally(() => h.complete());   // erro também completa: o card de erro também é revelado
```

- Conteúdo já pronto (página estática, dado em cache): `complete: true`. O efeito todo leva cerca de 0,9 s.
- Não chame `complete()` com um `setTimeout` fixo para "dar tempo da animação". Isso quebra a ideia de o efeito seguir o estado.
- Se o `complete()` nunca vier, o motor solta o elemento sozinho em 8 s.

### 4. Vários elementos: use `auto()`

Para uma lista ou um dashboard, `SketchDraw.auto(el, opts)` cuida do que `generate` não cuida: espera o elemento entrar na tela, espaça os inícios em 40 ms, limita quantos rodam juntos (`maxRunning`, padrão 6, por `lane`) e encerra tudo no primeiro clique, tecla ou foco do usuário.

```js
document.querySelectorAll(".widget").forEach((el) => {
  const ctl = SketchDraw.auto(el, { container: grid, lane: "widgets", maxRunning: 8 });
  loadWidget(el.dataset.id).finally(() => ctl.complete());
});
```

`auto` é de uso único por elemento. Para não repetir o efeito quando a tela remonta, guarde as chaves já desenhadas num `Set` e só chame `auto` para as novas.

### 5. Marca central e cor

- **Marca:** por padrão, o centro da planta mostra a logo do Atlas (PunkMetrics) em pontilhado. Num projeto que não é do Atlas, troque pela marca do projeto (`mark: { w, h, paths: ["M...", ...] }`, com o viewBox e os `d` dos paths do SVG da logo) ou desligue (`mark: null`). Pergunte ao usuário se houver dúvida.
- **Cor:** o motor usa `var(--foreground)` e, sem ela, a cor de texto herdada do container. Se o tema guarda a cor do texto em outra variável, passe `color: "var(--minha-cor-de-texto)"`.
- **Tokens de motion** (opcionais, com fallback): `--ease-smooth-out`, `--duration-slow`, `--duration-fast`, `--duration-stagger`.

### 6. Confira no navegador

- Rode com `timeScale: 10` para ver cada camada em câmera lenta. A transição CSS do reveal continua em 400 ms.
- Ao fim do efeito, `document.querySelectorAll(".sketch-gen").length` deve ser 0 e o elemento deve estar com os estilos originais.
- Ative "reduzir movimento" no sistema: o efeito vira um fade de 250 ms, sem planta.
- Teste nos temas claro e escuro.

## Receitas por framework

**React:**

```jsx
function Widget({ data, loading }) {
  const ref = useRef(null);
  const ctl = useRef(null);
  useLayoutEffect(() => {
    ctl.current = SketchDraw.auto(ref.current, { container: ref.current.closest(".grid"), complete: !loading });
    return () => ctl.current.cancel();
  }, []);
  useEffect(() => {
    if (!loading) ctl.current?.complete();
  }, [loading]);
  return <div ref={ref} className="rounded-xl">…</div>;
}
```

Use `useLayoutEffect` para o elemento ficar escondido antes do primeiro paint, sem piscar. O `cancel()` no cleanup mostra o elemento e solta a canvas, e cobre o duplo efeito do StrictMode.

**Vue:** a mesma ideia com `onMounted` (cria o `auto`), `watch` no estado de carregamento (chama `complete()`) e `onBeforeUnmount` (chama `cancel()`).

## Opções de `generate`

| Opção | Padrão | Uso |
|---|---|---|
| `container` | `document.body` | elemento posicionado que recebe o overlay |
| `complete` | `false` | conteúdo já pronto |
| `delay` | `0` | atraso antes de começar (ms) |
| `reveal` | `"fade"` | `"fade"` (opacidade + desfoque) ou `"scan"` (cortina de cima para baixo) |
| `variant` | `"box"` | `"stroke"` desenha só o traço de um `<path>` SVG (linhas que ligam nós de um diagrama) |
| `follow` | `false` | alvo que se move por transform (pan e zoom de canvas) |
| `mark` | logo do Atlas | `{ w, h, paths }` ou `null` |
| `color` | `var(--foreground)` | cor da planta |
| `timeScale` | `1` | câmera lenta para depurar |

O handle devolve `complete()`, `cancel()` e `finished` (`Promise<"done" | "cancelled">`). `auto` aceita também `lane`, `maxRunning` e `extraDelay`, e o `finished` dele pode resolver com `"skipped"`.

## Para tirar uma parte do rascunho

As peças internas são lidas do DOM do alvo: caixas com fundo ou borda, linhas de texto e ícones SVG de até 160 px. Marque com `data-gen-ignore` o que não deve ser rascunhado (um gráfico grande, um bloco decorativo).
