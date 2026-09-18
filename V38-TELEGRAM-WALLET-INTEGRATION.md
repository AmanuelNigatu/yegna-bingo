# V38 Telegram Wallet Request Integration

This folder contains the V37 application unchanged plus the Telegram wallet-request integration contract.

## Environment variables
Set these on the backend/server (never in frontend code):
- TELEGRAM_BOT_TOKEN
- WALLET_BOT_SECRET
- SUPER_ADMIN_TELEGRAM_ID

## Request contract

POST /api/wallet/requests
Headers:
  Content-Type: application/json
  X-Wallet-Bot-Secret: $WALLET_BOT_SECRET

Body:
{
  "telegram_user_id": "<numeric Telegram user id>",
  "username": "<telegram username, optional>",
  "type": "deposit" | "withdraw",
  "amount": 10,
  "reference": "<unique bot request id>",
  "note": "<optional>"
}

The backend must:
1. Validate the bot secret.
2. Validate the numeric Telegram user ID and positive amount.
3. Create exactly one Pending wallet request for the unique reference.
4. Never modify wallet balance for a pending deposit.
5. For a withdrawal, reserve funds according to the application's wallet hold policy.
6. Store the request against Telegram numeric user ID; username is display/search data.
7. Return the existing request when the same reference is submitted again instead of creating a duplicate.

Admin approval remains server-side and must atomically transition:
Pending -> Approved OR Pending -> Rejected exactly once.

The existing V37 UI/game/wallet/admin behavior is intentionally preserved.
