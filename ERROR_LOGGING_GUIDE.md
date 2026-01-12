# Error Logging System - Bank Nkhonde

## Overview

A centralized error logging system has been implemented to track and monitor errors throughout the Bank Nkhonde application. This system provides structured error logging with categorization, severity levels, and optional Firestore storage for production monitoring.

## Error Logger Module

**Location:** `scripts/errorLogger.js`

### Features

- **Categorized Error Logging**: Errors are categorized by type (authentication, database, payment, etc.)
- **Severity Levels**: Errors are assigned severity levels (low, medium, high, critical)
- **Console Logging**: All errors are logged to the browser console with appropriate formatting
- **Firestore Logging**: High and critical severity errors are automatically logged to Firestore (in production)
- **User-Friendly Messages**: Provides helper functions to convert technical error messages to user-friendly text
- **Rich Context**: Includes user ID, group ID, action context, and metadata with each error

## Usage

### Basic Error Logging

```javascript
import { logError, ErrorCategory, ErrorSeverity } from "./errorLogger.js";

try {
  // Your code here
} catch (error) {
  await logError(error, {
    category: ErrorCategory.DATABASE,
    severity: ErrorSeverity.MEDIUM,
    context: "loadUserData",
    metadata: { userId: user.uid, groupId: groupId }
  });
}
```

### Specialized Error Loggers

The module provides specialized functions for common error types:

#### Authentication Errors
```javascript
import { logAuthError } from "./errorLogger.js";

try {
  await signInWithEmailAndPassword(auth, email, password);
} catch (error) {
  await logAuthError(error, "User Login", { email });
}
```

#### Database Errors
```javascript
import { logDatabaseError } from "./errorLogger.js";

try {
  const doc = await getDoc(docRef);
} catch (error) {
  await logDatabaseError(error, "Fetch User Document", { userId: user.uid });
}
```

#### Storage Errors
```javascript
import { logStorageError } from "./errorLogger.js";

try {
  await uploadBytes(storageRef, file);
} catch (error) {
  await logStorageError(error, "Upload Payment Proof", { fileName: file.name });
}
```

#### Payment Errors
```javascript
import { logPaymentError } from "./errorLogger.js";

try {
  await processPayment(paymentData);
} catch (error) {
  await logPaymentError(error, "Process Payment", { amount, paymentType });
}
```

#### Loan Errors
```javascript
import { logLoanError } from "./errorLogger.js";

try {
  await createLoan(loanData);
} catch (error) {
  await logLoanError(error, "Create Loan", { loanId, amount });
}
```

#### Form Errors
```javascript
import { logFormError } from "./errorLogger.js";

try {
  await submitForm(formData);
} catch (error) {
  await logFormError(error, "Registration Form", { email });
}
```

### User-Friendly Error Messages

```javascript
import { getUserFriendlyErrorMessage } from "./errorLogger.js";

try {
  // Your code
} catch (error) {
  const friendlyMessage = getUserFriendlyErrorMessage(error);
  alert(friendlyMessage);
}
```

## Error Categories

- `AUTHENTICATION`: Authentication and authorization errors
- `DATABASE`: Firestore database operation errors
- `STORAGE`: Firebase Storage operation errors
- `PAYMENT`: Payment processing errors
- `LOAN`: Loan operation errors
- `FORM`: Form submission errors
- `CALENDAR`: Calendar and date-related errors
- `NOTIFICATION`: Notification sending errors
- `VALIDATION`: Input validation errors
- `NETWORK`: Network request errors
- `PERMISSION`: Permission/access control errors
- `SYSTEM`: General system errors
- `UNKNOWN`: Uncategorized errors

## Error Severity Levels

- `LOW`: Non-critical errors (e.g., optional data not found)
- `MEDIUM`: Moderate errors (e.g., non-critical operation failures)
- `HIGH`: Serious errors (e.g., payment failures, permission denied)
- `CRITICAL`: Critical errors (e.g., system failures, data corruption)

## Firestore Error Logs Collection

In production environments, high and critical severity errors are automatically logged to Firestore:

**Collection:** `errorLogs`

**Document Structure:**
```javascript
{
  errorName: "Error",
  errorMessage: "Error message",
  errorCode: "error-code",
  errorStack: "Stack trace...",
  category: "database",
  severity: "high",
  context: "loadUserData",
  userId: "user-id",
  userEmail: "user@example.com",
  metadata: {
    groupId: "group-id",
    timestamp: "2024-01-01T00:00:00.000Z",
    url: "https://...",
    userAgent: "...",
    referrer: "..."
  },
  createdAt: Timestamp
}
```

## Integration Status

The error logging system has been integrated into:

- ✅ `scripts/user_dashboard.js` - User dashboard operations
  - Authentication errors (logout)
  - Database errors (loading user data, groups, payments)
  - Storage errors (payment proof uploads)
  - Payment errors (payment uploads)
  - Calendar errors (loading payment calendar)

### Files Pending Integration

The following files could benefit from error logging integration:

- `scripts/login.js` - Login authentication
- `scripts/registration.js` - User registration
- `scripts/admin_dashboard.js` - Admin operations
- `scripts/manage_members.js` - Member management
- `scripts/manage_loans.js` - Loan management
- `scripts/broadcast_notifications.js` - Notification sending
- `scripts/settings.js` - Settings updates

## Best Practices

1. **Use Appropriate Categories**: Always use the correct error category
2. **Set Correct Severity**: Assign appropriate severity levels
3. **Provide Context**: Include meaningful context strings
4. **Include Metadata**: Add relevant metadata (user IDs, group IDs, etc.)
5. **Don't Log Everything**: Don't log low-severity errors for expected conditions
6. **User-Friendly Messages**: Use `getUserFriendlyErrorMessage()` for user-facing errors
7. **Avoid Logging Sensitive Data**: Don't include passwords or sensitive information in logs

## Example: Complete Error Handling

```javascript
import { 
  logDatabaseError, 
  getUserFriendlyErrorMessage,
  ErrorSeverity 
} from "./errorLogger.js";

async function loadUserData(userId) {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) {
      throw new Error("User not found");
    }
    return userDoc.data();
  } catch (error) {
    await logDatabaseError(error, "loadUserData", { userId });
    const friendlyMessage = getUserFriendlyErrorMessage(error);
    showErrorToUser(friendlyMessage);
    return null;
  }
}
```

## Monitoring Error Logs

To monitor error logs in production:

1. **Firebase Console**: Navigate to Firestore → `errorLogs` collection
2. **Filter by Severity**: Filter for HIGH or CRITICAL errors
3. **Filter by Category**: Filter by error category to identify patterns
4. **Monitor Trends**: Track error frequency and patterns over time

## Future Enhancements

Potential improvements to the error logging system:

1. **Error Alerting**: Set up alerts for critical errors
2. **Error Analytics**: Build dashboards for error analysis
3. **Error Aggregation**: Group similar errors together
4. **Automatic Reporting**: Generate automated error reports
5. **User Feedback Integration**: Allow users to submit additional context for errors
