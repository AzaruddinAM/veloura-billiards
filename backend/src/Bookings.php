<?php
declare(strict_types=1);

/** Online & staff bookings: availability, validation, conflicts. All times are unix seconds. */
final class Bookings
{
    public const ACTIVE = ['pending', 'confirmed'];
    public const STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
    public const DURATIONS = [30, 60, 90, 120, 150, 180, 240];
    private const MAX_ACTIVE_PER_PHONE = 3;

    /** Opening window for a calendar day; closing at/before opening means "after midnight". */
    public static function window(string $date, array $s): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)) throw new HttpError(422, 'Date must be YYYY-MM-DD');
        $open = strtotime("$date {$s['open_time']}:00");
        $close = strtotime("$date {$s['close_time']}:00");
        if ($close <= $open) $close += 86400;
        return [$open, $close];
    }

    public static function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone);
        if (strlen($digits) < 7 || strlen($digits) > 15) throw new HttpError(422, 'Please enter a valid phone number');
        return $digits;
    }

    /** Key used to match a phone with or without country code: its last 10 digits. */
    public static function phoneKey(string $phone): string
    {
        return substr(self::normalizePhone($phone), -10);
    }

    /** Busy intervals per active table overlapping [from, to): bookings + currently running sessions. */
    public static function busy(int $from, int $to): array
    {
        $busy = [];
        $ph = implode(',', array_fill(0, count(self::ACTIVE), '?'));
        foreach (Db::all("SELECT table_id, start_ts, end_ts FROM bookings WHERE status IN ($ph) AND start_ts < ? AND end_ts > ?",
            [...self::ACTIVE, $to, $from]) as $b) {
            $busy[(int) $b['table_id']][] = [(int) $b['start_ts'], (int) $b['end_ts']];
        }
        // A table that is playing right now is assumed busy for at least another hour.
        $now = time();
        foreach (Db::all('SELECT table_id, start_ts FROM sessions WHERE end_ts IS NULL') as $s) {
            $busy[(int) $s['table_id']][] = [(int) $s['start_ts'], max($now + 3600, (int) $s['start_ts'] + 3600)];
        }
        return $busy;
    }

    public static function availability(string $date): array
    {
        $s = Settings::all();
        [$open, $close] = self::window($date, $s);
        $now = time();
        $tables = Db::all('SELECT id, name, type, rate_per_hour FROM pool_tables WHERE active = 1 ORDER BY sort_order, id');
        $busy = self::busy($open, $close);
        return [
            'date' => $date,
            'open_ts' => $open,
            'close_ts' => $close,
            'earliest_ts' => max($open, $now + $s['booking_min_notice'] * 60),
            'slot_minutes' => $s['slot_minutes'],
            'durations' => self::DURATIONS,
            'tables' => array_map(fn($t) => [
                'id' => (int) $t['id'], 'name' => $t['name'], 'type' => $t['type'], 'rate_per_hour' => (float) $t['rate_per_hour'],
                'busy' => $busy[(int) $t['id']] ?? [],
            ], $tables),
        ];
    }

    /** Validate and insert a booking. $staff = user array when created at the desk. */
    public static function create(array $in, ?array $staff = null): array
    {
        $s = Settings::all();
        if (!$staff && !$s['booking_enabled']) throw new HttpError(403, 'Online booking is currently closed. Please call us to book.');

        $table = Db::one('SELECT * FROM pool_tables WHERE id = ? AND active = 1', [(int) ($in['table_id'] ?? 0)]);
        if (!$table) throw new HttpError(422, 'Please choose a table');

        $name = trim((string) ($in['customer_name'] ?? ''));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) throw new HttpError(422, 'Please enter your name');
        $phone = self::normalizePhone((string) ($in['phone'] ?? ''));
        $email = trim((string) ($in['email'] ?? '')) ?: null;
        if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError(422, 'Please enter a valid email or leave it empty');
        $players = (int) ($in['players'] ?? 2);
        if ($players < 1 || $players > 12) throw new HttpError(422, 'Players must be between 1 and 12');
        $notes = mb_substr(trim((string) ($in['notes'] ?? '')), 0, 500) ?: null;

        $duration = (int) ($in['duration_minutes'] ?? 60);
        if (!in_array($duration, self::DURATIONS, true)) throw new HttpError(422, 'Please choose a valid duration');
        $date = (string) ($in['date'] ?? '');
        $time = (string) ($in['time'] ?? '');
        if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) throw new HttpError(422, 'Please choose a time');
        [$open, $close] = self::window($date, $s);
        $start = strtotime("$date $time:00");
        if ($start < $open) $start += 86400; // after-midnight slot of the same business day
        $end = $start + $duration * 60;

        if ($start < $open || $end > $close) throw new HttpError(422, "We're open {$s['open_time']}–{$s['close_time']}. Please pick a time inside opening hours.");
        if ((($start - $open) / 60) % $s['slot_minutes'] !== 0) throw new HttpError(422, 'Please pick one of the listed start times');
        $now = time();
        if (!$staff && $start < $now + $s['booking_min_notice'] * 60) throw new HttpError(422, "Bookings need at least {$s['booking_min_notice']} minutes' notice");
        if ($staff && $end <= $now) throw new HttpError(422, 'That time has already passed');
        if ($start > $now + $s['booking_max_days'] * 86400) throw new HttpError(422, "You can book up to {$s['booking_max_days']} days ahead");

        if (!$staff) {
            $ph = implode(',', array_fill(0, count(self::ACTIVE), '?'));
            $active = (int) Db::scalar("SELECT COUNT(*) FROM bookings WHERE SUBSTR(phone, -10) = ? AND status IN ($ph) AND end_ts > ?", [substr($phone, -10), ...self::ACTIVE, $now]);
            if ($active >= self::MAX_ACTIVE_PER_PHONE) throw new HttpError(429, 'You already have ' . self::MAX_ACTIVE_PER_PHONE . ' upcoming bookings. Please call us for more.');
        }

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            foreach (self::busy($start, $end)[(int) $table['id']] ?? [] as [$bs, $be]) {
                if ($bs < $end && $be > $start) throw new HttpError(409, "Sorry, {$table['name']} was just booked for that time. Please choose another slot.");
            }
            $code = self::newCode();
            $status = $staff || $s['booking_auto_confirm'] ? 'confirmed' : 'pending';
            $id = Db::insert('INSERT INTO bookings (code, table_id, customer_name, phone, email, players, start_ts, end_ts, status, notes, source, created_at, updated_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$code, $table['id'], $name, $phone, $email, $players, $start, $end, $status, $notes, $staff ? 'staff' : 'online', $now, $staff['id'] ?? null]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::find($id);
    }

    public static function find(int $id): array
    {
        $b = Db::one('SELECT b.*, t.name table_name, t.type table_type, t.rate_per_hour FROM bookings b JOIN pool_tables t ON t.id = b.table_id WHERE b.id = ?', [$id]);
        if (!$b) throw new HttpError(404, 'Booking not found');
        return self::row($b);
    }

    public static function row(array $b): array
    {
        foreach (['id', 'table_id', 'players', 'start_ts', 'end_ts', 'created_at'] as $k) if (isset($b[$k])) $b[$k] = (int) $b[$k];
        if (array_key_exists('session_id', $b)) $b['session_id'] = $b['session_id'] === null ? null : (int) $b['session_id'];
        $b['duration_minutes'] = intdiv($b['end_ts'] - $b['start_ts'], 60);
        if (isset($b['rate_per_hour'])) {
            $b['rate_per_hour'] = (float) $b['rate_per_hour'];
            $b['estimate'] = round($b['rate_per_hour'] * $b['duration_minutes'] / 60, 2);
        }
        return $b;
    }

    /** What a customer may see about their own booking (looked up by code + phone). */
    public static function publicRow(array $b): array
    {
        return array_intersect_key($b, array_flip([
            'code', 'table_name', 'table_type', 'customer_name', 'players', 'start_ts', 'end_ts', 'duration_minutes', 'status', 'estimate',
        ]));
    }

    private static function newCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
        do {
            $code = 'VB';
            for ($i = 0; $i < 6; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        } while (Db::scalar('SELECT 1 FROM bookings WHERE code = ?', [$code]));
        return $code;
    }
}
