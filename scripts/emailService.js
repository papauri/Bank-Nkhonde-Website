/**
 * Email Service Helper
 * 
 * This module provides functions to send emails through Firebase Cloud Functions.
 * It uses the custom SMTP configuration set up in functions/index.js
 */

import { functions, httpsCallable } from './firebaseConfig.js';

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
  try {
    const sendWelcome = httpsCallable(functions, 'sendRegistrationWelcome');
    const result = await sendWelcome({
      email,
      userName,
      groupName
    });
    return result.data;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}
