# Firestore Database Structure

## Overview
This document defines the complete Firestore database structure for the Bank Nkhonde multi-group savings and loan application. The structure is designed to support multiple independent groups with different rules and regulations.

## Visual Database Hierarchy

```
firestore (root)
│
├── users (collection)
│   └── {userId} (document)
│       ├── uid: string
│       ├── email: string
│       ├── fullName: string
│       ├── phone: string
│       ├── createdAt: Timestamp
│       ├── updatedAt: Timestamp
│       ├── profileImageUrl: string
│       └── groupMemberships: array
│           └── [{ groupId, role, joinedAt }]
│
├── groups (collection)
│   └── {groupId} (document)
│       ├── groupId: string
│       ├── groupName: string
│       ├── description: string
│       ├── createdAt: Timestamp
│       ├── createdBy: string
│       ├── status: string
│       ├── rules: object {...}
│       ├── statistics: object {...}
│       ├── admins: array [...]
│       │
│       ├── members (subcollection)
│       │   └── {userId} (document)
│       │       ├── uid: string
│       │       ├── fullName: string
│       │       ├── email: string
│       │       ├── phone: string
│       │       ├── role: string
│       │       ├── joinedAt: Timestamp
│       │       ├── status: string
│       │       ├── collateral: string
│       │       ├── customPaymentRules: object
│       │       └── financialSummary: object
│       │
│       ├── payments (subcollection)
│       │   └── {yearType} (document) [e.g., "2024_SeedMoney"]
│       │       ├── year: number
│       │       ├── paymentType: string
│       │       ├── createdAt: Timestamp
│       │       ├── totalExpected: number
│       │       ├── totalReceived: number
│       │       ├── totalPending: number
│       │       │
│       │       └── {userId} (subcollection)
│       │           └── {documentId} (document)
│       │               ├── userId: string
│       │               ├── fullName: string
│       │               ├── paymentType: string
│       │               ├── totalAmount: number
│       │               ├── amountPaid: number
│       │               ├── arrears: number
│       │               ├── approvalStatus: string
│       │               ├── paymentStatus: string
│       │               ├── dueDate: Timestamp
│       │               ├── paidAt: Timestamp
│       │               ├── approvedAt: Timestamp
│       │               ├── createdAt: Timestamp
│       │               ├── updatedAt: Timestamp
│       │               └── proofOfPayment: object
│       │
│       ├── loans (subcollection)
│       │   └── {loanId} (document)
│       │       ├── loanId: string
│       │       ├── borrowerId: string
│       │       ├── borrowerName: string
│       │       ├── loanAmount: number
│       │       ├── interestRate: number
│       │       ├── totalRepayable: number
│       │       ├── amountPaid: number
│       │       ├── amountRemaining: number
│       │       ├── status: string
│       │       ├── requestedAt: Timestamp
│       │       ├── approvedAt: Timestamp
│       │       ├── approvedBy: string
│       │       ├── repaymentSchedule: array
│       │       ├── penalties: object
│       │       ├── collateral: string
│       │       ├── purpose: string
│       │       └── notes: string
│       │
│       ├── transactions (subcollection)
│       │   └── {transactionId} (document)
│       │       ├── transactionId: string
│       │       ├── transactionType: string
│       │       ├── amount: number
│       │       ├── userId: string
│       │       ├── userName: string
│       │       ├── description: string
│       │       ├── status: string
│       │       ├── createdAt: Timestamp
│       │       ├── processedAt: Timestamp
│       │       ├── processedBy: string
│       │       └── metadata: object
│       │
│       ├── meetings (subcollection - optional)
│       │   └── {meetingId} (document)
│       │
│       └── notifications (subcollection)
│           └── {notificationId} (document)
│
├── invitationCodes (collection)
│   └── {codeId} (document)
│       ├── code: string
│       ├── approved: boolean
│       ├── used: boolean
│       ├── createdAt: Timestamp
│       ├── approvedAt: Timestamp
│       ├── approvedBy: string
│       ├── usedAt: Timestamp
│       ├── usedBy: string
│       └── expiresAt: Timestamp
│
├── invitations (collection)
│   └── {invitationId} (document)
│       ├── groupId: string
│       ├── groupName: string
│       ├── email: string
│       ├── invitedBy: string
│       ├── invitedByName: string
│       ├── invitedByEmail: string
│       ├── invitationToken: string
│       ├── status: string
│       ├── role: string
│       ├── createdAt: Timestamp
│       ├── expiresAt: Timestamp
│       ├── acceptedAt: Timestamp
│       └── acceptedBy: string
│
└── systemSettings (collection)
    └── config (document)
        ├── maintenanceMode: boolean
        ├── allowNewRegistrations: boolean
        ├── maxGroupsPerUser: number
        ├── defaultCycleDuration: number
        ├── supportEmail: string
        └── supportPhone: string
```

## Collection Details

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

---

## Practical Examples

### Example 1: Complete User Registration Flow

When a new user registers and creates a group:

```javascript
// 1. User document created in /users/{userId}
{
  uid: "abc123",
  email: "john@example.com",
  fullName: "John Doe",
  phone: "+265991234567",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  profileImageUrl: "",
  groupMemberships: [{
    groupId: "MoneyMasters_1641234567890",
    role: "senior_admin",
    joinedAt: Timestamp.now()
  }]
}

// 2. Group document created in /groups/{groupId}
{
  groupId: "MoneyMasters_1641234567890",
  groupName: "Money Masters",
  description: "",
  createdAt: Timestamp.now(),
  createdBy: "abc123",
  status: "active",
  rules: {
    seedMoney: {
      amount: 5000,
      dueDate: Timestamp.fromDate(new Date("2024-03-01")),
      required: true
    },
    monthlyContribution: {
      amount: 2000,
      required: true,
      dayOfMonth: 15
    },
    interestRate: 10,
    loanPenalty: { rate: 5, type: "percentage" },
    monthlyPenalty: { rate: 2, type: "percentage" },
    cycleDuration: {
      startDate: Timestamp.fromDate(new Date("2024-01-15")),
      endDate: null,
      months: 12
    },
    customRules: []
  },
  statistics: {
    totalMembers: 1,
    totalFunds: 0,
    totalLoans: 0,
    totalArrears: 5000
  },
  admins: [{
    uid: "abc123",
    fullName: "John Doe",
    email: "john@example.com",
    role: "senior_admin",
    assignedAt: Timestamp.now()
  }]
}

// 3. Member document in /groups/{groupId}/members/{userId}
{
  uid: "abc123",
  fullName: "John Doe",
  email: "john@example.com",
  phone: "+265991234567",
  role: "senior_admin",
  joinedAt: Timestamp.now(),
  status: "active",
  collateral: null,
  customPaymentRules: {},
  financialSummary: {
    totalPaid: 0,
    totalArrears: 5000,
    totalLoans: 0,
    totalLoansPaid: 0
  }
}

// 4. Payment year document in /groups/{groupId}/payments/2024_SeedMoney
{
  year: 2024,
  paymentType: "SeedMoney",
  createdAt: Timestamp.now(),
  totalExpected: 5000,
  totalReceived: 0,
  totalPending: 0
}

// 5. Individual payment in /groups/{groupId}/payments/2024_SeedMoney/{userId}/PaymentDetails
{
  userId: "abc123",
  fullName: "John Doe",
  paymentType: "Seed Money",
  totalAmount: 5000,
  amountPaid: 0,
  arrears: 5000,
  approvalStatus: "unpaid",
  paymentStatus: "unpaid",
  dueDate: Timestamp.fromDate(new Date("2024-03-01")),
  paidAt: null,
  approvedAt: null,
  createdAt: Timestamp.now(),
  updatedAt: null,
  proofOfPayment: {
    imageUrl: "",
    uploadedAt: null,
    verifiedBy: ""
  }
}
```

---

### Example 2: Adding a New Member to an Existing Group

When an admin adds a new member:

```javascript
// 1. Update member document in /groups/{groupId}/members/{newUserId}
{
  uid: "xyz789",
  fullName: "Jane Smith",
  email: "jane@example.com",
  phone: "+265997654321",
  role: "member",
  joinedAt: Timestamp.now(),
  status: "active",
  collateral: "Land Title #12345",
  customPaymentRules: {
    // Jane gets a discount on seed money
    seedMoney: 4000  // Instead of the default 5000
  },
  financialSummary: {
    totalPaid: 0,
    totalArrears: 4000,
    totalLoans: 0,
    totalLoansPaid: 0
  }
}

// 2. Add to user's global profile if not exists
// Create or update /users/{newUserId}
{
  uid: "xyz789",
  email: "jane@example.com",
  fullName: "Jane Smith",
  phone: "+265997654321",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  profileImageUrl: "",
  groupMemberships: [{
    groupId: "MoneyMasters_1641234567890",
    role: "member",
    joinedAt: Timestamp.now()
  }]
}

// 3. Update group statistics in /groups/{groupId}
{
  statistics: {
    totalMembers: 2,  // Incremented
    totalFunds: 0,
    totalLoans: 0,
    totalArrears: 9000  // 5000 + 4000
  }
}
```

---

### Example 3: Payment Submission and Approval Flow

When a member submits a payment:

```javascript
// 1. Member uploads proof and updates their payment document
// Path: /groups/{groupId}/payments/2024_SeedMoney/{userId}/PaymentDetails
{
  userId: "xyz789",
  fullName: "Jane Smith",
  paymentType: "Seed Money",
  totalAmount: 4000,
  amountPaid: 0,
  arrears: 4000,
  approvalStatus: "pending",  // Changed from "unpaid"
  paymentStatus: "unpaid",
  dueDate: Timestamp.fromDate(new Date("2024-03-01")),
  paidAt: Timestamp.now(),  // Timestamp of submission
  approvedAt: null,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),  // Updated
  proofOfPayment: {
    imageUrl: "https://storage.googleapis.com/bucket/proof123.jpg",
    uploadedAt: Timestamp.now(),
    verifiedBy: ""
  }
}

// 2. Admin approves the payment
{
  userId: "xyz789",
  fullName: "Jane Smith",
  paymentType: "Seed Money",
  totalAmount: 4000,
  amountPaid: 4000,  // Updated
  arrears: 0,  // Updated
  approvalStatus: "approved",  // Changed
  paymentStatus: "paid",  // Changed
  dueDate: Timestamp.fromDate(new Date("2024-03-01")),
  paidAt: Timestamp.now(),
  approvedAt: Timestamp.now(),  // Set
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  proofOfPayment: {
    imageUrl: "https://storage.googleapis.com/bucket/proof123.jpg",
    uploadedAt: Timestamp.now(),
    verifiedBy: "abc123"  // Admin UID
  }
}

// 3. Transaction record created in /groups/{groupId}/transactions/{transactionId}
{
  transactionId: "txn_1641234567890",
  transactionType: "payment",
  amount: 4000,
  userId: "xyz789",
  userName: "Jane Smith",
  description: "Seed Money payment approved",
  status: "completed",
  createdAt: Timestamp.now(),
  processedAt: Timestamp.now(),
  processedBy: "abc123",  // Admin who approved
  metadata: {
    paymentType: "Seed Money",
    referenceId: "2024_SeedMoney/xyz789/PaymentDetails",
    proofUrl: "https://storage.googleapis.com/bucket/proof123.jpg"
  }
}

// 4. Update payment year summary
// Path: /groups/{groupId}/payments/2024_SeedMoney
{
  year: 2024,
  paymentType: "SeedMoney",
  createdAt: Timestamp.now(),
  totalExpected: 9000,
  totalReceived: 4000,  // Updated
  totalPending: 0  // Updated
}

// 5. Update member's financial summary
// Path: /groups/{groupId}/members/{userId}
{
  financialSummary: {
    totalPaid: 4000,  // Updated
    totalArrears: 0,  // Updated
    totalLoans: 0,
    totalLoansPaid: 0
  }
}

// 6. Update group statistics
// Path: /groups/{groupId}
{
  statistics: {
    totalMembers: 2,
    totalFunds: 4000,  // Updated
    totalLoans: 0,
    totalArrears: 5000  // Updated (John's 5000 still pending)
  }
}
```

---

### Example 4: Loan Request and Approval

When a member requests a loan:

```javascript
// 1. Loan document created in /groups/{groupId}/loans/{loanId}
{
  loanId: "loan_1641234567890",
  borrowerId: "xyz789",
  borrowerName: "Jane Smith",
  loanAmount: 10000,
  interestRate: 10,  // From group rules
  totalRepayable: 11000,  // 10000 + 10%
  amountPaid: 0,
  amountRemaining: 11000,
  status: "pending",
  requestedAt: Timestamp.now(),
  approvedAt: null,
  approvedBy: null,
  repaymentSchedule: [
    {
      dueDate: Timestamp.fromDate(new Date("2024-04-15")),
      amount: 3666.67,
      status: "pending",
      paidAt: null
    },
    {
      dueDate: Timestamp.fromDate(new Date("2024-05-15")),
      amount: 3666.67,
      status: "pending",
      paidAt: null
    },
    {
      dueDate: Timestamp.fromDate(new Date("2024-06-15")),
      amount: 3666.66,
      status: "pending",
      paidAt: null
    }
  ],
  penalties: {
    totalPenalties: 0,
    penaltyRate: 5
  },
  collateral: "Land Title #12345",
  purpose: "Small business expansion",
  notes: "Requesting loan for shop inventory"
}

// 2. Admin approves the loan
{
  // ... same fields as above with updates:
  status: "active",  // Changed from "pending"
  approvedAt: Timestamp.now(),  // Set
  approvedBy: "abc123"  // Admin UID
}

// 3. Transaction created in /groups/{groupId}/transactions/{transactionId}
{
  transactionId: "txn_1641234567891",
  transactionType: "loan",
  amount: 10000,
  userId: "xyz789",
  userName: "Jane Smith",
  description: "Loan approved and disbursed",
  status: "completed",
  createdAt: Timestamp.now(),
  processedAt: Timestamp.now(),
  processedBy: "abc123",
  metadata: {
    loanId: "loan_1641234567890",
    interestRate: 10,
    totalRepayable: 11000
  }
}

// 4. Update member's financial summary
{
  financialSummary: {
    totalPaid: 4000,
    totalArrears: 0,
    totalLoans: 11000,  // Updated
    totalLoansPaid: 0
  }
}

// 5. Update group statistics
{
  statistics: {
    totalMembers: 2,
    totalFunds: -6000,  // 4000 - 10000 (funds decreased)
    totalLoans: 11000,  // Updated
    totalArrears: 5000
  }
}
```

---

## Data Relationships Diagram

```
User (John Doe)
│
├── Global Profile (/users/abc123)
│   └── groupMemberships: [MoneyMasters, SaversClub]
│
├── MoneyMasters Group
│   ├── Member Record (/groups/MoneyMasters_123/members/abc123)
│   ├── Seed Money Payment (/groups/MoneyMasters_123/payments/2024_SeedMoney/abc123/PaymentDetails)
│   ├── Monthly Payments (/groups/MoneyMasters_123/payments/2024_MonthlyContributions/abc123/...)
│   └── Loans (/groups/MoneyMasters_123/loans/loan_xyz)
│
└── SaversClub Group
    └── Member Record (/groups/SaversClub_456/members/abc123)
```

---

## Migration Considerations

When updating from the current structure:
1. Add missing fields gradually with default values
2. Use Cloud Functions for data migration if needed
3. Maintain backward compatibility during transition
4. Update security rules to match new structure

---

## Query Examples

### Get all members in a group
```javascript
const membersRef = collection(db, `groups/${groupId}/members`);
const membersSnapshot = await getDocs(membersRef);
```

### Get all unpaid payments for a user
```javascript
const paymentsRef = collection(db, `groups/${groupId}/payments/2024_SeedMoney/${userId}`);
const q = query(paymentsRef, where("paymentStatus", "==", "unpaid"));
const unpaidPayments = await getDocs(q);
```

### Get all active loans
```javascript
const loansRef = collection(db, `groups/${groupId}/loans`);
const q = query(loansRef, where("status", "==", "active"));
const activeLoans = await getDocs(q);
```

### Get recent transactions
```javascript
const transactionsRef = collection(db, `groups/${groupId}/transactions`);
const q = query(transactionsRef, orderBy("createdAt", "desc"), limit(10));
const recentTransactions = await getDocs(q);
```
