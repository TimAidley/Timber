import type { AdvancedFile, AdvancedKind } from './loadAdvancedFiles.js';

/**
 * Pure helper for the advanced list's grouping, mirroring `contentList.ts` for the
 * content navigator. The advanced area edits raw source files (templates + config);
 * this groups them by {@link AdvancedKind} — which maps one-to-one onto their folders
 * (`templates/`, `config/schemas/`, the rest of `config/`) — so the file list reads
 * like the content list rather than one long flat run of paths.
 */
export interface AdvancedGroup {
  kind: AdvancedKind;
  /** The group's display heading (e.g. "Templates"). */
  label: string;
  files: AdvancedFile[];
}

/** Display heading + display order for each kind (templates → styles → schemas →
 *  config). Styles sit next to templates: together they *are* the theme. */
const GROUP_LABEL: Record<AdvancedKind, string> = {
  template: 'Templates',
  style: 'Styles',
  schema: 'Schemas',
  config: 'Config',
};
const GROUP_ORDER: AdvancedKind[] = ['template', 'style', 'schema', 'config'];

/**
 * Group advanced files by kind, in a stable heading order (templates → styles →
 * schemas → config). Files keep the incoming order within a group — `loadAdvancedFiles`
 * already sorts them by path — and empty groups are dropped.
 */
export function groupAdvancedFiles(files: readonly AdvancedFile[]): AdvancedGroup[] {
  const byKind = new Map<AdvancedKind, AdvancedFile[]>();
  for (const file of files) {
    const arr = byKind.get(file.kind);
    if (arr) arr.push(file);
    else byKind.set(file.kind, [file]);
  }
  return GROUP_ORDER.flatMap((kind) => {
    const group = byKind.get(kind);
    return group ? [{ kind, label: GROUP_LABEL[kind], files: group }] : [];
  });
}

/** The list's display name for a file: its basename (the path is the secondary line). */
export function advancedFileName(file: AdvancedFile): string {
  return file.path.split('/').pop() ?? file.path;
}
