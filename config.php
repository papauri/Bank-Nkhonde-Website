<?php
/**
 * Bank Nkhonde Configuration
 * 
 * To switch between environments, change the ENVIRONMENT constant:
 * - 'UAT' for local development/testing
 * - 'PROD' for production deployment
 */

// Environment Configuration - Change this single line to switch environments
define('ENVIRONMENT', 'UAT'); // Options: 'UAT' or 'PROD'

// Environment-specific settings
$config = [];

if (ENVIRONMENT === 'PROD') {
    // Production Configuration
    $config['base_url'] = 'https://banknkonde.com';
    $config['environment'] = 'production';
    $config['debug'] = false;
} else {
    // UAT/Development Configuration
    $config['base_url'] = 'http://127.0.0.1:8000';
    $config['environment'] = 'development';
    $config['debug'] = true;
}

// Detect the app's base path from the request so upload URLs (and any other
// server-generated absolute paths) always resolve correctly whether the app
// lives at the domain root or in a subdirectory. The constant is safe to use
// in every handler: it is derived from the server's own SCRIPT_NAME, never
// from user input, and it never includes a query string or fragment.
if (!defined('APP_BASE_PATH')) {
    // API requests hit api/index.php; the app root is one directory above.
    $scriptPath = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    $apiPos = strrpos($scriptPath, '/api/index.php');
    if ($apiPos !== false) {
        $appPath = substr($scriptPath, 0, $apiPos);
    } else {
        // Fallback: anything up to the last / excluding the file name.
        $appPath = rtrim(dirname($scriptPath), '/\\');
    }
    // Normalise: never end with a slash (makes concatenation predictable).
    define('APP_BASE_PATH', $appPath !== '' ? $appPath : '');
}

// Common configuration
$config['app_name'] = 'Bank Nkhonde';
$config['firebase_project_id'] = 'banknkonde';
$config['app_base_path'] = APP_BASE_PATH;

// Make config available globally
$GLOBALS['config'] = $config;

// Helper function to get config values
function get_config($key) {
    return isset($GLOBALS['config'][$key]) ? $GLOBALS['config'][$key] : null;
}

// Set error reporting based on environment
if ($config['debug']) {
    error_reporting(E_ALL);
    ini_set('display_errors', 1);
} else {
    error_reporting(0);
    ini_set('display_errors', 0);
}

// Set default timezone
date_default_timezone_set('Africa/Blantyre');
?>
