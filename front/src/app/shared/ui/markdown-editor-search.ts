import { search } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Labels of the find & replace panel (CodeMirror defaults are lowercase terse words). */
const SEARCH_PHRASES: Readonly<Record<string, string>> = {
  Find: 'Find…',
  Replace: 'Replace with…',
  next: 'Next',
  previous: 'Previous',
  all: 'Select all',
  'match case': 'Aa',
  regexp: '.*',
  'by word': 'Word',
  replace: 'Replace',
  'replace all': 'Replace all',
  close: 'Close',
};

const FIELD_RADIUS = '8px';
const CHIP_RADIUS = '999px';

/** Find & replace panel styled like the app (PrimeNG tokens, light and dark). */
const SEARCH_THEME = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'transparent',
    color: 'var(--p-text-color)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ac-panel-border)' },
  '.cm-search.cm-panel': {
    position: 'relative',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 40px 8px 10px',
    fontFamily: 'inherit',
    fontSize: '13px',
    backgroundColor: 'var(--p-content-background)',
  },
  '.cm-search br': { display: 'none' },
  '.cm-search .cm-textfield': {
    flex: '1 1 220px',
    minWidth: '0',
    margin: '0',
    padding: '6px 10px',
    border: '1px solid var(--p-content-border-color, var(--ac-panel-border))',
    borderRadius: FIELD_RADIUS,
    backgroundColor: 'var(--p-content-background)',
    color: 'var(--p-text-color)',
    fontSize: '13px',
    outline: 'none',
    transition: 'border-color .15s, box-shadow .15s',
  },
  '.cm-search .cm-textfield:focus': {
    borderColor: 'var(--p-primary-color)',
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--p-primary-color) 20%, transparent)',
  },
  '.cm-search .cm-button': {
    margin: '0',
    padding: '6px 12px',
    border: 'none',
    borderRadius: FIELD_RADIUS,
    backgroundImage: 'none',
    backgroundColor: 'var(--p-content-hover-background)',
    color: 'var(--p-text-color)',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color .15s',
  },
  '.cm-search .cm-button:hover': {
    backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 15%, transparent)',
  },
  '.cm-search .cm-button:active': { backgroundImage: 'none' },
  '.cm-search .cm-button[name=replaceAll], .cm-search .cm-button[name=next]': {
    backgroundColor: 'var(--p-primary-color)',
    color: 'var(--p-primary-contrast-color, #fff)',
  },
  '.cm-search .cm-button[name=replaceAll]:hover, .cm-search .cm-button[name=next]:hover': {
    backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 85%, black)',
  },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    margin: '0',
    padding: '5px 10px',
    border: '1px solid var(--ac-panel-border)',
    borderRadius: CHIP_RADIUS,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '12px',
    color: 'var(--ac-muted)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all .15s',
  },
  '.cm-search label:hover': { borderColor: 'var(--p-primary-color)' },
  '.cm-search label:has(input:checked)': {
    borderColor: 'var(--p-primary-color)',
    backgroundColor: 'color-mix(in srgb, var(--p-primary-color) 15%, transparent)',
    color: 'var(--p-primary-color)',
  },
  '.cm-search label:has(input:focus-visible)': {
    outline: '2px solid var(--p-primary-color)',
    outlineOffset: '1px',
  },
  '.cm-search input[type=checkbox]': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    opacity: '0',
  },
  '.cm-search button[name=close]': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '26px',
    height: '26px',
    padding: '0',
    border: 'none',
    borderRadius: CHIP_RADIUS,
    backgroundColor: 'transparent',
    color: 'var(--ac-muted)',
    fontSize: '18px',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.cm-search button[name=close]:hover': {
    backgroundColor: 'var(--p-content-hover-background)',
    color: 'var(--p-text-color)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, #facc15 35%, transparent)',
    outline: 'none',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, #f97316 55%, transparent)',
  },
});

/**
 * Find & replace panel at the top of the editor, with app styling and clear labels.
 *
 * @returns Extensions.
 */
export function searchPanel(): Extension[] {
  return [search({ top: true }), EditorState.phrases.of(SEARCH_PHRASES), SEARCH_THEME];
}
