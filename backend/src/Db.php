<?php
declare(strict_types=1);

final class Db
{
    private static ?PDO $pdo = null;
    private static array $config = [];

    public static function init(array $config): void
    {
        self::$config = $config;
    }

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;
        $c = self::$config;
        if ($c['driver'] === 'mysql') {
            $m = $c['mysql'];
            $dsn = "mysql:host={$m['host']};port={$m['port']};dbname={$m['database']};charset=utf8mb4";
            $pdo = new PDO($dsn, $m['username'], $m['password']);
        } else {
            $dir = dirname($c['sqlite']);
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            $pdo = new PDO('sqlite:' . $c['sqlite']);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA journal_mode = WAL');
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        self::$pdo = $pdo;
        self::migrate();
        return $pdo;
    }

    public static function driver(): string
    {
        return self::$config['driver'];
    }

    private static function migrate(): void
    {
        $pdo = self::$pdo;
        $exists = self::driver() === 'mysql'
            ? $pdo->query("SHOW TABLES LIKE 'settings'")->fetch()
            : $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")->fetch();
        if (!$exists) self::install();
        self::upgrade();
    }

    /** Data upgrades for existing databases, tracked by the schema_version setting. */
    private static function upgrade(): void
    {
        $version = (int) (self::scalar("SELECT v FROM settings WHERE k = 'schema_version'") ?? 1);
        if ($version < 2) {
            // v2: gaming stations — two PS5 bays and a racing simulator.
            $order = (int) self::scalar('SELECT COALESCE(MAX(sort_order), 0) FROM pool_tables');
            foreach ([['PS5 Bay 1', 'ps5', 150], ['PS5 Bay 2', 'ps5', 150], ['Racing Simulator', 'simulator', 400]] as $i => [$name, $type, $rate]) {
                self::run('INSERT INTO pool_tables (name, type, rate_per_hour, sort_order, active) VALUES (?,?,?,?,1)',
                    [$name, $type, $rate, $order + $i + 1]);
            }
            self::run("DELETE FROM settings WHERE k = 'schema_version'");
            self::run("INSERT INTO settings (k, v) VALUES ('schema_version', '2')");
        }
    }

    private static function install(): void
    {
        $pdo = self::$pdo;
        $file = __DIR__ . '/../database/schema.' . (self::driver() === 'mysql' ? 'mysql' : 'sqlite') . '.sql';
        $sql = file_get_contents($file);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            $pdo->exec($stmt);
        }
        self::seed();
    }

    private static function seed(): void
    {
        $now = time();
        $users = [
            ['Administrator', 'admin', 'admin123', 'admin'],
            ['Front Desk', 'staff', 'staff123', 'staff'],
        ];
        foreach ($users as [$name, $u, $p, $role]) {
            self::run('INSERT INTO users (name, username, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)',
                [$name, $u, password_hash($p, PASSWORD_DEFAULT), $role, $now]);
        }
        $tables = [
            ['Emerald 1', 'pool', 200], ['Emerald 2', 'pool', 200], ['Emerald 3', 'pool', 200],
            ['Royal Snooker', 'snooker', 350], ['Crown Snooker', 'snooker', 350], ['Carom Lounge', 'carom', 250],
        ];
        foreach ($tables as $i => [$name, $type, $rate]) {
            self::run('INSERT INTO pool_tables (name, type, rate_per_hour, sort_order, active) VALUES (?,?,?,?,1)',
                [$name, $type, $rate, $i + 1]);
        }
        $settings = [
            'business_name' => 'Veloura Billiards',
            'currency' => '₹',
            'round_to_minutes' => '1',
            'min_minutes' => '15',
            'address' => '',
            'phone' => '',
        ];
        foreach ($settings as $k => $v) self::run('INSERT INTO settings (k, v) VALUES (?,?)', [$k, $v]);
    }

    public static function run(string $sql, array $params = []): PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st;
    }

    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function scalar(string $sql, array $params = []): mixed
    {
        $v = self::run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::run($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }
}
