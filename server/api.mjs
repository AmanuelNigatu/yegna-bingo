import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function corsHeaders(origin) {
  const allowed = String(process.env.ALLOWED_ORIGIN || '').trim();
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data, X-Wallet-Bot-Secret',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
  // Never combine wildcard origins with credentialed requests. In production,
  // require an explicit Mini App origin. Non-production keeps a permissive
  // fallback for local previews where no origin is configured.
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  else if (process.env.NODE_ENV !== 'production') headers['Access-Control-Allow-Origin'] = '*';
  return headers;
}

function json(status, body, extraHeaders = {}, origin = '') {
  const requestId = crypto.randomUUID();
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, ...corsHeaders(origin), ...extraHeaders }, body: JSON.stringify(body) };
}

function originAllowed(event) {
  const origin = String(event.headers?.origin || event.headers?.Origin || '').trim();
  const allowed = String(process.env.ALLOWED_ORIGIN || '').trim();
  if (!origin) return true;
  if (allowed) return origin === allowed;
  return process.env.NODE_ENV !== 'production';
}

function logEvent(event, data = {}) {
  const payload = {
    service: 'yegna-bingo-api',
    ts: new Date().toISOString(),
    method: event.httpMethod,
    path: event.path,
    ...data
  };
  console.log(JSON.stringify(payload));
}
const SESSION_COOKIE = 'yegna_session';
const PICK_WINDOW_SECONDS = 35;
const CALL_INTERVAL_MS = 3000;
const MAX_CATCH_UP_CALLS = 20;
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 86400);
function cookieValue(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const part = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function sessionHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}
function clearSessionCookie() {
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`;
}

function verifyTelegramInitData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS || 3600);
  const futureSkew = Number(process.env.TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS || 60);
  if (!Number.isInteger(authDate) || authDate <= 0 || !Number.isFinite(maxAge) || maxAge < 60) return null;
  // Telegram initData is intentionally short-lived. Reject stale or future-dated
  // payloads to reduce replay and clock-skew abuse.
  if (now - authDate > maxAge || authDate - now > futureSkew) return null;
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}
async function authFromSession(req, client) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || token.length < 40) return null;
  const r = await client.query(
    `SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > NOW()`,
    [sessionHash(token)]
  );
  if (!r.rows[0]) return null;
  await client.query(`UPDATE auth_sessions SET last_seen_at=NOW() WHERE token_hash=$1`, [sessionHash(token)]);
  return r.rows[0];
}

async function createSession(req, client) {
  const tg = verifyTelegramInitData(req.headers['x-telegram-init-data']);
  if (!tg?.id) return null;
  const initData = String(req.headers['x-telegram-init-data'] || '');
  const replayHash = sessionHash(initData);
  await client.query('BEGIN');
  try {
    const replay = await client.query(`SELECT 1 FROM telegram_auth_replays WHERE payload_hash=$1 FOR UPDATE`, [replayHash]);
    if (replay.rows[0]) { await client.query('ROLLBACK'); return null; }
    const user = await upsertTelegramUser(tg, client);
    await client.query(`INSERT INTO telegram_auth_replays(payload_hash,telegram_id) VALUES($1,$2)`, [replayHash, tg.id]);
    const token = crypto.randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO auth_sessions(token_hash,user_id,expires_at,last_seen_at) VALUES($1,$2,NOW()+make_interval(secs => $3),NOW())`,
      [sessionHash(token), user.id, SESSION_TTL_SECONDS]
    );
    await client.query('COMMIT');
    return { user, token };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
}

async function upsertTelegramUser(tg, client) {
  const superAdminId = String(process.env.SUPER_ADMIN_TELEGRAM_ID || '').trim();
  const configuredSuperAdmin = superAdminId && String(tg.id) === superAdminId;
  const existing = await client.query(`SELECT * FROM users WHERE telegram_id=$1`, [tg.id]);
  let role = configuredSuperAdmin ? 'super_admin' : (existing.rows[0]?.role === 'sub_admin' ? 'sub_admin' : 'user');
  const { rows } = await client.query(`INSERT INTO users(telegram_id, username, first_name, last_name, role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, role=EXCLUDED.role, updated_at=NOW() RETURNING *`, [tg.id, tg.username || null, tg.first_name || null, tg.last_name || null, role]);
  await client.query(`INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [rows[0].id]);
  return rows[0];
}

async function auth(req, client) {
  return authFromSession(req, client);
}

function isAdmin(user) { return user?.role === 'sub_admin' || user?.role === 'super_admin'; }
function isSuperAdmin(user) { return user?.role === 'super_admin'; }
async function hasPermission(client, user, permission) {
  if (isSuperAdmin(user)) return true;
  if (user?.role !== 'sub_admin') return false;
  const r = await client.query(`SELECT permissions FROM sub_admin_permissions WHERE user_id=$1`, [user.id]);
  return Boolean(r.rows[0]?.permissions?.[permission]);
}

function seededRandom(seed) {
  let x = seed >>> 0;
  return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; };
}
function shuffle(values, random) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function createBingoCard(cardNo, gameType) {
  const random = seededRandom(cardNo * 7919 + gameType * 104729);
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  const columns = ranges.map(([min,max]) => shuffle(Array.from({length:max-min+1},(_,i)=>min+i), random).slice(0,5));
  return Array.from({length:5},(_,row)=>Array.from({length:5},(_,col)=>(row===2 && col===2 ? 'FREE' : columns[col][row])));
}
function winningPattern(grid, called) {
  const marked = v => v === 'FREE' || called.has(Number(v));
  for (let r=0;r<5;r++) if (grid[r].every(marked)) return { type:'horizontal', label:`ROW ${r+1}`, cells:Array.from({length:5},(_,c)=>[r,c]) };
  for (let c=0;c<5;c++) if (grid.every(row=>marked(row[c]))) return { type:'vertical', label:`COLUMN ${c+1}`, cells:Array.from({length:5},(_,r)=>[r,c]) };
  if (Array.from({length:5},(_,i)=>grid[i][i]).every(marked)) return { type:'diagonal', label:'DIAGONAL', cells:Array.from({length:5},(_,i)=>[i,i]) };
  if (Array.from({length:5},(_,i)=>grid[i][4-i]).every(marked)) return { type:'diagonal', label:'DIAGONAL', cells:Array.from({length:5},(_,i)=>[i,4-i]) };
  const corners=[[0,0],[0,4],[4,0],[4,4]];
  if (corners.every(([r,c])=>marked(grid[r][c]))) return { type:'corners', label:'FOUR CORNERS', cells:corners };
  return null;
}
async function recordGameCall(client, gameId, callIndex, number) {
  const r = await client.query(
    `INSERT INTO game_calls(game_id,call_index,number) VALUES($1,$2,$3)
     ON CONFLICT(game_id,call_index) DO NOTHING RETURNING id,called_at`,
    [gameId, callIndex, number]
  );
  if (r.rows.length) return r.rows[0];
  const existing = await client.query(`SELECT id,called_at FROM game_calls WHERE game_id=$1 AND call_index=$2`, [gameId, callIndex]);
  return existing.rows[0] || null;
}

function nextCalledNumber(game) {
  const calls = Array.isArray(game.called_numbers) ? game.called_numbers.map(Number) : [];
  const used = new Set(calls);
  const available = Array.from({length:75}, (_,i)=>i+1).filter(n => !used.has(n));
  if (!available.length) return null;
  const seed = crypto.createHash('sha256').update(`${game.id}:${Number(game.call_index || 0)}:${game.created_at}`).digest().readUInt32BE(0);
  return available[seed % available.length];
}

async function settleGameForWinners(client, game, winners) {
  if (!winners.length) return { rewardPool:0, share:0 };
  const poolR = await client.query(`SELECT COUNT(*)::numeric * $2::numeric AS stake_total FROM game_cards WHERE game_id=$1`, [game.id, game.stake]);
  const stakeTotal = Number(poolR.rows[0].stake_total || 0);
  const rewardPool = Number((stakeTotal * Number(game.reward_rate) / 100).toFixed(2));
  const share = Number((rewardPool / winners.length).toFixed(2));
  for (const w of winners) {
    const uid=Number(w.userId), card=Number(w.cardNumber);
    const wal=await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`,[uid]);
    if(!wal.rows[0]) throw new Error('Winner wallet not found');
    const next=Number((Number(wal.rows[0].balance)+share).toFixed(2));
    const tx=await client.query(`INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail) VALUES($1,'win_reward',$2,$3,$4,$5) ON CONFLICT(type,reference_id,user_id) DO NOTHING RETURNING id`,[uid,share,next,`reward-${game.id}-${card}`,winners.length===2?`Win Reward · Shared Overlap · Card #${card}`:`Win Reward · Card #${card}`]);
    if(tx.rows.length) await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`,[next,uid]);
    await client.query(`INSERT INTO game_winners(game_id,user_id,card_number,reward_amount,split_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(game_id,card_number) DO NOTHING`,[game.id,uid,card,share,winners.length]);
  }
  await client.query(`UPDATE games SET status='settled', settled_at=NOW(), winner_count=$2 WHERE id=$1`,[game.id,winners.length]);
  return {rewardPool,share};
}

function pathParts(event) { return (event.path || '').split('/').filter(Boolean).slice(-5); }

export async function handler(event) {
  const startedAt = Date.now();
  logEvent(event, { event: 'request_start' });
  if (!originAllowed(event)) return json(403, { error: 'Origin not allowed.' });
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  // Lightweight public health endpoint. It checks configuration and PostgreSQL
  // connectivity without requiring a Telegram session or exposing user data.
  if (event.httpMethod === 'GET' && pathParts(event).at(-1) === 'health') {
    const checks = { database: 'unknown', telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) };
    if (!process.env.DATABASE_URL) {
      checks.database = 'not_configured';
      return json(503, { ok: false, checks, latencyMs: Date.now() - startedAt });
    }
    try {
      const r = await pool.query('SELECT 1 AS ok');
      checks.database = r.rows[0]?.ok === 1 ? 'ok' : 'error';
      const healthy = checks.database === 'ok' && checks.telegram;
      logEvent(event, { event: 'health_check', ok: healthy, latencyMs: Date.now() - startedAt, checks });
      return json(healthy ? 200 : 503, { ok: healthy, checks, latencyMs: Date.now() - startedAt });
    } catch (e) {
      checks.database = 'error';
      console.error(JSON.stringify({ service: 'yegna-bingo-api', event: 'health_error', ts: new Date().toISOString(), error: e?.message || 'database error' }));
      return json(503, { ok: false, checks, latencyMs: Date.now() - startedAt });
    }
  }

  if (!process.env.DATABASE_URL || !process.env.TELEGRAM_BOT_TOKEN) return json(503, { error: 'Backend is not configured. Set DATABASE_URL and TELEGRAM_BOT_TOKEN.' });
  const client = await pool.connect();
  try {
    const method = event.httpMethod;
    const parts = pathParts(event);
    const body = event.body ? JSON.parse(event.body) : {};

    // One-time Telegram initData bootstrap. Protected API routes use the server session cookie after this.
    if (method === 'POST' && parts.at(-2) === 'auth' && parts.at(-1) === 'session') {
      const current = await authFromSession(event, client);
      if (current) return json(200, { ok: true, user: { id:current.id, telegramId:current.telegram_id, username:current.username, firstName:current.first_name, lastName:current.last_name, role:current.role } });
      const created = await createSession(event, client);
      if (!created) return json(401, { error: 'Telegram authentication payload is invalid, expired, or already used.' }, { 'Set-Cookie': clearSessionCookie() });
      return json(200, { ok: true, user: { id:created.user.id, telegramId:created.user.telegram_id, username:created.user.username, firstName:created.user.first_name, lastName:created.user.last_name, role:created.user.role } }, { 'Set-Cookie': sessionCookie(created.token) });
    }

    if (method === 'POST' && parts.at(-2) === 'auth' && parts.at(-1) === 'logout') {
      const token = cookieValue(event, SESSION_COOKIE);
      if (token) await client.query(`DELETE FROM auth_sessions WHERE token_hash=$1`, [sessionHash(token)]);
      return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }

    // Telegram Bot wallet-request intake. Accept both the V38 contract route
    // (/wallet/requests) and the legacy internal route (/bot/wallet-request).
    const isBotWalletRequest = method === 'POST' &&
      ((parts.at(-2) === 'wallet' && parts.at(-1) === 'requests') ||
       (parts.includes('bot') && parts.at(-1) === 'wallet-request'));
    if (isBotWalletRequest) {
      const botSecret = String(process.env.WALLET_BOT_SECRET || '').trim();
      const supplied = String(event.headers['x-wallet-bot-secret'] || event.headers['X-Wallet-Bot-Secret'] || '').trim();
      const secretBuf = Buffer.from(botSecret);
      const suppliedBuf = Buffer.from(supplied);
      if (!botSecret || !supplied || secretBuf.length !== suppliedBuf.length || !crypto.timingSafeEqual(secretBuf, suppliedBuf)) {
        return json(401, { error: 'Bot wallet request authentication failed.' });
      }
      const telegramId = String(body.telegram_user_id ?? body.telegramId ?? '').trim();
      const type = body.type === 'withdraw' || body.type === 'withdrawal' ? 'withdrawal' :
        body.type === 'deposit' ? 'deposit' : '';
      const amount = Number(body.amount);
      const referenceId = String(body.reference ?? body.referenceId ?? '').trim();
      if (!/^\d+$/.test(telegramId) || !type || !Number.isFinite(amount) || amount <= 0 || !referenceId) {
        return json(400, { error: 'telegram_user_id, type, positive amount and unique reference are required.' });
      }
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id,reference_id,status,amount,type,requested_at FROM wallet_requests WHERE reference_id=$1 FOR UPDATE`,
        [referenceId]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return json(200, { ok: true, idempotent: true, request: existing.rows[0] });
      }
      const u = await client.query(`SELECT id FROM users WHERE telegram_id=$1`, [telegramId]);
      if (!u.rows[0]) {
        await client.query('ROLLBACK');
        return json(404, { error: 'User has not opened the Mini App yet.' });
      }
      if (type === 'withdrawal') {
        const w = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [u.rows[0].id]);
        if (!w.rows[0] || Number(w.rows[0].balance) < amount) {
          await client.query('ROLLBACK');
          return json(400, { error: 'Insufficient wallet balance for withdrawal.' });
        }
        const next = Number(w.rows[0].balance) - amount;
        await client.query(
          `INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail)
           VALUES($1,'withdrawal_hold',$2,$3,$4,$5)`,
          [u.rows[0].id, -amount, next, `request-${referenceId}`, `Withdrawal hold · Request ${referenceId}`]
        );
        await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`, [next, u.rows[0].id]);
      }
      const r = await client.query(
        `INSERT INTO wallet_requests(user_id,type,amount,reference_id,method,detail)
         VALUES($1,$2,$3,$4,$5,$6)
         RETURNING id,reference_id,status,amount,type,requested_at`,
        [u.rows[0].id, type, amount, referenceId, body.method || null, body.note ?? body.detail ?? null]
      );
      await client.query('COMMIT');
      return json(201, { ok: true, request: r.rows[0] });
    }

    const user = await auth(event, client);
    if (!user) return json(401, { error: 'Valid Telegram WebApp authentication is required.' });

    if (method === 'GET' && parts.at(-1) === 'health') return json(200, { ok: true });

    if (method === 'GET' && parts.at(-1) === 'me') {
      return json(200, { user: { id:user.id, telegramId:user.telegram_id, username:user.username, firstName:user.first_name, lastName:user.last_name, role:user.role } });
    }

    if (method === 'GET' && parts.at(-1) === 'wallet') {
      const w = await client.query(`SELECT w.balance, u.username, u.telegram_id FROM wallets w JOIN users u ON u.id=w.user_id WHERE w.user_id=$1`, [user.id]);
      const tx = await client.query(`SELECT id,type,amount,balance_after,detail,reference_id,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [user.id]);
      return json(200, { wallet: w.rows[0], transactions: tx.rows });
    }

    if (parts.at(-2) === 'admin' || parts.includes('admin')) {
      if (!isAdmin(user)) return json(403, { error: 'Admin access required.' });
      if (method === 'GET' && parts.at(-1) === 'stats') {
        if (!(await hasPermission(client, user, 'dashboard_view'))) return json(403,{error:'Dashboard permission required.'});
        const r = await client.query(`SELECT
          (SELECT COUNT(*) FROM users) users,
          (SELECT COALESCE(SUM(balance),0) FROM wallets) balance,
          (SELECT COALESCE(SUM(-amount),0) FROM wallet_transactions WHERE type='stake') stakes,
          (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='win_reward') rewards,
          (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='deposit') deposits,
          (SELECT COALESCE(SUM(amount),0) FROM wallet_requests WHERE type='withdrawal' AND status='approved') withdrawals`);
        return json(200, r.rows[0]);
      }
      if (method === 'GET' && parts.at(-1) === 'user-wallet') {
        if (!(await hasPermission(client, user, 'users_view'))) return json(403,{error:'Users permission required.'});
        const targetId = Number(event.queryStringParameters?.userId);
        if (!Number.isInteger(targetId)) return json(400,{error:'Valid userId is required.'});
        const w = await client.query(`SELECT w.balance,u.id,u.telegram_id,u.username,u.first_name,u.last_name FROM wallets w JOIN users u ON u.id=w.user_id WHERE u.id=$1`,[targetId]);
        if (!w.rows[0]) return json(404,{error:'User wallet not found.'});
        const tx = await client.query(`SELECT id,type,amount,balance_after,detail,reference_id,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[targetId]);
        return json(200,{user:w.rows[0],transactions:tx.rows});
      }

      if (method === 'GET' && parts.at(-1) === 'users') {
        if (!(await hasPermission(client, user, 'users_view'))) return json(403,{error:'Users permission required.'});
        const q = String(event.queryStringParameters?.q || '').trim();
        const r = await client.query(`SELECT u.id,u.telegram_id,u.username,u.first_name,u.last_name,u.role,w.balance FROM users u JOIN wallets w ON w.user_id=u.id WHERE ($1='' OR COALESCE(u.username,'') ILIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 200`, [q]);
        return json(200, { users: r.rows });
      }
      if (method === 'GET' && parts.at(-1) === 'wallet-requests') {
        if (!(await hasPermission(client, user, 'wallet_manage'))) return json(403,{error:'Wallet permission required.'});
        const status = String(event.queryStringParameters?.status || 'pending').trim();
        const type = String(event.queryStringParameters?.type || '').trim();
        const params=[]; const where=[];
        if (['pending','approved','rejected'].includes(status)) { params.push(status); where.push(`r.status=$${params.length}`); }
        if (['deposit','withdrawal'].includes(type)) { params.push(type); where.push(`r.type=$${params.length}`); }
        const q = `SELECT r.id,r.reference_id,r.type,r.amount,r.status,r.method,r.detail,r.rejection_reason,r.requested_at,r.reviewed_at,u.id user_id,u.telegram_id,u.username,u.first_name,u.last_name,ru.username reviewed_by_username FROM wallet_requests r JOIN users u ON u.id=r.user_id LEFT JOIN users ru ON ru.id=r.reviewed_by ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END, r.requested_at DESC LIMIT 200`;
        const result=await client.query(q,params);
        return json(200,{requests:result.rows});
      }
      if (method === 'POST' && parts.at(-1) === 'wallet-requests-approve') {
        if (!(await hasPermission(client, user, 'wallet_manage'))) return json(403,{error:'Wallet permission required.'});
        const requestId=Number(body.requestId); if(!Number.isInteger(requestId)) return json(400,{error:'Valid requestId is required.'});
        await client.query('BEGIN');
        const rr=await client.query(`SELECT * FROM wallet_requests WHERE id=$1 FOR UPDATE`,[requestId]);
        const req=rr.rows[0]; if(!req){await client.query('ROLLBACK');return json(404,{error:'Wallet request not found.'});}
        if(req.status!=='pending'){await client.query('ROLLBACK');return json(409,{error:`Request is already ${req.status}.`});}
        const wal=await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`,[req.user_id]);
        if(!wal.rows[0]){await client.query('ROLLBACK');return json(404,{error:'User wallet not found.'});}
        const current=Number(wal.rows[0].balance), amount=Number(req.amount);
        const next=req.type==='deposit' ? current+amount : current;
        const txType=req.type==='deposit'?'deposit':'withdrawal';
        const txAmount=req.type==='deposit'?amount:0;
        const tx=await client.query(`INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(type,reference_id,user_id) DO NOTHING RETURNING id`,[req.user_id,txType,txAmount,next,`request-${req.reference_id}`,`${req.type==='deposit'?'Deposit':'Withdrawal'} approved · Request #${req.id}`]);
        if(req.type==='deposit' && tx.rows.length){ await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`,[next,req.user_id]); }
        await client.query(`UPDATE wallet_requests SET status='approved',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2`,[user.id,req.id]);
        await client.query('COMMIT');
        return json(200,{ok:true,requestId:req.id,status:'approved',balance:next,transactionId:tx.rows[0]?.id||null});
      }
      if (method === 'POST' && parts.at(-1) === 'wallet-requests-reject') {
        if (!(await hasPermission(client, user, 'wallet_manage'))) return json(403,{error:'Wallet permission required.'});
        const requestId=Number(body.requestId); if(!Number.isInteger(requestId)) return json(400,{error:'Valid requestId is required.'});
        const reason=String(body.reason||'Rejected by admin').trim().slice(0,500);
        await client.query('BEGIN');
        const rr=await client.query(`SELECT * FROM wallet_requests WHERE id=$1 FOR UPDATE`,[requestId]);
        const req=rr.rows[0]; if(!req){await client.query('ROLLBACK');return json(404,{error:'Wallet request not found.'});}
        if(req.status!=='pending'){await client.query('ROLLBACK');return json(409,{error:`Request is already ${req.status}.`});}
        let refundBalance = null;
        if (req.type === 'withdrawal') {
          const wal = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [req.user_id]);
          if (!wal.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'User wallet not found.'}); }
          const current = Number(wal.rows[0].balance);
          const next = current + Number(req.amount);
          const tx = await client.query(
            `INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail)
             VALUES($1,'withdrawal_refund',$2,$3,$4,$5)
             ON CONFLICT(type,reference_id,user_id) DO NOTHING RETURNING id`,
            [req.user_id, Number(req.amount), next, `request-${req.reference_id}-refund`, `Withdrawal rejected · Hold released · Request #${req.id}`]
          );
          if (tx.rows.length) {
            await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`, [next, req.user_id]);
            refundBalance = next;
          } else {
            const currentAfter = await client.query(`SELECT balance FROM wallets WHERE user_id=$1`, [req.user_id]);
            refundBalance = Number(currentAfter.rows[0]?.balance ?? current);
          }
        }
        await client.query(`UPDATE wallet_requests SET status='rejected',rejection_reason=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3`,[reason,user.id,req.id]);
        await client.query('COMMIT');
        return json(200,{ok:true,requestId:req.id,status:'rejected',balance:refundBalance});
      }
      if (method === 'GET' && parts.at(-1) === 'settings') {
        if (!(await hasPermission(client, user, 'reward_manage'))) return json(403,{error:'Reward permission required.'});
        const r = await client.query(`SELECT key,value FROM app_settings`); return json(200, Object.fromEntries(r.rows.map(x=>[x.key,x.value])));
      }
      if (method === 'PUT' && parts.at(-1) === 'reward-rate') {
        if (!(await hasPermission(client, user, 'reward_manage'))) return json(403,{error:'Reward permission required.'});
        const rate = Number(body.rate); if (!Number.isFinite(rate) || rate < 0 || rate > 100) return json(400,{error:'Reward rate must be 0-100.'});
        await client.query(`INSERT INTO app_settings(key,value,updated_at) VALUES('reward_rate',$1,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [rate.toFixed(2)]);
        return json(200,{rate});
      }
      if (method === 'POST' && parts.at(-2) === 'users' && parts.at(-1) === 'adjust') {
        if (!(await hasPermission(client, user, 'wallet_manage'))) return json(403,{error:'Wallet permission required.'});
        const targetId = Number(body.userId), amount = Number(body.amount), type = body.type === 'debit' ? 'admin_debit' : 'admin_credit';
        if (!Number.isInteger(targetId) || !Number.isFinite(amount) || amount <= 0) return json(400,{error:'Invalid userId or amount.'});
        await client.query('BEGIN');
        const w = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [targetId]);
        if (!w.rows[0] || (type === 'admin_debit' && Number(w.rows[0].balance) < amount)) { await client.query('ROLLBACK'); return json(400,{error:'Insufficient balance or user not found.'}); }
        const signed = type === 'admin_debit' ? -amount : amount;
        const next = Number(w.rows[0].balance) + signed;
        const tx = await client.query(`INSERT INTO wallet_transactions(user_id,type,amount,balance_after,detail,reference_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [targetId,type,signed,next,body.detail || (type==='admin_debit'?'Admin wallet debit':'Admin wallet credit'),`admin-${user.id}-${crypto.randomUUID()}`]);
        await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`, [next,targetId]); await client.query('COMMIT');
        return json(200,{ok:true,balance:next,transactionId:tx.rows[0].id});
      }
    }

    if (parts.includes('sub-admins')) {
      if (!isSuperAdmin(user)) return json(403,{error:'Super admin access required.'});
      if (method === 'GET' && parts.at(-1) === 'sub-admins') {
        const r = await client.query(`SELECT u.id,u.telegram_id,u.username,u.first_name,u.last_name,u.created_at,u.updated_at,COALESCE(s.permissions,'{}'::jsonb) permissions FROM users u LEFT JOIN sub_admin_permissions s ON s.user_id=u.id WHERE u.role='sub_admin' ORDER BY u.created_at DESC`);
        return json(200,{subAdmins:r.rows});
      }
      if (method === 'POST' && parts.at(-1) === 'sub-admins') {
        const telegramId = body.telegramId ? String(body.telegramId).trim() : '';
        const username = body.username ? String(body.username).trim().replace(/^@/,'') : '';
        if (!telegramId && !username) return json(400,{error:'telegramId or username is required.'});
        const found = await client.query(`SELECT * FROM users WHERE ${telegramId ? 'telegram_id=$1' : 'LOWER(COALESCE(username,\'\'))=LOWER($1)'}`, [telegramId || username]);
        if (!found.rows[0]) return json(404,{error:'User must open the Mini App once before being promoted to sub admin.'});
        const target=found.rows[0];
        if (target.role === 'super_admin') return json(400,{error:'A super admin cannot be converted to sub admin.'});
        const permissions = body.permissions && typeof body.permissions === 'object' ? body.permissions : {dashboard_view:true,users_view:true,wallet_manage:true,reward_manage:false,game_manage:false};
        await client.query('BEGIN');
        const r=await client.query(`UPDATE users SET role='sub_admin',updated_at=NOW() WHERE id=$1 RETURNING id,telegram_id,username,first_name,last_name,role`,[target.id]);
        await client.query(`INSERT INTO sub_admin_permissions(user_id,permissions,created_by,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions,updated_at=NOW()`,[target.id,JSON.stringify(permissions),user.id]);
        await client.query('COMMIT');
        return json(200,{ok:true,subAdmin:{...r.rows[0],permissions}});
      }
      const targetId = Number(parts.at(-1));
      if (method === 'DELETE' && Number.isInteger(targetId)) {
        await client.query('BEGIN');
        const target=await client.query(`SELECT role FROM users WHERE id=$1 FOR UPDATE`,[targetId]);
        if(!target.rows[0]){await client.query('ROLLBACK');return json(404,{error:'Sub admin not found.'});}
        if(target.rows[0].role!=='sub_admin'){await client.query('ROLLBACK');return json(400,{error:'Only sub admins can be removed here.'});}
        await client.query(`UPDATE users SET role='user',updated_at=NOW() WHERE id=$1`,[targetId]);
        await client.query(`DELETE FROM sub_admin_permissions WHERE user_id=$1`,[targetId]);
        await client.query('COMMIT');
        return json(200,{ok:true,removedUserId:targetId});
      }
      if (method === 'PUT' && Number.isInteger(targetId)) {
        const permissions = body.permissions && typeof body.permissions === 'object' ? body.permissions : null;
        if (!permissions) return json(400,{error:'permissions object is required.'});
        const exists=await client.query(`SELECT role FROM users WHERE id=$1`,[targetId]);
        if(!exists.rows[0] || exists.rows[0].role!=='sub_admin') return json(404,{error:'Sub admin not found.'});
        await client.query(`INSERT INTO sub_admin_permissions(user_id,permissions,created_by,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions,updated_at=NOW()`,[targetId,JSON.stringify(permissions),user.id]);
        return json(200,{ok:true,userId:targetId,permissions});
      }
    }

    if (method === 'GET' && parts.at(-1) === 'access') {
      const permissions = isSuperAdmin(user) ? {dashboard_view:true,users_view:true,wallet_manage:true,reward_manage:true,game_manage:true,sub_admin_manage:true} : (await client.query(`SELECT permissions FROM sub_admin_permissions WHERE user_id=$1`,[user.id])).rows[0]?.permissions || {};
      return json(200,{user:{id:user.id,telegramId:user.telegram_id,username:user.username,role:user.role},permissions});
    }

    if (method === 'GET' && parts.at(-2) === 'games' && parts.at(-1) === 'round') {
      const gameType = Number(event.queryStringParameters?.gameType);
      if (![1,2].includes(gameType)) return json(400,{error:'gameType must be 1 or 2.'});
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [9100 + gameType]);
      let r = await client.query(`SELECT id,game_type,stake,reward_rate,status,created_at,pick_started_at,started_at FROM games WHERE game_type=$1 AND status IN ('picking','running') ORDER BY created_at DESC LIMIT 1`,[gameType]);
      if (!r.rows[0]) {
        const id = `R-${Date.now()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
        const rr = await client.query(`SELECT value FROM app_settings WHERE key='reward_rate'`);
        const rate = Number(rr.rows[0]?.value ?? 85);
        r = await client.query(`INSERT INTO games(id,game_type,stake,reward_rate,status,pick_started_at,called_numbers,call_index) VALUES($1,$2,10,$3,'picking',NOW(),'[]'::jsonb,0) RETURNING id,game_type,stake,reward_rate,status,created_at,pick_started_at,started_at,called_numbers,call_index,next_call_at,winner_count`,[id,gameType,rate]);
      }

      // The picking window is GLOBAL and server-authoritative. If a window
      // expires with zero reservations, reset the SAME round's clock instead
      // of launching a game or relying on any client's localStorage state.
      // If at least one card exists, transition it to running immediately.
      let round = r.rows[0];
      const countR = await client.query(`SELECT COUNT(*)::int AS count FROM game_cards WHERE game_id=$1`, [round.id]);
      let pickedCount = Number(countR.rows[0]?.count || 0);
      if (round.status === 'picking') {
        const elapsed = Math.floor((Date.now() - new Date(round.pick_started_at).getTime()) / 1000);
        if (elapsed >= PICK_WINDOW_SECONDS) {
          if (pickedCount > 0) {
            const started = await client.query(`UPDATE games SET status='running',started_at=COALESCE(started_at,NOW()),next_call_at=COALESCE(next_call_at,NOW()),last_activity_at=NOW(),ended_reason=NULL WHERE id=$1 AND status='picking' RETURNING id,game_type,stake,reward_rate,status,created_at,pick_started_at,started_at`, [round.id]);
            round = started.rows[0] || round;
          } else {
            const reset = await client.query(`UPDATE games SET pick_started_at=NOW(),started_at=NULL,next_call_at=NULL,called_numbers='[]'::jsonb,call_index=0,current_call=NULL,winner_count=0,last_activity_at=NOW(),ended_reason='no_cards_picked' WHERE id=$1 AND status='picking' RETURNING id,game_type,stake,reward_rate,status,created_at,pick_started_at,started_at`, [round.id]);
            round = reset.rows[0] || round;
          }
        }
      }
      const serverNow = Date.now();
      const secondsLeft = round.status === 'picking'
        ? Math.max(0, PICK_WINDOW_SECONDS - Math.floor((serverNow - new Date(round.pick_started_at).getTime()) / 1000))
        : 0;
      await client.query('COMMIT');
      return json(200,{ok:true,round,pickedCount,serverNow,secondsLeft,pickWindowSeconds:PICK_WINDOW_SECONDS});
    }

    if (method === 'GET' && parts.at(-2) === 'games' && parts.at(-1) === 'state') {
      const gameId = String(event.queryStringParameters?.gameId || '').trim();
      if (!gameId) return json(400,{error:'gameId is required.'});
      await client.query('BEGIN');
      const g = await client.query(`SELECT * FROM games WHERE id=$1 FOR UPDATE`,[gameId]);
      if(!g.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'Game round not found.'}); }
      let game = g.rows[0];
      const countR = await client.query(`SELECT COUNT(*)::int AS count FROM game_cards WHERE game_id=$1`,[gameId]);
      const pickedCount = Number(countR.rows[0].count || 0);
      if(game.status==='picking') {
        const elapsed = Math.floor((Date.now()-new Date(game.pick_started_at).getTime())/1000);
        if(elapsed >= PICK_WINDOW_SECONDS && pickedCount > 0) {
          const started = await client.query(`UPDATE games SET status='running',started_at=COALESCE(started_at,NOW()),next_call_at=COALESCE(next_call_at,NOW()),last_activity_at=NOW(),ended_reason=NULL WHERE id=$1 RETURNING *`,[gameId]);
          game=started.rows[0];
        }
      }
      // Recovery-safe engine: one state request may advance every call whose
      // scheduled 3-second deadline has already passed. This means the game
      // does not permanently pause when all clients briefly disconnect. The
      // DB row is locked above, so only one request can advance this round.
      let catchUp = 0;
      while(game.status==='running' && game.next_call_at && new Date(game.next_call_at).getTime() <= Date.now() && catchUp < MAX_CATCH_UP_CALLS) {
        const calls = Array.isArray(game.called_numbers) ? game.called_numbers.map(Number) : [];
        if(calls.length >= 75) {
          await client.query(`UPDATE games SET status='settled',settled_at=COALESCE(settled_at,NOW()),next_call_at=NULL,ended_reason=COALESCE(ended_reason,'all_numbers_called') WHERE id=$1`,[gameId]);
          game=(await client.query(`SELECT * FROM games WHERE id=$1`,[gameId])).rows[0];
          break;
        }
        const next = nextCalledNumber(game);
        if(next == null) break;
        const nextIndex = Number(game.call_index || 0);
        const nextCalls=[...calls,next];
        const cards=await client.query(
          `SELECT gc.user_id,gc.card_number,u.username,u.first_name,u.last_name
           FROM game_cards gc JOIN users u ON u.id=gc.user_id
           WHERE gc.game_id=$1 ORDER BY gc.card_number`, [gameId]
        );
        const calledSet=new Set(nextCalls);
        const winners=[];
        for(const row of cards.rows){
          const pattern=winningPattern(createBingoCard(Number(row.card_number),Number(game.game_type)),calledSet);
          if(pattern) winners.push({
            userId:Number(row.user_id), cardNumber:Number(row.card_number),
            userName:row.username?`@${row.username}`:(row.first_name||row.last_name||'YEGNA Player'), pattern
          });
        }

        // Persist the call before exposing it through game state. The unique
        // (game_id,call_index) constraint makes replay/catch-up idempotent.
        await recordGameCall(client, gameId, nextIndex, next);
        if(winners.length) {
          // Only cards completing on this exact call may share the prize.
          const overlapWinners=winners.slice(0,2);
          const settled=await settleGameForWinners(client,game,overlapWinners);
          await client.query(
            `UPDATE games SET called_numbers=$2::jsonb,current_call=$3,call_index=call_index+1,next_call_at=NULL,ended_reason='winner' WHERE id=$1`,
            [gameId,JSON.stringify(nextCalls),next]
          );
          game=(await client.query(`SELECT * FROM games WHERE id=$1`,[gameId])).rows[0];
          game._settlement={rewardPool:settled.rewardPool,share:settled.share,winners:overlapWinners};
          break;
        }

        const scheduledNext = new Date(new Date(game.next_call_at).getTime() + CALL_INTERVAL_MS);
        const nextAt = scheduledNext;
        const updated=await client.query(
          `UPDATE games SET called_numbers=$2::jsonb,current_call=$3,call_index=call_index+1,next_call_at=$4,last_activity_at=NOW() WHERE id=$1 RETURNING *`,
          [gameId,JSON.stringify(nextCalls),next,nextAt]
        );
        game=updated.rows[0];
        catchUp += 1;
        if(nextCalls.length>=75) {
          await client.query(`UPDATE games SET status='settled',settled_at=NOW(),winner_count=0,next_call_at=NULL,ended_reason='all_numbers_called' WHERE id=$1`,[gameId]);
          game=(await client.query(`SELECT * FROM games WHERE id=$1`,[gameId])).rows[0];
          break;
        }
      }

      const winnerRows=await client.query(`SELECT gw.user_id,gw.card_number,gw.reward_amount,gw.split_count,u.username,u.first_name,u.last_name FROM game_winners gw JOIN users u ON u.id=gw.user_id WHERE gw.game_id=$1 ORDER BY gw.id`,[gameId]);
      await client.query('COMMIT');
      const calls=Array.isArray(game.called_numbers)?game.called_numbers.map(Number):[];
      const winners=winnerRows.rows.map(w=>({userId:Number(w.user_id),cardNumber:Number(w.card_number),rewardAmount:Number(w.reward_amount),splitCount:Number(w.split_count),userName:w.username?`@${w.username}`:(w.first_name||w.last_name||'YEGNA Player')}));
      return json(200,{ok:true,round:{id:game.id,gameType:Number(game.game_type),stake:Number(game.stake),rewardRate:Number(game.reward_rate),status:game.status,pickStartedAt:game.pick_started_at,startedAt:game.started_at,calledNumbers:calls,currentCall:game.current_call?Number(game.current_call):null,callIndex:Number(game.call_index||0),nextCallAt:game.next_call_at,winnerCount:Number(game.winner_count||0),lastActivityAt:game.last_activity_at,endedReason:game.ended_reason},pickedCount,winners});
    }

    if (method === 'GET' && parts.at(-2) === 'games' && parts.at(-1) === 'cards') {
      const gameId = String(event.queryStringParameters?.gameId || '').trim();
      if (!gameId) return json(400,{error:'gameId is required.'});
      const r = await client.query(`SELECT card_number,user_id,(user_id=$2) AS mine FROM game_cards WHERE game_id=$1 ORDER BY card_number`, [gameId, user.id]);
      return json(200,{cards:r.rows,userId:Number(user.id)});
    }

    if (method === 'POST' && parts.at(-2) === 'games' && parts.at(-1) === 'start') {
      const gameId = String(body.gameId || '').trim();
      if (!gameId) return json(400,{error:'gameId is required.'});
      await client.query('BEGIN');
      const r = await client.query(`SELECT id,status,pick_started_at FROM games WHERE id=$1 FOR UPDATE`, [gameId]);
      if (!r.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'Game round not found.'}); }
      if (r.rows[0].status !== 'picking') { await client.query('ROLLBACK'); return json(409,{error:`Game is already ${r.rows[0].status}.`}); }
      const elapsed = Math.floor((Date.now() - new Date(r.rows[0].pick_started_at).getTime()) / 1000);
      if (elapsed < 35) { await client.query('ROLLBACK'); return json(409,{error:`Card picking is still open for ${PICK_WINDOW_SECONDS-elapsed} more seconds.`}); }
      const count = await client.query(`SELECT COUNT(*)::int count FROM game_cards WHERE game_id=$1`, [gameId]);
      if (!count.rows[0].count) {
        await client.query(`UPDATE games SET pick_started_at=NOW(),started_at=NULL,next_call_at=NULL,called_numbers='[]'::jsonb,call_index=0,current_call=NULL,winner_count=0,last_activity_at=NOW(),ended_reason='no_cards_picked' WHERE id=$1 AND status='picking'`, [gameId]);
        await client.query('COMMIT');
        return json(409,{error:'No cards were picked. A new 35-second card-picking window has started.',reset:true});
      }
      await client.query(`UPDATE games SET status='running',started_at=COALESCE(started_at,NOW()),next_call_at=COALESCE(next_call_at,NOW()),last_activity_at=NOW(),ended_reason=NULL WHERE id=$1 AND status='picking'`, [gameId]);
      await client.query('COMMIT');
      return json(200,{ok:true,gameId,status:'running',cards:count.rows[0].count});
    }

    if (method === 'POST' && parts.at(-2) === 'games' && parts.at(-1) === 'stake') {
      const gameId = String(body.gameId || '').trim(), cardNumber = Number(body.cardNumber), gameType = Number(body.gameType || 1);
      const stake = 10; // Server-controlled stake. Never trust a client-supplied amount.
      if (!gameId || ![1,2].includes(gameType) || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > 600) return json(400,{error:'Invalid card reservation request.'});
      await client.query('BEGIN');
      const g = await client.query(`SELECT * FROM games WHERE id=$1 AND game_type=$2 FOR UPDATE`, [gameId,gameType]);
      if (!g.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'Game round not found.'}); }
      if (g.rows[0].status !== 'picking') { await client.query('ROLLBACK'); return json(409,{error:'Card picking is closed.'}); }

      // Boundary-safe picker lifecycle: a reservation request arriving after
      // the 35-second window must never write into an expired window. If no
      // cards exist, start a fresh window first; if cards already exist, the
      // round launches and this late reservation is rejected.
      const elapsed = Math.floor((Date.now() - new Date(g.rows[0].pick_started_at).getTime()) / 1000);
      if (elapsed >= PICK_WINDOW_SECONDS) {
        const existing = await client.query(`SELECT COUNT(*)::int AS count FROM game_cards WHERE game_id=$1`, [gameId]);
        if (Number(existing.rows[0]?.count || 0) > 0) {
          await client.query(`UPDATE games SET status='running',started_at=COALESCE(started_at,NOW()),next_call_at=COALESCE(next_call_at,NOW()),last_activity_at=NOW(),ended_reason=NULL WHERE id=$1 AND status='picking'`, [gameId]);
          await client.query('COMMIT');
          return json(409,{error:'Game is starting now because the card-picking window has ended.',status:'running'});
        }
        await client.query(`UPDATE games SET pick_started_at=NOW(),started_at=NULL,next_call_at=NULL,called_numbers='[]'::jsonb,call_index=0,current_call=NULL,winner_count=0,last_activity_at=NOW(),ended_reason='no_cards_picked' WHERE id=$1 AND status='picking'`, [gameId]);
      }

      const referenceId = `stake-${gameId}-${cardNumber}`;
      // Idempotency: a client retry after a successful commit must not charge
      // the player a second time. The game row is already locked above.
      const prior = await client.query(
        `SELECT wt.id,wt.amount,wt.balance_after,gc.card_number
         FROM wallet_transactions wt
         LEFT JOIN game_cards gc ON gc.stake_transaction_id=wt.id
         WHERE wt.user_id=$1 AND wt.type='stake' AND wt.reference_id=$2
         LIMIT 1`,
        [user.id, referenceId]
      );
      if (prior.rows[0]) {
        if (Number(prior.rows[0].card_number) === cardNumber) {
          const current = await client.query(`SELECT balance FROM wallets WHERE user_id=$1`, [user.id]);
          await client.query('ROLLBACK');
          return json(200,{ok:true,idempotent:true,balance:Number(current.rows[0]?.balance ?? prior.rows[0].balance_after),cardNumber,stake});
        }
        await client.query('ROLLBACK');
        return json(409,{error:'Stake reference is already in use.'});
      }
      const mineCount = await client.query(`SELECT COUNT(*)::int count FROM game_cards WHERE game_id=$1 AND user_id=$2`, [gameId,user.id]);
      if (mineCount.rows[0].count >= 2) { await client.query('ROLLBACK'); return json(400,{error:'Maximum 2 Bingo cards per user.'}); }
      const w = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [user.id]);
      if (!w.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'User wallet not found.'}); }
      if (Number(w.rows[0].balance) < stake) { await client.query('ROLLBACK'); return json(400,{error:'Insufficient wallet balance. 10 ETB is required.'}); }
      const exists = await client.query(`SELECT id FROM game_cards WHERE game_id=$1 AND card_number=$2`, [gameId,cardNumber]);
      if (exists.rows.length) { await client.query('ROLLBACK'); return json(409,{error:'Card is already taken.'}); }
      const next = Number(w.rows[0].balance)-stake;
      const tx = await client.query(`INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail) VALUES($1,'stake',$2,$3,$4,$5) RETURNING id`, [user.id,-stake,next,referenceId,`Game ${gameId} · Card #${cardNumber}`]);
      try {
        await client.query(`INSERT INTO game_cards(game_id,user_id,card_number,stake_transaction_id) VALUES($1,$2,$3,$4)`, [gameId,user.id,cardNumber,tx.rows[0].id]);
      } catch (e) {
        if (e?.code === '23505') { await client.query('ROLLBACK'); return json(409,{error:'Card is already taken or reservation already exists.'}); }
        throw e;
      }
      await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`, [next,user.id]);
      await client.query('COMMIT'); return json(200,{ok:true,balance:next,cardNumber,stake});
    }

    if (method === 'POST' && parts.at(-2) === 'games' && parts.at(-1) === 'unpick') {
      const gameId = String(body.gameId || '').trim();
      const cardNumber = Number(body.cardNumber);
      if (!gameId || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > 600) return json(400,{error:'Invalid card release request.'});
      await client.query('BEGIN');
      const game = await client.query(`SELECT status,stake FROM games WHERE id=$1 FOR UPDATE`, [gameId]);
      if (!game.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'Game round not found.'}); }
      if (game.rows[0].status !== 'picking') { await client.query('ROLLBACK'); return json(409,{error:'Card cannot be released after game launch.'}); }
      const gc = await client.query(`SELECT id FROM game_cards WHERE game_id=$1 AND card_number=$2 AND user_id=$3 FOR UPDATE`, [gameId,cardNumber,user.id]);
      if (!gc.rows[0]) {
        const priorRefund = await client.query(
          `SELECT amount,balance_after FROM wallet_transactions WHERE user_id=$1 AND type='stake_refund' AND reference_id=$2 LIMIT 1`,
          [user.id, `refund-${gameId}-${cardNumber}`]
        );
        if (priorRefund.rows[0]) {
          const current = await client.query(`SELECT balance FROM wallets WHERE user_id=$1`, [user.id]);
          await client.query('ROLLBACK');
          return json(200,{ok:true,idempotent:true,balance:Number(current.rows[0]?.balance ?? priorRefund.rows[0].balance_after),cardNumber});
        }
        await client.query('ROLLBACK'); return json(404,{error:'Your card reservation was not found.'});
      }
      const stake = Number(game.rows[0].stake);
      const wal = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [user.id]);
      const next = Number(wal.rows[0].balance) + stake;
      const tx = await client.query(
        `INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail)
         VALUES($1,'stake_refund',$2,$3,$4,$5)
         ON CONFLICT(type,reference_id,user_id) DO NOTHING RETURNING id`,
        [user.id, stake, next, `refund-${gameId}-${cardNumber}`, `Card #${cardNumber} released before game launch`]
      );
      if (tx.rows.length) await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`,[next,user.id]);
      await client.query(`DELETE FROM game_cards WHERE id=$1`,[gc.rows[0].id]);
      await client.query('COMMIT');
      return json(200,{ok:true,balance:next,cardNumber});
    }

    if (method === 'POST' && parts.at(-2) === 'games' && parts.at(-1) === 'settle') {
      if (!isAdmin(user) || !(await hasPermission(client, user, 'game_manage'))) return json(403,{error:'Game management permission required.'});
      const gameId=String(body.gameId || '').trim(), winners=Array.isArray(body.winners)?body.winners:[];
      if (!gameId || winners.length < 1 || winners.length > 2) return json(400,{error:'Settlement requires 1 or 2 winners.'});
      await client.query('BEGIN');
      const gameR=await client.query(`SELECT * FROM games WHERE id=$1 FOR UPDATE`,[gameId]);
      if(!gameR.rows[0]) { await client.query('ROLLBACK'); return json(404,{error:'Game not found.'}); }
      const game=gameR.rows[0];
      if(game.status==='settled') { await client.query('ROLLBACK'); return json(409,{error:'Game already settled.'}); }
      if(game.status!=='running') { await client.query('ROLLBACK'); return json(409,{error:'Only a running game can be settled.'}); }
      const calls=Array.isArray(game.called_numbers)?game.called_numbers.map(Number):[];
      if(!calls.length) { await client.query('ROLLBACK'); return json(400,{error:'No Bingo number has been called yet.'}); }
      const normalized=winners.map(w=>({userId:Number(w.userId),cardNumber:Number(w.cardNumber)}));
      const keys=normalized.map(w=>`${w.userId}:${w.cardNumber}`);
      if(normalized.some(w=>!Number.isInteger(w.userId)||!Number.isInteger(w.cardNumber)||w.cardNumber<1||w.cardNumber>600)||new Set(keys).size!==keys.length){
        await client.query('ROLLBACK'); return json(400,{error:'Invalid or duplicate winner card.'});
      }
      const verified=[];
      for(const w of normalized){
        const cardCheck=await client.query(`SELECT 1 FROM game_cards WHERE game_id=$1 AND user_id=$2 AND card_number=$3`,[gameId,w.userId,w.cardNumber]);
        if(!cardCheck.rows[0]) { await client.query('ROLLBACK'); return json(400,{error:`Winner card #${w.cardNumber} is not registered in this game.`}); }
        const card=winningPattern(createBingoCard(w.cardNumber,Number(game.game_type)),new Set(calls));
        if(!card) { await client.query('ROLLBACK'); return json(400,{error:`Winner card #${w.cardNumber} does not satisfy a winning pattern.`}); }
        verified.push({...w,pattern:card});
      }
      const poolR=await client.query(`SELECT COUNT(*)::numeric * $2::numeric AS stake_total FROM game_cards WHERE game_id=$1`,[gameId,game.stake]);
      const rewardPool=Number((Number(poolR.rows[0].stake_total||0)*Number(game.reward_rate)/100).toFixed(2));
      const share=Number((rewardPool/verified.length).toFixed(2));
      for(const w of verified){
        const wal=await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`,[w.userId]);
        if(!wal.rows[0]) throw new Error('Winner wallet not found');
        const next=Number((Number(wal.rows[0].balance)+share).toFixed(2));
        const tx=await client.query(`INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail) VALUES($1,'win_reward',$2,$3,$4,$5) ON CONFLICT(type,reference_id,user_id) DO NOTHING RETURNING id`,[w.userId,share,next,`reward-${gameId}-${w.cardNumber}`,verified.length===2?`Win Reward · Shared Overlap · Card #${w.cardNumber}`:`Win Reward · Card #${w.cardNumber}`]);
        if(tx.rows.length) await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`,[next,w.userId]);
        await client.query(`INSERT INTO game_winners(game_id,user_id,card_number,reward_amount,split_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(game_id,card_number) DO NOTHING`,[gameId,w.userId,w.cardNumber,share,verified.length]);
      }
      await client.query(`UPDATE games SET status='settled',settled_at=NOW(),winner_count=$2,next_call_at=NULL WHERE id=$1`,[gameId,verified.length]);
      await client.query('COMMIT');
      return json(200,{ok:true,rewardPool,share,winnerCount:verified.length});
    }

    return json(404,{error:'Route not found.'});
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(JSON.stringify({ service: 'yegna-bingo-api', event: 'request_error', ts: new Date().toISOString(), method, path: event.path, error: e?.message || 'unknown error' }));
    return json(500,{error:'Internal server error.'});
  } finally {
    logEvent(event, { event: 'request_end', latencyMs: Date.now() - startedAt });
    client.release();
  }
}
