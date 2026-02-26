import http from 'node:http';
import https from 'node:https';

const PORT_BASE = 9345;

export interface TrafficProxyOptions {
  executionUrl: string;
  consensusUrl: string;
  proverUrl: string;
  portBase?: number;
}

export interface TrafficProxy {
  proxyUrls: { execution: string; consensus: string; prover: string };
  getTotalBytes(): number;
  close(): Promise<void>;
}

/** In-process reverse proxy; counts bytes in+out per upstream, getTotalBytes() returns sum. */
export async function createTrafficProxy(options: TrafficProxyOptions): Promise<TrafficProxy> {
  const portBase = options.portBase ?? PORT_BASE;
  const upstreams = [
    { url: options.executionUrl, port: portBase },
    { url: options.consensusUrl, port: portBase + 1 },
    { url: options.proverUrl, port: portBase + 2 },
  ] as const;

  const counts = [{ in: 0, out: 0 }, { in: 0, out: 0 }, { in: 0, out: 0 }];
  const servers: http.Server[] = [];

  function getTotalBytes(): number {
    return counts.reduce((sum, c) => sum + c.in + c.out, 0);
  }

  function createProxyHandler(upstreamUrl: string, index: number): http.RequestListener {
    const parsed = new URL(upstreamUrl);
    const isHttps = parsed.protocol === 'https:';

    return (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => {
      const bodyChunks: Buffer[] = [];
      clientReq.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
      clientReq.on('end', () => {
        const body = Buffer.concat(bodyChunks);
        counts[index]!.out += body.length;

        // Use upstream URL path (e.g. /execution) so POST to proxy root is forwarded to upstream path
        const clientPath = clientReq.url ?? '/';
        const basePath = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
        const path = basePath + (clientPath === '/' ? '' : clientPath);
        const opts = {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: path || '/',
          method: clientReq.method,
          headers: {
            ...clientReq.headers,
            host: parsed.host,
          },
        };
        const req = (isHttps ? https : http).request(opts, (upstreamRes) => {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            counts[index]!.in += chunk.length;
          });
          upstreamRes.on('end', () => {
            clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
            clientRes.end(Buffer.concat(chunks));
          });
        });
        req.on('error', (err) => {
          clientRes.writeHead(502);
          clientRes.end(String(err));
        });
        req.write(body);
        req.end();
      });
    };
  }

  await Promise.all(
    upstreams.map((u, i) => {
      return new Promise<void>((resolve) => {
        const server = http.createServer(createProxyHandler(u.url, i));
        server.listen(u.port, '127.0.0.1', () => {
          servers.push(server);
          resolve();
        });
      });
    }),
  );

  return {
    proxyUrls: {
      execution: `http://127.0.0.1:${portBase}`,
      consensus: `http://127.0.0.1:${portBase + 1}`,
      prover: `http://127.0.0.1:${portBase + 2}`,
    },
    getTotalBytes,
    async close(): Promise<void> {
      await Promise.all(servers.map((s) => new Promise<void>((res) => s.close(() => res()))));
    },
  };
}
