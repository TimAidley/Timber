import { handleRequest, type BrokerEnv } from './handler.js';

/**
 * Cloudflare Workers entry point (the reference deployment). All logic lives in the
 * portable {@link handleRequest}; this is just the platform glue, so the same handler
 * ports to Deno Deploy, Netlify/Vercel edge functions, or any host with the fetch API.
 */
export default {
  fetch(request: Request, env: BrokerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
