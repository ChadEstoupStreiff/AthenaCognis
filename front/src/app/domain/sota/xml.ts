/** TEI namespace (GROBID). */
export const TEI_NS = 'http://www.tei-c.org/ns/1.0';
/** Atom namespace (arXiv). */
export const ATOM_NS = 'http://www.w3.org/2005/Atom';
/** arXiv extension namespace. */
export const ARXIV_NS = 'http://arxiv.org/schemas/atom';

/** One step of an ElementTree-like path. */
export interface XmlStep {
  readonly name: string;
  /** Any descendant (`.//name`) instead of a direct child. */
  readonly deep?: boolean;
  /** Required attribute value. */
  readonly attr?: readonly [string, string];
}

/**
 * Parse XML.
 *
 * @param text - XML text.
 * @returns Document element.
 * @throws Error when the XML is invalid.
 */
export function parseXml(text: string): Element {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const root = document.documentElement;
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML.');
  }
  return root;
}

/**
 * Elements matching a path, in document order (subset of ElementTree `findall`).
 *
 * @param context - Starting element.
 * @param namespace - Namespace of every step.
 * @param steps - Path.
 * @returns Matches.
 */
export function findAll(context: Element, namespace: string, steps: readonly XmlStep[]): Element[] {
  return steps.reduce<Element[]>(
    (nodes, step) =>
      nodes.flatMap((node) => {
        const candidates = step.deep
          ? [...node.getElementsByTagNameNS(namespace, step.name)]
          : [...node.children];
        return candidates.filter(
          (element) =>
            element.namespaceURI === namespace &&
            element.localName === step.name &&
            (step.attr === undefined || element.getAttribute(step.attr[0]) === step.attr[1]),
        );
      }),
    [context],
  );
}

/**
 * First element matching a path.
 *
 * @param context - Starting element.
 * @param namespace - Namespace.
 * @param steps - Path.
 * @returns Element or null.
 */
export function findFirst(
  context: Element | null,
  namespace: string,
  steps: readonly XmlStep[],
): Element | null {
  return context === null ? null : (findAll(context, namespace, steps)[0] ?? null);
}

/**
 * Collapsed text content of an element.
 *
 * @param element - Element or null.
 * @returns Text, empty when missing.
 */
export function xmlText(element: Element | null): string {
  return (element?.textContent ?? '').split(/\s+/).filter(Boolean).join(' ');
}
