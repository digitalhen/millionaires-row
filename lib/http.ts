import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/** Below this, compressing costs more than it saves. */
const MIN_GZIP_BYTES = 4096;

/**
 * zlib level for bodies compressed per request.
 *
 * These payloads are arrays of rounded coordinates — highly repetitive digits,
 * which is the case where the cheap levels already capture nearly all of the
 * win. On a 1.3MB viewport response, level 1 is ~4x faster than the zlib
 * default (6) for ~7% more bytes, and at 100 concurrent viewport requests the
 * compressor, not Postgres, is what saturates the box. Bytes are the cheaper
 * resource here; CPU is the scarce one.
 *
 * Bodies that are compressed once and reused (the citywide overview) pass a
 * higher level explicitly — there the trade runs the other way.
 */
const GZIP_LEVEL_STREAMING = 1;
export const GZIP_LEVEL_CACHED = 6;

/** Compress a body, for callers that memoise the result themselves. */
export function gzipBuffer(body: Buffer, level = GZIP_LEVEL_CACHED): Promise<Buffer> {
  return gzipAsync(body, { level });
}

export type ResponseInit = {
  status?: number;
  headers?: Record<string, string>;
  /**
   * Pre-compressed form of `body`. Supplied by callers that hold both forms of
   * a deterministic payload, so a request costs a buffer copy rather than a
   * megabyte of compression.
   */
  gzipped?: Buffer;
};

/**
 * JSON response with opportunistic gzip. Next does not compress App Router
 * route handlers, and the map payloads are megabytes of digits — they shrink
 * by roughly 4x. Anything that fronts the app (Traefik, nginx, a CDN) will
 * simply pass our already-encoded body through.
 */
export async function jsonResponse(
  req: Request,
  data: unknown,
  init: ResponseInit = {},
): Promise<Response> {
  const body = Buffer.from(JSON.stringify(data));
  return bufferResponse(req, body, init);
}

export async function bufferResponse(
  req: Request,
  body: Buffer,
  init: ResponseInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Vary', 'Accept-Encoding');

  const accepts = (req.headers.get('accept-encoding') || '').includes('gzip');
  if (accepts && (init.gzipped || body.length >= MIN_GZIP_BYTES)) {
    const gz = init.gzipped ?? (await gzipAsync(body, { level: GZIP_LEVEL_STREAMING }));
    headers.set('Content-Encoding', 'gzip');
    headers.set('Content-Length', String(gz.length));
    return new Response(new Uint8Array(gz), { status: init.status ?? 200, headers });
  }

  headers.set('Content-Length', String(body.length));
  return new Response(new Uint8Array(body), { status: init.status ?? 200, headers });
}
