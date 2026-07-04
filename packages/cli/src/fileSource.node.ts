import { readFile, readdir, access } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FileSource, OutputSink } from '@timber/generator';

/**
 * Node/`fs`-backed implementation of the generator's I/O seam. Lives in the CLI
 * package — never in the generator core or the browser bundle — so `node:fs` can
 * never leak into an isomorphic build (CLAUDE.md: native/Node deps only in CI).
 */
export class NodeFileSource implements FileSource {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return resolve(this.root, path);
  }

  async readText(path: string): Promise<string> {
    return readFile(this.abs(path), 'utf8');
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return readFile(this.abs(path));
  }

  async list(dir: string): Promise<string[]> {
    return readdir(this.abs(dir));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }
}

/** Node/`fs`-backed output sink that creates parent directories as needed. */
export class NodeOutputSink implements OutputSink {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return resolve(this.root, path);
  }

  async writeText(path: string, contents: string): Promise<void> {
    const target = this.abs(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  async writeBytes(path: string, contents: Uint8Array): Promise<void> {
    const target = this.abs(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}
