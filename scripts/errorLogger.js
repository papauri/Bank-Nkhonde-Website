/**
 * Error Logger Utility
 * Centralized error logging system for Bank Nkhonde
 * Logs errors to console and optionally to Firestore for monitoring
 */

import { db, auth, collection, addDoc, Timestamp } from "./firebaseConfig.js";

/**
 * Error Categories
 */
export const ErrorCategory = {
  AUTHENTICATION: "authentication",
  DATABASE: "database",
  STORAGE: "storage",
  PAYMENT: "payment",
  LOAN: "loan",
  FORM: "form",
  CALENDAR: "calendar",
  NOTIFICATION: "notification",
  VALIDATION: "validation",
  NETWORK: "network",
  PERMISSION: "permission",
  SYSTEM: "system",
  UNKNOWN: "unknown",
};

/**
 * Error Severity Levels
 */
export const ErrorSeverity = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

/**
 * Log Error to Console and Firestore
 * @param {Error|string} error - Error object or error message
 * @param {Object} options - Error logging options
 * @param {string} options.category - Error category (default: UNKNOWN)
 * @param {string} options.severity - Error severity (default: MEDIUM)
 * @param {string} options.context - Additional context (function name, action, etc.)
 * @param {Object} options.metadata - Additional metadata (userId, groupId, etc.)
 * @param {boolean} options.logToFirestore - Whether to log to Firestore (default: true in production)
 */
export async function logError(error, options = {}) {
  const {
    category = ErrorCategory.UNKNOWN,
    severity = ErrorSeverity.MEDIUM,
    context = "",
    metadata = {},
    logToFirestore = true,
  } = options;

  // Extract error information
  const errorMessage = error?.message || error || "Unknown error";
  const errorCode = error?.code || "";
  const errorStack = error?.stack || "";
  const errorName = error?.name || "Error";

  // Get current user
  const currentUser = auth?.currentUser;
  const userId = currentUser?.uid || metadata.userId || "anonymous";
  const userEmail = currentUser?.email || metadata.userEmail || "";

  // Build error log entry
  const errorLog = {
    errorName,
    errorMessage,
    errorCode,
    errorStack,
    category,
    severity,
    context,
    userId,
    userEmail,
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      referrer: document.referrer,
    },
    createdAt: Timestamp.now(),
  };

  // Always log to console
  const consoleMessage = `[${category.toUpperCase()}] ${context ? `[${context}] ` : ""}${errorMessage}${errorCode ? ` (${errorCode})` : ""}`;
  
  switch (severity) {
    case ErrorSeverity.CRITICAL:
      console.error("🚨 CRITICAL ERROR:", consoleMessage, errorLog);
      break;
    case ErrorSeverity.HIGH:
      console.error("🔴 HIGH ERROR:", consoleMessage, errorLog);
      break;
    case ErrorSeverity.MEDIUM:
      console.error("🟡 MEDIUM ERROR:", consoleMessage, errorLog);
      break;
    case ErrorSeverity.LOW:
      console.warn("🟢 LOW ERROR:", consoleMessage, errorLog);
      break;
    default:
      console.error("ERROR:", consoleMessage, errorLog);
  }

  // Log to Firestore (only in production or when explicitly enabled)
  if (logToFirestore && (process.env.NODE_ENV === "production" || window.location.hostname !== "localhost")) {
    try {
      // Only log high severity errors to Firestore to avoid excessive writes
      if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
        await addDoc(collection(db, "errorLogs"), errorLog);
      }
    } catch (firestoreError) {
      // Don't fail if Firestore logging fails - just log to console
      console.error("Failed to log error to Firestore:", firestoreError);
    }
  }

  return errorLog;
}

/**
 * Log Firebase Authentication Error
 */
export async function logAuthError(error, context = "", metadata = {}) {
  let severity = ErrorSeverity.MEDIUM;
  
  // Determine severity based on error code
  if (error?.code === "auth/user-not-found" || error?.code === "auth/wrong-password") {
    severity = ErrorSeverity.LOW;
  } else if (error?.code === "auth/too-many-requests" || error?.code === "auth/network-request-failed") {
    severity = ErrorSeverity.HIGH;
  } else if (error?.code === "auth/account-exists-with-different-credential") {
    severity = ErrorSeverity.MEDIUM;
  }

  return await logError(error, {
    category: ErrorCategory.AUTHENTICATION,
    severity,
    context: context || "Authentication",
    metadata,
  });
}

/**
 * Log Firebase Database Error
 */
export async function logDatabaseError(error, context = "", metadata = {}) {
  let severity = ErrorSeverity.MEDIUM;
  
  // Determine severity based on error code
  if (error?.code === "permission-denied") {
    severity = ErrorSeverity.HIGH;
  } else if (error?.code === "unavailable" || error?.code === "deadline-exceeded") {
    severity = ErrorSeverity.HIGH;
  } else if (error?.code === "not-found") {
    severity = ErrorSeverity.LOW;
  }

  return await logError(error, {
    category: ErrorCategory.DATABASE,
    severity,
    context: context || "Database Operation",
    metadata,
  });
}

/**
 * Log Firebase Storage Error
 */
export async function logStorageError(error, context = "", metadata = {}) {
  let severity = ErrorSeverity.MEDIUM;
  
  if (error?.code === "storage/unauthorized" || error?.code === "storage/quota-exceeded") {
    severity = ErrorSeverity.HIGH;
  }

  return await logError(error, {
    category: ErrorCategory.STORAGE,
    severity,
    context: context || "Storage Operation",
    metadata,
  });
}

/**
 * Log Payment Error
 */
export async function logPaymentError(error, context = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.PAYMENT,
    severity: ErrorSeverity.HIGH,
    context: context || "Payment Operation",
    metadata,
  });
}

/**
 * Log Loan Error
 */
export async function logLoanError(error, context = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.LOAN,
    severity: ErrorSeverity.HIGH,
    context: context || "Loan Operation",
    metadata,
  });
}

/**
 * Log Form Submission Error
 */
export async function logFormError(error, formName = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.FORM,
    severity: ErrorSeverity.MEDIUM,
    context: `Form Submission: ${formName}`,
    metadata,
  });
}

/**
 * Log Validation Error
 */
export async function logValidationError(error, field = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    context: `Validation: ${field}`,
    metadata,
  });
}

/**
 * Log Network Error
 */
export async function logNetworkError(error, context = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    context: context || "Network Request",
    metadata,
  });
}

/**
 * Log Permission Error
 */
export async function logPermissionError(error, context = "", metadata = {}) {
  return await logError(error, {
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
    context: context || "Permission Check",
    metadata,
  });
}

/**
 * Get User-Friendly Error Message
 * @param {Error|string} error - Error object or error message
 * @returns {string} User-friendly error message
 */
export function getUserFriendlyErrorMessage(error) {
  const errorCode = error?.code || "";
  const errorMessage = error?.message || error || "An unexpected error occurred";

  // Firebase Auth errors
  if (errorCode === "auth/user-not-found") {
    return "No account found with this email address. Please check your email and try again.";
  }
  if (errorCode === "auth/wrong-password") {
    return "Incorrect password. Please try again.";
  }
  if (errorCode === "auth/email-already-in-use") {
    return "This email is already registered. Please use a different email or log in instead.";
  }
  if (errorCode === "auth/invalid-email") {
    return "Please enter a valid email address.";
  }
  if (errorCode === "auth/weak-password") {
    return "Password is too weak. Please use a stronger password (at least 6 characters).";
  }
  if (errorCode === "auth/too-many-requests") {
    return "Too many failed attempts. Please try again later.";
  }
  if (errorCode === "auth/network-request-failed") {
    return "Network error. Please check your internet connection and try again.";
  }
  if (errorCode === "auth/requires-recent-login") {
    return "Please log in again to perform this action.";
  }

  // Firebase Firestore errors
  if (errorCode === "permission-denied") {
    return "You don't have permission to perform this action. Please contact support.";
  }
  if (errorCode === "unavailable") {
    return "Service is temporarily unavailable. Please try again later.";
  }
  if (errorCode === "deadline-exceeded") {
    return "Request timed out. Please try again.";
  }
  if (errorCode === "not-found") {
    return "The requested resource was not found.";
  }

  // Firebase Storage errors
  if (errorCode === "storage/unauthorized") {
    return "You don't have permission to access this file.";
  }
  if (errorCode === "storage/quota-exceeded") {
    return "Storage quota exceeded. Please contact support.";
  }
  if (errorCode === "storage/object-not-found") {
    return "File not found.";
  }

  // Generic error messages
  if (errorMessage.includes("network") || errorMessage.includes("Network")) {
    return "Network error. Please check your internet connection and try again.";
  }
  if (errorMessage.includes("permission") || errorMessage.includes("Permission")) {
    return "You don't have permission to perform this action.";
  }
  if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
    return "Request timed out. Please try again.";
  }

  // Return original message if no match
  return errorMessage;
}

/**
 * Wrap async function with error logging
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context string for error logging
 * @param {Object} options - Error logging options
 * @returns {Function} Wrapped function
 */
export function withErrorLogging(fn, context, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      await logError(error, {
        context,
        ...options,
      });
      throw error;
    }
  };
}
