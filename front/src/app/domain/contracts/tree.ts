/** One section of a document tree (exported JSON shape, `GET /tree/get/{file}`). */
export interface DocumentTreeSection {
  readonly section_id: string;
  readonly Title: string;
  readonly Description: string;
  readonly sections: readonly DocumentTreeSection[];
  /** First and last block, 1-based inclusive. */
  readonly paper_section_range: readonly [number, number];
}

/** Parameters of a tree generation (`POST /tree/ask/{file}`). */
export interface DocumentTreeParams {
  readonly max_depth: number;
  readonly max_sections: number;
  readonly min_words: number;
  readonly focus: string;
  /** Let the AI stop splitting once a section is one idea (depth capped at the max limit). */
  readonly auto_depth: boolean;
  /** Let the AI choose how many sections each level has (one per idea). */
  readonly auto_sections: boolean;
}

/** Default tree parameters (mirror the backend defaults). */
export const DOCUMENT_TREE_DEFAULTS: DocumentTreeParams = {
  max_depth: 3,
  max_sections: 5,
  min_words: 300,
  focus: '',
  auto_depth: true,
  auto_sections: true,
};

/** Accepted bounds of the numeric tree parameters. */
export const DOCUMENT_TREE_LIMITS = {
  max_depth: { min: 1, max: 5 },
  max_sections: { min: 2, max: 10 },
  min_words: { min: 50, max: 5000 },
  focusChars: 300,
} as const;

/** Stored tree of a file. */
export interface DocumentTreeRecord {
  readonly file: string;
  readonly date: string;
  readonly params: DocumentTreeParams;
  /** Blocks of the document when the tree was built. */
  readonly block_count: number;
  readonly tree: readonly DocumentTreeSection[];
}

/** Every block of a document (`GET /tree/blocks/{file}`); range n = blocks[n - 1]. */
export interface DocumentTreeBlocks {
  /** Blocks of the document now (differs from the record when the text changed). */
  readonly block_count: number;
  readonly blocks: readonly string[];
}
