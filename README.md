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
| **Book online** (`/book`, public) | customers | Pick a game (pool, snooker, carom, PS5, racing sim), day, duration and a free start time; get a booking code. `/book/manage` lets them view or cancel with code + phone. No payment online. |
| **Bookings** | all | Day timeline per table (click an empty spot to add a phone booking), list view and upcoming view. Confirm, seat (starts the timer), mark no-show or cancel. A badge shows requests waiting for confirmation. |
| **Sessions** | all | Billed history per month, table or player, with totals. Admins can delete wrong entries. |
| **Accounts** | all | Members (regulars). Play "on account", see the ledger, record payments, see balances due. |
| **Month End** | admin | Revenue, expenses, net profit, cash collected, daily chart, payment-method split, per-table figures, member dues. Add expenses. **Close month** locks that month's sessions, payments and expenses (Reopen undoes it). Export CSV / print. |
| **Admin** | admin | 6-month trend, months waiting to close, tables & hourly rates, staff logins & roles, billing rules (round up to N minutes, minimum charge), currency and business name, online booking rules (on/off, auto-confirm, opening hours, slot length, days ahead, minimum notice). |

### Billing rule
`billed minutes = max(ceil(played minutes / round_to) × round_to, minimum minutes)`,
`amount = rate per hour × billed minutes / 60`. The server calculates it when you stop, using the rate the table had when the session started.

## MySQL (e.g. XAMPP)
1. Create a database `veloura_billiards`.
2. In `backend/config.php` set `'driver' => 'mysql'` and your credentials (or set the env vars `VB_DB_DRIVER=mysql`, `VB_DB_HOST`, `VB_DB_NAME`, `VB_DB_USER`, `VB_DB_PASS`).
3. Tables and seed data are created automatically on the first API call.

## Deploy (billiards.velouraone.in on Hostinger)
```bash
bash build-release.sh
```
This builds Angular and assembles `release/` (also attached to every GitHub Actions run):

```
release/
  .htaccess  ← serves everything from public/ and blocks config, src/, database/, data/
  public/    ← index.php, Angular app
  src/  database/  data/  config.php  config.local.example.php
```

1. Upload the **contents** of `release/` into the subdomain's folder in hPanel → File Manager, so `.htaccess`, `public/`, `src/`… sit directly inside it. The root `.htaccess` makes this work with Hostinger's default document root; you don't need to change it.
2. Requirements: **PHP 8.1+** (hPanel → Advanced → PHP Configuration) with `pdo_sqlite` or `pdo_mysql`.
3. SQLite (default): `data/` must be writable by PHP. MySQL: copy `config.local.example.php` to `config.local.php` on the server and fill in the database created in hPanel (that file is git-ignored).
4. Open https://billiards.velouraone.in, sign in as `admin / admin123` and **change both default passwords immediately** in Admin → Staff.

## Continuous deployment (GitHub Actions)

`.github/workflows/ci-cd.yml` runs on every push and pull request:

1. **Build & test:** lints all PHP, runs `build-release.sh`, then `.github/scripts/smoke-test.sh` against the built release (app pages, sign-in, timers and billing, member accounts, month end, staff/admin roles). The ready-to-upload `release/` is attached to the run as an artifact.
2. **Deploy** (pushes to `main` only): uploads `release/` to Hostinger over FTPS. Only changed files are sent, and the live database (`data/*.sqlite`) and `config.local.php` are never touched.

Deployment stays off until you add these in GitHub → **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `FTP_SERVER` | FTP host from hPanel → Files → FTP Accounts (an IP or `ftp.velouraone.in`) |
| Secret | `FTP_USERNAME` | FTP username from the same page |
| Secret | `FTP_PASSWORD` | its password |
| Variable | `FTP_SERVER_DIR` | the subdomain folder as seen by that FTP account, ending in `/` (e.g. `domains/velouraone.in/public_html/billiards/`, or `./` for an FTP account rooted there) |
| Variable (optional) | `FTP_PROTOCOL` | `ftps` (default) or `ftp` |

**Fresh reinstall:** GitHub → Actions → **CI / Deploy** → **Run workflow** → tick **clean_slate**. This deletes everything in `FTP_SERVER_DIR` (including `data/`, the live SQLite database) before uploading. Normal pushes never delete anything.

Time zone (used for month boundaries) is set in `backend/config.php` (`Asia/Kolkata` by default).
