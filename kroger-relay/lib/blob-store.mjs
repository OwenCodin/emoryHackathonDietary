// Vercel Blob store (private). Signatures checked against @vercel/blob 2.9.0 dist/index.d.ts:
//   put(pathname, body, { access, contentType, addRandomSuffix, allowOverwrite, cacheControlMaxAge })
//   get(pathname, { access, useCache }) -> null | { statusCode, stream, ... }
//   del(urlOrPathname | string[]) and list({ prefix, limit }) take no `access` option.
// On Vercel the SDK authenticates with OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID); no token is read here.
import { del, get, list, put } from '@vercel/blob';

const pathFor = (state) => `codes/${state}.json`;

export function createBlobStore() {
  return {
    async put(state, { code, at }) {
      try {
        await put(pathFor(state), JSON.stringify({ code, at }), {
          access: 'private',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        });
        return { ok: true };
      } catch (err) {
        // The package has no dedicated error class for an existing pathname, so match its message.
        if (/already exists/i.test(String(err?.message ?? ''))) return { ok: false, exists: true };
        return { ok: false };
      }
    },
    async get(state) {
      const result = await get(pathFor(state), { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = (await new Response(result.stream).text()).slice(0, 4096);
      const parsed = JSON.parse(text);
      if (typeof parsed?.code !== 'string' || !Number.isFinite(parsed?.at)) return null;
      return { code: parsed.code, at: parsed.at };
    },
    async del(state) {
      try {
        await del(pathFor(state));
      } catch {
        // deleting a missing blob is fine; other failures are cleaned up by the ten-minute sweep
      }
    },
    async sweep(cutoffMs) {
      try {
        const { blobs } = await list({ prefix: 'codes/', limit: 100 });
        const old = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoffMs).map((b) => b.url);
        if (old.length > 0) await del(old);
      } catch {
        // best effort
      }
    },
  };
}
