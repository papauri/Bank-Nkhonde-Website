# Bank Nkhonde Website

A digital platform for managing ROSCAs (Rotating Savings and Credit Associations) with Firebase backend.

## Features

- User and Admin Authentication
- Group Management
- Payment Tracking
- Loan Management
- Mobile-Responsive Design
- Firebase Firestore Database Integration

## Requirements

- PHP 7.4 or higher
- Modern web browser with JavaScript enabled
- Internet connection (for Firebase services)

## Local Development (UAT)

### Running the Application Locally

You can run the application using PHP's built-in web server:

```bash
# Option 1: Listen on localhost only
php -S 127.0.0.1:8000

# Option 2: Listen on all network interfaces
php -S 0.0.0.0:8000
```

Then open your browser and navigate to:
- `http://127.0.0.1:8000` (for localhost access)
- `http://0.0.0.0:8000` (for network access)

### Environment Configuration

The application is configured via `config.php`. The default environment is set to **UAT** (User Acceptance Testing).

## Production Deployment

### Switching to Production Mode

To deploy to production:

1. Open `config.php`
2. Change line 12 from:
   ```php
   define('ENVIRONMENT', 'UAT'); // Options: 'UAT' or 'PROD'
   ```
   to:
   ```php
   define('ENVIRONMENT', 'PROD'); // Options: 'UAT' or 'PROD'
   ```

3. Save the file

### Production Domain

The production domain is configured as: **banknkonde.com**

### Deploying to Production Server

1. Upload all files to your production web server
2. Ensure `config.php` has `ENVIRONMENT` set to `'PROD'`
3. Configure your web server (Apache/Nginx) to point to the root directory
4. Ensure the domain `banknkonde.com` is properly configured in your DNS
5. Set up SSL/HTTPS for secure connections

#### Apache Configuration Example

```apache
<VirtualHost *:80>
    ServerName banknkonde.com
    DocumentRoot /path/to/Bank-Nkhonde-Website
    
    <Directory /path/to/Bank-Nkhonde-Website>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

#### Nginx Configuration Example

```nginx
server {
    listen 80;
    server_name banknkonde.com;
    root /path/to/Bank-Nkhonde-Website;
    index index.html index.php;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
    }
}
```

## Firebase Configuration

The application uses Firebase for:
- Authentication (Firebase Auth)
- Database (Firestore)
- File Storage (Firebase Storage)

Firebase configuration is located in `scripts/firebaseConfig.js`.

## File Structure

```
Bank-Nkhonde-Website/
├── config.php                 # Environment configuration
├── index.html                 # Main login page
├── pages/                     # Application pages
│   ├── admin_dashboard.html
│   ├── admin_registration.html
│   ├── group_page.html
│   └── user_dashboard.html
├── scripts/                   # JavaScript files
│   ├── firebaseConfig.js      # Firebase configuration
│   ├── main.js                # Login functionality
│   ├── registration.js        # Registration logic
│   ├── admin_dashboard.js
│   ├── user_dashboard.js
│   └── ...
├── styles/                    # CSS stylesheets
│   ├── styles.css             # Main styles
│   ├── registration.css
│   ├── admin_dashboard.css
│   ├── user_dashboard.css
│   └── ...
└── README.md                  # This file
```

## Key Functions

### Login
- User Login: Standard user authentication
- Admin Login: Administrator authentication with additional privileges

### Registration
- Admin can register and create new groups
- Invitation code system for approval workflow
- Group configuration (seed money, interest rates, contributions, etc.)

### Dashboard
- **User Dashboard**: View groups, contributions, and loans
- **Admin Dashboard**: Manage groups, approve payments, manage members

## Mobile-Friendly Design

The application is designed to be fully responsive and mobile-friendly:
- Touch-friendly buttons (minimum 44px touch targets)
- Responsive layouts for all screen sizes
- Optimized form inputs for mobile devices
- Smooth transitions and interactions

## Security

- Firebase Authentication for secure user management
- Environment-based configuration
- Input validation on both client and server side
- HTTPS recommended for production deployment

## Support

For issues or questions, please contact the development team.

## License

Proprietary - All rights reserved
