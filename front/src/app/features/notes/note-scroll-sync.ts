import {
  buildAnchors,
  easeStep,
  invertAnchors,
  mapScroll,
  type ScrollAnchor,
} from '../../shared/text/scroll-sync';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
/** Scroll events caused by our own sync are ignored for this long. */
const ECHO_GUARD_MS = 80;

/** Share of the remaining distance the following pane covers each frame. */
const EASE_FACTOR = 0.3;

/** Pane of the split view. */
type Side = 'editor' | 'preview';

/** Running eased scroll of the following pane. */
interface ScrollAnimation {
  readonly side: Side;
  readonly element: HTMLElement;
  target: number;
}

/** Both panes of the split view. */
export interface ScrollPanes {
  readonly editor: HTMLElement;
  readonly preview: HTMLElement;
  /** Editor offsets of the source headings. */
  readonly editorHeadingTops: readonly number[];
}

/**
 * Maximum scroll offset of an element.
 *
 * @param element - Scrollable element.
 * @returns Offset.
 */
function maxScroll(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

/**
 * Offsets of the rendered headings inside the preview scroller.
 *
 * @param preview - Preview scroller.
 * @returns Offsets.
 */
function previewHeadingTops(preview: HTMLElement): number[] {
  const top = preview.getBoundingClientRect().top - preview.scrollTop;
  return [...preview.querySelectorAll(HEADING_SELECTOR)].map(
    (heading) => heading.getBoundingClientRect().top - top,
  );
}

/** Keeps editor and preview scrolled to the same section (headings as anchors), smoothly. */
export class NoteScrollSync {
  private panes: ScrollPanes | null = null;
  private anchors: ScrollAnchor[] = [];
  private animation: ScrollAnimation | null = null;
  private frame = 0;
  private quietSide: Side | null = null;
  private quietUntil = 0;
  private readonly onEditorScroll = (): void => {
    this.follow('editor');
  };
  private readonly onPreviewScroll = (): void => {
    this.follow('preview');
  };

  /**
   * Attach to the panes (re-attaching replaces the previous ones).
   *
   * @param panes - Panes and source heading offsets.
   */
  attach(panes: ScrollPanes): void {
    if (this.panes?.editor !== panes.editor || this.panes.preview !== panes.preview) {
      this.detach();
      panes.editor.addEventListener('scroll', this.onEditorScroll, { passive: true });
      panes.preview.addEventListener('scroll', this.onPreviewScroll, { passive: true });
    }
    this.panes = panes;
    this.anchors = buildAnchors(
      panes.editorHeadingTops,
      previewHeadingTops(panes.preview),
      maxScroll(panes.editor),
      maxScroll(panes.preview),
    );
  }

  /** Stop syncing. */
  detach(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.animation = null;
    this.panes?.editor.removeEventListener('scroll', this.onEditorScroll);
    this.panes?.preview.removeEventListener('scroll', this.onPreviewScroll);
    this.panes = null;
  }

  /**
   * Ease the other pane towards the section the user scrolled to.
   *
   * @param source - Pane that scrolled.
   */
  private follow(source: Side): void {
    const panes = this.panes;
    if (panes === null || this.isEcho(source)) {
      return;
    }
    const fromEditor = source === 'editor';
    const from = fromEditor ? panes.editor : panes.preview;
    const anchors = fromEditor ? this.anchors : invertAnchors(this.anchors);
    const target = mapScroll(anchors, from.scrollTop);
    this.animation = {
      side: fromEditor ? 'preview' : 'editor',
      element: fromEditor ? panes.preview : panes.editor,
      target,
    };
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(() => {
        this.step();
      });
    }
  }

  /**
   * Whether a scroll event comes from our own animation of that pane.
   *
   * @param source - Pane that scrolled.
   * @returns `true` to ignore it.
   */
  private isEcho(source: Side): boolean {
    return (
      this.animation?.side === source ||
      (this.quietSide === source && performance.now() < this.quietUntil)
    );
  }

  /** Advance the eased scroll by one frame. */
  private step(): void {
    this.frame = 0;
    const animation = this.animation;
    if (animation === null) {
      return;
    }
    const before = animation.element.scrollTop;
    animation.element.scrollTop = easeStep(before, animation.target, EASE_FACTOR);
    this.quietSide = animation.side;
    this.quietUntil = performance.now() + ECHO_GUARD_MS;
    const after = animation.element.scrollTop;
    if (after === before || after === animation.target) {
      this.animation = null;
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.step();
    });
  }
}
