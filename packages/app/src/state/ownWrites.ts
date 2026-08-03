import type { HostProvider } from '@timber/host';

/**
 * Which commits on the WIP branch **this tab** made (SPEC §11).
 *
 * The branch is shared: a second editor tab, another device, or the same person
 * tomorrow all commit to `<login>_wip`. To warn about a *foreign* write we first have
 * to recognise our own, and "the tip changed" alone can't tell the difference — so
 * every commit this tab lands is recorded here by sha.
 *
 * Bounded: a long session makes a lot of autosave commits, and only the recent ones can
 * plausibly be confused with a tip we're looking at right now.
 */
export class OwnWrites {
  private readonly shas = new Set<string>();
  private readonly order: string[] = [];
  private last: string | undefined;
  private readonly listeners = new Set<(sha: string) => void>();

  constructor(private readonly limit = 64) {}

  record(sha: string): void {
    this.last = sha;
    if (!this.shas.has(sha)) {
      this.shas.add(sha);
      this.order.push(sha);
      while (this.order.length > this.limit) {
        const oldest = this.order.shift();
        if (oldest) this.shas.delete(oldest);
      }
    }
    for (const listener of this.listeners) listener(sha);
  }

  /**
   * Observe every commit this tab lands, whoever landed it — autosave, discard, a
   * theme import, publish. Because {@link recordingClient} funnels all write paths
   * through {@link record}, subscribing here is the one place "our branch just
   * moved" can be watched **without a per-call-site hook that each new feature has
   * to remember** — forgetting exactly that is how theme imports once left the
   * header counts stale (and the Publish button disabled) until a reload.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (sha: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  has(sha: string): boolean {
    return this.shas.has(sha);
  }

  /** The most recent commit this tab landed — the baseline a foreign write moves past. */
  latest(): string | undefined {
    return this.last;
  }
}

/**
 * Wrap a {@link HostProvider} so **every** commit it lands is recorded in {@link OwnWrites}
 * — autosave, discard/revert, theme import, publish alike.
 *
 * Deliberately a `Proxy` rather than a hand-written delegating object: the port has a
 * dozen methods and grows, and a delegate that silently misses a newly added write path
 * would reintroduce exactly the bug this exists to prevent (our own commit read as
 * someone else's). Only the two methods that create commits are intercepted; everything
 * else passes straight through.
 */
export function recordingClient(client: HostProvider, own: OwnWrites): HostProvider {
  const WRITES = new Set(['commitFiles', 'publishSquash']);
  return new Proxy(client, {
    get(target, prop) {
      // Read and bind against the real instance, never the proxy: these adapters use
      // private fields, which throw if a method runs with `this` set to the proxy.
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== 'function') return value; // `deploy` is a plain object
      const fn = value as (...args: unknown[]) => unknown;
      if (!WRITES.has(String(prop))) return fn.bind(target);
      return async (...args: unknown[]): Promise<unknown> => {
        const result = await fn.apply(target, args);
        const sha = (result as { sha?: unknown } | undefined)?.sha;
        if (typeof sha === 'string') own.record(sha);
        return result;
      };
    },
  });
}
