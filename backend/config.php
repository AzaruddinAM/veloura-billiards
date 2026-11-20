<?php
// Veloura Billiards — backend configuration.
// Default uses SQLite (zero setup). To use MySQL, set driver => 'mysql' and fill credentials,
// then create the database (schema is applied automatically on first request).
//
// On a server, put real credentials in backend/config.local.php (git-ignored) instead of
// editing this file — see config.local.example.php.
$config = [
    'driver'   => getenv('VB_DB_DRIVER') ?: 'sqlite',          // 'sqlite' | 'mysql'
    'sqlite'   => __DIR__ . '/data/veloura.sqlite',
    'mysql'    => [
        'host'     => getenv('VB_DB_HOST') ?: '127.0.0.1',
        'port'     => getenv('VB_DB_PORT') ?: '3306',
        'database' => getenv('VB_DB_NAME') ?: 'veloura_billiards',
        'username' => getenv('VB_DB_USER') ?: 'root',
        'password' => getenv('VB_DB_PASS') ?: '',
    ],
    'timezone'        => getenv('VB_TZ') ?: 'Asia/Kolkata',
    'token_ttl_hours' => 24 * 7,
    // Origins allowed to call the API from another origin (Angular dev server).
    // In production the app and API share https://billiards.velouraone.in, so CORS isn't needed.
    'cors_origins'    => ['http://localhost:4200', 'http://127.0.0.1:4200'],
];

$local = __DIR__ . '/config.local.php';
if (is_file($local)) {
    $config = array_replace_recursive($config, require $local);
}
return $config;
