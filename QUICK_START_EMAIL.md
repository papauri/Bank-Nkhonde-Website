# Quick Start: Email Service Setup

## 🚀 Quick Setup (5 minutes)

### Step 1: Install Dependencies
```bash
cd functions
npm install
```

### Step 2: Deploy Functions
```bash
# From project root
firebase deploy --only functions
```

### Step 3: Test It!
1. Go to login page
2. Click "Forgot password?"
3. Enter your email
4. Check your inbox!

## 📧 Current Email Configuration

All settings are in `functions/index.js` (lines 7-25). To change:

1. **SMTP Server**: Edit `emailConfig.smtp.host`
2. **SMTP Port**: Edit `emailConfig.smtp.port`
3. **Username**: Edit `emailConfig.smtp.auth.user`
4. **Password**: Edit `emailConfig.smtp.auth.pass`
5. **From Email**: Edit `emailConfig.from.email`

After changes, redeploy:
```bash
firebase deploy --only functions
```

## 🔒 Production Setup (Recommended)

For production, use Firebase environment variables instead of hardcoding:

```bash
firebase functions:config:set smtp.host="mail.promanaged-it.com"
firebase functions:config:set smtp.port="465"
firebase functions:config:set smtp.user="_mainaccount@promanaged-it.com"
firebase functions:config:set smtp.pass="2:p2WpmX[0YTs7"
firebase functions:config:set app.base_url="https://banknkonde.com"
```

Then redeploy functions - they'll automatically use these values!

## ✅ What's Working

- ✅ Password reset emails
- ✅ Registration welcome emails
- ✅ Invitation emails (automatic)
- ✅ Email verification (ready to use)

## 📝 Need Help?

See `EMAIL_SETUP_COMPLETE.md` for detailed documentation.
