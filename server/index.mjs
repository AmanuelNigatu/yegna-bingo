import http from 'node:http';
import { handler as apiHandler } from './api.mjs';
import { handler as botHandler } from './bot.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function headersToObject(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[key] = value;
  return out;
}

function eventFromRequest(req, body) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryStringParameters = Object.fromEntries(url.searchParams.entries());
  return {
    httpMethod: req.method || 'GET',
    path: url.pathname,
    rawUrl: req.url,
    headers: req.headers,
    queryStringParameters,
    body,
    isBase64Encoded: false,
  };
}

const MAX_BODY_BYTES = 1024 * 1024;

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return '';
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    req.resume();
    const error = new Error('Request body too large');
    error.statusCode = 413;
    throw error;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    const onEnd = () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    };
    req.on('data', chunk => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        req.removeListener('end', onEnd);
        req.resume();
        const error = new Error('Request body too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', onEnd);
    req.once('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const event = eventFromRequest(req, body);
    let result;

    if (event.path === '/telegram/webhook' || event.path === '/telegram/webhook/') {
      result = await botHandler(event);
    } else if (event.path === '/api' || event.path.startsWith('/api/')) {
      result = await apiHandler(event);
    } else if (event.path === '/health' || event.path === '/health/') {
      result = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, service: 'yegna-bingo' }) };
    } else {
      result = { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
    }

    res.writeHead(result.statusCode || 200, headersToObject(result.headers));
    res.end(result.body || '');
  } catch (error) {
    if (error?.statusCode === 413) {
      if (!res.headersSent) res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
      if (!res.destroyed) res.end(JSON.stringify({ error: 'Request body exceeds the 1 MiB limit.' }));
      return;
    }
    console.error('HTTP server error', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`YEGNA BINGO server listening on ${HOST}:${PORT}`);
});
