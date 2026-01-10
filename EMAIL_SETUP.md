# Email Invitation System - Backend Setup Guide

## Overview
The email invitation system stores invitation requests in Firestore but requires a backend Cloud Function to actually send emails. This approach keeps SMTP credentials secure and off the client.

## SMTP Configuration
- **Host**: mail.promanaged-it.com
- **Port**: 465 (SMTP with SSL)
- **Username**: _mainaccount@promanaged-it.com
- **Password**: 2:p2WpmX[0YTs7
- **Authentication**: Required
- **Security**: SSL/TLS

## Required Setup

### 1. Create Firebase Cloud Function

Create a Cloud Function that listens for new documents in the `invitations` collection:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// Configure SMTP transport
const transporter = nodemailer.createTransport({
  host: 'mail.promanaged-it.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,  // _mainaccount@promanaged-it.com
    pass: process.env.SMTP_PASS   // 2:p2WpmX[0YTs7
  }
});

// Cloud Function triggered on new invitation
exports.sendInvitationEmail = functions.firestore
  .document('invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    const invitation = snap.data();
    
    // Build email content
    const mailOptions = {
      from: '_mainaccount@promanaged-it.com',
      to: invitation.email,
      subject: `Invitation to join ${invitation.groupName}`,
      html: `
        <h2>You've been invited!</h2>
        <p>You have been invited to join the group: <strong>${invitation.groupName}</strong></p>
        <p>Invited by: ${invitation.invitedByEmail}</p>
        ${invitation.customMessage ? `<p>Message: ${invitation.customMessage}</p>` : ''}
        <p>Please contact the group administrator for next steps.</p>
      `
    };
    
    try {
      await transporter.sendMail(mailOptions);
      
      // Update invitation status
      await snap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('Invitation email sent to:', invitation.email);
    } catch (error) {
      console.error('Error sending email:', error);
      
      // Update invitation status with error
      await snap.ref.update({
        status: 'failed',
        error: error.message
      });
    }
  });
```

### 2. Install Dependencies

```bash
cd functions
npm install nodemailer
```

### 3. Set Environment Variables

```bash
firebase functions:config:set smtp.user="_mainaccount@promanaged-it.com"
firebase functions:config:set smtp.pass="2:p2WpmX[0YTs7"
```

### 4. Deploy the Function

```bash
firebase deploy --only functions:sendInvitationEmail
```

## Testing

1. Go to Settings page as an admin
2. Enter an email address and select a group
3. Click "Send Invitation"
4. Check that:
   - Document is created in `invitations` collection
   - Cloud Function is triggered
   - Email is sent
   - Invitation status is updated to "sent"

## Security Notes

- SMTP credentials are stored as environment variables on the backend
- Never expose these credentials in client-side code
- Consider adding rate limiting to prevent abuse
- Add email validation and domain checking
- Implement invitation expiry (e.g., 7 days)

## Alternative: SendGrid/Mailgun

If you prefer a dedicated email service:

```javascript
// Using SendGrid
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: invitation.email,
  from: '_mainaccount@promanaged-it.com',
  subject: `Invitation to join ${invitation.groupName}`,
  html: emailContent
};

await sgMail.send(msg);
```

## Firestore Security Rules

Add rules to protect the invitations collection:

```javascript
match /invitations/{inviteId} {
  // Only authenticated users can create invitations
  allow create: if request.auth != null;
  
  // Users can only read their own sent invitations
  allow read: if request.auth != null && 
    (resource.data.invitedBy == request.auth.uid || 
     resource.data.email == request.auth.token.email);
  
  // Only the sender can update their invitations
  allow update: if request.auth != null && 
    resource.data.invitedBy == request.auth.uid;
  
  // Only the sender can delete their invitations
  allow delete: if request.auth != null && 
    resource.data.invitedBy == request.auth.uid;
}
```

## Monitoring

Monitor email sending in Firebase Console:
1. Functions > Logs
2. Look for "Invitation email sent" messages
3. Check for errors and failed sends
4. Monitor Firestore for invitation status updates
