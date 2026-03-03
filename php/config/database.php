<?php
/**
 * Database connection — returns a PDO instance.
 * Credentials are read from environment variables so they are never
 * hard-coded in source control.
 *
 * Required environment variables:
 *   DB_HOST     (default: 127.0.0.1)
 *   DB_PORT     (default: 3306)
 *   DB_NAME     (default: cipher_music)
 *   DB_USER     (default: cipher_user)
 *   DB_PASSWORD (required — no default)
 */

function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $host   = getenv('DB_HOST')     ?: '127.0.0.1';
    $port   = getenv('DB_PORT')     ?: '3306';
    $dbname = getenv('DB_NAME')     ?: 'cipher_music';
    $user   = getenv('DB_USER')     ?: 'cipher_user';
    $pass   = getenv('DB_PASSWORD') ?: '';

    $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
    ];

    try {
        $pdo = new PDO($dsn, $user, $pass, $options);
    } catch (PDOException $e) {
        // Do not expose DB credentials in the error message
        http_response_code(503);
        die(json_encode(['error' => 'Database connection failed.']));
    }

    return $pdo;
}
