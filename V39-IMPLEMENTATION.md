# V39 Backend + Telegram Wallet Security

V39 keeps the V38 UI/design and adds the first production-oriented server enforcement layer.

## Required server environment
- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `SUPER_ADMIN_TELEGRAM_ID`
- `WALLET_BOT_SECRET`
- `ALLOWED_ORIGIN`

Never put bot secrets or the Super Admin numeric Telegram ID in frontend code.

## Telegram Bot request endpoint

`POST /api/wallet/requests`

Header:
`X-Wallet-Bot-Secret: <WALLET_BOT_SECRET>`

Body:
```json
{
  "telegram_user_id": "123456789",
  "username": "optional_display_name",
  "type": "deposit",
  "amount": 100,
  "reference": "BOT-UNIQUE-REQUEST-ID",
  "note": "optional"
}
```

`type` is `deposit` or `withdraw` (the backend also accepts the legacy `withdrawal` spelling).

The same `reference` is idempotent: resubmitting it returns the existing request instead of creating a duplicate.

## Wallet policy

- Deposit: pending requests do not change balance; approval adds the amount atomically.
- Withdrawal: the requested amount is held immediately by deducting it from available balance and creating a `withdrawal_hold` ledger entry.
- Withdrawal approval: changes status only; no second deduction.
- Withdrawal rejection: creates a `withdrawal_refund` ledger entry and restores the held amount.
- Admin approval/rejection is locked in a database transaction and can happen only once.

## Telegram identity

The backend identifies users by Telegram numeric `telegram_id`. Username is display/search data and may change without creating a new account. Telegram Mini App `initData` is verified server-side.

## Card stake enforcement

- Card selection calls the backend.
- Stake is 10 ETB per card and is deducted atomically.
- A card cannot be reserved if wallet balance is insufficient.
- A selected card can be released only while the round is still in `picking`.
- Releasing before launch refunds the full 10 ETB and records `stake_refund`.
- Duplicate card reservations are rejected by the database unique constraint.

## Important deployment step

Run `db/migration-v39.sql` against the production PostgreSQL/Supabase database before deploying the V39 frontend/backend.
