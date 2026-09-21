# YEGNA BINGO V50 Changes

## Caller timing
- Production server call interval: **4 seconds**.
- Local/demo fallback call interval: **4 seconds**.
- Audio follows the current called number, so the 4-second server/display cadence drives audio as well.

## Wallet access
- Regular users: `/wallet` returns only the authenticated user's own balance and transaction history.
- Cross-user wallet access: `/admin/user-wallet` requires an authenticated admin plus `users_view` permission.
- Admin wallet management and request approval remain protected by the existing admin permissions.

No client-supplied user ID is accepted for the regular user's wallet endpoint.
