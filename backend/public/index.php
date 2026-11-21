<?php
declare(strict_types=1);

$config = require __DIR__ . '/../config.php';
date_default_timezone_set($config['timezone']);

// Never print PHP warnings into API responses (that would corrupt the JSON); log them instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require __DIR__ . '/../src/Http.php';
require __DIR__ . '/../src/Db.php';
require __DIR__ . '/../src/Services.php';
require __DIR__ . '/../src/Bookings.php';
require __DIR__ . '/../src/routes.php';

// When run with `php -S`, let the built-in server serve real static files (e.g. the built Angular app).
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (PHP_SAPI === 'cli-server' && !str_starts_with($uriPath, '/api') && is_file(__DIR__ . $uriPath)) {
    return false;
}

// Non-API requests fall through to the Angular app (build output copied into public/).
if (!preg_match('#/api(/.*)?$#', $uriPath, $m)) {
    $spa = __DIR__ . '/index.html';
    if (is_file($spa)) { readfile($spa); exit; }
    http_response_code(404);
    echo 'Veloura Billiards API is running. Start the Angular app on http://localhost:4200';
    exit;
}
$path = rtrim($m[1] ?? '/', '/') ?: '/';

header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $config['cors_origins'], true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

Db::init($config);
$router = new Router();
register_routes($router, $config);

try {
    $result = $router->dispatch($_SERVER['REQUEST_METHOD'], $path);
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
} catch (HttpError $e) {
    http_response_code($e->status);
    echo json_encode(['error' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    error_log((string) $e);
    echo json_encode(['error' => 'Server error: ' . $e->getMessage()]);
}
