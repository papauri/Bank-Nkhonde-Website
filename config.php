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

// Common configuration
$config['app_name'] = 'Bank Nkhonde';
$config['firebase_project_id'] = 'banknkonde';

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
