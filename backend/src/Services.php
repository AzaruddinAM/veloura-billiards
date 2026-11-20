<?php
declare(strict_types=1);

final class Auth
{
    private static ?array $user = null;

    public static function login(string $username, string $password, int $ttlHours): array
    {
        $u = Db::one('SELECT * FROM users WHERE username = ? AND active = 1', [$username]);
        if (!$u || !password_verify($password, $u['password_hash'])) {
            throw new HttpError(401, 'Invalid username or password');
        }
        Db::run('DELETE FROM auth_tokens WHERE expires_at < ?', [time()]);
        $token = bin2hex(random_bytes(32));
        Db::run('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?,?,?)',
            [$token, $u['id'], time() + $ttlHours * 3600]);
        return ['token' => $token, 'user' => self::publicUser($u)];
    }

    public static function token(): ?string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!$h && function_exists('getallheaders')) {
            foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'Authorization') === 0) $h = $v;
        }
        return preg_match('/Bearer\s+([a-f0-9]{64})/i', $h, $m) ? $m[1] : null;
    }

    public static function user(): array
    {
        if (self::$user) return self::$user;
        $t = self::token();
        $u = $t ? Db::one(
            'SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? AND t.expires_at > ? AND u.active = 1',
            [$t, time()]
        ) : null;
        if (!$u) throw new HttpError(401, 'Please sign in');
        return self::$user = self::publicUser($u);
    }

    public static function admin(): array
    {
        $u = self::user();
        if ($u['role'] !== 'admin') throw new HttpError(403, 'Admin access required');
        return $u;
    }

    public static function logout(): void
    {
        if ($t = self::token()) Db::run('DELETE FROM auth_tokens WHERE token = ?', [$t]);
    }

    public static function publicUser(array $u): array
    {
        return ['id' => (int) $u['id'], 'name' => $u['name'], 'username' => $u['username'],
            'role' => $u['role'], 'active' => (bool) $u['active']];
    }
}

final class Settings
{
    public static function all(): array
    {
        $out = [];
        foreach (Db::all('SELECT k, v FROM settings') as $r) $out[$r['k']] = $r['v'];
        $out['round_to_minutes'] = max(1, (int) ($out['round_to_minutes'] ?? 1));
        $out['min_minutes'] = max(0, (int) ($out['min_minutes'] ?? 0));
        return $out;
    }

    public static function save(array $data): array
    {
        $allowed = ['business_name', 'currency', 'round_to_minutes', 'min_minutes', 'address', 'phone'];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $data)) continue;
            Db::run('DELETE FROM settings WHERE k = ?', [$k]);
            Db::run('INSERT INTO settings (k, v) VALUES (?, ?)', [$k, (string) $data[$k]]);
        }
        return self::all();
    }
}

final class Billing
{
    /** @return array{minutes:int, billed_minutes:int, amount:float} */
    public static function compute(int $start, int $end, float $rate, array $settings): array
    {
        $seconds = max(0, $end - $start);
        $minutes = (int) ceil($seconds / 60);
        $round = $settings['round_to_minutes'];
        $billed = (int) (ceil($minutes / $round) * $round);
        $billed = max($billed, $settings['min_minutes']);
        return ['minutes' => $minutes, 'billed_minutes' => $billed, 'amount' => round($rate * $billed / 60, 2)];
    }
}

final class Closing
{
    public static function isClosed(string $period): bool
    {
        return (bool) Db::scalar('SELECT 1 FROM month_closings WHERE period = ?', [$period]);
    }

    public static function assertOpen(string $period): void
    {
        if (self::isClosed($period)) {
            throw new HttpError(409, "Month $period is closed. Reopen it from Month End to make changes.");
        }
    }
}

final class Reports
{
    public static function memberBalances(?int $untilTs = null): array
    {
        $untilTs ??= PHP_INT_MAX;
        $rows = Db::all('SELECT id, name, phone FROM members ORDER BY name');
        $charges = [];
        foreach (Db::all("SELECT member_id, SUM(total) s FROM sessions WHERE payment_method = 'account' AND end_ts IS NOT NULL AND end_ts < ? GROUP BY member_id", [$untilTs]) as $r) {
            $charges[$r['member_id']] = (float) $r['s'];
        }
        $paid = [];
        foreach (Db::all('SELECT member_id, SUM(amount) s FROM payments WHERE ts < ? GROUP BY member_id', [$untilTs]) as $r) {
            $paid[$r['member_id']] = (float) $r['s'];
        }
        return array_map(fn($m) => [
            'id' => (int) $m['id'], 'name' => $m['name'], 'phone' => $m['phone'],
            'charges' => round($charges[$m['id']] ?? 0, 2),
            'payments' => round($paid[$m['id']] ?? 0, 2),
            'balance' => round(($charges[$m['id']] ?? 0) - ($paid[$m['id']] ?? 0), 2),
        ], $rows);
    }

    public static function month(string $period): array
    {
        [$from, $to] = period_bounds($period);
        $sessions = Db::all(
            'SELECT s.*, t.name table_name FROM sessions s JOIN pool_tables t ON t.id = s.table_id
             WHERE s.end_ts IS NOT NULL AND s.end_ts >= ? AND s.end_ts < ? ORDER BY s.end_ts',
            [$from, $to]
        );

        $revenue = $gross = $discounts = 0.0;
        $minutes = 0;
        $byMethod = ['cash' => 0.0, 'card' => 0.0, 'upi' => 0.0, 'account' => 0.0];
        $byTable = [];
        $daily = [];
        $days = (int) date('t', $from);
        for ($d = 1; $d <= $days; $d++) $daily[$d] = 0.0;

        foreach ($sessions as $s) {
            $total = (float) $s['total'];
            $revenue += $total;
            $gross += (float) $s['amount'];
            $discounts += (float) $s['discount'];
            $minutes += (int) $s['billed_minutes'];
            $method = $s['payment_method'] ?: 'cash';
            $byMethod[$method] = ($byMethod[$method] ?? 0) + $total;
            $key = $s['table_id'];
            $byTable[$key] ??= ['table_id' => (int) $key, 'name' => $s['table_name'], 'sessions' => 0, 'minutes' => 0, 'revenue' => 0.0];
            $byTable[$key]['sessions']++;
            $byTable[$key]['minutes'] += (int) $s['billed_minutes'];
            $byTable[$key]['revenue'] += $total;
            $daily[(int) date('j', (int) $s['end_ts'])] += $total;
        }

        $expenses = Db::all('SELECT * FROM expenses WHERE period = ? ORDER BY ts', [$period]);
        $expByCat = [];
        $expTotal = 0.0;
        foreach ($expenses as $e) {
            $expTotal += (float) $e['amount'];
            $expByCat[$e['category']] = ($expByCat[$e['category']] ?? 0) + (float) $e['amount'];
        }
        $accountPayments = (float) Db::scalar('SELECT COALESCE(SUM(amount),0) FROM payments WHERE period = ?', [$period]);
        $collected = $revenue - $byMethod['account'] + $accountPayments;
        $closing = Db::one('SELECT period, closed_at, closed_by FROM month_closings WHERE period = ?', [$period]);

        $r2 = fn($v) => round((float) $v, 2);
        return [
            'period' => $period,
            'closed' => (bool) $closing,
            'closed_at' => $closing ? (int) $closing['closed_at'] : null,
            'can_close' => $to <= time() && !$closing,
            'sessions_count' => count($sessions),
            'minutes' => $minutes,
            'gross' => $r2($gross),
            'discounts' => $r2($discounts),
            'revenue' => $r2($revenue),
            'by_method' => array_map($r2, $byMethod),
            'account_payments' => $r2($accountPayments),
            'collected' => $r2($collected),
            'expenses_total' => $r2($expTotal),
            'expenses_by_category' => array_map($r2, $expByCat),
            'expenses' => $expenses,
            'net' => $r2($revenue - $expTotal),
            'by_table' => array_values(array_map(fn($t) => [...$t, 'revenue' => $r2($t['revenue'])], $byTable)),
            'daily' => array_values(array_map($r2, $daily)),
            'outstanding' => array_values(array_filter(self::memberBalances($to), fn($m) => abs($m['balance']) > 0.004)),
        ];
    }
}
