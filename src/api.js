const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export function isBackendConfigured() {
  return Boolean(import.meta.env.VITE_API_BASE_URL || window.location.hostname !== "localhost");
}

let sessionPromise = null;

async function ensureTelegramSession() {
  if (sessionPromise) return sessionPromise;
  const initData = window.Telegram?.WebApp?.initData || "";
  sessionPromise = (async () => {
    const headers = new Headers({ "Content-Type": "application/json", "X-Telegram-Init-Data": initData });
    if (!initData) throw new Error("Open YEGNA BINGO from Telegram to authenticate.");
    const response = await fetch(`${API_BASE}/auth/session`, { method: "POST", headers, credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status})`);
    return data;
  })().catch(error => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export async function apiFetch(path, options = {}) {
  await ensureTelegramSession();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const walletApi = {
  getWallet: () => apiFetch("/wallet"),
  getAdminStats: () => apiFetch("/admin/stats"),
  getAdminUsers: (q = "") => apiFetch(`/admin/users?q=${encodeURIComponent(q)}`),
  getAdminUserWallet: (userId) => apiFetch(`/admin/user-wallet?userId=${encodeURIComponent(userId)}`),
  getAdminSettings: () => apiFetch("/admin/settings"),
  setRewardRate: (rate) => apiFetch("/admin/reward-rate", { method: "PUT", body: JSON.stringify({ rate }) }),
  adjustUser: (userId, amount, type, detail) => apiFetch("/admin/users/adjust", { method: "POST", body: JSON.stringify({ userId, amount, type, detail }) }),
  getWalletRequests: (status = "pending", type = "") => apiFetch(`/admin/wallet-requests?status=${encodeURIComponent(status)}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
  approveWalletRequest: (requestId) => apiFetch("/admin/wallet-requests-approve", { method: "POST", body: JSON.stringify({ requestId }) }),
  rejectWalletRequest: (requestId, reason) => apiFetch("/admin/wallet-requests-reject", { method: "POST", body: JSON.stringify({ requestId, reason }) }),
  releaseCard: (gameId, cardNumber) => apiFetch("/games/unpick", { method: "POST", body: JSON.stringify({ gameId, cardNumber }) }),
  startGame: (gameId) => apiFetch("/games/start", { method: "POST", body: JSON.stringify({ gameId }) }),
  getGameCards: (gameId) => apiFetch(`/games/cards?gameId=${encodeURIComponent(gameId)}`),
  getGameState: (gameId) => apiFetch(`/games/state?gameId=${encodeURIComponent(gameId)}`),
  getActiveRound: (gameType) => apiFetch(`/games/round?gameType=${encodeURIComponent(gameType)}`),
  getMe: () => apiFetch("/me"),
  reserveStake: (gameId, cardNumber, stake = 10, gameType = 1) => apiFetch("/games/stake", { method: "POST", body: JSON.stringify({ gameId, cardNumber, stake, gameType }) }),
  settleGame: (gameId, winners) => apiFetch("/games/settle", { method: "POST", body: JSON.stringify({ gameId, winners }) }),
  getAdminAccess: () => apiFetch("/admin/access"),
  getSubAdmins: () => apiFetch("/admin/sub-admins"),
  addSubAdmin: (payload) => apiFetch("/admin/sub-admins", { method: "POST", body: JSON.stringify(payload) }),
  updateSubAdminPermissions: (userId, permissions) => apiFetch(`/admin/sub-admins/${userId}`, { method: "PUT", body: JSON.stringify({ permissions }) }),
  removeSubAdmin: (userId) => apiFetch(`/admin/sub-admins/${userId}`, { method: "DELETE" }),
};
