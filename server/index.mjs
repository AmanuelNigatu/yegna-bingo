import http from 'node:http';
import { handler as apiHandler } from './api.mjs';
import { handler as botHandler } from './bot.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function headersObject(req) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) out[key] = value.join(', ');
    else if (value != null) out[key] = value;
  }
  return out;
}

function toEvent(req, body) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return {
    httpMethod: req.method,
    path: url.pathname,
    rawQuery: url.search.slice(1),
    headers: headersObject(req),
    body
  };
}

function send(res, result) {
  const status = Number(result?.statusCode || 200);
  for (const [key, value] of Object.entries(result?.headers || {})) {
    if (value != null) res.setHeader(key, value);
  }
  res.statusCode = status;
  res.end(result?.body ?? '');
}

const server = http.createServer(async (req, res) => {
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
    const event = toEvent(req, body);

    if (event.path === '/api/bot' || event.path.startsWith('/api/bot/')) {
      send(res, await botHandler(event));
      return;
    }
    if (event.path === '/api' || event.path.startsWith('/api/')) {
      send(res, await apiHandler(event));
      return;
    }
    if (event.path === '/health' || event.path === '/') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, service: 'yegna-bingo-backend' }));
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found.' }));
  } catch (error) {
    console.error(JSON.stringify({ service: 'yegna-bingo-backend', event: 'server_error', error: error?.message || 'unknown error' }));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
  }
});

server.listen(PORT, HOST, () => console.log(`YEGNA BINGO backend listening on ${HOST}:${PORT}`));
