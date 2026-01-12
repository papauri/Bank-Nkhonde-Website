# Email Service Setup - Complete Guide

## Overview
The email service is now configured to use your custom SMTP server for sending emails through Firebase Cloud Functions. This keeps your SMTP credentials secure on the backend.

## Configuration File
All email settings are in: **`config/email.config.js`**

### Current SMTP Settings:
- **Host**: mail.promanaged-it.com
- **Port**: 465 (SSL)
- **Username**: _mainaccount@promanaged-it.com
- **Password**: 2:p2WpmX[0YTs7
- **From Email**: _mainaccount@promanaged-it.com
- **From Name**: Bank Nkhonde

### To Change Email Settings:
1. Open `config/email.config.js`
2. Update the `smtp` object with your new credentials
3. Update the `from` object with your sender information
4. Redeploy the Cloud Functions (see below)

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Set Environment Variables (Optional)

For production, you can use Firebase environment variables instead of hardcoding in the config file:

```bash
firebase functions:config:set smtp.host="mail.promanaged-it.com"
firebase functions:config:set smtp.port="465"
firebase functions:config:set smtp.user="_mainaccount@promanaged-it.com"
firebase functions:config:set smtp.pass="2:p2WpmX[0YTs7"
```

Then update `functions/index.js` to read from environment variables:
```javascript
const smtpConfig = functions.config().smtp || emailConfig.smtp;
```

### 3. Deploy Cloud Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy specific functions
firebase deploy --only functions:sendPasswordResetEmail
firebase deploy --only functions:sendEmailVerification
firebase deploy --only functions:sendRegistrationWelcome
firebase deploy --only functions:sendInvitationEmail
```

### 4. Test Email Service

#### Test Password Reset:
1. Go to login page
2. Click "Forgot password?"
3. Enter your email
4. Check your inbox for the reset email

#### Test Registration Welcome:
1. Complete a new registration
2. Check your email for the welcome message

#### Test Invitation:
1. As an admin, send an invitation to a member
2. Check the recipient's email

## Available Email Functions

### 1. Password Reset Email
- **Function**: `sendPasswordResetEmail`
- **Triggered**: When user clicks "Forgot password?" on login page
- **Template**: Professional HTML email with reset link

### 2. Email Verification
- **Function**: `sendEmailVerification`
- **Triggered**: When new user registers (optional)
- **Template**: Verification email with confirmation link

### 3. Registration Welcome Email
- **Function**: `sendRegistrationWelcome`
- **Triggered**: After successful registration
- **Template**: Welcome message with group details

### 4. Invitation Email
- **Function**: `sendInvitationEmail`
- **Triggered**: Automatically when invitation document is created in Firestore
- **Template**: Invitation email with acceptance link

## Email Templates

All email templates are defined in `functions/index.js` and include:
- Professional HTML styling
- Responsive design
- Brand colors (Bank Nkhonde green)
- Plain text fallback
- Support contact information

### Customizing Templates

Edit the `emailTemplates` object in `functions/index.js`:
- `passwordReset()` - Password reset template
- `emailVerification()` - Email verification template
- `registrationWelcome()` - Welcome email template

## Frontend Integration

The frontend uses `scripts/emailService.js` to call the Cloud Functions:

```javascript
import { sendPasswordResetEmail, sendRegistrationWelcome } from './emailService.js';

// Send password reset
await sendPasswordResetEmail(email, resetLink, userName);

// Send welcome email
await sendRegistrationWelcome(email, userName, groupName);
```

## Security Notes

1. **Never commit credentials to Git**: The config file should be in `.gitignore` or use environment variables
2. **Use environment variables in production**: Store sensitive data in Firebase Functions config
3. **Rate limiting**: Consider adding rate limiting to prevent email abuse
4. **Email validation**: Always validate email addresses before sending

## Troubleshooting

### Emails not sending?
1. Check Firebase Functions logs: `firebase functions:log`
2. Verify SMTP credentials are correct
3. Check that port 465 is not blocked by firewall
4. Verify the "from" email is authorized on your SMTP server

### Functions not deploying?
1. Make sure you're in the `functions` directory
2. Run `npm install` to ensure dependencies are installed
3. Check that you're logged into Firebase: `firebase login`

### Email delivery issues?
1. Check spam/junk folders
2. Verify SMTP server allows sending from your domain
3. Check SMTP server logs for delivery status
4. Test SMTP connection manually using a tool like `telnet` or `openssl`

## Monitoring

Monitor email sending in Firebase Console:
1. Go to Functions > Logs
2. Filter by function name (e.g., `sendPasswordResetEmail`)
3. Look for success/error messages
4. Check Firestore for invitation status updates

## Updating Email Configuration

To change email settings:

1. **Quick Change**: Edit `config/email.config.js` and redeploy functions
2. **Production Change**: Use Firebase environment variables (recommended)
3. **Template Change**: Edit templates in `functions/index.js`

After making changes, always redeploy:
```bash
firebase deploy --only functions
```

## Support

For issues or questions:
- Check Firebase Functions logs
- Review email server logs
- Contact: _mainaccount@promanaged-it.com
