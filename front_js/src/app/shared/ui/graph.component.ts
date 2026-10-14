import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DataSet, type Edge, Network, type Node, type Options } from 'vis-network/standalone';

/** Graph node. */
export interface GraphNode extends Node {
  readonly id: string;
}

/** Graph edge. */
export interface GraphEdge extends Edge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

const DEFAULT_HEIGHT = 420;

/** vis-network wrapper (data updates in place; emits node clicks). */
@Component({
  selector: 'ac-graph',
  template: `<div #host class="graph" [style.height.px]="height()"></div>`,
  styles: `
    .graph {
      width: 100%;
      border-radius: 10px;
      background: var(--ac-code-background);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphComponent {
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly nodeSet = new DataSet<GraphNode>();
  private readonly edgeSet = new DataSet<GraphEdge>();
  private network: Network | null = null;

  /** Nodes. */
  readonly nodes = input<readonly GraphNode[]>([]);
  /** Edges. */
  readonly edges = input<readonly GraphEdge[]>([]);
  /** vis-network options. */
  readonly options = input<Options>({});
  /** Height in pixels. */
  readonly height = input(DEFAULT_HEIGHT);
  /** Emits the id of a clicked node. */
  readonly nodeClick = output<string>();

  /** Create the network after render and keep data in sync. */
  constructor() {
    afterNextRender(() => {
      this.network = new Network(
        this.host().nativeElement,
        { nodes: this.nodeSet, edges: this.edgeSet },
        this.options(),
      );
      this.network.on('click', (params: { nodes: string[] }) => {
        const [id] = params.nodes;
        if (id !== undefined) {
          this.nodeClick.emit(id);
        }
      });
    });
    effect(() => {
      this.replace(this.nodeSet, this.nodes());
      this.replace(this.edgeSet, this.edges());
    });
    effect(() => {
      this.network?.setOptions(this.options());
    });
    inject(DestroyRef).onDestroy(() => {
      this.network?.destroy();
    });
  }

  /**
   * Replace the content of a data set.
   *
   * @param set - Data set.
   * @param items - New items.
   */
  private replace<T extends { readonly id: string }>(set: DataSet<T>, items: readonly T[]): void {
    set.clear();
    set.add([...items]);
  }
}
