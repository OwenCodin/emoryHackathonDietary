// Serves a relay over node:http (local dev server and the local end-to-end test).
export function createNodeHandler(relay) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      let handler = null;
      if (url.pathname.startsWith('/k/') || url.pathname === '/api/k') handler = relay.start;
      else if (url.pathname === '/api/kroger/callback') handler = relay.callback;
      else if (url.pathname === '/api/kroger/claim') handler = relay.claim;
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const init = { method: req.method, headers: req.headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) break;
          chunks.push(chunk);
        }
        init.body = Buffer.concat(chunks);
      }
      const response = await handler(new Request(url, init));
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
    }
  };
}
