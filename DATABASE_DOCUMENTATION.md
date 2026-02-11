# Bank Nkhonde - Database Documentation

**Last Updated:** February 11, 2026  
**Version:** 1.0  
**Database:** Cloud Firestore (Firebase)  
**Type:** NoSQL Document Database

---

## Table of Contents

1. [Database Overview](#database-overview)
2. [Collections Structure](#collections-structure)
3. [Data Relationships](#data-relationships)
4. [Security Rules](#security-rules)
5. [Data Flow Examples](#data-flow-examples)
6. [Indexes & Query Optimization](#indexes--query-optimization)
7. [Backup & Recovery](#backup--recovery)
8. [Schema Evolution](#schema-evolution)

---

## Database Overview

### Firestore Basics

**Document-Based NoSQL:**
- Hierarchical structure: Collections → Documents → Fields
- Subcollections for nested data
- Real-time synchronization
- Offline persistence
- Automatic scaling

**Why Firestore:**
- Real-time updates for live payment tracking
- Offline support for mobile users
- Automatic indexing for fast queries
- Built-in security rules
- Serverless (no backend management)

### Database Hierarchy

```
Firestore
├── users (collection)
│   └── {userId} (document)
│
├── groups (collection)
│   └── {groupId} (document)
│       ├── members (subcollection)
│       │   └── {memberId} (document)
│       ├── payments (subcollection)
│       │   ├── {year}_SeedMoney (document)
│       │   │   └── {memberId} (subcollection)
│       │   │       └── PaymentDetails (document)
│       │   ├── {year}_MonthlyContributions (document)
│       │   │   └── {memberId} (subcollection)
│       │   │       └── {monthName} (document)
│       │   └── {year}_ServiceFee (document)
│       │       └── {memberId} (subcollection)
│       │           └── PaymentDetails (document)
│       ├── loans (subcollection)
│       │   └── {loanId} (document)
│       │       └── payments (subcollection)
│       │           └── {paymentId} (document)
│       ├── notifications (subcollection)
│       │   └── {notificationId} (document)
│       ├── messages (subcollection)
│       │   └── {messageId} (document)
│       └── broadcasts (subcollection)
│           └── {broadcastId} (document)
│
├── invitationCodes (collection)
│   └── {codeId} (document)
│
└── auditLogs (collection)
    └── {logId} (document)
```

---

## Collections Structure

### 1. Users Collection: `users/{userId}`

**Purpose:** Global user profiles (independent of groups)

**Document ID:** Firebase Auth UID

**Schema:**
```javascript
{
  uid: string,                    // Firebase Auth UID (same as document ID)
  email: string,                  // Primary email (unique)
  fullName: string,               // Display name
  phone: string,                  // Contact number
  whatsappNumber: string,         // WhatsApp contact
  profileImageUrl: string,        // Firebase Storage URL
  createdAt: Timestamp,           // Account creation date
  updatedAt: Timestamp,           // Last profile update
  
  // Group memberships (denormalized for quick access)
  groupMemberships: [
    {
      groupId: string,            // Reference to groups/{groupId}
      role: string,               // "member" | "admin" | "senior_admin"
      joinedAt: Timestamp         // When joined this group
    }
  ],
  
  // Optional fields
  dateOfBirth: Timestamp | null,
  address: string | null,
  nationality: string | null,
  occupation: string | null,
  emailVerified: boolean           // Firebase Auth verification status
}
```

**Indexes:**
- email (automatic unique index via Firebase Auth)
- uid (document ID, automatically indexed)

**Access Control:**
- Users can read/update their own profile
- Cannot change email or uid
- Cannot delete their account (must contact admin)

---

### 2. Groups Collection: `groups/{groupId}`

**Purpose:** Store group-level configuration and rules

**Document ID:** Auto-generated Firestore ID

**Schema:**
```javascript
{
  groupId: string,                // Same as document ID
  groupName: string,              // Display name
  description: string,            // Purpose/description
  status: string,                 // "active" | "inactive" | "completed"
  createdBy: string,              // User ID of creator
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Financial Rules Configuration
  rules: {
    seedMoney: {
      amount: number,             // e.g., 10000 MWK
      dueDate: Timestamp,         // Deadline for payment
      required: boolean,          // Must pay to join?
      allowPartialPayment: boolean,
      maxPaymentMonths: number,   // e.g., 2 months
      mustBeFullyPaid: boolean    // Must complete before loans?
    },
    
    monthlyContribution: {
      amount: number,             // e.g., 50000 MWK/month
      required: boolean,
      dayOfMonth: number,         // e.g., 15 (15th of each month)
      allowPartialPayment: boolean
    },
    
    serviceFee: {
      amount: number,             // Optional operational fee
      required: boolean,
      dueDate: Timestamp | null,
      perCycle: boolean,          // One-time per cycle
      nonRefundable: boolean,
      description: string
    },
    
    loanInterest: {
      rates: {
        month1: number,           // e.g., 10 (10%)
        month2: number,           // e.g., 7 (7%)
        month3: number            // e.g., 5 (5%)
      },
      calculationMethod: string,  // "reduced_balance" | "flat_rate"
      maxRepaymentMonths: number  // e.g., 3
    },
    
    loanPenalty: {
      rate: number,               // Percentage penalty
      type: string,               // "percentage" | "fixed"
      gracePeriodDays: number     // e.g., 3 days
    },
    
    contributionPenalty: {
      dailyRate: number,          // Daily penalty rate
      monthlyRate: number,        // Monthly penalty rate
      type: string,               // "percentage"
      gracePeriodDays: number     // e.g., 5 days
    },
    
    cycleDuration: {
      startDate: Timestamp,       // Cycle start
      endDate: Timestamp | null,  // Cycle end (calculated)
      months: number,             // e.g., 12
      autoRenew: boolean          // Start new cycle automatically?
    },
    
    loanRules: {
      maxLoanAmount: number,      // e.g., 500000 MWK
      minCycleLoanAmount: number, // Minimum for forced loans
      maxActiveLoansByMember: number, // Usually 1
      requireCollateral: boolean,
      minRepaymentMonths: number, // e.g., 1
      maxRepaymentMonths: number  // e.g., 3
    }
  },
  
  // Admin Information (denormalized)
  admins: [
    {
      uid: string,                // User ID
      email: string,              // For notifications
      name: string,               // Display name
      role: string,               // "admin" | "senior_admin"
      addedAt: Timestamp
    }
  ],
  
  // Group Statistics (calculated/cached)
  statistics: {
    totalMembers: number,
    activeLoans: number,
    totalCollected: number,
    totalDisbursed: number,
    lastUpdated: Timestamp
  }
}
```

**Indexes:**
- groupId (document ID)
- createdBy (for finding groups created by user)
- status (for filtering active groups)

---

### 3. Members Subcollection: `groups/{groupId}/members/{memberId}`

**Purpose:** Store member-specific data for each group

**Document ID:** User ID from users collection

**Schema:**
```javascript
{
  // User Reference
  uid: string,                    // References users/{userId}
  userId: string,                 // Same as uid (consistency)
  
  // Personal Info (denormalized from users)
  fullName: string,
  email: string,
  phone: string,
  whatsappNumber: string,
  profileImageUrl: string,
  
  // Group Membership
  role: string,                   // "member" | "admin" | "senior_admin"
  status: string,                 // "active" | "inactive" | "suspended"
  joinedAt: Timestamp,
  invitedBy: string | null,       // User ID who invited
  
  // Financial Summary (calculated from payments)
  financialSummary: {
    totalPaid: number,            // Sum of all approved payments
    totalArrears: number,         // Sum of all outstanding amounts
    totalPending: number,         // Sum of pending payments
    totalLoans: number,           // Sum of all loans taken
    totalLoansPaid: number,       // Sum of loan repayments made
    totalPenalties: number,       // Sum of penalties charged
    lastPaymentDate: Timestamp | null,
    lastUpdated: Timestamp
  },
  
  // Compliance Status
  seedMoneyPaid: boolean,         // Fully paid?
  monthlyContributionsCurrent: boolean, // Up to date?
  eligibleForLoan: boolean,       // Can take loan?
  
  // Metadata
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

**Calculated Fields:**
- `financialSummary` updated on every payment approval
- `eligibleForLoan` recalculated based on payment status
- `monthlyContributionsCurrent` checks if arrears exist

---

### 4. Payments Structure

#### 4.1 Seed Money: `groups/{groupId}/payments/{year}_SeedMoney/{memberId}/PaymentDetails`

**Purpose:** Track one-time seed money contributions

**Path Explanation:**
- `{year}`: Payment year (e.g., "2026")
- `{memberId}`: Member's user ID
- `PaymentDetails`: Fixed document name

**Schema:**
```javascript
{
  // Member Reference
  userId: string,                 // Member ID
  fullName: string,               // Member name (denormalized)
  
  // Payment Details
  paymentType: string,            // "Seed Money"
  totalAmount: number,            // Total due (from group rules)
  amountPaid: number,             // Total paid so far
  arrears: number,                // Remaining balance
  
  // Status
  approvalStatus: string,         // "unpaid" | "pending" | "approved" | "rejected" | "completed"
  paymentStatus: string,          // "Pending" | "Completed"
  
  // Payment Proof
  proofOfPayment: {
    imageUrl: string,             // Firebase Storage URL
    fileName: string,
    fileSize: number,
    uploadedBy: string,           // User ID
    uploadedAt: Timestamp,
    verifiedBy: string | null,    // Admin who approved
    verifiedAt: Timestamp | null
  } | null,
  
  // Approval Tracking
  approvedBy: string | null,      // Admin user ID
  approvedAt: Timestamp | null,
  rejectedBy: string | null,
  rejectedAt: Timestamp | null,
  rejectionReason: string | null,
  
  // Timestamps
  dueDate: Timestamp,             // From group rules
  paidAt: Timestamp | null,       // When payment was made
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Additional Info
  paymentMethod: string,          // "cash" | "bank_transfer" | "mobile_money"
  notes: string | null,
  recordedManually: boolean,      // Admin-recorded vs user-uploaded
  isAdvancedPayment: boolean      // Always false for seed money
}
```

#### 4.2 Monthly Contributions: `groups/{groupId}/payments/{year}_MonthlyContributions/{memberId}/{monthName}`

**Purpose:** Track monthly savings contributions

**Path Explanation:**
- `{year}`: Payment year (e.g., "2026")
- `{memberId}`: Member's user ID
- `{monthName}`: Month name (e.g., "January", "February")

**Schema:**
```javascript
{
  // Member Reference
  userId: string,
  memberId: string,               // Same as userId
  memberName: string,
  
  // Payment Period
  type: string,                   // "monthly_contribution"
  month: string,                  // "January", "February", etc.
  year: number,                   // 2026
  
  // Payment Details
  totalAmount: number,            // From group rules
  amountPaid: number,
  arrears: number,
  
  // Status
  approvalStatus: string,         // "unpaid" | "pending" | "approved" | "rejected" | "completed"
  paymentStatus: string,
  
  // Payment Proof
  proofOfPayment: {
    imageUrl: string,
    uploadedAt: Timestamp,
    verifiedBy: string | null,
    uploadedBy: string
  } | null,
  
  // Approval
  approvedBy: string | null,
  approvedAt: Timestamp | null,
  rejectedBy: string | null,
  rejectedAt: Timestamp | null,
  rejectionReason: string | null,
  
  // Timestamps
  dueDate: Timestamp,             // Calculated from group rules
  paidAt: Timestamp | null,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Additional
  paymentMethod: string,
  notes: string | null,
  recordedManually: boolean,
  isAdvancedPayment: boolean      // Can be true for monthly contributions
}
```

#### 4.3 Service Fee: `groups/{groupId}/payments/{year}_ServiceFee/{memberId}/PaymentDetails`

**Purpose:** Track operational service fees

**Structure:** Similar to Seed Money with additional fields:
```javascript
{
  // ... (same base fields as Seed Money)
  
  // Service Fee Specific
  perCycle: boolean,              // One-time or recurring
  nonRefundable: boolean,
  description: string             // What the fee covers
}
```

---

### 5. Loans Collection: `groups/{groupId}/loans/{loanId}`

**Purpose:** Track loan requests, approvals, and disbursements

**Document ID:** Auto-generated Firestore ID

**Schema:**
```javascript
{
  // Loan Identification
  loanId: string,                 // Same as document ID
  loanNumber: string,             // Human-readable (e.g., "L-2026-001")
  
  // Borrower Information
  borrowerId: string,             // Member user ID
  borrowerName: string,
  borrowerEmail: string,
  
  // Loan Details
  principalAmount: number,        // Amount requested
  approvedAmount: number,         // May differ from requested
  status: string,                 // "pending" | "approved" | "rejected" | "disbursed" | "completed" | "defaulted"
  
  // Repayment Terms
  repaymentPeriod: number,        // Months (1-3)
  interestRates: {
    month1: number,
    month2: number,
    month3: number
  },
  totalInterest: number,          // Calculated
  totalRepayment: number,         // Principal + Interest
  monthlyPayment: number,         // Base monthly payment
  
  // Repayment Schedule
  repaymentSchedule: [
    {
      month: number,              // 1, 2, 3
      dueDate: Timestamp,
      principalDue: number,
      interestDue: number,
      totalDue: number,
      amountPaid: number,
      balance: number,
      status: string,             // "pending" | "paid" | "overdue"
      paidAt: Timestamp | null
    }
  ],
  
  // Disbursement
  disbursedAmount: number,
  disbursedAt: Timestamp | null,
  disbursedBy: string | null,     // Admin user ID
  disbursementMethod: string,     // "cash" | "bank_transfer" | "mobile_money"
  
  // Approval/Rejection
  requestedAt: Timestamp,
  approvedBy: string | null,
  approvedAt: Timestamp | null,
  rejectedBy: string | null,
  rejectedAt: Timestamp | null,
  rejectionReason: string | null,
  
  // Security
  purpose: string,                // Why loan is needed
  collateral: string | null,      // Description of collateral
  guarantor: {
    name: string,
    phone: string,
    relationship: string
  } | null,
  
  // Tracking
  amountRepaid: number,           // Total repaid so far
  remainingBalance: number,       // Principal + Interest - Repaid
  penaltiesCharged: number,       // Total penalties
  
  // Metadata
  createdAt: Timestamp,
  updatedAt: Timestamp,
  completedAt: Timestamp | null
}
```

---

### 6. Loan Payments: `groups/{groupId}/loans/{loanId}/payments/{paymentId}`

**Purpose:** Track individual loan repayment transactions

**Schema:**
```javascript
{
  // Payment Reference
  paymentId: string,
  loanId: string,                 // Parent loan
  
  // Payer Info
  userId: string,
  userName: string,
  
  // Payment Details
  amount: number,                 // Amount paid in this transaction
  principalPortion: number,       // Goes to principal
  interestPortion: number,        // Goes to interest
  penaltyPortion: number,         // Penalty payment (if any)
  
  // Scheduled Payment Reference
  scheduledMonth: number,         // Which month this payment is for
  scheduledAmount: number,        // What was expected
  
  // Status
  status: string,                 // "pending" | "approved"
  approvedBy: string | null,
  approvedAt: Timestamp | null,
  
  // Proof
  proofOfPayment: {
    imageUrl: string,
    uploadedAt: Timestamp
  } | null,
  
  // Timestamps
  paidAt: Timestamp,
  createdAt: Timestamp,
  
  // Additional
  paymentMethod: string,
  notes: string | null
}
```

---

### 7. Notifications: `groups/{groupId}/notifications/{notificationId}`

**Purpose:** User notifications within a group

**Schema:**
```javascript
{
  // Recipient
  userId: string,                 // Who receives this notification
  recipientId: string,            // Duplicate for backward compatibility
  
  // Notification Content
  type: string,                   // "payment_approved" | "loan_approved" | "broadcast" | etc.
  title: string,                  // Notification headline
  message: string,                // Full message body
  
  // Context
  groupId: string,
  groupName: string,
  senderId: string | null,        // Who triggered it (null for system)
  
  // Related Data (optional)
  paymentType: string | null,
  paymentId: string | null,
  loanId: string | null,
  amount: number | null,
  
  // Status
  read: boolean,
  readAt: Timestamp | null,
  dismissed: boolean,
  dismissedAt: Timestamp | null,
  
  // Metadata
  createdAt: Timestamp,
  expiresAt: Timestamp | null     // Auto-delete after expiry
}
```

---

### 8. Messages: `groups/{groupId}/messages/{messageId}`

**Purpose:** Support tickets and admin communications

**Schema:**
```javascript
{
  // Message Info
  messageId: string,
  subject: string,
  body: string,
  
  // Participants
  createdBy: string,              // User ID of sender
  createdByName: string,
  assignedTo: string | null,      // Admin handling the message
  
  // Status
  status: string,                 // "open" | "in_progress" | "resolved" | "closed"
  priority: string,               // "low" | "medium" | "high" | "urgent"
  
  // Conversation Thread
  replies: [
    {
      replyId: string,
      userId: string,
      userName: string,
      message: string,
      createdAt: Timestamp,
      attachments: string[] | null
    }
  ],
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp | null
}
```

---

### 9. Invitation Codes: `invitationCodes/{codeId}`

**Purpose:** Manage group invitation codes

**Schema:**
```javascript
{
  code: string,                   // Unique code (e.g., "BNKHONDE2026")
  groupId: string,                // Which group this is for
  groupName: string,
  
  // Validity
  createdBy: string,              // Admin who created it
  createdAt: Timestamp,
  expiresAt: Timestamp | null,
  maxUses: number | null,         // Limit number of uses
  usedCount: number,
  
  // Status
  status: string,                 // "active" | "expired" | "revoked"
  
  // Usage Tracking
  usedBy: [
    {
      userId: string,
      usedAt: Timestamp
    }
  ]
}
```

---

### 10. Audit Logs: `auditLogs/{logId}`

**Purpose:** Track all critical operations for compliance

**Schema:**
```javascript
{
  // Action Details
  action: string,                 // "payment_approved" | "loan_disbursed" | etc.
  entityType: string,             // "payment" | "loan" | "member" | "group"
  entityId: string,               // ID of affected entity
  
  // User Context
  performedBy: string,            // User ID
  performedByName: string,
  performedByRole: string,
  
  // Group Context
  groupId: string,
  groupName: string,
  
  // Changes Made
  changes: {
    before: object,               // State before change
    after: object                 // State after change
  },
  
  // Metadata
  ipAddress: string | null,
  userAgent: string | null,
  timestamp: Timestamp
}
```

---

## Data Relationships

### 1. User ↔ Groups (Many-to-Many)

**Forward Reference:**
```javascript
users/{userId}.groupMemberships[]
// Contains: { groupId, role, joinedAt }
```

**Reverse Reference:**
```javascript
groups/{groupId}/members/{userId}
// Document exists if user is member
```

**Validation:**
- `users/{userId}.groupMemberships[].groupId` must exist in `groups` collection
- `groups/{groupId}/members/{userId}` must reference valid `users/{userId}`

---

### 2. Member ↔ Payments (One-to-Many)

**Foreign Key:** `userId` in payment document = `memberId` in path

**Validation:**
```javascript
// Payment document
{
  userId: memberId,  // Must match path segment
  memberId: memberId  // Optional redundancy
}
```

**Integrity:** Payment documents cannot exist without parent member

---

### 3. Member ↔ Loans (One-to-Many)

**Foreign Key:** `borrowerId` in loan document

**Validation:**
```javascript
{
  borrowerId: memberId,  // Must exist in groups/{groupId}/members/
  borrowerName: memberFullName
}
```

**Constraints:**
- Member must have `seedMoneyPaid: true`
- Member must have `monthlyContributionsCurrent: true`
- Check `maxActiveLoansByMember` limit

---

### 4. Loan ↔ Loan Payments (One-to-Many)

**Implicit Relationship:** Subcollection path provides the link

**Path Structure:**
```
groups/{groupId}/loans/{loanId}/payments/{paymentId}
```

No explicit `loanId` field needed in payment document (path provides it)

---

### 5. Referential Integrity Patterns

**Denormalization for Performance:**
```javascript
// Instead of querying users/{userId} every time
// Store frequently accessed data in member document
{
  uid: userId,  // Reference to users collection
  fullName: "John Doe",  // Denormalized
  email: "john@example.com"  // Denormalized
}
```

**Update Strategy:**
- Update `users/{userId}` first
- Then update all `groups/{groupId}/members/{userId}` documents
- Use Cloud Function triggers for consistency

---

## Security Rules

### Rule Structure

**File:** `firestore.rules`

**Helper Functions:**
```javascript
function isSignedIn() {
  return request.auth != null;
}

function isGroupMember(groupId) {
  return isSignedIn() && 
    exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid));
}

function isGroupAdmin(groupId) {
  return isSignedIn() && 
    exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)) &&
    get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role in ['admin', 'senior_admin'];
}

function isSeniorAdmin(groupId) {
  return isSignedIn() && 
    get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role == 'senior_admin';
}
```

### Collection Rules

#### Users Collection

```javascript
match /users/{userId} {
  // Users can read their own profile
  allow read: if isSignedIn() && request.auth.uid == userId;
  
  // Users can create their own profile during registration
  allow create: if isSignedIn() && request.auth.uid == userId;
  
  // Users can update their own profile
  allow update: if isSignedIn() && request.auth.uid == userId &&
    // Prevent changing uid and email
    request.resource.data.uid == resource.data.uid &&
    request.resource.data.email == resource.data.email;
  
  // No deletions allowed
  allow delete: if false;
}
```

#### Groups Collection

```javascript
match /groups/{groupId} {
  // Members can read group if they belong to it
  allow read: if isGroupMember(groupId);
  
  // Any authenticated user can create groups (during registration)
  allow create: if isSignedIn();
  
  // Only admins can update group settings
  allow update: if isGroupAdmin(groupId);
  
  // Only senior admins can delete groups
  allow delete: if isSeniorAdmin(groupId);
}
```

#### Members Subcollection

```javascript
match /groups/{groupId}/members/{memberId} {
  // Members can read other members in their group
  allow read: if isGroupMember(groupId);
  
  // Only admins can add new members
  allow create: if isGroupAdmin(groupId);
  
  // Only admins can update member information
  allow update: if isGroupAdmin(groupId);
  
  // Only senior admins can remove members
  allow delete: if isSeniorAdmin(groupId);
}
```

#### Payments Subcollection

```javascript
match /groups/{groupId}/payments/{yearType}/{userId}/{documentId} {
  // Members can read their own payments, admins can read all
  allow read: if isSignedIn() && 
    (request.auth.uid == userId || isGroupAdmin(groupId));
  
  // Admins can create payment records
  allow create: if isGroupAdmin(groupId);
  
  // Members can upload proof, admins can approve
  allow update: if isSignedIn() && (
    (request.auth.uid == userId && 
      request.resource.data.diff(resource.data).affectedKeys().hasOnly(['proofOfPayment', 'updatedAt'])) ||
    isGroupAdmin(groupId)
  );
  
  // No deletions (audit trail)
  allow delete: if false;
}
```

#### Loans Subcollection

```javascript
match /groups/{groupId}/loans/{loanId} {
  // All members can read loans
  allow read: if isGroupMember(groupId);
  
  // Members can create loan requests
  allow create: if isGroupMember(groupId);
  
  // Only admins can update (approve/disburse)
  allow update: if isGroupAdmin(groupId);
  
  // Only senior admins can delete
  allow delete: if isSeniorAdmin(groupId);
}
```

#### Notifications

```javascript
match /groups/{groupId}/notifications/{notificationId} {
  // Members can read their own notifications
  allow read: if isSignedIn() && 
    resource.data.userId == request.auth.uid;
  
  // Admins can create notifications
  allow create: if isGroupAdmin(groupId);
  
  // Users can mark as read
  allow update: if isSignedIn() && 
    resource.data.userId == request.auth.uid &&
    request.resource.data.diff(resource.data).affectedKeys()
      .hasOnly(['read', 'readAt', 'dismissed', 'dismissedAt']);
  
  // Admins can delete
  allow delete: if isGroupAdmin(groupId);
}
```

---

## Data Flow Examples

### Example 1: User Registration Flow

**Step 1: Create Firebase Auth Account**
```javascript
const userCredential = await createUserWithEmailAndPassword(auth, email, password);
const userId = userCredential.user.uid;
```

**Step 2: Create User Document**
```javascript
await setDoc(doc(db, "users", userId), {
  uid: userId,
  email: email,
  fullName: fullName,
  phone: phone,
  whatsappNumber: whatsappNumber,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  profileImageUrl: "",
  groupMemberships: []  // Empty initially
});
```

**Step 3: Create Group Document**
```javascript
const groupRef = await addDoc(collection(db, "groups"), {
  groupName: groupName,
  description: description,
  createdBy: userId,
  createdAt: Timestamp.now(),
  status: "active",
  rules: { /* ... rules configuration ... */ }
});
const groupId = groupRef.id;
```

**Step 4: Add Creator as Senior Admin**
```javascript
await setDoc(doc(db, `groups/${groupId}/members`, userId), {
  uid: userId,
  userId: userId,
  fullName: fullName,
  email: email,
  role: "senior_admin",
  joinedAt: Timestamp.now(),
  financialSummary: {
    totalPaid: 0,
    totalArrears: 0,
    lastUpdated: Timestamp.now()
  }
});
```

**Step 5: Update User's Group Memberships**
```javascript
await updateDoc(doc(db, "users", userId), {
  groupMemberships: arrayUnion({
    groupId: groupId,
    role: "senior_admin",
    joinedAt: Timestamp.now()
  })
});
```

---

### Example 2: Payment Approval Flow

**Step 1: User Uploads Payment Proof**
```javascript
// Upload to Storage
const fileName = `payment-proofs/${groupId}/${userId}/${Date.now()}_${file.name}`;
const storageRef = ref(storage, fileName);
await uploadBytes(storageRef, file);
const imageUrl = await getDownloadURL(storageRef);

// Update payment document
const paymentRef = doc(db, `groups/${groupId}/payments/2026_SeedMoney/${userId}/PaymentDetails`);
await updateDoc(paymentRef, {
  proofOfPayment: {
    imageUrl: imageUrl,
    uploadedAt: Timestamp.now(),
    uploadedBy: userId
  },
  approvalStatus: "pending",
  updatedAt: Timestamp.now()
});
```

**Step 2: Admin Approves (ACID Transaction)**
```javascript
const batch = writeBatch(db);

// Update payment status
const paymentRef = doc(db, `groups/${groupId}/payments/2026_SeedMoney/${userId}/PaymentDetails`);
batch.update(paymentRef, {
  approvalStatus: "approved",
  approvedBy: adminId,
  approvedAt: Timestamp.now(),
  arrears: newArrears,
  paymentStatus: "Completed"
});

// Update member financial summary
const memberRef = doc(db, `groups/${groupId}/members`, userId);
batch.update(memberRef, {
  "financialSummary.totalPaid": increment(amountPaid),
  "financialSummary.totalArrears": increment(-amountPaid),
  "financialSummary.lastUpdated": Timestamp.now(),
  seedMoneyPaid: true
});

// Create notification
const notifRef = doc(collection(db, `groups/${groupId}/notifications`));
batch.set(notifRef, {
  userId: userId,
  type: "payment_approved",
  title: "Payment Approved",
  message: `Your seed money payment of ${formatCurrency(amountPaid)} has been approved.`,
  createdAt: Timestamp.now(),
  read: false
});

await batch.commit();  // All or nothing
```

---

### Example 3: Loan Disbursement Flow

**Step 1: Create Loan Request**
```javascript
const loanRef = await addDoc(collection(db, `groups/${groupId}/loans`), {
  borrowerId: userId,
  borrowerName: userName,
  principalAmount: amount,
  repaymentPeriod: months,
  purpose: purpose,
  status: "pending",
  requestedAt: Timestamp.now()
});
```

**Step 2: Admin Approves and Disburses**
```javascript
const batch = writeBatch(db);

// Calculate repayment schedule
const schedule = calculateRepaymentSchedule(amount, months, interestRates);

// Update loan
const loanRef = doc(db, `groups/${groupId}/loans`, loanId);
batch.update(loanRef, {
  status: "disbursed",
  approvedBy: adminId,
  approvedAt: Timestamp.now(),
  disbursedAt: Timestamp.now(),
  disbursedAmount: amount,
  repaymentSchedule: schedule,
  totalInterest: calculateTotalInterest(schedule),
  totalRepayment: amount + calculateTotalInterest(schedule)
});

// Update member summary
const memberRef = doc(db, `groups/${groupId}/members`, userId);
batch.update(memberRef, {
  "financialSummary.totalLoans": increment(amount),
  "financialSummary.lastUpdated": Timestamp.now()
});

// Notification
const notifRef = doc(collection(db, `groups/${groupId}/notifications`));
batch.set(notifRef, {
  userId: userId,
  type: "loan_disbursed",
  title: "Loan Disbursed",
  message: `Your loan of ${formatCurrency(amount)} has been disbursed.`,
  createdAt: Timestamp.now(),
  read: false
});

await batch.commit();
```

---

## Indexes & Query Optimization

### Composite Indexes

**File:** `firestore.indexes.json`

**Required Indexes:**

1. **Members by Group and Role:**
```json
{
  "collectionGroup": "members",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "role", "order": "ASCENDING" }
  ]
}
```

2. **Payments by Status:**
```json
{
  "collectionGroup": "payments",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "approvalStatus", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "DESCENDING" }
  ]
}
```

3. **Loans by Status and Date:**
```json
{
  "collectionGroup": "loans",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "requestedAt", "order": "DESCENDING" }
  ]
}
```

4. **Notifications Unread:**
```json
{
  "collectionGroup": "notifications",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

### Query Patterns

**Efficient Queries:**

```javascript
// Get pending payments for a group
const q = query(
  collectionGroup(db, "payments"),
  where("groupId", "==", groupId),
  where("approvalStatus", "==", "pending"),
  orderBy("updatedAt", "desc"),
  limit(20)
);

// Get active loans for a member
const q = query(
  collection(db, `groups/${groupId}/loans`),
  where("borrowerId", "==", userId),
  where("status", "in", ["approved", "disbursed"]),
  orderBy("requestedAt", "desc")
);

// Get unread notifications
const q = query(
  collection(db, `groups/${groupId}/notifications`),
  where("userId", "==", userId),
  where("read", "==", false),
  orderBy("createdAt", "desc"),
  limit(10)
);
```

---

## Backup & Recovery

### Automated Backups

**Firebase Firestore Backup:**
- Scheduled daily exports to Cloud Storage
- 30-day retention policy
- Point-in-time recovery available

**Export Format:**
```
gs://banknkonde-backups/2026-02-11/
  ├── users/
  ├── groups/
  ├── invitationCodes/
  └── auditLogs/
```

### Manual Backup

**Using Firebase CLI:**
```bash
firebase firestore:export gs://banknkonde-backups/manual-$(date +%Y%m%d)
```

### Recovery

**Full Restore:**
```bash
firebase firestore:import gs://banknkonde-backups/2026-02-11
```

**Selective Restore:**
```bash
firebase firestore:import --collection groups gs://banknkonde-backups/2026-02-11/groups
```

---

## Schema Evolution

### Adding New Fields

**Safe Additions (No Migration Needed):**
```javascript
// Add optional field to existing documents
await updateDoc(doc(db, "groups", groupId), {
  newField: defaultValue
});
```

**Required Fields (Migration Script):**
```javascript
// Cloud Function or script to update all documents
const groups = await getDocs(collection(db, "groups"));
const batch = writeBatch(db);

groups.forEach((doc) => {
  if (!doc.data().newRequiredField) {
    batch.update(doc.ref, {
      newRequiredField: calculateDefault(doc.data())
    });
  }
});

await batch.commit();
```

### Renaming Fields

**Approach 1: Add New, Keep Old (Temporary)**
```javascript
// Phase 1: Add new field alongside old
await updateDoc(docRef, {
  newFieldName: doc.data().oldFieldName,
  oldFieldName: doc.data().oldFieldName  // Keep for now
});

// Phase 2: Update all code to use newFieldName

// Phase 3: Remove oldFieldName
const batch = writeBatch(db);
docs.forEach(doc => {
  batch.update(doc.ref, {
    oldFieldName: FieldValue.delete()
  });
});
```

### Data Migrations

**Best Practices:**
1. Test on UAT environment first
2. Create backup before migration
3. Use batched writes (max 500 per batch)
4. Add rollback capability
5. Monitor during migration
6. Update documentation

---

## Maintenance Guidelines

### When to Update This Document

**Must Update:**
- New collection added
- Collection structure changed
- Security rules modified
- New index created
- Relationship patterns changed

**Update Process:**
1. Make database changes
2. Update DATABASE_DOCUMENTATION.md
3. Update APP_DOCUMENTATION.md if affects functionality
4. Test changes
5. Commit both code and docs together

### Version Control

**Database Version Tracking:**
```javascript
// Add to groups collection
{
  schemaVersion: "1.0",
  lastSchemaUpdate: Timestamp.now()
}
```

**Migration History:**
```javascript
// Track migrations
{
  migrations: [
    {
      version: "1.0.1",
      description: "Added serviceFee field",
      appliedAt: Timestamp.now(),
      appliedBy: "admin@banknkonde.com"
    }
  ]
}
```

---

**Document Maintained By:** Development Team  
**Last Schema Change:** February 11, 2026  
**Current Schema Version:** 1.0  
**Contact:** support@banknkonde.com
