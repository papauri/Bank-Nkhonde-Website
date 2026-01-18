/**
 * Email Service Helper
 * 
 * This module provides functions to send emails through Firebase Cloud Functions.
 * It uses the custom SMTP configuration set up in functions/index.js
 * 
 * Email sending is non-blocking - registration will succeed even if email fails.
 */

import { functions, httpsCallable } from './firebaseConfig.js';

// Email service enabled flag
const EMAIL_SERVICE_ENABLED = true;
const EMAIL_NON_BLOCKING = true;

/**
 * Send Password Reset Email
 * @param {string} email - User's email address
 * @param {string} resetLink - Password reset link
 * @param {string} userName - User's name (optional)
 * @returns {Promise<Object>} Success response
 */
export async function sendPasswordResetEmail(email, resetLink, userName = null) {
  try {
    const sendPasswordReset = httpsCallable(functions, 'sendPasswordResetEmail');
    const result = await sendPasswordReset({
      email,
      resetLink,
      userName
    });
    return result.data;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
}

/**
 * Send Email Verification
 * @param {string} email - User's email address
 * @param {string} verificationLink - Email verification link
 * @param {string} userName - User's name (optional)
 * @returns {Promise<Object>} Success response
 */
export async function sendEmailVerification(email, verificationLink, userName = null) {
  try {
    const sendVerification = httpsCallable(functions, 'sendEmailVerification');
    const result = await sendVerification({
      email,
      verificationLink,
      userName
    });
    return result.data;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
}

/**
 * Send Registration Welcome Email
 * @param {string} email - User's email address
 * @param {string} userName - User's name
 * @param {string} groupName - Group name
 * @returns {Promise<Object>} Success response
 */
export async function sendRegistrationWelcome(email, userName, groupName) {
  // Check if email service is enabled
  if (!EMAIL_SERVICE_ENABLED) {
    console.log('Email service is disabled, skipping welcome email');
    return { success: false, message: 'Email service disabled' };
  }

  try {
    const sendWelcome = httpsCallable(functions, 'sendRegistrationWelcome');
    const result = await sendWelcome({
      email,
      userName,
      groupName
    });
    console.log('✅ Welcome email sent successfully');
    return result.data;
  } catch (error) {
    // Log error but don't throw if non-blocking
    const errorMessage = error.message || 'Unknown error';
    const errorCode = error.code || 'unknown';
    
    console.error('❌ Error sending welcome email:', errorCode, errorMessage);
    
    // If non-blocking, return error object instead of throwing
    if (EMAIL_NON_BLOCKING) {
      return { 
        success: false, 
        error: errorCode,
        message: 'Email service unavailable (non-critical)',
        details: errorMessage
      };
    }
    
    // Otherwise throw the error
    throw error;
  }
}
