# YEGNA BINGO V40 — Telegram Authentication Hardening

V40 is based on V39.1 and changes only the server-side Telegram authentication hardening.

## Changes
- Telegram `initData` now has a configurable maximum age, default **3600 seconds (1 hour)**.
- Future-dated `auth_date` values are rejected beyond a configurable **60-second clock-skew** window.
- Telegram `hash` must be a valid 64-character hexadecimal SHA-256 digest before timing-safe comparison.
- `SUPER_ADMIN_TELEGRAM_ID` remains the server-side source of truth for the Super Admin identity. A stale `super_admin` database role is not preserved when the configured numeric Telegram ID does not match.
- Existing user/wallet/history/game behavior is otherwise unchanged.

## Environment
```
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=3600
TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS=60
```

## Important
This hardening makes the existing per-request Telegram authentication short-lived, but it does not add a server session layer. Full one-time nonce/session replay prevention would require a coordinated frontend + backend session flow and is intentionally not mixed into this minimal V40 change.
