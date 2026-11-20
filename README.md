# Veloura Billiards

Table timers, billing, member accounts, month-end closing and an admin panel for a billiards hall.

- **frontend/**: Angular 22 (standalone components, signals, lazy routes, CSS 3D floor)
- **backend/**: plain PHP 8.x REST API (PDO). Uses **SQLite** by default (no setup needed), or **MySQL** if you configure it.

## Run it (development)

```bash
# 1. API on :8000 (creates backend/data/veloura.sqlite and seed data on first request)
php -S 127.0.0.1:8000 -t backend/public backend/public/index.php

# 2. Angular on :4200 (proxies /api → :8000)
cd frontend && npm install && npm start
```

Open http://localhost:4200 and sign in with the seeded logins **admin / admin123** or **staff / staff123**.
Change these passwords right away in **Admin → Staff**.

## Features

| Page | Who | What |
|---|---|---|
| **Floor** (home) | all | 3D carousel of tables (drag, arrow keys, ball dots, floor map). Start a timer with a walk-in name or member; live timer and running amount; Stop & bill with discount, payment method (Cash / UPI / Card / On account) and a printable receipt. |
| **Sessions** | all | Billed history per month, table or player, with totals. Admins can delete wrong entries. |
| **Accounts** | all | Members (regulars). Play "on account", see the ledger, record payments, see balances due. |
| **Month End** | admin | Revenue, expenses, net profit, cash collected, daily chart, payment-method split, per-table figures, member dues. Add expenses. **Close month** locks that month's sessions, payments and expenses (Reopen undoes it). Export CSV / print. |
| **Admin** | admin | 6-month trend, months waiting to close, tables & hourly rates, staff logins & roles, billing rules (round up to N minutes, minimum charge), currency and business name. |

### Billing rule
`billed minutes = max(ceil(played minutes / round_to) × round_to, minimum minutes)`,
`amount = rate per hour × billed minutes / 60`. The server calculates it when you stop, using the rate the table had when the session started.

## MySQL (e.g. XAMPP)
1. Create a database `veloura_billiards`.
2. In `backend/config.php` set `'driver' => 'mysql'` and your credentials (or set the env vars `VB_DB_DRIVER=mysql`, `VB_DB_HOST`, `VB_DB_NAME`, `VB_DB_USER`, `VB_DB_PASS`).
3. Tables and seed data are created automatically on the first API call.

## Deploy (billiards.veloura.in)
```bash
bash build-release.sh
```
This builds Angular and assembles `release/`:

```
release/
  public/   ← set the domain's document root here (index.php, .htaccess, Angular app)
  src/  database/  data/  config.php  config.local.example.php
```

1. Upload the contents of `release/` to the server (needs **PHP 8.1+** with `pdo_sqlite` or `pdo_mysql`, Apache with `mod_rewrite`, or nginx routing all paths to `public/index.php`).
2. Point the document root of `billiards.veloura.in` at `release/public` and enable HTTPS.
3. Using MySQL? Copy `config.local.example.php` to `config.local.php` on the server and fill in the credentials (that file is git-ignored). With SQLite, just make `data/` writable by PHP.
4. Add a DNS record for `billiards` (A record to the server IP, or CNAME to the host) at your domain registrar.
5. Open the site, sign in as `admin / admin123` and **change both default passwords immediately** in Admin → Staff.

Time zone (used for month boundaries) is set in `backend/config.php` (`Asia/Kolkata` by default).
