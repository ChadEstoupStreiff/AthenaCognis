import { EMPTY_INFO, type PaperInfo } from './paper';
import { findYear } from './text';
import { findAll, findFirst, parseXml, TEI_NS, type XmlStep, xmlText } from './xml';

const AUTHOR_SEPARATOR = ' | ';

/**
 * First element of a TEI path.
 *
 * @param context - Context.
 * @param steps - Path.
 * @returns Element or null.
 */
function tei(context: Element | null, steps: readonly XmlStep[]): Element | null {
  return findFirst(context, TEI_NS, steps);
}

/**
 * Authors of a biblStruct as `Family, Given | …`.
 *
 * @param bibl - biblStruct.
 * @returns Authors.
 */
function teiAuthors(bibl: Element | null): string {
  if (bibl === null) {
    return '';
  }
  const people = findAll(bibl, TEI_NS, [
    { name: 'analytic' },
    { name: 'author' },
    { name: 'persName' },
  ]);
  return people
    .flatMap((person) => {
      const family = xmlText(tei(person, [{ name: 'surname' }]));
      const given = findAll(person, TEI_NS, [{ name: 'forename' }])
        .map((forename) => xmlText(forename))
        .join(' ');
      return family === '' ? [] : [given === '' ? family : `${family}, ${given}`];
    })
    .join(AUTHOR_SEPARATOR);
}

/**
 * Page range of an imprint.
 *
 * @param imprint - imprint element.
 * @returns `from-to`, single page or empty.
 */
function teiPages(imprint: Element | null): string {
  const scope = tei(imprint, [{ name: 'biblScope', attr: ['unit', 'page'] }]);
  if (scope === null) {
    return '';
  }
  const range = [scope.getAttribute('from'), scope.getAttribute('to')].filter(
    (page): page is string => page !== null && page !== '',
  );
  return range.length > 0 ? range.join('-') : xmlText(scope);
}

/**
 * Convert a GROBID TEI header (`/api/processHeaderDocument`) into metadata.
 *
 * @param text - TEI XML.
 * @returns Metadata.
 * @throws Error when the XML is invalid.
 */
export function parseTeiHeader(text: string): PaperInfo {
  const root = parseXml(text);
  const bibl = tei(root, [{ name: 'sourceDesc', deep: true }, { name: 'biblStruct' }]);
  const imprint = tei(bibl, [{ name: 'monogr' }, { name: 'imprint' }]);
  const title =
    xmlText(tei(root, [{ name: 'analytic', deep: true }, { name: 'title' }])) ||
    xmlText(tei(root, [{ name: 'titleStmt', deep: true }, { name: 'title' }]));
  const date = tei(root, [{ name: 'date', deep: true, attr: ['type', 'published'] }]);
  const doi = xmlText(tei(root, [{ name: 'idno', deep: true, attr: ['type', 'DOI'] }]));
  const arxiv = xmlText(tei(root, [{ name: 'idno', deep: true, attr: ['type', 'arXiv'] }]));
  const scope = (unit: string): string =>
    xmlText(tei(imprint, [{ name: 'biblScope', attr: ['unit', unit] }]));
  return {
    ...EMPTY_INFO,
    title,
    authors: teiAuthors(bibl),
    year: date === null ? '' : findYear((date.getAttribute('when') ?? '') || xmlText(date)),
    journal: xmlText(
      tei(root, [
        { name: 'monogr', deep: true },
        { name: 'title', attr: ['level', 'j'] },
      ]),
    ),
    url: doi ? `https://doi.org/${doi}` : arxiv ? `https://arxiv.org/abs/${arxiv}` : '',
    doi,
    volume: scope('volume'),
    issue: scope('issue'),
    pages: teiPages(imprint),
  };
}
