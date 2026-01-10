# DEPLOYMENT GUIDE - Bank Nkhonde Website

## Quick Start (Local Development)

### Running the Application

1. **Navigate to the project directory:**
   ```bash
   cd Bank-Nkhonde-Website
   ```

2. **Start the PHP development server:**
   ```bash
   # Option 1: Localhost only (recommended)
   php -S 127.0.0.1:8000
   
   # Option 2: All network interfaces
   php -S 0.0.0.0:8000
   ```

3. **Open in browser:**
   - http://127.0.0.1:8000

### Pre-Deployment Check

Run the deployment check script to verify everything is configured correctly:

```bash
./deploy-check.sh
```

This will check:
- ✓ PHP installation and version
- ✓ Configuration file
- ✓ Directory structure
- ✓ Required files
- ✓ Firebase configuration

---

## Environment Switching

### Current Setup (UAT - Local Development)

The application is currently configured for **UAT** (User Acceptance Testing) environment.

File: `config.php` (Line 11)
```php
define('ENVIRONMENT', 'UAT'); // Options: 'UAT' or 'PROD'
```

Settings:
- Base URL: `http://127.0.0.1:8000`
- Debug Mode: Enabled
- Error Display: Enabled

### Switching to Production

**To deploy to production, follow these steps:**

1. **Edit `config.php`** and change line 11:
   ```php
   define('ENVIRONMENT', 'PROD'); // Options: 'UAT' or 'PROD'
   ```

2. **Production settings will automatically apply:**
   - Base URL: `https://banknkonde.com`
   - Debug Mode: Disabled
   - Error Display: Disabled

---

## Production Deployment

### Prerequisites

- Web server (Apache or Nginx)
- PHP 7.4 or higher
- Domain: banknkonde.com
- SSL certificate (for HTTPS)

### Deployment Steps

1. **Update Configuration**
   ```bash
   # Edit config.php
   nano config.php
   
   # Change line 11 from:
   define('ENVIRONMENT', 'UAT');
   
   # To:
   define('ENVIRONMENT', 'PROD');
   ```

2. **Upload Files to Server**
   ```bash
   # Using SCP
   scp -r * user@banknkonde.com:/var/www/html/
   
   # Or using FTP/SFTP client
   # Upload all files to your web server root
   ```

3. **Configure Web Server**

   **For Apache:**
   ```apache
   <VirtualHost *:80>
       ServerName banknkonde.com
       ServerAlias www.banknkonde.com
       DocumentRoot /var/www/html
       
       <Directory /var/www/html>
           Options -Indexes +FollowSymLinks
           AllowOverride All
           Require all granted
       </Directory>
       
       ErrorLog ${APACHE_LOG_DIR}/banknkonde_error.log
       CustomLog ${APACHE_LOG_DIR}/banknkonde_access.log combined
   </VirtualHost>
   ```

   **For Nginx:**
   ```nginx
   server {
       listen 80;
       server_name banknkonde.com www.banknkonde.com;
       root /var/www/html;
       index index.html index.php;
       
       location / {
           try_files $uri $uri/ /index.html;
       }
       
       location ~ \.php$ {
           fastcgi_pass unix:/var/run/php/php-fpm.sock;
           fastcgi_index index.php;
           include fastcgi_params;
           fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
       }
       
       # Security headers
       add_header X-Frame-Options "SAMEORIGIN";
       add_header X-Content-Type-Options "nosniff";
       add_header X-XSS-Protection "1; mode=block";
   }
   ```

4. **Set Up SSL/HTTPS**
   ```bash
   # Using Let's Encrypt
   sudo certbot --apache -d banknkonde.com -d www.banknkonde.com
   
   # Or for Nginx
   sudo certbot --nginx -d banknkonde.com -d www.banknkonde.com
   ```

5. **Set Proper Permissions**
   ```bash
   # Set ownership
   sudo chown -R www-data:www-data /var/www/html
   
   # Set permissions
   sudo find /var/www/html -type d -exec chmod 755 {} \;
   sudo find /var/www/html -type f -exec chmod 644 {} \;
   ```

6. **Test the Deployment**
   - Visit https://banknkonde.com
   - Test login functionality
   - Test registration functionality
   - Verify Firebase connection
   - Check on mobile devices

---

## Key Features

### Authentication
- ✅ User Login
- ✅ Admin Login
- ✅ User Registration
- ✅ Password Reset

### Database
- ✅ Firebase Firestore integration
- ✅ Real-time data synchronization
- ✅ Secure authentication

### Mobile Support
- ✅ Fully responsive design
- ✅ Touch-friendly interface
- ✅ Optimized for iOS and Android
- ✅ Tablet support

---

## Troubleshooting

### PHP Server Won't Start
```bash
# Check if port 8000 is in use
lsof -i :8000

# Kill the process using port 8000
kill -9 <PID>

# Try a different port
php -S 127.0.0.1:8080
```

### Files Not Loading
- Verify file paths are correct
- Check file permissions
- Ensure PHP is serving from correct directory

### Firebase Connection Issues
- Verify internet connection
- Check Firebase configuration in `scripts/firebaseConfig.js`
- Ensure Firebase project is active

### Production 500 Errors
- Check server error logs
- Verify PHP version compatibility
- Ensure all files were uploaded
- Check file permissions

---

## File Structure

```
Bank-Nkhonde-Website/
├── config.php              ← ENVIRONMENT CONFIGURATION
├── index.html              ← Main entry point
├── README.md               ← Documentation
├── deploy-check.sh         ← Pre-deployment checker
├── DEPLOYMENT.md           ← This file
├── pages/
│   ├── admin_dashboard.html
│   ├── admin_registration.html
│   ├── group_page.html
│   └── user_dashboard.html
├── scripts/
│   ├── firebaseConfig.js   ← Firebase settings
│   └── ...
└── styles/
    └── ...
```

---

## Support

For issues or questions:
1. Check this deployment guide
2. Run `./deploy-check.sh` to verify setup
3. Check server error logs
4. Review Firebase console for authentication issues

---

## Security Checklist

Before going to production:
- [ ] ENVIRONMENT set to 'PROD' in config.php
- [ ] SSL/HTTPS configured
- [ ] Debug mode disabled (automatic in PROD)
- [ ] File permissions set correctly
- [ ] Firewall configured
- [ ] Regular backups scheduled
- [ ] Firebase security rules reviewed

---

**Last Updated:** January 10, 2026  
**Version:** 1.0  
**Production Domain:** banknkonde.com
