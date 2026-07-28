import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/** Below this, compressing costs more than it saves. */
const MIN_GZIP_BYTES = 4096;

/**
 * JSON response with opportunistic gzip. Next does not compress App Router
 * route handlers, and the map payloads are megabytes of digits — they shrink
 * by roughly 4x. Anything that fronts the app (Traefik, nginx, a CDN) will
 * simply pass our already-encoded body through.
 */
export async function jsonResponse(
  req: Request,
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const body = Buffer.from(JSON.stringify(data));
  return bufferResponse(req, body, init);
}

export async function bufferResponse(
  req: Request,
  body: Buffer,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Vary', 'Accept-Encoding');

  const accepts = (req.headers.get('accept-encoding') || '').includes('gzip');
  if (accepts && body.length >= MIN_GZIP_BYTES) {
    const gz = await gzipAsync(body);
    headers.set('Content-Encoding', 'gzip');
    headers.set('Content-Length', String(gz.length));
    return new Response(new Uint8Array(gz), { status: init.status ?? 200, headers });
  }

  headers.set('Content-Length', String(body.length));
  return new Response(new Uint8Array(body), { status: init.status ?? 200, headers });
}
