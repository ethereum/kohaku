// Proof runner: bundles the demo page, serves it, drives headless Chromium,
// and asserts that Kohaku RPC calls succeed through the anon-rpc sandbox.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));

await build({
    entryPoints: [join(root, 'src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: join(root, 'dist/main.js'),
    logLevel: 'warning',
});

const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const path = pathname === '/' ? '/index.html' : pathname;
    try {
        const data = await readFile(join(root, path));
        res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404).end('not found');
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`serving ${url}`);

// WebRTC flags: same set as anon-rpc's own e2e, needed for real KPS dials.
const browser = await chromium.launch({
    args: [
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--force-webrtc-ip-handling-policy=default',
    ],
});
const page = await browser.newPage();
page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[poc]')) console.log(text);
});
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

const flavor = process.argv[2] === 'tor' ? 'tor' : 'passthrough';
await page.goto(`${url}?worker=${flavor}`);
await page.waitForFunction(() => window.__poc !== undefined, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.__poc);

await browser.close();
server.close();

console.log('\nresult:', JSON.stringify(result, null, 2));

const pass = result.ok === true && result.chainId === 1 && result.block > 23_000_000;
console.log(pass ? '\nPOC PASSED ✅' : '\nPOC FAILED ❌');
process.exit(pass ? 0 : 1);
