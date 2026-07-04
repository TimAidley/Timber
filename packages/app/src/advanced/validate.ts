import { parse as parseYaml } from 'yaml';
import { engine } from '@timber/generator';
import { loadSchemas } from '@timber/content';
import type { AdvancedFile } from './loadAdvancedFiles.js';

/** The outcome of an author-time check on one template/config file. */
export interface AdvancedValidation {
  valid: boolean;
  /** Human-readable problems; empty when valid. */
  errors: string[];
}

const OK: AdvancedValidation = { valid: true, errors: [] };

/**
 * Validate a template or config file *before* it can be committed (SPEC §8). This is
 * the gate behind the locked "block the commit, keep a local draft" decision: a file
 * that fails here is never sent to the WIP branch (a broken `{% for %}` or malformed
 * schema must not reach the build), but the caller still persists the draft locally.
 *
 * Each kind is checked with the **same** machinery the build uses, so a pass here
 * means the build won't choke:
 * - `template` → LiquidJS `engine.parse` (the exact parser `renderPage` runs).
 * - `schema`   → `loadSchemas` over a one-file snapshot (known field kinds, required
 *                options), the same validator the CLI runs.
 * - `config`   → structural YAML parse (malformed YAML is the failure mode).
 */
export function validateAdvancedFile(file: AdvancedFile): AdvancedValidation {
  switch (file.kind) {
    case 'template':
      return validateTemplate(file.content);
    case 'schema':
      return validateSchema(file.path, file.content);
    case 'config':
      return validateYaml(file.content);
  }
}

function validateTemplate(source: string): AdvancedValidation {
  try {
    engine.parse(source);
    return OK;
  } catch (err) {
    return fail(`Template syntax error — ${messageOf(err)}`);
  }
}

function validateSchema(path: string, source: string): AdvancedValidation {
  try {
    loadSchemas(new Map([[path, source]]));
    return OK;
  } catch (err) {
    return fail(messageOf(err));
  }
}

function validateYaml(source: string): AdvancedValidation {
  try {
    parseYaml(source);
    return OK;
  } catch (err) {
    return fail(`Invalid YAML — ${messageOf(err)}`);
  }
}

function fail(message: string): AdvancedValidation {
  return { valid: false, errors: [message] };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
