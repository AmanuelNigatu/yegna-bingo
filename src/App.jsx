import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, History, WalletCards, UserRound, Eye, EyeOff, Play, Crown, Sparkles, LockKeyhole, Unlock, ArrowLeft, Check, RotateCcw, Volume2, VolumeX, RefreshCw, Radio, Trophy, CircleDot, Zap } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { walletApi, isBackendConfigured } from "./api.js";

const GAMES = [
  { id: 1, amount: 10, label: "10 No.1", tone: "green" },
  { id: 2, amount: 10, label: "10 No.2", tone: "orange" }
];
const PICKER_NAV_ITEMS = [
  { key: "game", label: "Game", icon: Gamepad2, path: "/" },
  { key: "wallet", label: "Wallet", icon: WalletCards, path: "/wallet" },
  { key: "profile", label: "Profile", icon: UserRound, path: "/profile" }
];
const TOTAL_CARDS = 600;
const MAX_PICKED = 2;

function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function shuffle(values, random) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createCard(cardNo, gameId) {
  const random = seededRandom(cardNo * 7919 + gameId * 104729);
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  const columns = ranges.map(([min, max]) => {
    const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return shuffle(nums, random).slice(0, 5);
  });
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => (row === 2 && col === 2 ? "FREE" : columns[col][row]))
  );
}

const CARD_CACHE = new Map();
function getCards(gameId) {
  if (!CARD_CACHE.has(gameId)) {
    CARD_CACHE.set(gameId, Array.from({ length: TOTAL_CARDS }, (_, i) => ({ number: i + 1, grid: createCard(i + 1, gameId) })));
  }
  return CARD_CACHE.get(gameId);
}

function getStoredState() {
  try { return JSON.parse(localStorage.getItem("yegna-bingo-state") || "{}") || {}; } catch { return {}; }
}

function saveStoredState(state) {
  localStorage.setItem("yegna-bingo-state", JSON.stringify(state));
}

function getGameUniqueId(gameId) {
  const key = `yegna-bingo-game-id-${gameId}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(9);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, n => chars[n % chars.length]).join("");
    const id = `YGB-${code}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `YGB-${gameId}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  }
}

function getPlayerKey() {
  try {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser?.id) return `tg-${tgUser.id}`;
  } catch {}
  const key = "yegna-bingo-player-key";
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = `local-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch { return "local-player"; }
}

function savePlayerDisplayName(playerKey, displayName) {
  try { localStorage.setItem(`yegna-bingo-player-name-${playerKey}`, displayName || "YEGNA Player"); } catch {}
}

function readPlayerDisplayNameForKey(playerKey) {
  try { return localStorage.getItem(`yegna-bingo-player-name-${playerKey}`) || "YEGNA Player"; } catch { return "YEGNA Player"; }
}

function readPickedRegistry(gameId) {
  try {
    const data = JSON.parse(localStorage.getItem(`yegna-bingo-picked-${gameId}`) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}

function writePickedRegistry(gameId, registry, roundId = null) {
  try {
    const key = roundId ? `yegna-bingo-picked-${gameId}-${roundId}` : `yegna-bingo-picked-${gameId}`;
    localStorage.setItem(key, JSON.stringify(registry));
  } catch {}
}

function getRoundKey(gameId) {
  return `yegna-bingo-round-${gameId}`;
}

function createRound(gameId) {
  const id = `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return { id, gameId, status: "picking", pickStartedAt: Date.now(), completedAt: null };
}

function readRound(gameId) {
  try {
    const round = JSON.parse(localStorage.getItem(getRoundKey(gameId)) || "null");
    return round && round.id ? round : null;
  } catch { return null; }
}

function getOrCreateRound(gameId) {
  const saved = readRound(gameId);
  if (saved && saved.status !== "complete") return saved;
  const next = createRound(gameId);
  writeRound(gameId, next);
  return next;
}

function writeRound(gameId, round) {
  try { localStorage.setItem(getRoundKey(gameId), JSON.stringify(round)); } catch {}
}

function readPickedRegistryForRound(gameId, roundId) {
  try {
    const data = JSON.parse(localStorage.getItem(`yegna-bingo-picked-${gameId}-${roundId}`) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}

function writePickedRegistryForRound(gameId, roundId, registry) {
  try { localStorage.setItem(`yegna-bingo-picked-${gameId}-${roundId}`, JSON.stringify(registry)); } catch {}
}

function readWinnerList(gameId, roundId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`yegna-bingo-winner-${gameId}-${roundId}`) || "null");
    if (Array.isArray(saved?.winners)) return saved.winners.slice(0, 2);
    return saved?.cardNumber ? [saved] : [];
  } catch { return []; }
}


const WALLET_KEY = "yegna-bingo-wallet-demo";
const REWARD_KEY = "yegna-bingo-reward-rate";
function readWalletStore() {
  try { const v = JSON.parse(localStorage.getItem(WALLET_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function writeWalletStore(v) { try { localStorage.setItem(WALLET_KEY, JSON.stringify(v)); } catch {} }
function readRewardRate() {
  try { const n = Number(localStorage.getItem(REWARD_KEY)); return Number.isFinite(n) ? n : 85; } catch { return 85; }
}
function getWalletUserKey() { return getPlayerKey(); }
function getWalletUser() {
  const key = getWalletUserKey();
  const store = readWalletStore();
  if (!store[key]) {
    store[key] = { userKey:key, username:getPlayerDisplayName(), balance:0, transactions:[] };
    writeWalletStore(store);
  }
  return store[key];
}
function recordWalletTransaction(userKey, type, amount, detail, meta = {}) {
  const store = readWalletStore();
  const user = store[userKey] || { userKey, username:readPlayerDisplayNameForKey(userKey), balance:0, transactions:[] };
  const nextBalance = Number(user.balance || 0) + Number(amount || 0);
  user.balance = Number(nextBalance.toFixed(2));
  user.transactions = [{ id:`TX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, type, amount:Number(amount || 0), detail, balance:user.balance, createdAt:Date.now(), ...meta }, ...(user.transactions || [])];
  store[userKey] = user; writeWalletStore(store); return user;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showBalance, setShowBalance] = useState(false);
  const [serverWallet, setServerWallet] = useState(null);
  const balance = Number(serverWallet?.wallet?.balance ?? getWalletUser().balance ?? 0);
  const [session, setSession] = useState(() => getStoredState());

  useEffect(() => {
    let alive = true;
    if (isBackendConfigured()) {
      walletApi.getWallet().then(data => {
        if (!alive) return;
        setServerWallet(data);
        try {
          const key = getWalletUserKey();
          const store = readWalletStore();
          const old = store[key] || {};
          store[key] = { ...old, userKey:key, username:data.wallet?.username || old.username || getPlayerDisplayName(), balance:Number(data.wallet?.balance || 0), transactions:(data.transactions || []).map(t => ({...t, createdAt:t.created_at, balance:t.balance_after})) };
          writeWalletStore(store);
        } catch {}
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [location.pathname]); // refresh when returning to Home/other pages

  useEffect(() => saveStoredState(session), [session]);

  const navItems = [
    { key: "game", label: "Game", icon: Gamepad2, path: "/" },
      { key: "wallet", label: "Wallet", icon: WalletCards, path: "/wallet" },
    { key: "profile", label: "Profile", icon: UserRound, path: "/profile" }
  ];

  const activeKey = location.pathname === "/history" ? "history" : location.pathname === "/wallet" ? "wallet" : location.pathname === "/profile" ? "profile" : location.pathname.startsWith("/game") ? "game" : "game";
  const params = new URLSearchParams(location.search);
  const gameId = Number(params.get("stake"));
  const goHome = useCallback(() => navigate("/"), [navigate]);
  const goToBingo = useCallback((id) => navigate(`/bingo?stake=${id}`), [navigate]);

  if (location.pathname === "/game" && [1, 2].includes(gameId)) {
    return <CardPicker gameId={gameId} session={session} setSession={setSession} onBack={goHome} onWatch={() => goToBingo(gameId)} onNavigate={navigate} />;
  }

  if (location.pathname === "/bingo" && [1, 2].includes(gameId)) {
    return <BingoGame gameId={gameId} session={session} setSession={setSession} onBack={goHome} onNavigate={navigate} navItems={navItems} />;
  }

  if (location.pathname === "/wallet") return <WalletPage onNavigate={navigate} />;
  if (location.pathname === "/history") return <HistoryPage onNavigate={navigate} />;
  if (location.pathname === "/admin/wallet") return <AdminWalletPage onNavigate={navigate} />;

  if (activeKey === "profile") {
    return (
      <div className="app-shell framed-page">
        <div className="page-frame" aria-hidden="true" />
        <div className="wallet-page profile-page">
          <img className="small-logo" src="/assets/yegna-logo.png" alt="YEGNA BINGO" />
          <div className="wallet-panel"><UserRound size={28}/><h1>Profile</h1><p>{getPlayerDisplayName()}</p><button className="wallet-action" onClick={() => navigate("/admin/wallet")}>Admin Wallet</button></div>
        </div>
        <BottomNav items={navItems} activeKey="profile" onNavigate={navigate} />
      </div>
    );
  }

  return (
    <div className="app-shell framed-page">
      <div className="page-frame" aria-hidden="true" />
      <div className="spark spark-a" /><div className="spark spark-b" /><div className="spark spark-c" />
      <div className="decor-ball decor-66">66</div>
      <div className="decor-ball decor-23">23</div>
      <div className="decor-ball decor-42">42</div>

      <main className="home">
        <section className="hero">
          <div className="hero-topline"><Crown size={20} fill="currentColor" /> <span>PREMIUM BINGO</span> <Crown size={20} fill="currentColor" /></div>
          <img className="logo" src="/assets/yegna-logo.png" alt="YEGNA BINGO logo" />
          <div className="welcome"><span>Welcome to</span><strong>YEGNA BINGO</strong></div>
          <div className="tagline"><span>PLAY</span><i /> <span>MARK</span><i /> <span>WIN</span></div>
          <div className="hero-sheen" />
        </section>

        <section className="balance-wrap">
          <div className="balance-caption"><Sparkles size={14} /> YOUR BALANCE <Sparkles size={14} /></div>
          <div className="balance-pill">
            <div className="wallet-icon"><WalletCards size={22} /></div>
            <span className="balance-value">{showBalance ? `${balance.toFixed(2)} ETB` : "••••••"}</span>
            <button className="icon-btn" aria-label={showBalance ? "Hide balance" : "Show balance"} onClick={() => setShowBalance(v => !v)}>{showBalance ? <EyeOff size={21} /> : <Eye size={21} />}</button>
          </div>
        </section>

        <section className="stake-card">
          <div className="section-title"><span /> <h2>Choose Your Stake</h2> <span /></div>
          <p className="section-subtitle">Choose one Bingo game · up to 2 cards per user</p>
          <div className="stake-list">
            {GAMES.map((game) => (
              <button key={game.id} className={`stake-row ${game.tone}`} onClick={() => navigate(`/game?stake=${game.id}`)}>
                <span className="play-chip"><Play size={17} fill="currentColor" /> PLAY</span>
                <span className="stake-main"><small>BINGO</small><b>{game.label}</b></span>
                <span className="stake-arrow">›</span>
              </button>
            ))}
          </div>
        </section>
      </main>
      <BottomNav items={navItems} activeKey={activeKey} onNavigate={navigate} />
    </div>
  );
}

function CardPicker({ gameId, session, setSession, onBack, onWatch, onNavigate }) {
  const game = GAMES.find(g => g.id === gameId);
  const cards = useMemo(() => getCards(gameId), [gameId]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busyCard, setBusyCard] = useState(null);
  const [serverTakenCards, setServerTakenCards] = useState(new Set());
  const [serverPickedCount, setServerPickedCount] = useState(0);
  const [serverRoundReady, setServerRoundReady] = useState(!isBackendConfigured());
  const [serverNow, setServerNow] = useState(Date.now());
  const [serverSecondsLeft, setServerSecondsLeft] = useState(null);
  const serverSecondsRef = useRef(null);
  const serverNowRef = useRef(Date.now());
  const serverSecondsSyncAtRef = useRef(Date.now());
  const onWatchRef = useRef(onWatch);
  useEffect(() => { onWatchRef.current = onWatch; }, [onWatch]);
  const [round, setRound] = useState(() => {
    return getOrCreateRound(gameId);
  });
  useEffect(() => {
    if (!isBackendConfigured()) return;
    let alive = true;
    const sync = async () => {
      try {
        const result = await walletApi.getActiveRound(gameId);
        if (!alive || !result.round) return;
        const r = result.round;
        const next = {
          id: r.id,
          gameId,
          status: r.status === "running" ? "live" : r.status === "settled" ? "complete" : "picking",
          pickStartedAt: new Date(r.pick_started_at || r.created_at).getTime(),
          completedAt: r.settled_at ? new Date(r.settled_at).getTime() : null
        };
        setServerPickedCount(Number(result.pickedCount || 0));
        const nextSeconds = Number.isFinite(Number(result.secondsLeft)) ? Number(result.secondsLeft) : null;
        const nextServerNow = Number.isFinite(Number(result.serverNow)) ? Number(result.serverNow) : (Date.parse(result.serverNow || "") || Date.now());
        serverSecondsRef.current = nextSeconds;
        serverNowRef.current = nextServerNow;
        serverSecondsSyncAtRef.current = Date.now();
        setServerSecondsLeft(nextSeconds);
        setServerNow(nextServerNow);
        setServerRoundReady(true);
        setRound(prev => {
          if (prev.id === next.id && prev.status === next.status && prev.pickStartedAt === next.pickStartedAt) return prev;
          return next;
        });
        writeRound(gameId, next);
        if (next.status === "live") onWatchRef.current?.();
      } catch (e) {
        if (alive) {
          setServerRoundReady(false);
          setNotice(e.message || "Secure game server is not available.");
        }
      }
    };
    sync();
    const timer = setInterval(sync, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [gameId]);

  const [secondsLeft, setSecondsLeft] = useState(() => {
    const saved = readRound(gameId);
    if (!saved || saved.status === "complete") return 35;
    return Math.max(0, 35 - Math.floor((Date.now() - saved.pickStartedAt) / 1000));
  });
  const roundId = round.id;
  const myCards = session.picked?.[gameId] || [];
  const playerKey = getPlayerKey();
  const selectedRoom = session.roomId && session.roomId !== gameId ? session.roomId : null;
  const [myServerCards, setMyServerCards] = useState(new Set());
  const effectiveMyCards = isBackendConfigured() ? Array.from(myServerCards) : myCards;
  const effectiveMySet = useMemo(() => new Set(effectiveMyCards.map(Number)), [effectiveMyCards.join(',')]);
  const occupiedByOthers = useMemo(() => {
    const taken = new Set(serverTakenCards);
    effectiveMySet.forEach(n => taken.delete(Number(n)));
    if (isBackendConfigured()) return taken;
    const registry = readPickedRegistryForRound(gameId, roundId);
    return new Set(Object.entries(registry).filter(([, owner]) => owner !== playerKey).map(([n]) => Number(n)));
  }, [gameId, roundId, playerKey, effectiveMyCards.join(','), serverTakenCards]);

  const visibleCards = useMemo(() => {
    const q = query.trim();
    if (!q) return cards;
    const n = Number(q.replace(/^#/, ""));
    if (!Number.isFinite(n) || n < 1 || n > TOTAL_CARDS) return [];
    return cards.filter(c => c.number === n);
  }, [cards, query]);

  // GLOBAL picker clock: keep ONE stable interval. The previous implementation
  // depended on onWatch/server countdown state, which are recreated on renders;
  // that repeatedly reset the local clock and could leave the UI stuck at 35s.
  // The server remains authoritative; refs let the display tick smoothly between
  // 1-second server synchronizations without restarting the timer.
  useEffect(() => {
    if (isBackendConfigured() && !serverRoundReady) return;
    if (round.status === "complete") return;
    if (round.status === "live") { onWatchRef.current?.(); return; }

    const localAtSync = Date.now();
    const serverAtSync = Number.isFinite(Number(serverNowRef.current)) && Number(serverNowRef.current) > 0
      ? Number(serverNowRef.current)
      : localAtSync;
    const startedAt = Number(round.pickStartedAt || serverAtSync);

    const tick = () => {
      const latestServerSeconds = Number(serverSecondsRef.current);
      if (Number.isFinite(latestServerSeconds)) {
        // Use the timestamp of the most recent server countdown sample, not
        // the timestamp when this React effect was created.
        const elapsedSinceServerSync = Math.floor((Date.now() - serverSecondsSyncAtRef.current) / 1000);
        setSecondsLeft(Math.max(0, latestServerSeconds - elapsedSinceServerSync));
        return;
      }
      const authoritativeNow = serverAtSync + (Date.now() - localAtSync);
      setSecondsLeft(Math.max(0, 35 - Math.floor((authoritativeNow - startedAt) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [round.status, round.pickStartedAt, serverRoundReady]);

  useEffect(() => {
    if (isBackendConfigured()) return;
    const onStorage = (event) => {
      if (event.key === getRoundKey(gameId)) {
        const next = readRound(gameId);
        if (next) setRound(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [gameId]);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    let alive = true;
    const load = async () => {
      try {
        const result = await walletApi.getGameCards(roundId);
        if (alive) {
          setServerTakenCards(new Set((result.cards || []).map(c => Number(c.card_number))));
          setServerPickedCount((result.cards || []).length);
        }
      } catch {}
    };
    load();
    const timer = setInterval(load, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [roundId]);

  // Backend is authoritative in production. Do not clear valid server picks
  // because the old localStorage registry is empty/stale (this used to make
  // a successful pick disappear immediately).
  useEffect(() => {
    if (!isBackendConfigured()) return;
    let alive = true;
    const syncMine = async () => {
      try {
        const result = await walletApi.getGameCards(roundId);
        if (!alive) return;
        const mine = (result.cards || [])
          .filter(c => c.mine === true || Number(c.user_id) === Number(result.userId))
          .map(c => Number(c.card_number))
          .filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL_CARDS)
          .slice(0, MAX_PICKED);
        setMyServerCards(new Set(mine));
        setSession(s => ({
          ...s,
          roomId: mine.length ? gameId : (s.roomId === gameId ? null : s.roomId),
          picked: { ...(s.picked || {}), [gameId]: mine }
        }));
      } catch {}
    };
    syncMine();
    const timer = setInterval(syncMine, 1200);
    return () => { alive = false; clearInterval(timer); };
  }, [gameId, roundId]);

  async function pickCard(cardNumber) {
    setNotice("");
    if (busyCard || round.status !== "picking") return;
    if (selectedRoom) {
      setNotice(`You already joined ${GAMES.find(g => g.id === session.roomId)?.label}. Finish that game before joining another.`);
      return;
    }
    if (isBackendConfigured() && !serverRoundReady) {
      setNotice("Connecting to the secure game server…");
      return;
    }
    const latestRound = isBackendConfigured() ? round : (readRound(gameId) || round);
    if (latestRound.status !== "picking") {
      onWatch();
      return;
    }
    if (occupiedByOthers.has(cardNumber)) {
      setNotice(`Card #${cardNumber} is already held by another user.`);
      return;
    }
    const selected = effectiveMySet.has(cardNumber);
    if (selected) {
      setBusyCard(cardNumber);
      try {
        if (isBackendConfigured()) {
          await walletApi.releaseCard(roundId, cardNumber);
        }
        const next = effectiveMyCards.filter(n => Number(n) !== cardNumber);
        const registry = readPickedRegistryForRound(gameId, roundId);
        if (registry[String(cardNumber)] === playerKey) delete registry[String(cardNumber)];
        writePickedRegistryForRound(gameId, roundId, registry);
        setServerTakenCards(prev => { const n = new Set(prev); n.delete(cardNumber); return n; });
        setMyServerCards(prev => { const n = new Set(prev); n.delete(cardNumber); return n; });
        setSession(s => ({ ...s, roomId: next.length ? gameId : null, picked: { ...(s.picked || {}), [gameId]: next } }));
        setNotice(`Card #${cardNumber} released. 10 ETB stake refunded.`);
      } catch (e) {
        setNotice(e.message || "Card could not be released.");
      } finally {
        setBusyCard(null);
      }
      return;
    }
    if (effectiveMyCards.length >= MAX_PICKED) {
      setNotice("Maximum 2 Bingo cards. Release one card before choosing another.");
      return;
    }
    setBusyCard(cardNumber);
    try {
      const current = readRound(gameId) || round;
      if (current.status !== "picking") { onWatch(); return; }
      if (isBackendConfigured()) {
        await walletApi.reserveStake(roundId, cardNumber, game.amount, gameId);
      }
      // The API call is the reservation. Never require a local registry to
      // confirm success; that registry is only a legacy offline fallback.
      savePlayerDisplayName(playerKey, getPlayerDisplayName());
      setServerTakenCards(prev => new Set([...prev, cardNumber]));
      setMyServerCards(prev => new Set([...prev, cardNumber]));
      setSession(s => ({
        ...s,
        roomId: gameId,
        picked: { ...(s.picked || {}), [gameId]: Array.from(new Set([...(s.picked?.[gameId] || []), cardNumber])).slice(0, MAX_PICKED) }
      }));
      if (!isBackendConfigured()) {
        const registry = readPickedRegistryForRound(gameId, roundId);
        registry[String(cardNumber)] = playerKey;
        writePickedRegistryForRound(gameId, roundId, registry);
      }
      setNotice(`Card #${cardNumber} reserved. ${game.amount} ETB stake deducted.`);
    } catch (e) {
      setNotice(e.message || "Card selection failed.");
    } finally {
      setBusyCard(null);
    }
  }

  async function resetMyCards() {
    setNotice("");
    if (isBackendConfigured()) {
      try {
        for (const cardNumber of effectiveMyCards) await walletApi.releaseCard(roundId, cardNumber);
      } catch (e) {
        setNotice(e.message || "One or more cards could not be released.");
        return;
      }
    }
    const registry = readPickedRegistryForRound(gameId, roundId);
    for (const cardNumber of effectiveMyCards) {
      if (registry[String(cardNumber)] === playerKey) delete registry[String(cardNumber)];
    }
    writePickedRegistryForRound(gameId, roundId, registry);
    setServerTakenCards(prev => {
      const next = new Set(prev);
      effectiveMyCards.forEach(n => next.delete(Number(n)));
      return next;
    });
    setMyServerCards(new Set());
    setSession(s => ({ ...s, roomId: null, picked: { ...(s.picked || {}), [gameId]: [] } }));
    setNotice(`Your selected cards were released and ${effectiveMyCards.length * game.amount} ETB refunded.`);
  }

  return (
    <div className="app-shell framed-page picker-page">
      <div className="page-frame" aria-hidden="true" />
      <header className="picker-header">
        <button className="header-back" onClick={onBack}><ArrowLeft size={21} /></button>
        <div><img src="/assets/yegna-logo.png" alt="YEGNA BINGO" /><span>{game.label} · BINGO</span></div>
        <div className="header-crown"><Crown size={24} fill="currentColor" /></div>
      </header>

      <main className="picker-main">
        <section className={`picker-hero ${game.tone}`}>
          <div><span className="picker-kicker">BINGO CARD PICK</span><h1>{game.label}</h1><p>600 cards available · choose up to 2</p></div>
          <div className="picked-counter"><strong>{secondsLeft}s</strong><span>PICKING TIME</span><small>{effectiveMyCards.length}/2 CARDS</small></div>
        </section>

        {selectedRoom && <div className="room-warning"><LockKeyhole size={17} /> You are already playing another Bingo game.</div>}
        {notice && <div className="picker-notice">{notice}</div>}

        <section className="picker-controls">
          <div className="search-box"><span>#</span><input inputMode="numeric" value={query} onChange={e => setQuery(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Find card number 1–600" /></div>
          <button className="release-btn" onClick={resetMyCards} disabled={!effectiveMyCards.length}><RotateCcw size={16} /> Release</button>
        </section>

        <button className="watch-game-btn" onClick={() => {
          if (round.status === "picking" && effectiveMyCards.length < 1) {
            setNotice("Please pick at least 1 Bingo card before starting the game.");
            return;
          }
          onWatch();
        }} disabled={round.status === "picking" && (secondsLeft > 0 || effectiveMyCards.length < 1)}><Radio size={17} /> {round.status === "picking" ? (effectiveMyCards.length < 1 ? "PICK 1 CARD TO START" : `GAME STARTS IN ${secondsLeft}s`) : "CONTINUE TO GAME"}<span>›</span></button>

        <div className="legend"><span><i className="legend-free" /> Available</span><span><i className="legend-mine" /> Yours</span><span><LockKeyhole size={14} /> Taken</span></div>

        <section className="card-grid">
          {visibleCards.map(card => {
            const mine = effectiveMySet.has(card.number);
            const locked = occupiedByOthers.has(card.number);
            return <BingoCard key={card.number} card={card} mine={mine} locked={locked} busy={busyCard === card.number} onClick={() => pickCard(card.number)} />;
          })}
          {!visibleCards.length && <div className="no-results">No card found. Try a number from 1 to 600.</div>}
        </section>


        <button className="back-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">↑<span>Top</span></button>
      </main>
      <BottomNav items={PICKER_NAV_ITEMS} activeKey="game" onNavigate={onNavigate} />
    </div>
  );
}

function getPlayerDisplayName() {
  try {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser) {
      if (tgUser.username) return `@${tgUser.username}`;
      const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
      if (fullName) return fullName;
    }
  } catch {}
  return "YEGNA Player";
}

// Bingo wins on a complete horizontal row, vertical column, diagonal,
// or (as an additional winning pattern) all four corner numbers. FREE counts
// as already marked. Keep the returned `cells` array compatible with the
// existing winner-card highlighting flow.
function getWinningPattern(grid, calledSet) {
  const isMarked = value => value === "FREE" || calledSet.has(value);
  const patterns = [];
  for (let r = 0; r < 5; r++) patterns.push({ type: "horizontal", label: "HORIZONTAL", cells: Array.from({ length: 5 }, (_, c) => [r, c]) });
  for (let c = 0; c < 5; c++) patterns.push({ type: "vertical", label: "VERTICAL", cells: Array.from({ length: 5 }, (_, r) => [r, c]) });
  patterns.push({ type: "diagonal", label: "DIAGONAL", cells: Array.from({ length: 5 }, (_, i) => [i, i]) });
  patterns.push({ type: "diagonal", label: "DIAGONAL", cells: Array.from({ length: 5 }, (_, i) => [i, 4 - i]) });
  patterns.push({ type: "corners", label: "FOUR CORNERS", cells: [[0, 0], [0, 4], [4, 0], [4, 4]] });
  return patterns.find(pattern => pattern.cells.every(([r, c]) => isMarked(grid[r][c]))) || null;
}

function getWinningLine(grid, calledSet) {
  return getWinningPattern(grid, calledSet)?.cells || null;
}


// Amharic caller audio is provided as local MP3 assets.
// Filenames intentionally keep the `k` prefix: kstart, kend, kb1...ko75.
function callerAudioName(n) {
  const prefix = n <= 15 ? "kb" : n <= 30 ? "ki" : n <= 45 ? "kn" : n <= 60 ? "kg" : "ko";
  return `${prefix}${n}.mp3`;
}
function callerAudioUrl(name) {
  return `/assets/audio/${name}`;
}


function BingoGame({ gameId, session, setSession, onBack, onNavigate, navItems }) {
  const game = GAMES.find(g => g.id === gameId);
  const myCards = session.picked?.[gameId] || [];
  // Resolve the round BEFORE any hook that depends on it. The previous build
  // referenced `round.id` inside useMemo before `round` was initialized,
  // causing a ReferenceError and leaving the Game page completely blank.
  const [round, setRound] = useState(() => getOrCreateRound(gameId));
  const roundId = round.id;
  const cards = useMemo(() => {
    const nums = new Set(myCards);
    const savedWinner = (() => { try { return JSON.parse(localStorage.getItem(`yegna-bingo-winner-${gameId}-${roundId}`) || "null"); } catch { return null; } })();
    if (savedWinner?.cardNumber) nums.add(Number(savedWinner.cardNumber));
    return Array.from(nums).map(n => ({ number: n, grid: createCard(n, gameId) }));
  }, [gameId, myCards.join(","), roundId]);
  const callsKey = `yegna-bingo-calls-${gameId}-${roundId}`;
  const winnerKey = `yegna-bingo-winner-${gameId}-${roundId}`;
  const [pickedCount, setPickedCount] = useState(() => roundId ? Object.keys(readPickedRegistryForRound(gameId, roundId)).length : 0);
  const [called, setCalled] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(callsKey) || "null");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const [globalWinner, setGlobalWinner] = useState(() => {
    try { return JSON.parse(localStorage.getItem(winnerKey) || "null"); } catch { return null; }
  });
  const [auto, setAuto] = useState(true);
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem("yegna-bingo-sound") !== "off"; } catch { return true; }
  });

  // State required by the Bingo board and winner flow. Keep these tied to the
  // current round so opening the Game page directly never references an
  // undefined value (which would render a blank page).
  const [manualMarks, setManualMarks] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`yegna-bingo-marks-${gameId}-${roundId}`) || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  });
  const [winnerCountdown, setWinnerCountdown] = useState(5);
  const [winnerFinalized, setWinnerFinalized] = useState(false);
  const [roundStatus, setRoundStatus] = useState(() => round.status);

  // Keep the LIVE page synchronized with the current round when opened
  // directly or from another tab.
  useEffect(() => {
    const syncRound = () => {
      const latest = readRound(gameId);
      if (latest && latest.id === roundId && (latest.status !== round.status || latest.pickStartedAt !== round.pickStartedAt)) {
        setRound(latest);
        setRoundStatus(latest.status);
      }
    };
    syncRound();
    const timer = setInterval(syncRound, 250);
    return () => clearInterval(timer);
  }, [gameId, roundId, round.status, round.pickStartedAt]);

  // Production transport: the server is authoritative for calls, winners,
  // round status, and player count. Clients only poll/read state; no browser
  // timer is allowed to generate the official Bingo numbers.
  useEffect(() => {
    if (!isBackendConfigured() || !roundId) return;
    let alive = true;
    const syncServerState = async () => {
      try {
        const result = await walletApi.getGameState(roundId);
        if (!alive || !result?.round) return;
        const sr = result.round;
        const nextCalls = Array.isArray(sr.calledNumbers) ? sr.calledNumbers.map(Number) : [];
        setCalled(nextCalls);
        setPickedCount(Number(result.pickedCount || 0));
        const mappedStatus = sr.status === 'running' ? 'live' : sr.status;
        setRoundStatus(mappedStatus);
        setRound(prev => ({ ...prev, id: sr.id, status: mappedStatus, pickStartedAt: sr.pickStartedAt ? new Date(sr.pickStartedAt).getTime() : prev.pickStartedAt }));
        if (Array.isArray(result.winners) && result.winners.length) {
          const winners = result.winners.slice(0,2).map(w => ({
            gameId, cardNumber:Number(w.cardNumber), userName:w.userName || 'YEGNA Player',
            playerKey:`tg-${w.userId}`, calledCount:nextCalls.length, winningCall:sr.currentCall ? Number(sr.currentCall) : null,
            wonAt:Date.now()
          }));
          const nextWinner = { ...winners[0], winners };
          setGlobalWinner(nextWinner);
          try { localStorage.setItem(winnerKey, JSON.stringify(nextWinner)); } catch {}
        } else if (sr.status === 'settled' && nextCalls.length >= 75) {
          setGlobalWinner(null);
        }
      } catch {}
    };
    syncServerState();
    const timer = setInterval(syncServerState, 700);
    return () => { alive = false; clearInterval(timer); };
  }, [gameId, roundId, winnerKey]);

  const current = called[called.length - 1] || null;

  // Local Amharic audio engine. A single queue prevents overlap/race conditions
  // between Start -> Number calls -> End, while preserving the exact call order.
  const audioQueueRef = useRef([]);
  const audioBusyRef = useRef(false);
  const audioElementRef = useRef(null);
  const audioCacheRef = useRef(new Map());
  const playedStartRef = useRef(false);
  const playedEndRef = useRef(false);
  const spokenCallRef = useRef(null);

  // Preload the caller clips so the number voice can start with almost no
  // network/file-fetch delay when the number appears on screen.
  const preloadCallerAudio = useCallback(() => {
    if (!sound || typeof window === "undefined") return;
    const names = ["kstart.mp3", "kend.mp3"];
    for (let n = 1; n <= 75; n += 1) names.push(callerAudioName(n));
    names.forEach((fileName) => {
      if (audioCacheRef.current.has(fileName)) return;
      const audio = new Audio(callerAudioUrl(fileName));
      audio.preload = "auto";
      audioCacheRef.current.set(fileName, audio);
      try { audio.load(); } catch {}
    });
  }, [sound]);

  const playAudioFile = useCallback((fileName) => {
    if (!sound || typeof window === "undefined") return;
    audioQueueRef.current.push(fileName);
    if (audioBusyRef.current) return;

    const playNext = async () => {
      if (!sound || !audioQueueRef.current.length) {
        audioBusyRef.current = false;
        return;
      }
      audioBusyRef.current = true;
      const nextFile = audioQueueRef.current.shift();
      const audio = audioCacheRef.current.get(nextFile) || new Audio(callerAudioUrl(nextFile));
      audio.preload = "auto";
      audio.volume = 1;
      audio.currentTime = 0;
      audioElementRef.current = audio;
      const finish = () => {
        audio.onended = null;
        audio.onerror = null;
        audioElementRef.current = null;
        playNext();
      };
      audio.onended = finish;
      audio.onerror = finish;
      try {
        await audio.play();
      } catch {
        // Mobile/Telegram autoplay policies can reject a playback started
        // without a recent user gesture. Keep the item queued for the next
        // explicit Sound ON/tap gesture instead of falling back to TTS.
        audio.onended = null;
        audio.onerror = null;
        audioElementRef.current = null;
        audioQueueRef.current.unshift(nextFile);
        audioBusyRef.current = false;
      }
    };
    playNext();
  }, [sound]);

  const unlockAudio = useCallback((fallbackNumber = null) => {
    if (typeof window === "undefined" || !sound) return;
    // A real tap can unlock playback on Telegram/Android. If a previous
    // attempt was blocked, resume that queued item immediately.
    const audio = audioElementRef.current;
    if (audio) {
      audio.play().catch(() => {});
      return;
    }
    if (audioQueueRef.current.length && !audioBusyRef.current) {
      const pending = audioQueueRef.current.shift();
      if (pending) playAudioFile(pending);
      return;
    }
    if (fallbackNumber) playAudioFile(callerAudioName(fallbackNumber));
  }, [sound, playAudioFile]);


  useEffect(() => {
    try { localStorage.setItem("yegna-bingo-sound", sound ? "on" : "off"); } catch {}
    if (sound) {
      preloadCallerAudio();
      return;
    }
    audioQueueRef.current = [];
    audioBusyRef.current = false;
    try { audioElementRef.current?.pause?.(); } catch {}
    audioElementRef.current = null;
    audioCacheRef.current.forEach((audio) => {
      try { audio.pause(); audio.src = ""; } catch {}
    });
    audioCacheRef.current.clear();
  }, [sound, preloadCallerAudio]);

  const speakCall = useCallback((number) => {
    if (!sound || !Number.isInteger(number)) return;
    playAudioFile(callerAudioName(number));
  }, [sound, playAudioFile]);

  // Play the start announcement exactly once per mounted round.
  useEffect(() => {
    if (!sound || roundStatus !== "live" || playedStartRef.current) return;
    playedStartRef.current = true;
    playAudioFile("kstart.mp3");
  }, [roundStatus, sound, playAudioFile]);

  useEffect(() => {
    if (!sound || !current || current === spokenCallRef.current) return;
    spokenCallRef.current = current;
    speakCall(current);
  }, [current, sound, speakCall]);

  // Keep open tabs in the same browser synchronized. A real Telegram
  // multiplayer game should replace this storage transport with a backend/WebSocket.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === callsKey) {
        try {
          const next = JSON.parse(event.newValue || "[]");
          if (Array.isArray(next)) setCalled(next);
        } catch {}
      }
      if (event.key === winnerKey) {
        try { setGlobalWinner(event.newValue ? JSON.parse(event.newValue) : null); } catch {}
      }
      if (event.key === `yegna-bingo-picked-${gameId}-${roundId}`) {
        setPickedCount(roundId ? Object.keys(readPickedRegistryForRound(gameId, roundId)).length : 0);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [callsKey, winnerKey, gameId, roundId]);

  useEffect(() => {
    if (isBackendConfigured()) return;
    localStorage.setItem(callsKey, JSON.stringify(called));
  }, [called, callsKey]);

  useEffect(() => {
    const syncPicked = () => setPickedCount(roundId ? Object.keys(readPickedRegistryForRound(gameId, roundId)).length : 0);
    syncPicked();
    const timer = setInterval(syncPicked, 700);
    return () => clearInterval(timer);
  }, [gameId, roundId]);

  const last3 = called.slice(-3).reverse();
  const calledSet = useMemo(() => new Set(called), [called]);
  // Never index the selected-card array by the card number. Card numbers can be
  // sparse (e.g. 12 and 587), so `cards[n - 1]` makes many valid picks disappear.
  // Build each selected card directly from its number instead.
  const myCardsData = useMemo(() => myCards
    .map(n => ({ number: Number(n), grid: createCard(Number(n), gameId) }))
    .filter(card => Number.isFinite(card.number) && card.number >= 1 && card.number <= TOTAL_CARDS),
    [myCards.join(","), gameId]);
  const playerKey = getPlayerKey();

  const effectiveMarkedSets = useMemo(() => {
    const result = {};
    for (const card of myCardsData) {
      if (auto) {
        result[card.number] = calledSet;
      } else {
        result[card.number] = new Set(Array.isArray(manualMarks[String(card.number)]) ? manualMarks[String(card.number)] : []);
      }
    }
    return result;
  }, [myCardsData, calledSet, auto, manualMarks]);

  const winnerList = Array.isArray(globalWinner?.winners)
    ? globalWinner.winners
    : (globalWinner?.cardNumber ? [globalWinner] : []);
  const localWinners = useMemo(() => {
    // A second winner is allowed only when it completes on the SAME call as
    // the first winner. This preserves the instant one-winner finish while
    // still allowing a genuine overlap to produce two winners.
    const existingCards = new Set(winnerList.map(w => Number(w.cardNumber)));
    const firstWinner = winnerList[0];
    if (firstWinner?.calledCount && firstWinner.calledCount !== called.length) return [];
    const found = [];
    for (const card of myCardsData) {
      if (existingCards.has(Number(card.number))) continue;
      const marked = effectiveMarkedSets[card.number] || new Set();
      const pattern = getWinningPattern(card.grid, marked);
      if (pattern) {
        found.push({ card, line: pattern.cells, winType: pattern.type, winLabel: pattern.label, userName: getPlayerDisplayName() });
      }
      if (winnerList.length + found.length >= 2) break;
    }
    return found;
  }, [myCardsData, effectiveMarkedSets, called.length, winnerList.length, winnerList.map(w => `${w.cardNumber}:${w.playerKey || ''}:${w.calledCount || ''}`).join('|')]);

  const localWinner = localWinners[0] || null;
  // Publish up to two winner cards. One winner ends the game immediately
  // after a very short same-call arbitration window; a second card may join
  // only if it also wins on that exact call.
  useEffect(() => {
    if (isBackendConfigured()) return;
    if (!localWinners.length || winnerList.length >= 2) return;
    try {
      const existingRaw = localStorage.getItem(winnerKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const existingWinners = Array.isArray(existing?.winners)
        ? existing.winners
        : (existing?.cardNumber ? [existing] : []);
      if (existingWinners.length >= 2) {
        setGlobalWinner({ ...existing, winners: existingWinners.slice(0, 2) });
        return;
      }
      if (existingWinners.length === 1 && existingWinners[0].calledCount !== called.length) return;

      const candidates = localWinners.map(w => ({
        gameId,
        cardNumber: w.card.number,
        line: w.line,
        winType: w.winType,
        winLabel: w.winLabel,
        userName: w.userName,
        playerKey,
        calledCount: called.length,
        winningCall: current,
        wonAt: Date.now()
      }));
      const merged = [...existingWinners];
      for (const candidate of candidates) {
        if (merged.length >= 2) break;
        if (!merged.some(w => Number(w.cardNumber) === Number(candidate.cardNumber))) merged.push(candidate);
      }
      const next = { ...(merged[0] || candidates[0]), winners: merged.slice(0, 2) };
      localStorage.setItem(winnerKey, JSON.stringify(next));
      setGlobalWinner(next);
    } catch {}
  }, [localWinners, winnerKey, playerKey, called.length, current, winnerList.length]);

  const primaryWinner = winnerList[0] || null;
  const winnerCard = primaryWinner?.cardNumber
    ? (cards.find(c => c.number === Number(primaryWinner.cardNumber)) || { number: Number(primaryWinner.cardNumber), grid: createCard(Number(primaryWinner.cardNumber), gameId) })
    : null;
  const isWinner = Boolean(winnerList.some(w => w.playerKey && w.playerKey === playerKey));
  const rewardRate = readRewardRate();
  const totalRewardPool = Number((pickedCount * game.amount * rewardRate / 100).toFixed(2));
  const prizeAmount = winnerList.length ? Number((totalRewardPool / winnerList.length).toFixed(2)) : totalRewardPool;
  const gameComplete = winnerFinalized || called.length >= 75;

  // Credit the configured reward exactly once. A single winner receives the
  // full reward pool; a genuine same-call overlap splits that pool equally.
  useEffect(() => {
    if (isBackendConfigured()) return;
    if (!winnerFinalized || !winnerList.length || !pickedCount) return;
    const pool = Number((pickedCount * game.amount * readRewardRate() / 100).toFixed(2));
    const winners = winnerList.slice(0, 2);
    if (!pool || !winners.length) return;
    const share = Number((pool / winners.length).toFixed(2));
    try {
      const store = readWalletStore();
      let changed = false;
      winners.forEach((winner) => {
        const userKey = winner.playerKey;
        if (!userKey) return;
        const user = store[userKey];
        if (!user) return;
        const rewardId = `reward-${gameId}-${roundId}-${winner.cardNumber}`;
        const alreadyPaid = (user.transactions || []).some(t => t.type === "win_reward" && t.rewardId === rewardId);
        if (alreadyPaid) return;
        const nextBalance = Number((Number(user.balance || 0) + share).toFixed(2));
        user.balance = nextBalance;
        user.transactions = [{
          id: `TX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          type: "win_reward",
          amount: share,
          detail: winners.length > 1 ? "Win Reward · Shared Overlap" : "Win Reward",
          balance: nextBalance,
          createdAt: Date.now(),
          rewardId,
          gameId,
          roundId,
          cardNumber: winner.cardNumber
        }, ...(user.transactions || [])];
        store[userKey] = user;
        changed = true;
      });
      if (changed) writeWalletStore(store);
    } catch {}
  }, [winnerFinalized, winnerList.map(w => `${w.cardNumber}:${w.playerKey || ""}`).join("|"), pickedCount, gameId, roundId]);

  // Play the end announcement exactly once when a winner is declared or all
  // 75 numbers have been called. This effect is intentionally placed AFTER
  // gameComplete is initialized; referencing it earlier causes a TDZ
  // ReferenceError and can blank the entire Bingo page.
  useEffect(() => {
    if (!sound || !gameComplete || playedEndRef.current) return;
    playedEndRef.current = true;
    playAudioFile("kend.mp3");
  }, [gameComplete, sound, playAudioFile]);

  // A single winner ends immediately. We briefly wait only to catch a
  // second card that completed on the exact same call (the overlap case).
  useEffect(() => {
    if (winnerList.length < 1) {
      setWinnerFinalized(false);
      setWinnerCountdown(5);
      return;
    }
    const arbitration = setTimeout(() => setWinnerFinalized(true), 250);
    return () => clearTimeout(arbitration);
  }, [winnerList.length, winnerList.map(w => `${w.cardNumber}:${w.calledCount || ''}`).join('|')]);

  useEffect(() => {
    if (!winnerFinalized) return;
    setWinnerCountdown(5);
    const timer = setInterval(() => {
      setWinnerCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    const redirect = setTimeout(() => {
      onNavigate(`/game?stake=${gameId}`);
    }, 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(redirect);
    };
  }, [winnerFinalized, gameId, onNavigate]);

  useEffect(() => {
    if (!roundId || !gameComplete) return;
    const currentRound = readRound(gameId);
    if (currentRound && currentRound.id === roundId && currentRound.status !== "complete") {
      writeRound(gameId, { ...currentRound, status: "complete", completedAt: Date.now() });
      setTimeout(() => {
        setSession(s => ({ ...s, roomId: s.roomId === gameId ? null : s.roomId, picked: { ...(s.picked || {}), [gameId]: [] } }));
      }, 0);
    }
  }, [gameComplete, gameId, roundId, setSession]);
  const statusText = winnerFinalized && primaryWinner
    ? `${primaryWinner.userName} won the game · 1 other won the game`
    : myCards.length
      ? `YOUR ${myCards.length} CARD${myCards.length > 1 ? "S" : ""} · FOLLOW THE CALLS`
      : "SPECTATOR MODE · FOLLOW THE CALLS";

  // Calling numbers are independent from Auto. As soon as the 35-second
  // picker ends and the round becomes live, calls begin automatically.
  useEffect(() => {
    if (isBackendConfigured()) return;
    if (gameComplete || roundStatus !== "live") return;
    const makeCall = () => {
      setCalled(prev => {
        if (prev.length >= 75 || readWinnerList(gameId, roundId).length >= 2) return prev;
        const used = new Set(prev);
        const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !used.has(n));
        if (!available.length) return prev;
        const next = available[Math.floor(Math.random() * available.length)];
        return [...prev, next];
      });
    };
    makeCall();
    const timer = setInterval(makeCall, 3000);
    return () => clearInterval(timer);
  }, [gameComplete, winnerKey, roundStatus]);

  useEffect(() => {
    try {
      localStorage.setItem(`yegna-bingo-marks-${gameId}-${roundId}`, JSON.stringify(manualMarks));
    } catch {}
  }, [manualMarks, gameId, roundId]);

  function toggleCardNumber(cardNumber, row, col, value) {
    if (auto || gameComplete || roundStatus !== "live" || value === "FREE") return;
    if (!calledSet.has(value)) return;
    setManualMarks(prev => {
      const key = String(cardNumber);
      const current = new Set(Array.isArray(prev[key]) ? prev[key] : []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [key]: Array.from(current) };
    });
  }

  function clearManualMarks() {
    setManualMarks({});
  }

  function callNext() {
    if (gameComplete || roundStatus !== "live") return;
    setCalled(prev => {
      if (prev.length >= 75 || readWinnerList(gameId, roundId).length >= 2) return prev;
      const used = new Set(prev);
      const available = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !used.has(n));
      const next = available[Math.floor(Math.random() * available.length)];
      return [...prev, next];
    });
  }

  function resetGame() {
    setCalled([]);
    setAuto(false);
    clearManualMarks();
    localStorage.removeItem(winnerKey);
    setGlobalWinner(null);
  }

  return (
    <div className="app-shell framed-page bingo-page">
      <div className="page-frame" aria-hidden="true" />
      <header className="bingo-header">
        <button className="header-back" onClick={onBack}><ArrowLeft size={21} /></button>
        <div className="bingo-header-brand"><img src="/assets/yegna-logo.png" alt="YEGNA BINGO" /><span>{game.label} · LIVE BINGO</span></div>
        <div className="header-crown"><Crown size={24} fill="currentColor" /></div>
      </header>

      <main className="bingo-main">
        <section className="game-info-strip">
          <div><small>STAKE</small><b>10</b></div>
          <div><small>PLAYERS</small><b>{pickedCount}</b></div>
          <div><small>CALLED</small><b>{called.length}</b></div>
          <div><small>DERASH</small><b>{(pickedCount * 10 * 0.85).toFixed(2)}</b></div>
        </section>

        <section className={`call-panel ${winnerFinalized ? "winner-panel" : ""}`}>
          <div className="call-title">
            <span>{winnerFinalized ? "GAME WON" : "Current Call"}</span>
            <div className="current-ball">{current ? `${letterFor(current)}-${current}` : "—"}</div>
          </div>
          <div className="last-three-wrap">
            {last3.length ? last3.map(n => <div key={n} className={`last-ball ${ballTone(n)}`}>{letterFor(n)}{n}</div>) : <div className="waiting-balls"><CircleDot size={18} /> Waiting for the next call</div>}
          </div>
          <div className="game-controls">
            <button className="control-pill" aria-pressed={sound} onClick={() => {
              if (sound) {
                setSound(false);
              } else {
                // This click is a real user gesture, which is required by
                // Telegram/Android before an Audio element may start playback.
                setSound(true);
                unlockAudio(current);
              }
            }}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />} <span>{sound ? "Sound ON" : "Sound OFF"}</span></button>
            <div className="stake-pill">{game.label}</div>
            <button className={`auto-pill ${auto && !gameComplete && roundStatus === "live" ? "on" : ""}`} onClick={() => {
              if (roundStatus !== "live" || gameComplete) return;
              setAuto(prev => {
                if (prev) return false;
                // Preserve all numbers that have already been called when switching
                // from automatic marking to manual marking. The user can then tap
                // those marked cells to unmark/re-mark them manually.
                setManualMarks(currentMarks => {
                  const next = { ...currentMarks };
                  for (const card of myCardsData) next[String(card.number)] = Array.from(calledSet);
                  return next;
                });
                return true;
              });
            }}><span>Auto Mark</span><b>{auto && !gameComplete ? "ON" : "OFF"}</b></button>
          </div>
          {winnerFinalized && primaryWinner && <div className="winner-banner"><Trophy size={15} /><strong>{primaryWinner.userName} won the game{winnerList.length > 1 ? " · 1 other won the game" : ""}</strong><span>{winnerList.length > 1 ? `Cards #${String(winnerList[0].cardNumber).padStart(3, "0")} + #${String(winnerList[1].cardNumber).padStart(3, "0")}` : `Card #${String(primaryWinner.cardNumber).padStart(3, "0")}`}</span></div>}
        </section>

        <section className="game-split-screen">
          <section className="called-board">
            <div className="game-section-heading"><span /><h2>CALLED NUMBERS</h2><span /></div>
            <div className="number-board">
              {[['B',1,15], ['I',16,30], ['N',31,45], ['G',46,60], ['O',61,75]].map(([letter, start, end]) => (
                <div className={`number-column ${letter.toLowerCase()}`} key={letter}>
                  <div className="number-column-head">{letter}</div>
                  {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(n => (
                    <span key={n} className={`${calledSet.has(n) ? "called" : ""} ${current === n ? "current" : ""}`}>{n}</span>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="player-card-panel">
            {winnerFinalized && winnerCard ? (
              <section className="winner-card-display">
                <div className={`winner-display-title winner-type-${primaryWinner.winType || "line"}`}><Trophy size={18} /><div><strong>{primaryWinner.userName} won the game</strong><span>WINNING: {primaryWinner.winLabel || (primaryWinner.winType === "corners" ? "FOUR CORNERS" : "BINGO LINE")} · CARD #{String(winnerCard.number).padStart(3, "0")}</span></div></div>
                <LiveBingoCard card={winnerCard} calledSet={calledSet} winningLine={primaryWinner.line || getWinningLine(winnerCard.grid, calledSet)} winningType={primaryWinner.winType} winnerName={primaryWinner.userName} />
              </section>
            ) : !myCards.length ? (
              <section className="spectator-card">
                <Radio size={27} />
                <h2>እባክዎ ቀጣይ ዙር እስከሚጀምር ይጠብቁ</h2>
                <p>Card ሳይመርጡ ጨዋታውን መመልከትና መከታተል ይችላሉ።</p>
              </section>
            ) : (
              <section className="my-cards-game">
                <div className="game-section-heading"><span /><h2>{statusText}</h2><span /></div>
                <div className={`selected-game-cards ${myCardsData.length === 1 ? "one-card" : "two-cards"}`}>
                  {myCardsData.map(card => (
                    <LiveBingoCard
                      key={card.number}
                      card={card}
                      calledSet={calledSet}
                      markedSet={effectiveMarkedSets[card.number]}
                      winningLine={null}
                      interactive={!auto && !gameComplete && roundStatus === "live"}
                      onToggle={(row, col, value) => toggleCardNumber(card.number, row, col, value)}
                    />
                  ))}
                </div>
              </section>
            )}
          </section>
        </section>
      </main>

      {winnerFinalized && primaryWinner && winnerCard && (
        <div className={`winner-overlay ${isWinner ? "winner-overlay-self" : "winner-overlay-other"}`} role="dialog" aria-modal="true" aria-label={isWinner ? "You won the Bingo game" : "Bingo game result"}>
          <div className="winner-overlay-backdrop" />
          {isWinner && <PrizeCelebration />}
          <section className={`winner-modal ${isWinner ? "winner-modal-self" : "winner-modal-other"}`}>
            <div className="winner-modal-inner">
              <img className="winner-modal-logo" src="/assets/yegna-logo.png" alt="YEGNA BINGO" />
              <h1>BINGO!</h1>
              {isWinner ? (
                <>
                  <div className="winner-message winner-message-self"><strong>Congra!</strong><span>You won this game · {winnerList.length > 1 ? `Cards #${winnerList.map(w => String(w.cardNumber).padStart(3, "0")).join(" + #")}` : `Card #${String(primaryWinner.cardNumber).padStart(3, "0")}`}{winnerList.length > 1 ? " · 1 other won the game" : ""}</span></div>
                  <div className="prize-card">
                    <span className="prize-kicker">YOUR PRIZE</span>
                    <strong>{game.amount} × {pickedCount} × {readRewardRate()}%</strong>
                    <b>{prizeAmount.toFixed(2)} ETB</b>
                  </div>
                </>
              ) : (
                <div className="winner-message"><strong>{primaryWinner.userName}</strong><span>won the game · {winnerList.length > 1 ? `Cards #${winnerList.map(w => String(w.cardNumber).padStart(3, "0")).join(" + #")}` : `Card #${String(primaryWinner.cardNumber).padStart(3, "0")}`}{winnerList.length > 1 ? " · 1 other won the game" : ""}</span></div>
              )}
              {winnerList.length > 1 && (
                <div className="winner-message winner-message-other-card"><strong>{primaryWinner.userName}</strong><span>+ 1 other won the game</span></div>
              )}
              <div className={`winner-pattern-badge ${primaryWinner.winType === "corners" ? "corners" : "line"}`}>
                <Trophy size={15} />
                <span>WINNING PATTERN</span>
                <strong>{primaryWinner.winLabel || (primaryWinner.winType === "corners" ? "FOUR CORNERS" : "BINGO LINE")}</strong>
              </div>
              <LiveBingoCard
                card={winnerCard}
                calledSet={calledSet}
                winningLine={primaryWinner.line || getWinningLine(winnerCard.grid, calledSet)}
                winningType={primaryWinner.winType}
                winnerName={primaryWinner.userName}
              />
              <div className="next-round-countdown">
                <span>Next round</span>
                <strong>{winnerCountdown}</strong>
              </div>
            </div>
          </section>
        </div>
      )}

      <BottomNav items={navItems} activeKey="game" onNavigate={onNavigate} />
    </div>
  );
}


function WalletPage({ onNavigate }) {
  const [wallet, setWallet] = useState(() => getWalletUser());
  const [show, setShow] = useState(true);
  const [loading, setLoading] = useState(isBackendConfigured());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isBackendConfigured()) { setLoading(false); return; }
    try {
      const data = await walletApi.getWallet();
      const normalized = {
        ...wallet,
        username: data.wallet?.username || getPlayerDisplayName(),
        balance: Number(data.wallet?.balance || 0),
        transactions: (data.transactions || []).map(t => ({
          ...t,
          amount: Number(t.amount || 0),
          balance: Number(t.balance_after || 0),
          createdAt: t.created_at
        }))
      };
      setWallet(normalized);
      try {
        const key = getWalletUserKey();
        const store = readWalletStore();
        store[key] = normalized;
        writeWalletStore(store);
      } catch {}
      setError("");
    } catch (e) {
      setError(e.message || "Wallet could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <div className="app-shell framed-page wallet-page-shell"><div className="page-frame" aria-hidden="true"/>
    <header className="simple-page-header"><button className="header-back" onClick={()=>onNavigate("/")}><ArrowLeft size={21}/></button><div><img src="/assets/yegna-logo.png"/><span>MY WALLET</span></div><WalletCards size={24}/></header>
    <main className="wallet-main">
      <section className="wallet-hero"><span>AVAILABLE BALANCE</span><div><WalletCards size={25}/><strong>{show ? `${Number(wallet.balance||0).toFixed(2)} ETB` : "••••••"}</strong><button onClick={()=>setShow(v=>!v)}>{show?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></section>
      {loading && <div className="empty-wallet"><RefreshCw size={25}/><p>Loading wallet…</p></div>}
      {error && <div className="picker-notice">{error}</div>}
      <section className="wallet-panel"><div className="panel-title"><History size={19}/><h2>Transaction History</h2></div>
        {!(wallet.transactions||[]).length?<div className="empty-wallet"><WalletCards size={30}/><p>No wallet transactions yet.</p></div>:<div className="transaction-list">{wallet.transactions.map(t=><div className="transaction-row" key={t.id}><div><b>{t.detail}</b><small>{new Date(t.createdAt).toLocaleString()}</small></div><strong className={Number(t.amount)>=0?"income":"expense"}>{Number(t.amount)>=0?"+":""}{Number(t.amount).toFixed(2)} ETB</strong></div>)}</div>}
      </section>
    </main>
    <BottomNav items={PICKER_NAV_ITEMS} activeKey="wallet" onNavigate={onNavigate}/>
  </div>;
}
function HistoryPage({ onNavigate }) { return <WalletPage onNavigate={onNavigate} />; }
function AdminWalletPage({ onNavigate }) {
  const [store,setStore]=useState(()=>readWalletStore()); const [rate,setRate]=useState(()=>readRewardRate()); const [query,setQuery]=useState(""); const [selected,setSelected]=useState(null); const [amount,setAmount]=useState(""); const [detail,setDetail]=useState("");
  const [adminAccess,setAdminAccess]=useState(null); const [subAdmins,setSubAdmins]=useState([]); const [subAdminInput,setSubAdminInput]=useState(""); const [subAdminBusy,setSubAdminBusy]=useState(false); const [subAdminMessage,setSubAdminMessage]=useState("");
  const [walletRequests,setWalletRequests]=useState([]); const [requestFilter,setRequestFilter]=useState("pending"); const [requestBusy,setRequestBusy]=useState(false); const [requestMessage,setRequestMessage]=useState("");
  const [serverUsers,setServerUsers]=useState([]); const [serverStats,setServerStats]=useState(null); const [selectedWallet,setSelectedWallet]=useState(null);
  const users=serverUsers.length ? serverUsers.filter(u=>(u.username||"").toLowerCase().includes(query.toLowerCase()) || String(u.telegram_id||"").includes(query.replace(/^@/,""))) : Object.values(store).filter(u=>(u.username||"").toLowerCase().includes(query.toLowerCase()) || (u.userKey||"").toLowerCase().includes(query.toLowerCase()));
  const allUsers=serverUsers.length ? serverUsers : Object.values(store);
  const allTx=allUsers.flatMap(u=>u.transactions||[]);
  const totalBalance=serverStats ? Number(serverStats.balance||0) : allUsers.reduce((n,u)=>n+Number(u.balance||0),0);
  const totalStakes=serverStats ? Number(serverStats.stakes||0) : Math.abs(allTx.filter(t=>Number(t.amount)<0 && t.type==="stake").reduce((n,t)=>n+Number(t.amount||0),0));
  const totalRewards=serverStats ? Number(serverStats.rewards||0) : allTx.filter(t=>t.type==="win_reward").reduce((n,t)=>n+Number(t.amount||0),0);
  const totalDeposits=serverStats ? Number(serverStats.deposits||0) : allTx.filter(t=>t.type==="deposit").reduce((n,t)=>n+Number(t.amount||0),0);
  const totalWithdrawals=serverStats ? Number(serverStats.withdrawals||0) : allTx.filter(t=>t.type==="withdrawal").reduce((n,t)=>n+Number(t.amount||0),0);
  const refresh=()=>setStore(readWalletStore());
  const loadServerUsers=async()=>{ if(!isBackendConfigured()) return; try { const [u,s]=await Promise.all([walletApi.getAdminUsers(query),walletApi.getAdminStats()]); setServerUsers(u.users||[]); setServerStats(s); } catch(e) { setRequestMessage(e.message); } };
  const loadSelectedWallet=async(userId)=>{ if(!isBackendConfigured()) return; try { const data=await walletApi.getAdminUserWallet(userId); setSelectedWallet(data); } catch(e) { setRequestMessage(e.message); } };
  async function changeFunds(delta,type,defaultDetail){
    const n=Number(amount); if(!selected||!Number.isFinite(n)||n<=0)return;
    if(isBackendConfigured()){
      try { await walletApi.adjustUser(selected.id,n,type,detail.trim()||defaultDetail); setAmount("");setDetail(""); await loadServerUsers(); await loadSelectedWallet(selected.id); setRequestMessage("Wallet updated successfully."); } catch(e){ setRequestMessage(e.message); }
    } else {
      if(type==="admin_debit" && Number(selected.balance||0)<n)return;
      recordWalletTransaction(selected.userKey,type,type==="admin_debit"?-n:n,detail.trim()||defaultDetail); setAmount("");setDetail("");refresh();setSelected(readWalletStore()[selected.userKey]);
    }
  }
  async function saveRate(){
    const n=Math.max(0,Math.min(100,Number(rate)));
    if(!Number.isFinite(n)) return;
    try { if(isBackendConfigured()) await walletApi.setRewardRate(n); else localStorage.setItem(REWARD_KEY,String(n)); setRate(n); setRequestMessage("Reward rate saved."); } catch(e){ setRequestMessage(e.message); }
  }
  const loadSubAdmins=async()=>{ try {
    const access=await walletApi.getAdminAccess(); setAdminAccess(access);
    if(access.user?.role==='super_admin') setSubAdmins((await walletApi.getSubAdmins()).subAdmins||[]);
    if(access.permissions?.reward_manage) {
      const settings=await walletApi.getAdminSettings();
      if(settings.reward_rate !== undefined) setRate(Number(settings.reward_rate));
    }
  } catch(e){ setSubAdminMessage(e.message); } };
  const loadWalletRequests=async()=>{ try { const result=await walletApi.getWalletRequests(requestFilter); setWalletRequests(result.requests||[]); } catch(e){ setRequestMessage(e.message); } };
  useEffect(()=>{ loadSubAdmins(); loadServerUsers(); },[]);
  useEffect(()=>{ loadWalletRequests(); },[requestFilter]);
  useEffect(()=>{ if(isBackendConfigured()) { const t=setTimeout(loadServerUsers,250); return()=>clearTimeout(t); } },[query]);
  const approveRequest=async(id)=>{ if(!confirm("Approve this wallet request?")) return; setRequestBusy(true);setRequestMessage(""); try { await walletApi.approveWalletRequest(id); await loadWalletRequests(); setRequestMessage("Request approved successfully."); } catch(e){setRequestMessage(e.message);} finally{setRequestBusy(false);} };
  const rejectRequest=async(id)=>{ const reason=prompt("Rejection reason (optional):", "Rejected by admin") || "Rejected by admin"; setRequestBusy(true);setRequestMessage(""); try { await walletApi.rejectWalletRequest(id,reason); await loadWalletRequests(); setRequestMessage("Request rejected."); } catch(e){setRequestMessage(e.message);} finally{setRequestBusy(false);} };
  const addSubAdmin=async()=>{ if(!subAdminInput.trim())return; setSubAdminBusy(true);setSubAdminMessage(""); try { const isId=/^\d+$/.test(subAdminInput.trim()); await walletApi.addSubAdmin(isId?{telegramId:subAdminInput.trim()}:{username:subAdminInput.trim()}); setSubAdminInput(""); setSubAdmins((await walletApi.getSubAdmins()).subAdmins||[]); setSubAdminMessage("Sub admin added successfully."); } catch(e){setSubAdminMessage(e.message);} finally{setSubAdminBusy(false);} };
  const removeSubAdmin=async(id)=>{ if(!confirm("Remove this sub admin and return the account to normal user access?"))return; setSubAdminBusy(true);setSubAdminMessage(""); try { await walletApi.removeSubAdmin(id); setSubAdmins((await walletApi.getSubAdmins()).subAdmins||[]); setSubAdminMessage("Sub admin removed."); } catch(e){setSubAdminMessage(e.message);} finally{setSubAdminBusy(false);} };
  const togglePermission=async(admin,key)=>{ const next={...(admin.permissions||{}),[key]:!(admin.permissions||{})[key]}; setSubAdminBusy(true);setSubAdminMessage(""); try { await walletApi.updateSubAdminPermissions(admin.id,next); setSubAdmins(list=>list.map(x=>x.id===admin.id?{...x,permissions:next}:x)); } catch(e){setSubAdminMessage(e.message);} finally{setSubAdminBusy(false);} };
  const permissionLabels={dashboard_view:"Dashboard",users_view:"Users",wallet_manage:"Wallet",reward_manage:"Reward",game_manage:"Game"};
  return <div className="app-shell framed-page wallet-page-shell"><div className="page-frame" aria-hidden="true"/><header className="simple-page-header"><button className="header-back" onClick={()=>onNavigate("/")}><ArrowLeft size={21}/></button><div><img src="/assets/yegna-logo.png"/><span>ADMIN · WALLET MANAGEMENT</span></div><Crown size={24}/></header><main className="wallet-main admin-main">
    <section className="admin-stats"><div><b>{serverStats?.users ?? allUsers.length}</b><span>Total Users</span></div><div><b>{totalBalance.toFixed(2)}</b><span>Total Balance</span></div><div><b>{totalDeposits.toFixed(2)}</b><span>Total Deposits</span></div><div><b>{totalWithdrawals.toFixed(2)}</b><span>Total Withdrawals</span></div><div><b>{totalStakes.toFixed(2)}</b><span>Total Stakes</span></div><div><b>{totalRewards.toFixed(2)}</b><span>Rewards Paid</span></div></section>
    <section className="admin-card wallet-requests-card"><div className="panel-title"><RefreshCw size={19}/><h2>Deposit / Withdraw Approval</h2></div><p>Review wallet requests submitted through the Telegram Bot. Balance changes happen only after approval.</p><div className="request-tabs"><button className={requestFilter==="pending"?"active":""} onClick={()=>setRequestFilter("pending")}>Pending</button><button className={requestFilter==="approved"?"active":""} onClick={()=>setRequestFilter("approved")}>Approved</button><button className={requestFilter==="rejected"?"active":""} onClick={()=>setRequestFilter("rejected")}>Rejected</button><button className="request-refresh" onClick={loadWalletRequests} disabled={requestBusy}><RefreshCw size={15}/></button></div>{requestMessage&&<small className="subadmin-message">{requestMessage}</small>}<div className="wallet-request-list">{walletRequests.map(r=><div className={`wallet-request-row ${r.status}`} key={r.id}><div className="wallet-request-head"><span><b>{r.type==='deposit'?'DEPOSIT':'WITHDRAW'}</b><small>@{r.username||'YEGNA User'} · Telegram ID: {r.telegram_id}</small></span><strong>{Number(r.amount).toFixed(2)} ETB</strong></div><div className="wallet-request-meta"><span>#{r.id} · {new Date(r.requested_at).toLocaleString()}</span><span>{r.method||'Telegram Bot'}</span></div>{r.detail&&<div className="wallet-request-detail">{r.detail}</div>}{r.status==='pending'&&<div className="request-actions"><button onClick={()=>approveRequest(r.id)} disabled={requestBusy}>Approve</button><button className="danger" onClick={()=>rejectRequest(r.id)} disabled={requestBusy}>Reject</button></div>}{r.status!=='pending'&&<div className="request-status">{r.status.toUpperCase()}{r.rejection_reason?` · ${r.rejection_reason}`:''}</div>}</div>)}{!walletRequests.length&&<div className="empty-wallet"><RefreshCw size={27}/><p>No {requestFilter} wallet requests.</p></div>}</div></section>
    <section className="admin-card"><div className="panel-title"><Sparkles size={19}/><h2>Reward Control</h2></div><p>Admin controls the reward percentage used for new games.</p><div className="reward-control"><input type="number" min="0" max="100" value={rate} onChange={e=>setRate(e.target.value)}/><b>%</b><button onClick={saveRate}>Save</button></div><small className="demo-note">Reward is applied when the game is settled. Production wallet control must be enforced by the backend.</small></section>
    <section className="admin-card"><div className="panel-title"><UserRound size={19}/><h2>Users & Wallets</h2></div><input className="admin-search" placeholder="Search Telegram username" value={query} onChange={e=>setQuery(e.target.value)}/><div className="admin-users">{users.map(u=><button key={u.userKey} className={`admin-user ${selected?.userKey===u.userKey?"selected":""}`} onClick={()=>{setSelected(u); if(isBackendConfigured()) loadSelectedWallet(u.id);}}><span><b>{u.username||"YEGNA Player"}</b><small>{u.userKey}</small></span><strong>{Number(u.balance||0).toFixed(2)} ETB</strong></button>)}{!users.length&&<div className="empty-wallet"><p>No users with wallet records yet.</p></div>}</div></section>
    {selected&&<section className="admin-card"><div className="panel-title"><WalletCards size={19}/><h2>{selected.username} Wallet</h2></div><div className="admin-balance">{Number(selectedWallet?.user?.balance ?? selected.balance ?? 0).toFixed(2)} ETB</div><div className="admin-form"><input inputMode="decimal" placeholder="Amount" value={amount} onChange={e=>setAmount(e.target.value)}/><input placeholder="Reason (optional)" value={detail} onChange={e=>setDetail(e.target.value)}/><div className="admin-action-row"><button onClick={()=>changeFunds(1,"admin_credit","Admin wallet credit")}>Add Funds</button><button className="danger" onClick={()=>changeFunds(-1,"admin_debit","Admin wallet debit")}>Deduct Funds</button></div></div><div className="admin-history"><div className="panel-title"><History size={17}/><h2>Recent Transactions</h2></div>{(selectedWallet?.transactions || selected.transactions || []).slice(0,8).map(t=><div className="transaction-row" key={t.id}><div><b>{t.detail}</b><small>{new Date(t.createdAt || t.created_at).toLocaleString()}</small></div><strong className={Number(t.amount)>=0?"income":"expense"}>{t.amount>=0?"+":""}{Number(t.amount).toFixed(2)} ETB</strong></div>)}{!(selected.transactions||[]).length&&<div className="empty-wallet"><p>No transactions yet.</p></div>}</div></section>}
    <section className="admin-card subadmin-management-card"><div className="panel-title"><Crown size={19}/><h2>Sub Admin Management</h2></div><div className="subadmin-role-row"><span>Access level</span><b>{adminAccess?.user?.role==='super_admin' ? 'SUPER ADMIN' : adminAccess?.user?.role==='sub_admin' ? 'SUB ADMIN' : 'SUPER ADMIN ONLY'}</b></div><p>Only the Super Admin can add, remove, and control Sub Admin permissions.</p><div className="subadmin-add"><input placeholder="Telegram ID or username" value={subAdminInput} onChange={e=>setSubAdminInput(e.target.value)} disabled={adminAccess?.user?.role!=='super_admin'} /><button disabled={subAdminBusy || adminAccess?.user?.role!=='super_admin'} onClick={addSubAdmin}>Add Sub Admin</button></div>{subAdminMessage&&<small className="subadmin-message">{subAdminMessage}</small>}<div className="subadmin-list">{subAdmins.map(a=><div className="subadmin-row" key={a.id}><div className="subadmin-head"><span><b>{a.username?`@${a.username}`:"YEGNA User"}</b><small>Telegram ID: {a.telegram_id}</small></span><button className="danger-text" disabled={subAdminBusy || adminAccess?.user?.role!=='super_admin'} onClick={()=>removeSubAdmin(a.id)}>Remove</button></div><div className="permission-grid">{Object.entries(permissionLabels).map(([key,label])=><button key={key} className={(a.permissions||{})[key]?"permission on":"permission"} disabled={subAdminBusy || adminAccess?.user?.role!=='super_admin'} onClick={()=>togglePermission(a,key)}>{label}: {(a.permissions||{})[key]?"ON":"OFF"}</button>)}</div></div>)}{!subAdmins.length&&<div className="empty-wallet"><p>No sub admins yet.</p></div>}</div></section>
  </main></div>;
}

function PrizeCelebration() {
  const pieces = Array.from({ length: 22 }, (_, i) => i);
  return (
    <div className="prize-celebration" aria-hidden="true">
      <div className="prize-glow" />
      <div className="prize-coins">{pieces.map(i => <span key={i} style={{ "--i": i }}>ETB</span>)}</div>
      <div className="prize-stars">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ "--i": i }}>✦</i>)}</div>
    </div>
  );
}

function LiveBingoCard({ card, calledSet, markedSet, winningLine, winningType, winnerName, interactive = false, onToggle }) {
  const winningCells = new Set((winningLine || []).map(([r, c]) => `${r}-${c}`));
  const marks = markedSet || calledSet;
  return (
    <div className={`live-card ${winningLine ? "winner-card winner-pattern-highlight" : ""} ${winningType ? `winner-${winningType}` : ""}`}>
      <div className="live-card-top"><b>CARD #{String(card.number).padStart(3, "0")}</b><span>{winningLine ? <><Trophy size={13} /> WINNER</> : <><Trophy size={13} /> ACTIVE</>}</span></div>{winnerName && winningLine && <div className="winner-card-name">{winnerName}</div>}
      <div className="bingo-head"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>
      <div className="bingo-grid live-grid">
        {card.grid.flatMap((row, r) => row.map((value, c) => {
          const hit = value !== "FREE" && marks.has(value);
          const called = value !== "FREE" && calledSet.has(value);
          const winCell = winningCells.has(`${r}-${c}`);
          const clickable = interactive && called && value !== "FREE";
          return <span key={`${r}-${c}`} onClick={() => clickable && onToggle?.(r, c, value)} className={`${value === "FREE" ? "free" : ""} ${hit ? "hit" : ""} ${called && !hit ? "called-available" : ""} ${winCell ? "win-cell" : ""} ${clickable ? "manual-mark-cell" : ""}`}>{value === "FREE" ? "★" : value}</span>;
        }))}
      </div>
    </div>
  );
}

function letterFor(n) {
  if (!n) return "";
  if (n <= 15) return "B";
  if (n <= 30) return "I";
  if (n <= 45) return "N";
  if (n <= 60) return "G";
  return "O";
}

function ballTone(n) {
  if (n <= 15) return "blue";
  if (n <= 30) return "green";
  if (n <= 45) return "orange";
  if (n <= 60) return "red";
  return "purple";
}

function BingoCard({ card, mine, locked, busy, onClick }) {
  return (
    <button className={`bingo-card ${mine ? "mine" : ""} ${locked ? "locked" : ""} ${busy ? "busy" : ""}`} onClick={onClick} disabled={locked || busy} aria-label={`Bingo card ${card.number}${locked ? ", taken" : mine ? ", yours" : ", available"}`}>
      <div className="card-top"><span>CARD #{String(card.number).padStart(3, "0")}</span>{locked ? <LockKeyhole size={16} /> : mine ? <Check size={17} /> : <Unlock size={15} />}</div>
      <div className="bingo-head"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>
      <div className="bingo-grid">
        {card.grid.flatMap((row, r) => row.map((value, c) => <span key={`${r}-${c}`} className={value === "FREE" ? "free" : ""}>{value === "FREE" ? "★" : value}</span>))}
      </div>
      
    </button>
  );
}

function BottomNav({ items, activeKey, onNavigate }) {
  return <nav className="bottom-nav">{items.map(({ key, label, icon: Icon, path }) => <button key={key} className={`nav-item ${activeKey === key ? "active" : ""}`} onClick={() => onNavigate(path)}><Icon size={23} strokeWidth={2} /><span>{label}</span></button>)}</nav>;
}

export default App;
