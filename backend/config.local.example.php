<?php
// Copy to config.local.php on the server (it is git-ignored) and fill in real values.
// Only the keys you set here override config.php.
return [
    'driver' => 'mysql',
    'mysql'  => [
        'host'     => 'localhost',
        'database' => 'veloura_billiards',
        'username' => 'CHANGE_ME',
        'password' => 'CHANGE_ME',
    ],
];
