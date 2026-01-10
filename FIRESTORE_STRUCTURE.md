# Firestore Database Structure

## Overview
This document defines the complete Firestore database structure for the Bank Nkhonde multi-group savings and loan application. The structure is designed to support multiple independent groups with different rules and regulations.

## Collection Structure

### 1. **users** (Root Collection)
Stores global user information across all groups.

**Document ID**: Firebase Auth UID
**Fields**:
```javascript
{
  uid: string,                    // Firebase Auth UID
  email: string,                  // User's email (unique)
  fullName: string,               // User's full name
  phone: string,                  // Phone number with country code
  createdAt: Timestamp,           // Account creation date
  updatedAt: Timestamp,           // Last profile update
  profileImageUrl: string,        // Optional profile picture
  groupMemberships: [             // Array of group IDs where user is a member
    {
      groupId: string,
      role: string,               // 'admin', 'member', 'senior_admin'
      joinedAt: Timestamp
    }
  ]
}
```

---

### 2. **groups** (Root Collection)
Stores group-level configuration and settings.

**Document ID**: Auto-generated unique ID
**Fields**:
```javascript
{
  groupId: string,                     // Same as document ID
  groupName: string,                   // Name of the savings group
  description: string,                 // Optional group description
  createdAt: Timestamp,                // Group creation date
  createdBy: string,                   // UID of creator
  status: string,                      // 'active', 'inactive', 'dissolved'
  
  // Group Financial Rules
  rules: {
    seedMoney: {
      amount: number,                  // Required seed money amount
      dueDate: Timestamp,              // When seed money is due
      required: boolean                // Whether seed money is mandatory
    },
    monthlyContribution: {
      amount: number,                  // Monthly contribution amount
      required: boolean,               // Whether monthly contribution is mandatory
      dayOfMonth: number               // Day of month when payment is due (1-31)
    },
    interestRate: number,              // Loan interest rate percentage
    loanPenalty: {
      rate: number,                    // Penalty rate percentage
      type: string                     // 'fixed', 'percentage'
    },
    monthlyPenalty: {
      rate: number,                    // Monthly penalty rate percentage
      type: string                     // 'fixed', 'percentage'
    },
    cycleDuration: {
      startDate: Timestamp,            // Cycle start date
      endDate: Timestamp,              // Cycle end date (optional)
      months: number                   // Number of months in cycle
    },
    customRules: [                     // Array for flexible custom rules
      {
        name: string,
        description: string,
        value: any
      }
    ]
  },
  
  // Group Statistics
  statistics: {
    totalMembers: number,
    totalFunds: number,
    totalLoans: number,
    totalArrears: number
  },
  
  // Admin Information
  admins: [                            // Array of admin UIDs
    {
      uid: string,
      email: string,
      fullName: string,
      role: string,                    // 'senior_admin', 'admin'
      assignedAt: Timestamp
    }
  ]
}
```

**Subcollections**:
- `members`: Individual member data for this group
- `payments`: Payment tracking per year/type
- `loans`: Loan records
- `transactions`: Financial transaction history
- `meetings`: Meeting records (optional)
- `notifications`: Group-specific notifications

---

### 3. **groups/{groupId}/members** (Subcollection)
Stores member-specific data within a group.

**Document ID**: Firebase Auth UID
**Fields**:
```javascript
{
  uid: string,                    // Firebase Auth UID
  fullName: string,               // Member's name
  email: string,                  // Member's email
  phone: string,                  // Member's phone
  role: string,                   // 'admin', 'member', 'senior_admin'
  joinedAt: Timestamp,            // When member joined group
  status: string,                 // 'active', 'inactive', 'suspended'
  
  // Member-specific settings
  collateral: string,             // Collateral information (optional)
  customPaymentRules: {           // Override group defaults if needed
    seedMoney: number,            // Custom seed money amount
    monthlyContribution: number   // Custom monthly contribution
  },
  
  // Financial Summary
  financialSummary: {
    totalPaid: number,
    totalArrears: number,
    totalLoans: number,
    totalLoansPaid: number
  }
}
```

---

### 4. **groups/{groupId}/payments/{yearType}** (Subcollection)
Organizes payments by year and type.

**Document ID**: Format: `{YYYY}_{PaymentType}` (e.g., "2024_SeedMoney", "2024_MonthlyContributions")
**Fields**:
```javascript
{
  year: number,                   // Payment year
  paymentType: string,            // 'SeedMoney', 'MonthlyContributions'
  createdAt: Timestamp,
  totalExpected: number,          // Total expected from all members
  totalReceived: number,          // Total actually received
  totalPending: number            // Total pending approval
}
```

**Subcollection**: `{userId}` - Payment records for specific users

---

### 5. **groups/{groupId}/payments/{yearType}/{userId}/{documentId}** (Subcollection)
Individual payment records.

For Seed Money:
**Document ID**: "PaymentDetails"
**Fields**:
```javascript
{
  userId: string,
  fullName: string,
  paymentType: string,            // 'Seed Money'
  totalAmount: number,            // Amount due
  amountPaid: number,             // Amount paid so far
  arrears: number,                // Remaining balance
  approvalStatus: string,         // 'unpaid', 'pending', 'approved', 'rejected'
  paymentStatus: string,          // 'unpaid', 'partial', 'paid'
  dueDate: Timestamp,
  paidAt: Timestamp,              // When payment was made (optional)
  approvedAt: Timestamp,          // When payment was approved (optional)
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Payment proof
  proofOfPayment: {
    imageUrl: string,
    uploadedAt: Timestamp,
    verifiedBy: string            // UID of admin who verified
  }
}
```

For Monthly Contributions:
**Document ID**: Format: `{YYYY}_{MonthName}` (e.g., "2024_January")
**Fields**: Same as Seed Money structure

---

### 6. **groups/{groupId}/loans** (Subcollection)
Tracks loan records for the group.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  loanId: string,                 // Same as document ID
  borrowerId: string,             // UID of borrower
  borrowerName: string,
  loanAmount: number,
  interestRate: number,           // Interest rate at time of loan
  totalRepayable: number,         // Principal + interest
  amountPaid: number,
  amountRemaining: number,
  
  status: string,                 // 'pending', 'approved', 'active', 'paid', 'defaulted'
  
  requestedAt: Timestamp,
  approvedAt: Timestamp,
  approvedBy: string,             // UID of admin who approved
  
  repaymentSchedule: [
    {
      dueDate: Timestamp,
      amount: number,
      status: string,             // 'pending', 'paid', 'overdue'
      paidAt: Timestamp
    }
  ],
  
  penalties: {
    totalPenalties: number,
    penaltyRate: number
  },
  
  collateral: string,
  purpose: string,
  notes: string
}
```

---

### 7. **groups/{groupId}/transactions** (Subcollection)
Complete transaction history for audit trail.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  transactionId: string,
  transactionType: string,        // 'payment', 'loan', 'withdrawal', 'penalty'
  amount: number,
  userId: string,                 // User involved in transaction
  userName: string,
  description: string,
  status: string,                 // 'pending', 'completed', 'cancelled'
  
  createdAt: Timestamp,
  processedAt: Timestamp,
  processedBy: string,            // UID of admin who processed
  
  metadata: {                     // Flexible field for transaction-specific data
    paymentType: string,
    referenceId: string,
    proofUrl: string
  }
}
```

---

### 8. **invitationCodes** (Root Collection)
Manages registration approval codes.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  code: string,                   // 8-character registration code
  approved: boolean,              // Whether code is approved by senior admin
  used: boolean,                  // Whether code has been used
  createdAt: Timestamp,
  approvedAt: Timestamp,
  approvedBy: string,             // UID of senior admin who approved
  usedAt: Timestamp,
  usedBy: string,                 // UID of user who used the code
  expiresAt: Timestamp            // Optional expiration date
}
```

---

### 9. **invitations** (Root Collection)
Manages member invitations to join existing groups.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  groupId: string,
  groupName: string,
  email: string,                  // Email of invited person
  invitedBy: string,              // UID of person who sent invitation
  invitedByName: string,
  invitedByEmail: string,
  
  invitationToken: string,        // Unique token for acceptance link
  status: string,                 // 'pending', 'accepted', 'expired', 'cancelled'
  role: string,                   // Role to assign when accepted
  
  createdAt: Timestamp,
  expiresAt: Timestamp,
  acceptedAt: Timestamp,
  acceptedBy: string              // UID when invitation is accepted
}
```

---

### 10. **systemSettings** (Root Collection)
Global system configuration (optional).

**Document ID**: "config"
**Fields**:
```javascript
{
  maintenanceMode: boolean,
  allowNewRegistrations: boolean,
  maxGroupsPerUser: number,
  defaultCycleDuration: number,   // In months
  supportEmail: string,
  supportPhone: string
}
```

---

## Key Design Principles

1. **Separation of Concerns**: User data is separate from group data
2. **Flexibility**: Groups can have different rules through the `rules` object
3. **Scalability**: Subcollections prevent document size limits
4. **Audit Trail**: Transaction history maintains complete records
5. **No Duplication**: User emails and UIDs are unique across the system
6. **Optional Fields**: Many fields are optional to support different group types
7. **Consistent Naming**: Uses camelCase for all field names
8. **Type Safety**: Clear data types for all fields

## Migration Considerations

When updating from the current structure:
1. Add missing fields gradually with default values
2. Use Cloud Functions for data migration if needed
3. Maintain backward compatibility during transition
4. Update security rules to match new structure
