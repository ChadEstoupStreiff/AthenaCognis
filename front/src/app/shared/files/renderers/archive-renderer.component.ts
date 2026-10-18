import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TreeNode } from 'primeng/api';
import { TreeModule } from 'primeng/tree';
import type { FileMetadata } from '@domain/contracts';

/**
 * Build a folder tree from archive entry paths.
 *
 * @param paths - Entry paths (`a/b/c.txt`).
 * @returns Tree nodes.
 */
export function archiveTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    let level = root;
    const parts = path.split('/').filter((part) => part !== '');
    parts.forEach((part, index) => {
      let node = level.find((candidate) => candidate.label === part);
      if (node === undefined) {
        const leaf = index === parts.length - 1 && !path.endsWith('/');
        node = {
          label: part,
          icon: leaf ? 'pi pi-file' : 'pi pi-folder',
          children: [],
          expanded: index === 0,
        };
        level.push(node);
      }
      level = node.children ?? [];
    });
  }
  return root;
}

/** Contents of a zip/tar archive (from file metadata). */
@Component({
  selector: 'ac-archive-renderer',
  imports: [TreeModule],
  template: `
    @if (metadata().zip_paths_truncated) {
      <p class="ac-muted">
        Showing the first {{ metadata().zip_paths?.length }} of
        {{ metadata().zip_paths_total }} entries.
      </p>
    }
    <p-tree [value]="nodes()" styleClass="archive-tree" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArchiveRendererComponent {
  /** File metadata (with `zip_paths`). */
  readonly metadata = input.required<FileMetadata>();

  protected readonly nodes = computed(() => archiveTree(this.metadata().zip_paths ?? []));
}
