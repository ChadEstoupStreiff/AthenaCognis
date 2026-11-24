const MATH_SELECTOR = '.math[data-tex]';
const MERMAID_SELECTOR = 'pre > code.language-mermaid';
const EMBED_THUMB_SELECTOR = 'img.file-embed-thumb';
const RENDERED_ATTRIBUTE = 'data-rendered';
const BROKEN_CLASS = 'broken';

const MAX_CACHED_DIAGRAMS = 50;

let diagramCounter = 0;
/** Rendered SVG by theme and source (the preview re-renders on every keystroke). */
const diagramCache = new Map<string, string>();

/**
 * Typeset math placeholders with KaTeX (loaded on first use).
 *
 * @param root - Rendered Markdown root.
 */
async function renderMath(root: HTMLElement): Promise<void> {
  const elements = [...root.querySelectorAll<HTMLElement>(MATH_SELECTOR)].filter(
    (element) => !element.hasAttribute(RENDERED_ATTRIBUTE),
  );
  if (elements.length === 0) {
    return;
  }
  const { default: katex } = await import('katex');
  for (const element of elements) {
    katex.render(element.dataset['tex'] ?? '', element, {
      displayMode: element.classList.contains('math-block'),
      throwOnError: false,
      trust: false,
    });
    element.setAttribute(RENDERED_ATTRIBUTE, '');
  }
}

/**
 * Draw Mermaid code blocks as SVG diagrams (loaded on first use).
 *
 * @param root - Rendered Markdown root.
 * @param dark - Dark theme.
 */
async function renderDiagrams(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)];
  if (blocks.length === 0) {
    return;
  }
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
  });
  for (const code of blocks) {
    await renderDiagram(mermaid, code, dark);
  }
}

/**
 * SVG of a diagram, from the cache or freshly rendered.
 *
 * @param mermaid - Mermaid API.
 * @param source - Diagram source.
 * @param dark - Dark theme.
 * @returns SVG markup.
 * @throws Error when the diagram is invalid.
 */
async function diagramSvg(
  mermaid: typeof import('mermaid').default,
  source: string,
  dark: boolean,
): Promise<string> {
  const key = `${String(dark)}:${source}`;
  const cached = diagramCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  diagramCounter += 1;
  const { svg } = await mermaid.render(`ac-diagram-${String(diagramCounter)}`, source);
  if (diagramCache.size >= MAX_CACHED_DIAGRAMS) {
    diagramCache.delete(diagramCache.keys().next().value ?? '');
  }
  diagramCache.set(key, svg);
  return svg;
}

/**
 * Replace one Mermaid code block by its diagram (kept as code when invalid).
 *
 * @param mermaid - Mermaid API.
 * @param code - `<code>` element.
 * @param dark - Dark theme.
 */
async function renderDiagram(
  mermaid: typeof import('mermaid').default,
  code: HTMLElement,
  dark: boolean,
): Promise<void> {
  const block = code.parentElement;
  if (block === null) {
    return;
  }
  try {
    const svg = await diagramSvg(mermaid, code.textContent, dark);
    const figure = document.createElement('div');
    figure.className = 'mermaid-diagram';
    figure.innerHTML = svg;
    block.replaceWith(figure);
  } catch {
    block.classList.add('mermaid-error');
  }
}

/**
 * Hide embed thumbnails that fail to load (no preview yet).
 *
 * @param root - Rendered Markdown root.
 */
function watchThumbnails(root: HTMLElement): void {
  for (const image of root.querySelectorAll<HTMLImageElement>(EMBED_THUMB_SELECTOR)) {
    image.addEventListener(
      'error',
      () => {
        image.classList.add(BROKEN_CLASS);
      },
      { once: true },
    );
  }
}

/**
 * Typeset math, draw diagrams and wire embeds of freshly rendered Markdown.
 *
 * @param root - Rendered Markdown root.
 * @param dark - Dark theme (diagram colors).
 */
export async function enhanceMarkdown(root: HTMLElement, dark: boolean): Promise<void> {
  watchThumbnails(root);
  await Promise.all([renderMath(root), renderDiagrams(root, dark)]);
}
