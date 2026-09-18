# YEGNA BINGO V41 — Secure Telegram Session

V41 adds a server-side HttpOnly session after Telegram WebApp initData verification. Protected API routes no longer trust a client-supplied Telegram ID or repeatedly accept initData. The verified initData payload is recorded once by SHA-256 hash to prevent replay of the same bootstrap payload. Sessions are random 32-byte tokens stored only as SHA-256 hashes in PostgreSQL and expire according to `SESSION_TTL_SECONDS` (default 24 hours).

Frontend calls `POST /api/auth/session` once and then uses `credentials: include` for subsequent API requests. Logout deletes the server session and clears the cookie.

Run `db/migration-v41.sql` after V40. Set `ALLOWED_ORIGIN` to the exact deployed Mini App origin when cookies are used across origins.
