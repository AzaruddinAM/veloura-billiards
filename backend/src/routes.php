<?php
declare(strict_types=1);

/** Registers every API endpoint. All paths are relative to /api. */
function register_routes(Router $r, array $config): void
{
    $tableRow = function (array $t): array {
        return ['id' => (int) $t['id'], 'name' => $t['name'], 'type' => $t['type'],
            'rate_per_hour' => (float) $t['rate_per_hour'], 'sort_order' => (int) $t['sort_order'],
            'active' => (bool) $t['active']];
    };
    $sessionRow = function (array $s): array {
        foreach (['id', 'table_id', 'players', 'start_ts'] as $k) $s[$k] = (int) $s[$k];
        foreach (['member_id', 'end_ts', 'billed_minutes', 'started_by', 'stopped_by'] as $k) $s[$k] = $s[$k] === null ? null : (int) $s[$k];
        foreach (['rate_per_hour', 'discount'] as $k) $s[$k] = (float) $s[$k];
        foreach (['amount', 'total'] as $k) $s[$k] = $s[$k] === null ? null : (float) $s[$k];
        return $s;
    };
    $findSession = function (int $id) use ($sessionRow): array {
        $s = Db::one('SELECT s.*, t.name table_name, m.name member_name FROM sessions s
            JOIN pool_tables t ON t.id = s.table_id LEFT JOIN members m ON m.id = s.member_id WHERE s.id = ?', [$id]);
        if (!$s) throw new HttpError(404, 'Session not found');
        return $sessionRow($s);
    };

    // ---------- Auth ----------
    $r->add('POST', '/auth/login', fn() => Auth::login((string) required('username'), (string) required('password'), $config['token_ttl_hours']));
    $r->add('GET', '/auth/me', fn() => ['user' => Auth::user(), 'server_time' => time()]);
    $r->add('POST', '/auth/logout', function () { Auth::logout(); return ['ok' => true]; });

    // ---------- Settings ----------
    $r->add('GET', '/settings', function () { Auth::user(); return Settings::all(); });
    $r->add('PUT', '/settings', function () { Auth::admin(); return Settings::save(body()); });

    // ---------- Floor (tables + live sessions) ----------
    $r->add('GET', '/floor', function () use ($tableRow, $sessionRow) {
        Auth::user();
        $tables = array_map($tableRow, Db::all('SELECT * FROM pool_tables WHERE active = 1 ORDER BY sort_order, id'));
        $live = [];
        foreach (Db::all('SELECT s.*, m.name member_name FROM sessions s LEFT JOIN members m ON m.id = s.member_id WHERE s.end_ts IS NULL') as $s) {
            $live[(int) $s['table_id']] = $sessionRow($s);
        }
        [$dayStart] = [mktime(0, 0, 0)];
        $today = Db::one('SELECT COUNT(*) c, COALESCE(SUM(total),0) revenue, COALESCE(SUM(billed_minutes),0) minutes FROM sessions WHERE end_ts >= ?', [$dayStart]);
        return [
            'server_time' => time(),
            'settings' => Settings::all(),
            'tables' => array_map(fn($t) => [...$t, 'session' => $live[$t['id']] ?? null], $tables),
            'today' => ['sessions' => (int) $today['c'], 'revenue' => round((float) $today['revenue'], 2), 'minutes' => (int) $today['minutes']],
        ];
    });

    $r->add('POST', '/tables/{id}/start', function ($p) use ($findSession) {
        $u = Auth::user();
        $t = Db::one('SELECT * FROM pool_tables WHERE id = ? AND active = 1', [(int) $p['id']]);
        if (!$t) throw new HttpError(404, 'Table not found');
        if (Db::scalar('SELECT id FROM sessions WHERE table_id = ? AND end_ts IS NULL', [$t['id']])) {
            throw new HttpError(409, "{$t['name']} is already running");
        }
        $memberId = input('member_id') ? (int) input('member_id') : null;
        if ($memberId && !Db::scalar('SELECT id FROM members WHERE id = ? AND active = 1', [$memberId])) {
            throw new HttpError(422, 'Member not found');
        }
        $name = trim((string) input('customer_name', '')) ?: null;
        if (!$name && $memberId) $name = Db::scalar('SELECT name FROM members WHERE id = ?', [$memberId]);
        $id = Db::insert('INSERT INTO sessions (table_id, member_id, customer_name, players, start_ts, rate_per_hour, discount, notes, started_by)
            VALUES (?,?,?,?,?,?,0,?,?)',
            [$t['id'], $memberId, $name ?: 'Walk-in', max(1, (int) input('players', 2)), time(), $t['rate_per_hour'], input('notes'), $u['id']]);
        return $findSession($id);
    });

    // Preview the bill for a running session without stopping it.
    $r->add('GET', '/sessions/{id}/quote', function ($p) use ($findSession) {
        Auth::user();
        $s = $findSession((int) $p['id']);
        $end = $s['end_ts'] ?? time();
        return [...Billing::compute($s['start_ts'], $end, $s['rate_per_hour'], Settings::all()), 'end_ts' => $end];
    });

    $r->add('POST', '/sessions/{id}/stop', function ($p) use ($findSession) {
        $u = Auth::user();
        $s = $findSession((int) $p['id']);
        if ($s['end_ts'] !== null) throw new HttpError(409, 'Session already stopped');
        $end = time();
        $period = period_of($end);
        Closing::assertOpen($period);
        $method = (string) input('payment_method', 'cash');
        if (!in_array($method, ['cash', 'card', 'upi', 'account'], true)) throw new HttpError(422, 'Invalid payment method');
        $memberId = input('member_id') ? (int) input('member_id') : $s['member_id'];
        if ($method === 'account' && !$memberId) throw new HttpError(422, 'Choose a member account to charge');
        $bill = Billing::compute($s['start_ts'], $end, $s['rate_per_hour'], Settings::all());
        $discount = min(money(input('discount', 0)), $bill['amount']);
        Db::run('UPDATE sessions SET end_ts=?, billed_minutes=?, amount=?, discount=?, total=?, payment_method=?, member_id=?, period=?, notes=COALESCE(?, notes), stopped_by=? WHERE id=?',
            [$end, $bill['billed_minutes'], $bill['amount'], $discount, round($bill['amount'] - $discount, 2), $method, $memberId, $period, input('notes'), $u['id'], $s['id']]);
        return $findSession($s['id']);
    });

    $r->add('POST', '/sessions/{id}/cancel', function ($p) use ($findSession) {
        Auth::user();
        $s = $findSession((int) $p['id']);
        if ($s['end_ts'] !== null) throw new HttpError(409, 'Only running sessions can be cancelled');
        if (time() - $s['start_ts'] > 180) Auth::admin(); // staff can cancel only within 3 minutes
        Db::run('DELETE FROM sessions WHERE id = ?', [$s['id']]);
        return ['ok' => true];
    });

    $r->add('GET', '/sessions', function () use ($sessionRow) {
        Auth::user();
        $where = ['s.end_ts IS NOT NULL'];
        $args = [];
        if ($period = query('period')) {
            [$from, $to] = period_bounds(valid_period($period));
            $where[] = 's.end_ts >= ? AND s.end_ts < ?';
            array_push($args, $from, $to);
        }
        if ($t = query('table_id')) { $where[] = 's.table_id = ?'; $args[] = (int) $t; }
        if ($m = query('member_id')) { $where[] = 's.member_id = ?'; $args[] = (int) $m; }
        if ($q = query('q')) { $where[] = 's.customer_name LIKE ?'; $args[] = "%$q%"; }
        $limit = min(1000, max(1, (int) query('limit', 300)));
        $rows = Db::all('SELECT s.*, t.name table_name, m.name member_name FROM sessions s
            JOIN pool_tables t ON t.id = s.table_id LEFT JOIN members m ON m.id = s.member_id
            WHERE ' . implode(' AND ', $where) . " ORDER BY s.end_ts DESC LIMIT $limit", $args);
        return array_map($sessionRow, $rows);
    });

    $r->add('DELETE', '/sessions/{id}', function ($p) use ($findSession) {
        Auth::admin();
        $s = $findSession((int) $p['id']);
        if ($s['period']) Closing::assertOpen($s['period']);
        Db::run('DELETE FROM sessions WHERE id = ?', [$s['id']]);
        return ['ok' => true];
    });

    // ---------- Members (customer accounts) ----------
    $r->add('GET', '/members', function () {
        Auth::user();
        $balances = [];
        foreach (Reports::memberBalances() as $b) $balances[$b['id']] = $b;
        return array_map(fn($m) => [
            'id' => (int) $m['id'], 'name' => $m['name'], 'phone' => $m['phone'], 'email' => $m['email'],
            'notes' => $m['notes'], 'active' => (bool) $m['active'], 'created_at' => (int) $m['created_at'],
            'charges' => $balances[$m['id']]['charges'] ?? 0, 'payments' => $balances[$m['id']]['payments'] ?? 0,
            'balance' => $balances[$m['id']]['balance'] ?? 0,
        ], Db::all('SELECT * FROM members ORDER BY active DESC, name'));
    });
    $r->add('POST', '/members', function () {
        Auth::user();
        $id = Db::insert('INSERT INTO members (name, phone, email, notes, active, created_at) VALUES (?,?,?,?,1,?)',
            [required('name'), input('phone'), input('email'), input('notes'), time()]);
        return ['id' => $id];
    });
    $r->add('PUT', '/members/{id}', function ($p) {
        Auth::user();
        Db::run('UPDATE members SET name=?, phone=?, email=?, notes=?, active=? WHERE id=?',
            [required('name'), input('phone'), input('email'), input('notes'), input('active', true) ? 1 : 0, (int) $p['id']]);
        return ['ok' => true];
    });
    $r->add('GET', '/members/{id}/ledger', function ($p) {
        Auth::user();
        $id = (int) $p['id'];
        $m = Db::one('SELECT * FROM members WHERE id = ?', [$id]);
        if (!$m) throw new HttpError(404, 'Member not found');
        $entries = [];
        foreach (Db::all("SELECT s.id, s.end_ts ts, s.total, s.billed_minutes, t.name table_name FROM sessions s JOIN pool_tables t ON t.id = s.table_id WHERE s.member_id = ? AND s.payment_method = 'account' AND s.end_ts IS NOT NULL", [$id]) as $s) {
            $entries[] = ['type' => 'charge', 'ref' => (int) $s['id'], 'ts' => (int) $s['ts'], 'amount' => (float) $s['total'],
                'description' => "{$s['table_name']} · {$s['billed_minutes']} min"];
        }
        foreach (Db::all('SELECT * FROM payments WHERE member_id = ?', [$id]) as $pmt) {
            $entries[] = ['type' => 'payment', 'ref' => (int) $pmt['id'], 'ts' => (int) $pmt['ts'], 'amount' => (float) $pmt['amount'],
                'description' => 'Payment · ' . strtoupper($pmt['method']) . ($pmt['note'] ? " · {$pmt['note']}" : '')];
        }
        usort($entries, fn($a, $b) => $a['ts'] <=> $b['ts']);
        $bal = 0.0;
        foreach ($entries as &$e) {
            $bal += $e['type'] === 'charge' ? $e['amount'] : -$e['amount'];
            $e['balance'] = round($bal, 2);
        }
        return ['member' => ['id' => $id, 'name' => $m['name'], 'phone' => $m['phone']], 'entries' => array_reverse($entries), 'balance' => round($bal, 2)];
    });
    $r->add('POST', '/members/{id}/payments', function ($p) {
        $u = Auth::user();
        $ts = time();
        Closing::assertOpen(period_of($ts));
        $amount = money(required('amount'));
        if ($amount <= 0) throw new HttpError(422, 'Amount must be greater than zero');
        $id = Db::insert('INSERT INTO payments (member_id, amount, method, ts, period, note, created_by) VALUES (?,?,?,?,?,?,?)',
            [(int) $p['id'], $amount, input('method', 'cash'), $ts, period_of($ts), input('note'), $u['id']]);
        return ['id' => $id];
    });

    // ---------- Expenses ----------
    $r->add('GET', '/expenses', function () {
        Auth::admin();
        return Db::all('SELECT * FROM expenses WHERE period = ? ORDER BY ts DESC', [valid_period(query('period'))]);
    });
    $r->add('POST', '/expenses', function () {
        $u = Auth::admin();
        $date = (string) input('date', date('Y-m-d'));
        $ts = strtotime($date . ' 12:00:00');
        if (!$ts) throw new HttpError(422, 'Invalid date');
        Closing::assertOpen(period_of($ts));
        $id = Db::insert('INSERT INTO expenses (ts, period, category, amount, note, created_by) VALUES (?,?,?,?,?,?)',
            [$ts, period_of($ts), required('category'), money(required('amount')), input('note'), $u['id']]);
        return ['id' => $id];
    });
    $r->add('DELETE', '/expenses/{id}', function ($p) {
        Auth::admin();
        $e = Db::one('SELECT * FROM expenses WHERE id = ?', [(int) $p['id']]);
        if (!$e) throw new HttpError(404, 'Expense not found');
        Closing::assertOpen($e['period']);
        Db::run('DELETE FROM expenses WHERE id = ?', [$e['id']]);
        return ['ok' => true];
    });

    // ---------- Month end ----------
    $r->add('GET', '/reports/month', function () { Auth::admin(); return Reports::month(valid_period(query('period'))); });
    $r->add('GET', '/reports/closings', function () {
        Auth::admin();
        return array_map(fn($c) => [
            'period' => $c['period'], 'revenue' => (float) $c['revenue'], 'expenses' => (float) $c['expenses'],
            'net' => (float) $c['net'], 'sessions_count' => (int) $c['sessions_count'], 'minutes' => (int) $c['minutes'],
            'closed_at' => (int) $c['closed_at'], 'closed_by' => $c['closed_by_name'],
        ], Db::all('SELECT c.*, u.name closed_by_name FROM month_closings c LEFT JOIN users u ON u.id = c.closed_by ORDER BY c.period DESC'));
    });
    $r->add('POST', '/reports/month/close', function () {
        $u = Auth::admin();
        $period = valid_period((string) required('period'));
        [, $to] = period_bounds($period);
        if ($to > time()) throw new HttpError(409, 'A month can be closed only after it has ended');
        if (Closing::isClosed($period)) throw new HttpError(409, "$period is already closed");
        if (Db::scalar('SELECT COUNT(*) FROM sessions WHERE end_ts IS NULL AND start_ts < ?', [$to])) {
            throw new HttpError(409, 'Stop all tables started in this month before closing it');
        }
        $rep = Reports::month($period);
        Db::run('INSERT INTO month_closings (period, revenue, expenses, net, sessions_count, minutes, snapshot, closed_at, closed_by) VALUES (?,?,?,?,?,?,?,?,?)',
            [$period, $rep['revenue'], $rep['expenses_total'], $rep['net'], $rep['sessions_count'], $rep['minutes'], json_encode($rep), time(), $u['id']]);
        return Reports::month($period);
    });
    $r->add('POST', '/reports/month/reopen', function () {
        Auth::admin();
        Db::run('DELETE FROM month_closings WHERE period = ?', [valid_period((string) required('period'))]);
        return ['ok' => true];
    });

    // ---------- Admin: tables ----------
    $r->add('GET', '/admin/tables', function () use ($tableRow) {
        Auth::admin();
        return array_map($tableRow, Db::all('SELECT * FROM pool_tables ORDER BY sort_order, id'));
    });
    $r->add('POST', '/admin/tables', function () {
        Auth::admin();
        $type = (string) input('type', 'pool');
        if (!in_array($type, TABLE_TYPES, true)) throw new HttpError(422, 'Invalid table type');
        $id = Db::insert('INSERT INTO pool_tables (name, type, rate_per_hour, sort_order, active) VALUES (?,?,?,?,1)',
            [required('name'), $type, money(required('rate_per_hour')), (int) input('sort_order', 99)]);
        return ['id' => $id];
    });
    $r->add('PUT', '/admin/tables/{id}', function ($p) {
        Auth::admin();
        $type = (string) input('type', 'pool');
        if (!in_array($type, TABLE_TYPES, true)) throw new HttpError(422, 'Invalid table type');
        Db::run('UPDATE pool_tables SET name=?, type=?, rate_per_hour=?, sort_order=?, active=? WHERE id=?',
            [required('name'), $type, money(required('rate_per_hour')), (int) input('sort_order', 0), input('active', true) ? 1 : 0, (int) $p['id']]);
        return ['ok' => true];
    });
    $r->add('DELETE', '/admin/tables/{id}', function ($p) {
        Auth::admin();
        $id = (int) $p['id'];
        if (Db::scalar('SELECT COUNT(*) FROM sessions WHERE table_id = ?', [$id])) {
            Db::run('UPDATE pool_tables SET active = 0 WHERE id = ?', [$id]);
            return ['ok' => true, 'archived' => true];
        }
        Db::run('DELETE FROM pool_tables WHERE id = ?', [$id]);
        return ['ok' => true];
    });

    // ---------- Admin: users ----------
    $r->add('GET', '/admin/users', function () {
        Auth::admin();
        return array_map([Auth::class, 'publicUser'], Db::all('SELECT * FROM users ORDER BY role, name'));
    });
    $r->add('POST', '/admin/users', function () {
        Auth::admin();
        $username = strtolower((string) required('username'));
        if (Db::scalar('SELECT id FROM users WHERE username = ?', [$username])) throw new HttpError(409, 'Username already taken');
        $pw = (string) required('password');
        if (strlen($pw) < 6) throw new HttpError(422, 'Password must be at least 6 characters');
        $role = input('role') === 'admin' ? 'admin' : 'staff';
        return ['id' => Db::insert('INSERT INTO users (name, username, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)',
            [required('name'), $username, password_hash($pw, PASSWORD_DEFAULT), $role, time()])];
    });
    $r->add('PUT', '/admin/users/{id}', function ($p) {
        $me = Auth::admin();
        $id = (int) $p['id'];
        $role = input('role') === 'admin' ? 'admin' : 'staff';
        $active = input('active', true) ? 1 : 0;
        if ($id === $me['id'] && ($role !== 'admin' || !$active)) throw new HttpError(409, 'You cannot demote or disable yourself');
        Db::run('UPDATE users SET name=?, role=?, active=? WHERE id=?', [required('name'), $role, $active, $id]);
        if ($pw = input('password')) {
            if (strlen((string) $pw) < 6) throw new HttpError(422, 'Password must be at least 6 characters');
            Db::run('UPDATE users SET password_hash=? WHERE id=?', [password_hash((string) $pw, PASSWORD_DEFAULT), $id]);
        }
        if (!$active) Db::run('DELETE FROM auth_tokens WHERE user_id = ?', [$id]);
        return ['ok' => true];
    });

    // ---------- Admin: dashboard ----------
    $r->add('GET', '/admin/overview', function () {
        Auth::admin();
        $period = date('Y-m');
        $rep = Reports::month($period);
        $trend = [];
        for ($i = 5; $i >= 0; $i--) {
            $p = date('Y-m', strtotime("first day of -$i month"));
            [$f, $t] = period_bounds($p);
            $rev = (float) Db::scalar('SELECT COALESCE(SUM(total),0) FROM sessions WHERE end_ts >= ? AND end_ts < ?', [$f, $t]);
            $exp = (float) Db::scalar('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE period = ?', [$p]);
            $trend[] = ['period' => $p, 'revenue' => round($rev, 2), 'expenses' => round($exp, 2)];
        }
        return [
            'month' => $rep,
            'trend' => $trend,
            'running' => (int) Db::scalar('SELECT COUNT(*) FROM sessions WHERE end_ts IS NULL'),
            'members' => (int) Db::scalar('SELECT COUNT(*) FROM members WHERE active = 1'),
            'outstanding_total' => round(array_sum(array_map(fn($m) => max(0, $m['balance']), Reports::memberBalances())), 2),
            'open_months' => array_map(fn($x) => $x['p'], Db::all(
                "SELECT DISTINCT period p FROM sessions WHERE period IS NOT NULL AND period < ? AND period NOT IN (SELECT period FROM month_closings) ORDER BY p", [$period])),
        ];
    });
}
