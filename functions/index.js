/**
 * Firebase Cloud Functions for Bank Nkhonde
 * Email Service Functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ===========================================
// EMAIL CONFIGURATION
// ===========================================
// Easy to change: Update values below or use Firebase environment variables
// For production, use: firebase functions:config:set smtp.host="..." etc.

const emailConfig = {
  smtp: {
    host: functions.config().smtp?.host || 'mail.promanaged-it.com',
    port: parseInt(functions.config().smtp?.port || '465'),
    secure: true, // true for 465 (SSL), false for 587/25 (TLS)
    auth: {
      user: functions.config().smtp?.user || '_mainaccount@promanaged-it.com',
      pass: functions.config().smtp?.pass || '2:p2WpmX[0YTs7'
    },
    // Add TLS options if needed for SSL certificate issues
    // tls: {
    //   rejectUnauthorized: false
    // }
  },
  from: {
    name: 'Bank Nkhonde',
    email: functions.config().smtp?.user || '_mainaccount@promanaged-it.com'
  },
  templates: {
    baseUrl: functions.config().app?.base_url || 'http://localhost:8000',
    companyName: 'Bank Nkhonde',
    supportEmail: functions.config().smtp?.user || '_mainaccount@promanaged-it.com',
    supportPhone: '+265 991 234 567'
  }
};

// Initialize Firebase Admin
admin.initializeApp();

// Create reusable transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: emailConfig.smtp.host,
  port: emailConfig.smtp.port,
  secure: emailConfig.smtp.secure,
  auth: emailConfig.smtp.auth
});

/**
 * Email Templates
 */
const emailTemplates = {
  /**
   * Password Reset Email Template
   */
  passwordReset: (resetLink, userName = 'User') => {
    return {
      subject: 'Reset Your Bank Nkhonde Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #047857 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #047857; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bank Nkhonde</h1>
              <p>Password Reset Request</p>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>We received a request to reset your password for your Bank Nkhonde account.</p>
              <p>Click the button below to reset your password:</p>
              <p style="text-align: center;">
                <a href="${resetLink}" class="button">Reset Password</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #047857;">${resetLink}</p>
              <p><strong>This link will expire in 1 hour.</strong></p>
              <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
              <p>Best regards,<br>The Bank Nkhonde Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>For support, contact: ${emailConfig.templates.supportEmail}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName},
        
        We received a request to reset your password for your Bank Nkhonde account.
        
        Click this link to reset your password:
        ${resetLink}
        
        This link will expire in 1 hour.
        
        If you didn't request a password reset, please ignore this email.
        
        Best regards,
        The Bank Nkhonde Team
      `
    };
  },

  /**
   * Email Verification Template
   */
  emailVerification: (verificationLink, userName = 'User') => {
    return {
      subject: 'Verify Your Bank Nkhonde Email Address',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #047857 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #047857; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bank Nkhonde</h1>
              <p>Verify Your Email</p>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>Thank you for registering with Bank Nkhonde!</p>
              <p>Please verify your email address by clicking the button below:</p>
              <p style="text-align: center;">
                <a href="${verificationLink}" class="button">Verify Email</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #047857;">${verificationLink}</p>
              <p>If you didn't create an account, please ignore this email.</p>
              <p>Best regards,<br>The Bank Nkhonde Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>For support, contact: ${emailConfig.templates.supportEmail}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName},
        
        Thank you for registering with Bank Nkhonde!
        
        Please verify your email address by clicking this link:
        ${verificationLink}
        
        If you didn't create an account, please ignore this email.
        
        Best regards,
        The Bank Nkhonde Team
      `
    };
  },

  /**
   * Registration Welcome Email Template
   */
  registrationWelcome: (userName, groupName) => {
    return {
      subject: 'Welcome to Bank Nkhonde!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #047857 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #047857; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Bank Nkhonde!</h1>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>Congratulations! Your registration has been approved and your account has been successfully created.</p>
              <p><strong>Group Name:</strong> ${groupName}</p>
              <p>You can now log in to your admin dashboard and start managing your ROSCA group.</p>
              <p style="text-align: center;">
                <a href="${emailConfig.templates.baseUrl}/login.html" class="button">Log In Now</a>
              </p>
              <p>If you have any questions, please don't hesitate to contact our support team.</p>
              <p>Best regards,<br>The Bank Nkhonde Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>For support, contact: ${emailConfig.templates.supportEmail}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hello ${userName},
        
        Congratulations! Your registration has been approved and your account has been successfully created.
        
        Group Name: ${groupName}
        
        You can now log in to your admin dashboard and start managing your ROSCA group.
        
        Log in at: ${emailConfig.templates.baseUrl}/login.html
        
        Best regards,
        The Bank Nkhonde Team
      `
    };
  }
};

/**
 * HTTP Cloud Function: Send Password Reset Email
 * 
 * Usage: POST to /sendPasswordResetEmail
 * Body: { email: "user@example.com", resetLink: "https://..." }
 */
exports.sendPasswordResetEmail = functions.https.onCall(async (data, context) => {
  try {
    const { email, resetLink, userName } = data;

    if (!email || !resetLink) {
      throw new functions.https.HttpsError('invalid-argument', 'Email and reset link are required');
    }

    const template = emailTemplates.passwordReset(resetLink, userName);

    const mailOptions = {
      from: `"${emailConfig.from.name}" <${emailConfig.from.email}>`,
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text
    };

    await transporter.sendMail(mailOptions);

    return { success: true, message: 'Password reset email sent successfully' };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send email', error.message);
  }
});

/**
 * HTTP Cloud Function: Send Email Verification
 * 
 * Usage: POST to /sendEmailVerification
 * Body: { email: "user@example.com", verificationLink: "https://...", userName: "John Doe" }
 */
exports.sendEmailVerification = functions.https.onCall(async (data, context) => {
  try {
    const { email, verificationLink, userName } = data;

    if (!email || !verificationLink) {
      throw new functions.https.HttpsError('invalid-argument', 'Email and verification link are required');
    }

    const template = emailTemplates.emailVerification(verificationLink, userName);

    const mailOptions = {
      from: `"${emailConfig.from.name}" <${emailConfig.from.email}>`,
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text
    };

    await transporter.sendMail(mailOptions);

    return { success: true, message: 'Verification email sent successfully' };
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send email', error.message);
  }
});

/**
 * HTTP Cloud Function: Send Registration Welcome Email
 * 
 * Usage: POST to /sendRegistrationWelcome
 * Body: { email: "user@example.com", userName: "John Doe", groupName: "My Group" }
 */
exports.sendRegistrationWelcome = functions.https.onCall(async (data, context) => {
  try {
    const { email, userName, groupName } = data;

    if (!email || !userName || !groupName) {
      throw new functions.https.HttpsError('invalid-argument', 'Email, user name, and group name are required');
    }

    const template = emailTemplates.registrationWelcome(userName, groupName);

    const mailOptions = {
      from: `"${emailConfig.from.name}" <${emailConfig.from.email}>`,
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text
    };

    await transporter.sendMail(mailOptions);

    return { success: true, message: 'Welcome email sent successfully' };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send email', error.message);
  }
});

/**
 * Firestore Trigger: Send invitation email when invitation document is created
 */
exports.sendInvitationEmail = functions.firestore
  .document('invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    try {
      const invitation = snap.data();

      if (!invitation.email || !invitation.groupName) {
        console.error('Invalid invitation data:', invitation);
        return;
      }

      const invitationLink = `${emailConfig.templates.baseUrl}/pages/accept_invitation.html?invitationId=${context.params.inviteId}`;

      const mailOptions = {
        from: `"${emailConfig.from.name}" <${emailConfig.from.email}>`,
        to: invitation.email,
        subject: `Invitation to join ${invitation.groupName} - Bank Nkhonde`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #047857 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; background: #047857; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Bank Nkhonde</h1>
                <p>You've Been Invited!</p>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>You have been invited to join the ROSCA group: <strong>${invitation.groupName}</strong></p>
                ${invitation.invitedByEmail ? `<p>Invited by: ${invitation.invitedByEmail}</p>` : ''}
                ${invitation.customMessage ? `<p><em>"${invitation.customMessage}"</em></p>` : ''}
                <p>Click the button below to accept the invitation and create your account:</p>
                <p style="text-align: center;">
                  <a href="${invitationLink}" class="button">Accept Invitation</a>
                </p>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #047857;">${invitationLink}</p>
                <p>Best regards,<br>The Bank Nkhonde Team</p>
              </div>
              <div class="footer">
                <p>This is an automated message. Please do not reply to this email.</p>
                <p>For support, contact: ${emailConfig.templates.supportEmail}</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
          Hello,
          
          You have been invited to join the ROSCA group: ${invitation.groupName}
          ${invitation.invitedByEmail ? `Invited by: ${invitation.invitedByEmail}` : ''}
          
          Click this link to accept the invitation: ${invitationLink}
          
          Best regards,
          The Bank Nkhonde Team
        `
      };

      await transporter.sendMail(mailOptions);

      // Update invitation status
      await snap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('Invitation email sent to:', invitation.email);
    } catch (error) {
      console.error('Error sending invitation email:', error);

      // Update invitation status with error
      await snap.ref.update({
        status: 'failed',
        error: error.message
      });
    }
  });
