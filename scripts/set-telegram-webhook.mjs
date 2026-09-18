const backendUrl = String(process.env.BACKEND_URL || '').trim().replace(/\/$/, '');
const miniAppUrl = String(process.env.MINI_APP_URL || '').trim().replace(/\/$/, '');
const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
if (!backendUrl || !miniAppUrl || !token || !secret) throw new Error('BACKEND_URL, MINI_APP_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required.');
const healthUrl = `${backendUrl}/health`;
const webhookUrl = `${backendUrl}/api/bot`;
for (let attempt = 1; attempt <= 60; attempt++) {
  try { const health = await fetch(healthUrl); if (health.ok) break; } catch {}
  if (attempt === 60) throw new Error(`Backend did not become reachable: ${healthUrl}`);
  await new Promise(r => setTimeout(r, 5000));
}
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${response.status}`);
console.log(`Telegram webhook configured: ${webhookUrl}`);
console.log(`Mini App URL: ${miniAppUrl}`);
