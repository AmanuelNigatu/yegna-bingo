import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.ALLOWED_ORIGIN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function telegramSecretOk(event) {
  if (!WEBHOOK_SECRET) return false;
  const supplied = String(event.headers?.['x-telegram-bot-api-secret-token'] || event.headers?.['X-Telegram-Bot-Api-Secret-Token'] || '');
  const a = Buffer.from(WEBHOOK_SECRET);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function tg(method, payload) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${response.status}`);
  return data;
}

function menuKeyboard() {
  const rows = [];
  if (MINI_APP_URL) rows.push([{ text: '🎮 Open YEGNA BINGO', web_app: { url: MINI_APP_URL } }]);
  rows.push([{ text: '💰 Deposit', callback_data: 'deposit' }, { text: '💸 Withdraw', callback_data: 'withdrawal' }]);
  rows.push([{ text: '📋 My Wallet', callback_data: 'wallet' }, { text: '❓ Help', callback_data: 'help' }]);
  return { inline_keyboard: rows };
}

async function upsertBotUser(tgUser, client) {
  const role = String(process.env.SUPER_ADMIN_TELEGRAM_ID || '') === String(tgUser.id) ? 'super_admin' : 'user';
  const r = await client.query(
    `INSERT INTO users(telegram_id,username,first_name,last_name,role)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username=EXCLUDED.username, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
       role=CASE WHEN users.role='sub_admin' THEN users.role ELSE EXCLUDED.role END,
       updated_at=NOW()
     RETURNING *`,
    [tgUser.id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, role]
  );
  await client.query(`INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [r.rows[0].id]);
  return r.rows[0];
}

async function getConversation(client, telegramId) {
  const r = await client.query(`SELECT * FROM bot_conversations WHERE telegram_id=$1`, [telegramId]);
  return r.rows[0] || null;
}

async function setConversation(client, telegramId, action, step, amount=null, detail=null) {
  await client.query(
    `INSERT INTO bot_conversations(telegram_id,action,step,amount,detail,updated_at)
     VALUES($1,$2,$3,$4,$5,NOW())
     ON CONFLICT(telegram_id) DO UPDATE SET action=EXCLUDED.action,step=EXCLUDED.step,amount=EXCLUDED.amount,detail=EXCLUDED.detail,updated_at=NOW()`,
    [telegramId, action, step, amount, detail]
  );
}

async function clearConversation(client, telegramId) {
  await client.query(`DELETE FROM bot_conversations WHERE telegram_id=$1`, [telegramId]);
}

async function sendMenu(chatId, text) {
  return tg('sendMessage', { chat_id: chatId, text, reply_markup: menuKeyboard() });
}

function money(v) {
  return Number(v).toFixed(2);
}

async function beginRequest(client, tgUser, action, chatId) {
  await upsertBotUser(tgUser, client);
  await setConversation(client, tgUser.id, action, 'amount');
  const label = action === 'deposit' ? 'deposit' : 'withdrawal';
  return tg('sendMessage', {
    chat_id: chatId,
    text: action === 'deposit'
      ? '💰 Deposit\\n\\nEnter the amount in ETB (for example: 100):'
      : '💸 Withdraw\\n\\nEnter the amount in ETB (for example: 100):',
    reply_markup: { force_reply: true }
  });
}

async function handleText(client, msg, user) {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const conv = await getConversation(client, user.id);
  if (!conv) return sendMenu(chatId, 'Choose an option below:');

  if (conv.step === 'amount') {
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
      return tg('sendMessage', { chat_id: chatId, text: 'Please enter a valid positive ETB amount.' });
    }
    await setConversation(client, user.id, conv.action, 'detail', amount, null);
    return tg('sendMessage', {
      chat_id: chatId,
      text: conv.action === 'deposit'
        ? `Deposit amount: ${money(amount)} ETB\\n\\nSend the payment/reference detail (for example transaction reference or method):`
        : `Withdrawal amount: ${money(amount)} ETB\\n\\nSend the destination/method detail (for example Telebirr or bank account detail):`,
      reply_markup: { force_reply: true }
    });
  }

  if (conv.step === 'detail') {
    if (text.length < 2 || text.length > 500) {
      return tg('sendMessage', { chat_id: chatId, text: 'Please enter a valid detail (2–500 characters).' });
    }
    await setConversation(client, user.id, conv.action, 'confirm', conv.amount, text);
    return tg('sendMessage', {
      chat_id: chatId,
      text: `${conv.action === 'deposit' ? '💰 Deposit' : '💸 Withdrawal'}\\nAmount: ${money(conv.amount)} ETB\\nDetail: ${text}\\n\\nConfirm this request?`,
      reply_markup: { inline_keyboard: [[
        { text: '✅ Confirm', callback_data: 'confirm_request' },
        { text: '❌ Cancel', callback_data: 'cancel_request' }
      ]] }
    });
  }

  return sendMenu(chatId, 'Use the confirmation buttons above.');
}

async function createWalletRequest(client, user, conv) {
  const referenceId = `tg-${conv.action}-${user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  await client.query('BEGIN');
  try {
    const u = await upsertBotUser(user, client);
    if (conv.action === 'withdrawal') {
      const w = await client.query(`SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [u.id]);
      if (!w.rows[0] || Number(w.rows[0].balance) < Number(conv.amount)) {
        await client.query('ROLLBACK');
        return { ok:false, error:'Insufficient wallet balance for this withdrawal.' };
      }
      const next = Number(w.rows[0].balance) - Number(conv.amount);
      await client.query(
        `INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail)
         VALUES($1,'withdrawal_hold',$2,$3,$4,$5)`,
        [u.id, -Number(conv.amount), next, `request-${referenceId}`, `Withdrawal hold · Bot request ${referenceId}`]
      );
      await client.query(`UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2`, [next, u.id]);
    }
    const r = await client.query(
      `INSERT INTO wallet_requests(user_id,type,amount,reference_id,method,detail)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,reference_id,status,amount,type,requested_at`,
      [u.id, conv.action, Number(conv.amount), referenceId, conv.detail?.slice(0,100) || null, `Telegram Bot · ${conv.detail || ''}`.slice(0,500)]
    );
    await client.query(`DELETE FROM bot_conversations WHERE telegram_id=$1`, [user.id]);
    await client.query('COMMIT');
    return { ok:true, request:r.rows[0] };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  }
}

async function handleCallback(client, query) {
  const user = query.from;
  const chatId = query.message?.chat?.id;
  const data = String(query.data || '');
  await tg('answerCallbackQuery', { callback_query_id: query.id });

  if (data === 'deposit' || data === 'withdrawal') {
    await beginRequest(client, user, data, chatId);
    return;
  }
  if (data === 'cancel_request') {
    await clearConversation(client, user.id);
    return sendMenu(chatId, '❌ Request cancelled.');
  }
  if (data === 'confirm_request') {
    const conv = await getConversation(client, user.id);
    if (!conv || conv.step !== 'confirm') return sendMenu(chatId, 'This request has expired. Please start again.');
    const result = await createWalletRequest(client, user, conv);
    if (!result.ok) return sendMenu(chatId, `❌ ${result.error}`);
    return sendMenu(chatId, `✅ ${conv.action === 'deposit' ? 'Deposit' : 'Withdrawal'} request submitted.\\nReference: ${result.request.reference_id}\\nStatus: Pending`);
  }
  if (data === 'wallet') {
    const u = await upsertBotUser(user, client);
    const w = await client.query(`SELECT balance FROM wallets WHERE user_id=$1`, [u.id]);
    return sendMenu(chatId, `💰 Current wallet balance: ${money(w.rows[0]?.balance || 0)} ETB`);
  }
  if (data === 'help') {
    return sendMenu(chatId, 'YEGNA BINGO Help\\n\\n🎮 Open the Mini App to play.\\n💰 Deposit sends a request to Admin for approval.\\n💸 Withdraw reserves the amount and sends a request to Admin.\\n📋 Wallet shows your current balance.\\n\\nAdmin approval/rejection is handled in the Mini App.');
  }
}

export async function handler(event) {
  // GET is intentionally a safe health/diagnostic response. Telegram itself
  // still delivers webhook updates with POST. This prevents the common
  // confusion where opening the webhook URL in a browser appears broken.
  if (event.httpMethod === 'GET') {
    return json(200, {
      ok: true,
      service: 'yegna-bingo-telegram-bot',
      webhookMethod: 'POST',
      configured: {
        botToken: Boolean(BOT_TOKEN),
        database: Boolean(process.env.DATABASE_URL),
        webhookSecret: Boolean(WEBHOOK_SECRET),
        miniAppUrl: Boolean(MINI_APP_URL)
      }
    });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!BOT_TOKEN || !process.env.DATABASE_URL || !WEBHOOK_SECRET) return json(503, { error: 'Bot backend is not configured.' });
  if (!telegramSecretOk(event)) return json(401, { error: 'Invalid Telegram webhook secret.' });

  let update;
  try { update = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }

  const client = await pool.connect();
  try {
    if (update.callback_query) await handleCallback(client, update.callback_query);
    else if (update.message?.from) {
      const user = await upsertBotUser(update.message.from, client);
      if (update.message.text === '/start') {
        await clearConversation(client, user.telegram_id);
        await sendMenu(update.message.chat.id, `👋 Welcome to YEGNA BINGO, ${user.first_name || 'Player'}!\\n\\nYour Telegram account is securely linked to your wallet identity.`);
      } else if (update.message.text === '/deposit') await beginRequest(client, user, 'deposit', update.message.chat.id);
      else if (update.message.text === '/withdraw') await beginRequest(client, user, 'withdrawal', update.message.chat.id);
      else await handleText(client, update.message, user);
    }
    return json(200, { ok:true });
  } catch (e) {
    console.error('Telegram bot error', e);
    return json(200, { ok:false });
  } finally {
    client.release();
  }
}
