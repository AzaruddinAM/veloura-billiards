<?php
declare(strict_types=1);

const TABLE_TYPES = ['pool', 'snooker', 'carom', 'ps5', 'simulator'];

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Router
{
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
        $this->routes[] = [$method, $regex, $handler];
    }

    public function dispatch(string $method, string $path): mixed
    {
        $allowed = false;
        foreach ($this->routes as [$m, $regex, $handler]) {
            if (!preg_match($regex, $path, $match)) continue;
            $allowed = true;
            if ($m !== $method) continue;
            $params = array_filter($match, 'is_string', ARRAY_FILTER_USE_KEY);
            return $handler($params);
        }
        throw new HttpError($allowed ? 405 : 404, $allowed ? 'Method not allowed' : 'Not found');
    }
}

function body(): array
{
    static $data = null;
    if ($data === null) {
        $raw = file_get_contents('php://input');
        $data = $raw ? (json_decode($raw, true) ?: []) : [];
    }
    return $data;
}

function input(string $key, mixed $default = null): mixed
{
    $b = body();
    return array_key_exists($key, $b) ? $b[$key] : $default;
}

function query(string $key, mixed $default = null): mixed
{
    return isset($_GET[$key]) && $_GET[$key] !== '' ? $_GET[$key] : $default;
}

function required(string $key): mixed
{
    $v = input($key);
    if ($v === null || (is_string($v) && trim($v) === '')) {
        throw new HttpError(422, "Field '$key' is required");
    }
    return is_string($v) ? trim($v) : $v;
}

function money(mixed $v): float
{
    if (!is_numeric($v) || (float) $v < 0) throw new HttpError(422, 'Amount must be a positive number');
    return round((float) $v, 2);
}

function period_of(int $ts): string
{
    return date('Y-m', $ts);
}

function valid_period(?string $p): string
{
    $p = $p ?: date('Y-m');
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $p)) throw new HttpError(422, 'Period must be YYYY-MM');
    return $p;
}

/** @return array{0:int,1:int} [start, endExclusive] unix timestamps in configured timezone */
function period_bounds(string $period): array
{
    [$y, $m] = array_map('intval', explode('-', $period));
    return [mktime(0, 0, 0, $m, 1, $y), mktime(0, 0, 0, $m + 1, 1, $y)];
}
