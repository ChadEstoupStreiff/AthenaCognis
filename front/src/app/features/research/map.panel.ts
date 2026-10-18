import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import type { Options } from 'vis-network/standalone';
import {
  aiGraphLinks,
  type CitationRecord,
  type Connection,
  citationEdges,
  citationLinks,
  connectionsOf,
  degreesOf,
  displayTitle,
  type ExternalWork,
  MAX_AI_FORCE,
  type MapMode,
  type MapView,
  mapNodes,
  type Paper,
  paperLabel,
  sharedReferences,
  visibleNodes,
} from '@domain/sota';
import { SotaOnline } from '../../core/sota/sota-online';
import { SotaStorage } from '../../core/sota/sota-storage';
import { ThemeService } from '../../core/theme/theme.service';
import { GraphComponent } from '../../shared/ui/graph.component';
import { toGraphEdges, toGraphNodes } from './map-model';
import { MapRelations } from './map-relations';
import { PeekService } from '../../core/files/peek.service';
import { ResearchStore } from './research.store';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';

/** Details pane content. */
export type DetailsView =
  | {
      readonly kind: 'paper';
      readonly paper: Paper;
      readonly record: CitationRecord | null;
      readonly connections: readonly Connection[];
    }
  | {
      readonly kind: 'external';
      readonly work: ExternalWork;
      readonly connections: readonly Connection[];
    };

const MAX_SHARED_REFERENCES = 40;
const GRAPH_HEIGHT = 620;
const LEVEL_SEPARATION = 220;
const NODE_SPACING = 110;
/** Force layout: stronger repulsion + longer springs = more space between papers. */
const GRAVITATIONAL_CONSTANT = -9000;
const SPRING_LENGTH = 220;
const AVOID_OVERLAP = 0.6;

/** Citation & relation map of the library. */
@Component({
  selector: 'ac-research-map',
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    SelectButtonModule,
    SliderModule,
    ToggleSwitchModule,
    GraphComponent,
    MarkdownViewComponent,
  ],
  templateUrl: './map.panel.html',
  styleUrl: './map.panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPanelComponent {
  private readonly storage = inject(SotaStorage);
  private readonly online = inject(SotaOnline);
  private readonly theme = inject(ThemeService);
  protected readonly store = inject(ResearchStore);
  protected readonly peek = inject(PeekService);
  protected readonly relations = inject(MapRelations);

  protected readonly modes: { value: MapMode; label: string }[] = [
    { value: 'citations', label: 'Citations' },
    { value: 'ai', label: 'AI relations' },
  ];
  protected readonly mode = signal<MapMode>('citations');
  /** Chosen focus paper (ignored once it leaves the library). */
  protected readonly focusPath = signal<string | null>(null);
  protected readonly focus = computed(() => {
    const path = this.focusPath();
    return path !== null && this.store.papers().some((paper) => paper.path === path) ? path : null;
  });
  protected readonly depth = signal(1);
  protected readonly timeline = signal(false);
  protected readonly hideUnconnected = signal(false);
  protected readonly showShared = signal(true);
  protected readonly minCiting = signal(2);
  protected readonly minForce = signal(1);
  protected readonly clicked = signal<string | null>(null);
  protected readonly maxForce = MAX_AI_FORCE;
  protected readonly height = GRAPH_HEIGHT;

  protected readonly paperOptions = computed(() =>
    this.store.papers().map((paper) => ({
      value: paper.path,
      label: `${paperLabel(paper)} — ${displayTitle(paper)}`,
    })),
  );
  protected readonly view = computed<MapView>(() => ({
    mode: this.mode(),
    focus: this.focus(),
    depth: this.depth(),
    timeline: this.timeline(),
    hideUnconnected: this.hideUnconnected(),
  }));
  protected readonly missing = computed(() =>
    this.store.papers().filter((paper) => !this.store.records().has(paper.path)),
  );
  protected readonly aiSources = computed(() =>
    this.store.selection().length > 0 ? this.store.selection() : this.store.papers(),
  );

  private readonly recordsLoad = resource({
    params: () => this.store.papers().map((paper) => paper.path),
    loader: () => this.store.loadRecords(),
  });
  protected readonly aiLinks = resource({
    params: () => ({
      paths: this.store.papers().map((paper) => paper.path),
      version: this.relations.version(),
    }),
    loader: ({ params }) => this.storage.aiLinks(params.paths),
  });
  private readonly shared = computed(() => {
    if (this.mode() !== 'citations' || !this.showShared()) {
      return new Map<string, number>();
    }
    return sharedReferences(
      citationEdges(this.store.papers(), this.store.records()).external,
      this.minCiting(),
      MAX_SHARED_REFERENCES,
    );
  });
  protected readonly externals = resource({
    params: () => {
      const shared = this.shared();
      return shared.size === 0 ? undefined : { shared, key: [...shared.keys()].sort().join('|') };
    },
    loader: ({ params }) => this.online.externalWorks(params.shared),
  });

  private readonly citeLinks = computed(() =>
    citationLinks(this.store.papers(), this.store.records(), this.externals.value() ?? []),
  );
  private readonly aiGraph = computed(() =>
    aiGraphLinks(
      this.aiLinks.value() ?? [],
      new Set(this.store.papers().map((paper) => paper.path)),
      this.minForce(),
    ),
  );
  private readonly layout = computed(() => {
    const drawable = this.mode() === 'citations' ? this.citeLinks() : this.aiGraph();
    const externals = this.mode() === 'citations' ? (this.externals.value() ?? []) : [];
    const visible = visibleNodes(
      [
        ...this.store.papers().map((paper) => paper.path),
        ...externals.map((work) => work.openalexId),
      ],
      drawable,
      this.view(),
    );
    const links = drawable.filter((link) => visible.has(link.source) && visible.has(link.target));
    const nodes = mapNodes(
      this.store.papers().filter((paper) => visible.has(paper.path)),
      externals.filter((work) => visible.has(work.openalexId)),
      degreesOf(links),
      this.view(),
    );
    return { visible, links, nodes, externals };
  });
  protected readonly nodes = computed(() =>
    toGraphNodes(this.layout().nodes, this.theme.dark() ? '#e5e5e5' : '#1f2937'),
  );
  protected readonly edges = computed(() => toGraphEdges(this.layout().links));
  protected readonly caption = computed(() => {
    const { nodes, links } = this.layout();
    const papers = nodes.filter((node) => node.kind !== 'external').length;
    const shared = nodes.length - papers;
    return this.mode() === 'citations'
      ? `${String(papers)} papers · ${String(shared)} shared reference(s) outside the library (grey) · ${String(links.length)} citation(s) · arrow = cites`
      : `${String(papers)} papers · ${String(links.length)} AI relation(s) · line width = strength · hover a line for the reason`;
  });
  protected readonly options = computed<Options>(() => ({
    autoResize: true,
    interaction: { hover: true, tooltipDelay: 120 },
    edges: {
      arrows: { to: { enabled: this.mode() === 'citations', scaleFactor: 0.6 } },
      color: { color: '#9ca3af', highlight: '#7700a7' },
      smooth: { enabled: true, type: 'continuous', roundness: 0.4 },
    },
    physics: {
      enabled: !this.timeline(),
      stabilization: { iterations: 200 },
      barnesHut: {
        gravitationalConstant: GRAVITATIONAL_CONSTANT,
        springLength: SPRING_LENGTH,
        avoidOverlap: AVOID_OVERLAP,
      },
    },
    layout: this.timeline()
      ? {
          hierarchical: {
            enabled: true,
            direction: 'LR',
            levelSeparation: LEVEL_SEPARATION,
            nodeSpacing: NODE_SPACING,
          },
        }
      : { hierarchical: false },
  }));

  protected readonly target = computed(() => {
    const clicked = this.clicked();
    return clicked !== null && this.layout().visible.has(clicked) ? clicked : this.focus();
  });
  protected readonly details = computed(() => this.detailsOf(this.target()));
  protected readonly recordsLoading = this.recordsLoad.isLoading;

  /**
   * Details of a node.
   *
   * @param id - Node id.
   * @returns Paper or external work details, with connections.
   */
  private detailsOf(id: string | null): DetailsView | null {
    if (id === null) {
      return null;
    }
    const externals = this.externals.value() ?? [];
    const titles = new Map<string, string>([
      ...this.store.papers().map((paper) => [paper.path, displayTitle(paper)] as const),
      ...externals.map((work) => [work.openalexId, work.title] as const),
    ]);
    const connections = connectionsOf(id, [...this.citeLinks(), ...this.aiGraph()], titles);
    const paper = this.store.papers().find((item) => item.path === id);
    if (paper !== undefined) {
      return { kind: 'paper', paper, record: this.store.records().get(id) ?? null, connections };
    }
    const work = externals.find((item) => item.openalexId === id);
    return work === undefined ? null : { kind: 'external', work, connections };
  }
}
