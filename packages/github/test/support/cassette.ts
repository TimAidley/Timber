import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** One recorded real HTTP exchange, captured by `scripts/record-fixtures.ts`. */
export interface CassetteExchange {
  method: string;
  url: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
}

export type Cassette = CassetteExchange[];

export interface ServedRequest {
  method: string;
  pathname: string;
  authorization: string | null;
}

function keyFor(method: string, pathname: string): string {
  return `${method.toUpperCase()} ${pathname}`;
}

/**
 * Build an msw server that replays a cassette recorded from the real GitHub API.
 *
 * Requests are matched by (method, pathname) against a FIFO queue per key — so two
 * calls to the same endpoint (e.g. two `createBlob`s in a multi-file commit) are
 * served in the order they were recorded. When a recorded exchange has a request
 * body, the actual incoming body must deep-equal it, or the mock returns a loud
 * 599 explaining the mismatch — this is what catches a payload regression, not
 * just a wrong-endpoint regression.
 */
export function createCassetteServer(cassette: Cassette) {
  const queues = new Map<string, CassetteExchange[]>();
  for (const exchange of cassette) {
    const { pathname } = new URL(exchange.url);
    const key = keyFor(exchange.method, pathname);
    const queue = queues.get(key) ?? [];
    queue.push(exchange);
    queues.set(key, queue);
  }

  const served: ServedRequest[] = [];

  const handler = http.all('https://api.github.com/*', async ({ request }) => {
    const url = new URL(request.url);
    const key = keyFor(request.method, url.pathname);
    served.push({
      method: request.method,
      pathname: url.pathname,
      authorization: request.headers.get('authorization'),
    });

    const queue = queues.get(key);
    const next = queue?.shift();
    if (!next) {
      return HttpResponse.json(
        { message: `No recorded exchange left for ${key}` },
        { status: 599 },
      );
    }

    if (next.requestBody !== undefined) {
      const actualBody: unknown = await request
        .clone()
        .json()
        .catch(() => undefined);
      if (JSON.stringify(actualBody) !== JSON.stringify(next.requestBody)) {
        return HttpResponse.json(
          {
            message: `Request body for ${key} did not match the recording`,
            expected: next.requestBody,
            actual: actualBody,
          },
          { status: 599 },
        );
      }
    }

    return HttpResponse.json(next.responseBody, { status: next.status });
  });

  return {
    server: setupServer(handler),
    served,
    /** True once every recorded exchange has been consumed exactly once. */
    isExhausted: (): boolean => [...queues.values()].every((queue) => queue.length === 0),
  };
}
