#!/bin/bash

# Bank Nkhonde Website - Deployment Test Script
# This script helps verify the setup before deploying to production

echo "=========================================="
echo "Bank Nkhonde Website - Pre-Deployment Check"
echo "=========================================="
echo ""

# Check if PHP is installed
echo "1. Checking PHP installation..."
if command -v php &> /dev/null; then
    PHP_VERSION=$(php -v | head -1)
    echo "   ✓ PHP is installed: $PHP_VERSION"
else
    echo "   ✗ PHP is NOT installed. Please install PHP 7.4 or higher."
    exit 1
fi
echo ""

# Check PHP version
echo "2. Checking PHP version..."
PHP_VER=$(php -r 'echo PHP_VERSION;' | cut -d. -f1,2)
if (( $(echo "$PHP_VER >= 7.4" | bc -l) )); then
    echo "   ✓ PHP version is sufficient: $PHP_VER"
else
    echo "   ✗ PHP version is too old: $PHP_VER (requires 7.4+)"
    exit 1
fi
echo ""

# Check if config.php exists
echo "3. Checking configuration file..."
if [ -f "config.php" ]; then
    echo "   ✓ config.php exists"
    
    # Check current environment setting
    CURRENT_ENV=$(grep "define('ENVIRONMENT'" config.php | sed "s/.*'\([^']*\)'.*/\1/")
    echo "   Current environment: $CURRENT_ENV"
    
    if [ "$CURRENT_ENV" = "PROD" ]; then
        echo "   ⚠ WARNING: Environment is set to PRODUCTION"
    else
        echo "   ✓ Environment is set to UAT/Development"
    fi
else
    echo "   ✗ config.php is missing!"
    exit 1
fi
echo ""

# Check required directories
echo "4. Checking directory structure..."
REQUIRED_DIRS=("pages" "scripts" "styles")
ALL_DIRS_OK=true

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "   ✓ $dir/ directory exists"
    else
        echo "   ✗ $dir/ directory is missing!"
        ALL_DIRS_OK=false
    fi
done

if [ "$ALL_DIRS_OK" = false ]; then
    exit 1
fi
echo ""

# Check key files
echo "5. Checking required files..."
REQUIRED_FILES=("index.html" "pages/admin_dashboard.html" "pages/user_dashboard.html" "pages/admin_registration.html" "scripts/firebaseConfig.js" "scripts/main.js")
ALL_FILES_OK=true

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file exists"
    else
        echo "   ✗ $file is missing!"
        ALL_FILES_OK=false
    fi
done

if [ "$ALL_FILES_OK" = false ]; then
    exit 1
fi
echo ""

# Check Firebase configuration
echo "6. Checking Firebase configuration..."
if grep -q "banknkonde" scripts/firebaseConfig.js; then
    echo "   ✓ Firebase project ID found (banknkonde)"
else
    echo "   ⚠ WARNING: Firebase project ID not found or incorrect"
fi
echo ""

echo "=========================================="
echo "Pre-Deployment Check Complete!"
echo "=========================================="
echo ""

# Deployment instructions
echo "📋 DEPLOYMENT CHECKLIST:"
echo ""
echo "For UAT/Local Development:"
echo "  1. Ensure ENVIRONMENT is set to 'UAT' in config.php"
echo "  2. Run: php -S 127.0.0.1:8000"
echo "  3. Visit: http://127.0.0.1:8000"
echo ""
echo "For Production:"
echo "  1. Change ENVIRONMENT to 'PROD' in config.php"
echo "  2. Upload all files to web server"
echo "  3. Configure web server (Apache/Nginx)"
echo "  4. Point domain banknkonde.com to application"
echo "  5. Set up SSL/HTTPS"
echo ""
echo "✨ Everything looks good! Ready to deploy."
