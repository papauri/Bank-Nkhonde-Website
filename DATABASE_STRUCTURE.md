# Bank Nkhonde Database Structure

## Registration Flow and Data Storage

### Step 1: Admin Creates Account and Group

When an admin fills out the registration form and submits:

#### 1.1 User Account Creation
**Collection:** `users/{userId}`
**Document Created:**
```javascript
{
  uid: userId,
  fullName: name,
  email: email,
  phone: phone,
  whatsappNumber: whatsappNumber,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  profileImageUrl: "",
  groupMemberships: [{
    groupId: groupId,
    role: "senior_admin",
    joinedAt: Timestamp
  }]
}
```

#### 1.2 Group Document Creation
**Collection:** `groups/{groupId}`
**Document Created:**
```javascript
{
  groupId: groupId,
  groupName: groupData.groupName,
  description: groupData.groupDescription,
  createdAt: Timestamp,
  createdBy: userId,
  updatedAt: Timestamp,
  status: "active",
  
  // Financial Rules
  rules: {
    seedMoney: {
      amount: seedMoney,           // e.g., 10000
      dueDate: seedMoneyDueDate,
      required: true,
      allowPartialPayment: true,
      maxPaymentMonths: 2,
      mustBeFullyPaid: true
    },
    monthlyContribution: {
      amount: monthlyContribution,  // e.g., 50000
      required: true,
      dayOfMonth: 15,
      allowPartialPayment: true
    },
    serviceFee: {
      amount: serviceFee,           // e.g., 5000 (optional)
      required: serviceFee > 0,
      dueDate: serviceFeeDueDate,
      perCycle: true,
      nonRefundable: true,
      description: "Operational service fee (bank charges, etc.)"
    },
    loanInterest: {
      rates: { month1: 10, month2: 7, month3: 5 },
      calculationMethod: "reduced_balance",
      maxRepaymentMonths: 3
    },
    loanPenalty: {
      rate: 2,
      type: "percentage",
      gracePeriodDays: 3
    },
    contributionPenalty: {
      dailyRate: 1,
      monthlyRate: 30,
      type: "percentage",
      gracePeriodDays: 5
    },
    cycleDuration: {
      startDate: cycleStartDate,
      endDate: null,
      months: 12,
      autoRenew: false
    },
    loanRules: {
      maxLoanAmount: 0,
      minCycleLoanAmount: 0,
      maxActiveLoansByMember: 1,
      requireCollateral: false,
      minRepaymentMonths: 1,
      maxRepaymentMonths: 3
    }
  },
  
  // Admin Information
  admins: [{
    uid: userId,
    fullName: name,
    email: email,
    phone: phone,
    whatsappNumber: phone,
    role: "senior_admin",
    assignedAt: Timestamp,
    assignedBy: "system",
    isContactAdmin: true,
    canPromoteMembers: true,
    permissions: {
      canApprovePayments: true,
      canApproveLoan: true,
      canAddMembers: true,
      canRemoveMembers: true,
      canPromoteToAdmin: true,
      canDemoteAdmin: true,
      canSendBroadcasts: true,
      canManageSettings: true,
      canViewReports: true
    }
  }],
  
  // Group Statistics
  statistics: {
    totalMembers: 1,
    activeMembers: 1,
    totalFunds: 0,
    totalLoansActive: 0,
    totalLoansRepaid: 0,
    totalArrears: seedMoney,
    totalPenalties: 0,
    lastUpdated: Timestamp
  },
  
  // Advanced Settings
  advancedSettings: {
    surplusDistribution: "equal",
    enableLoanBooking: true,
    autoMonthlyReports: true,
    allowPartialPayments: true,
    requiredDocuments: {
      nationalId: true,
      proofOfAddress: false,
      guarantor: true,
      employmentLetter: false,
      photo: false,
      bankDetails: false
    },
    loanBookingQueue: [],
    enableRepaymentHistory: true
  },
  
  // Governance
  governance: {
    rules: groupData.governanceRules,
    rulesDocumentUrl: "",
    lastUpdated: Timestamp,
    updatedBy: userId
  },
  
  // Cycle Dates
  cycleDates: [Timestamp, Timestamp, ...], // Array of 12 month timestamps
  displayCycleDates: ["January 2024", "February 2024", ...]
}
```

#### 1.3 Member Document Creation (Admin as First Member)
**Collection:** `groups/{groupId}/members/{userId}`
**Document Created:**
```javascript
{
  uid: userId,
  fullName: name,
  email: email,
  phone: phone,
  whatsappNumber: whatsappNumber,
  role: "senior_admin",
  status: "active",
  joinedAt: Timestamp,
  addedBy: "system",
  financialSummary: {
    totalPaid: 0,
    totalArrears: seedMoney,
    totalPending: seedMoney,
    totalLoans: 0,
    totalLoansPaid: 0,
    totalPenalties: 0,
    lastUpdated: Timestamp
  }
}
```

#### 1.4 Payment Records Initialization

**Seed Money Payment:**
**Collection:** `groups/{groupId}/payments/{year}_SeedMoney/{userId}/PaymentDetails`
**Document Created:**
```javascript
{
  userId: userId,
  fullName: name,
  paymentType: "Seed Money",
  totalAmount: seedMoney,           // e.g., 10000
  amountPaid: 0,
  arrears: seedMoney,               // e.g., 10000
  approvalStatus: "unpaid",
  paymentStatus: "unpaid",
  dueDate: seedMoneyDueDate,
  paidAt: null,
  approvedAt: null,
  createdAt: Timestamp,
  updatedAt: null,
  proofOfPayment: {
    imageUrl: "",
    uploadedAt: null,
    verifiedBy: ""
  },
  currency: "MWK"
}
```

**Monthly Contribution Payments (One per Month in Cycle):**
**Collection:** `groups/{groupId}/payments/{year}_MonthlyContributions/{userId}/{year}_{monthName}`
**Documents Created (12 documents for 12 months):**
```javascript
{
  userId: userId,
  fullName: name,
  paymentType: "Monthly Contribution",
  month: "January",
  year: 2024,
  totalAmount: monthlyContribution,  // e.g., 50000
  amountPaid: 0,
  arrears: monthlyContribution,      // e.g., 50000
  approvalStatus: "unpaid",
  paymentStatus: "unpaid",
  dueDate: Timestamp,               // 15th of January 2024
  paidAt: null,
  approvedAt: null,
  createdAt: Timestamp,
  updatedAt: null,
  proofOfPayment: {
    imageUrl: "",
    uploadedAt: null,
    verifiedBy: ""
  },
  currency: "MWK"
}
// ... repeated for February, March, ..., December
```

**Service Fee Payment (If Enabled):**
**Collection:** `groups/{groupId}/payments/{year}_ServiceFee/{userId}/PaymentDetails`
**Document Created:**
```javascript
{
  userId: userId,
  fullName: name,
  paymentType: "Service Fee",
  totalAmount: serviceFee,          // e.g., 5000
  amountPaid: 0,
  arrears: serviceFee,              // e.g., 5000
  approvalStatus: "unpaid",
  paymentStatus: "unpaid",
  dueDate: serviceFeeDueDate,
  paidAt: null,
  approvedAt: null,
  createdAt: Timestamp,
  updatedAt: null,
  proofOfPayment: {
    imageUrl: "",
    uploadedAt: null,
    verifiedBy: ""
  },
  currency: "MWK",
  perCycle: true,
  nonRefundable: true,
  description: "Operational service fee (bank charges, etc.)"
}
```

**Payment Year Summary Documents (Parent Documents):**

**Seed Money Year Summary:**
**Collection:** `groups/{groupId}/payments/{year}_SeedMoney`
**Document Created:**
```javascript
{
  year: 2024,
  paymentType: "SeedMoney",
  createdAt: Timestamp,
  totalExpected: seedMoney,
  totalReceived: 0,
  totalPending: 0
}
```

**Monthly Contributions Year Summary:**
**Collection:** `groups/{groupId}/payments/{year}_MonthlyContributions`
**Document Created:**
```javascript
{
  year: 2024,
  paymentType: "MonthlyContributions",
  createdAt: Timestamp,
  totalExpected: monthlyContribution * 12,
  totalReceived: 0,
  totalPending: 0
}
```

**Service Fee Year Summary (If Enabled):**
**Collection:** `groups/{groupId}/payments/{year}_ServiceFee`
**Document Created:**
```javascript
{
  year: 2024,
  paymentType: "ServiceFee",
  createdAt: Timestamp,
  totalExpected: serviceFee,
  totalReceived: 0,
  totalPending: 0,
  perCycle: true,
  nonRefundable: true
}
```

---

### Step 2: New Member Joins Group

When admin adds a new member:

#### 2.1 User Document (if new user)
**Collection:** `users/{newUserId}`
**Document Created/Updated:**
```javascript
{
  uid: newUserId,
  fullName: memberName,
  email: email,
  phone: phone,
  // ... other fields
  groupMemberships: [{
    groupId: groupId,
    role: "member",
    joinedAt: Timestamp
  }]
}
```

#### 2.2 Member Document
**Collection:** `groups/{groupId}/members/{newUserId}`
**Document Created:**
```javascript
{
  uid: newUserId,
  fullName: memberName,
  email: email,
  phone: phone,
  role: "member",
  status: "active",
  joinedAt: Timestamp,
  addedBy: adminUserId,
  financialSummary: {
    totalPaid: 0,
    totalArrears: seedMoney + (serviceFee > 0 ? serviceFee : 0),
    totalPending: seedMoney + (serviceFee > 0 ? serviceFee : 0),
    totalLoans: 0,
    totalLoansPaid: 0,
    totalPenalties: 0,
    lastUpdated: Timestamp
  }
}
```

#### 2.3 Payment Records Created
Same structure as Step 1.4 for the new member:
- Seed Money payment record
- 12 Monthly Contribution records (one per month)
- Service Fee payment record (if enabled)

#### 2.4 Group Statistics Updated
**Collection:** `groups/{groupId}`
**Document Updated:**
```javascript
{
  statistics: {
    totalMembers: previousTotal + 1,
    activeMembers: previousActive + 1,
    totalArrears: previousArrears + seedMoney + serviceFee,
    // ... other stats
  }
}
```

---

### Step 3: Member Makes Payment

When a payment is recorded (manual or uploaded):

#### 3.1 Payment Document Updated
**Collection:** `groups/{groupId}/payments/{year}_{PaymentType}/{memberId}/PaymentDetails` (or `{year}_{monthName}` for monthly)

**Example - Seed Money Payment:**
```javascript
{
  amountPaid: previousAmount + paymentAmount,
  arrears: Math.max(0, totalAmount - newAmountPaid),
  approvalStatus: paymentStatus, // "pending", "approved", or "completed"
  paymentStatus: paymentStatus,
  approvedBy: adminUserId,
  approvedAt: Timestamp,
  paidAt: paymentDate,
  notes: paymentNotes,
  paymentMethod: "cash" | "mobile_money" | "bank_transfer",
  recordedManually: true,
  isAdvancedPayment: false,
  updatedAt: Timestamp,
  proofOfPayment: {
    imageUrl: "https://storage...",
    fileName: "proof.jpg",
    fileSize: 123456,
    uploadedBy: adminUserId,
    uploadedAt: Timestamp,
    verifiedBy: adminUserId,
    verifiedAt: Timestamp,
    storagePath: "payment-proofs/groupId/memberId/...",
    linkedToPayment: true,
    paymentType: "seed_money",
    paymentAmount: paymentAmount,
    paymentDate: Timestamp
  }
}
```

#### 3.2 Member Financial Summary Updated
**Collection:** `groups/{groupId}/members/{memberId}`
**Document Updated:**
```javascript
{
  financialSummary: {
    totalPaid: previousTotal + paymentAmount,
    totalArrears: recalculatedFromPayments,
    totalPending: updatedPending,
    lastUpdated: Timestamp
  }
}
```

#### 3.3 Notification Created
**Collection:** `groups/{groupId}/notifications/{notificationId}`
**Document Created:**
```javascript
{
  userId: memberId,
  recipientId: memberId,
  groupId: groupId,
  groupName: "Group Name",
  senderId: adminUserId,
  title: "Payment Recorded",
  message: "Your Seed Money payment of MWK 10,000 has been recorded...",
  type: "payment_recorded",
  paymentType: "seed_money",
  paymentId: "seed_memberId_2024",
  memberId: memberId,
  amount: paymentAmount,
  read: false,
  createdAt: Timestamp
}
```

#### 3.4 Group Statistics Updated
**Collection:** `groups/{groupId}`
**Document Updated:**
```javascript
{
  statistics: {
    totalFunds: previousTotal + paymentAmount,
    totalArrears: recalculatedTotalArrears,
    lastUpdated: Timestamp
  }
}
```

---

### Step 4: Member Requests Loan

When member requests a loan:

#### 4.1 Loan Document Created
**Collection:** `groups/{groupId}/loans/{loanId}`
**Document Created:**
```javascript
{
  borrowerId: memberId,
  borrowerName: memberName,
  borrowerEmail: email,
  amount: loanAmount,
  loanAmount: loanAmount,
  repaymentPeriod: repaymentPeriod,
  totalInterest: calculatedInterest,
  totalRepayable: loanAmount + totalInterest,
  amountRepaid: 0,
  purpose: loanPurpose,
  description: loanDescription,
  targetMonth: targetMonth,
  targetMonthName: "January",
  targetYear: 2024,
  status: "pending",
  bookingType: "user_request",
  requestedAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  approvedAt: null,
  approvedBy: null,
  disbursedAt: null,
  dueDate: calculatedDueDate,
  repaymentSchedule: [
    {
      month: 1,
      principal: principalAmount,
      interest: interestAmount,
      totalPayment: principalAmount + interestAmount,
      dueDate: Timestamp
    },
    // ... more months
  ],
  interestRates: { month1: 10, month2: 7, month3: 5 }
}
```

#### 4.2 Notifications to Admins
**Collection:** `groups/{groupId}/notifications/{notificationId}`
**Documents Created (one per admin):**
```javascript
{
  userId: adminId,
  recipientId: adminId,
  groupId: groupId,
  groupName: "Group Name",
  senderId: memberId,
  senderName: memberName,
  title: "New Loan Booking: MWK 100,000",
  message: "MemberName has booked a loan...",
  type: "loan_booking",
  loanId: loanId,
  read: false,
  createdAt: Timestamp
}
```

---

### Step 5: Admin Approves Loan

When admin approves a loan:

#### 5.1 Loan Document Updated
**Collection:** `groups/{groupId}/loans/{loanId}`
**Document Updated:**
```javascript
{
  status: "approved" | "active",
  approvedAt: Timestamp,
  approvedBy: adminUserId,
  disbursedAt: Timestamp
}
```

#### 5.2 Notification to Borrower
**Collection:** `groups/{groupId}/notifications/{notificationId}`
**Document Created:**
```javascript
{
  userId: memberId,
  recipientId: memberId,
  title: "Loan Approved",
  message: "Your loan request has been approved...",
  type: "loan_approved",
  loanId: loanId,
  read: false,
  createdAt: Timestamp
}
```

---

### Step 6: Loan Repayment Made

When member repays loan:

#### 6.1 Loan Payment Record Created
**Collection:** `groups/{groupId}/loans/{loanId}/payments/{paymentId}`
**Document Created:**
```javascript
{
  amount: paymentAmount,
  paymentDate: Timestamp,
  month: repaymentMonth,
  principal: principalPortion,
  interest: interestPortion,
  status: "approved",
  proofOfPayment: {
    imageUrl: "https://...",
    uploadedAt: Timestamp,
    verifiedBy: adminUserId
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### 6.2 Loan Document Updated
**Collection:** `groups/{groupId}/loans/{loanId}`
**Document Updated:**
```javascript
{
  amountRepaid: previousAmount + paymentAmount,
  updatedAt: Timestamp
  // If fully repaid, status changes to "completed"
}
```

---

### Step 7: Penalty Applied

When admin applies penalty for late payment:

#### 7.1 Penalty Document Created
**Collection:** `groups/{groupId}/penalties/{penaltyId}`
**Document Created:**
```javascript
{
  memberId: memberId,
  type: "seed_money_penalty" | "monthly_contribution_penalty",
  relatedMonth: "January 2024" | null,
  amount: penaltyAmount,
  status: "unpaid",
  appliedAt: Timestamp,
  appliedBy: adminUserId
}
```

#### 7.2 Notification Created
**Collection:** `groups/{groupId}/notifications/{notificationId}`
**Document Created:**
```javascript
{
  userId: memberId,
  recipientId: memberId,
  title: "Penalty Applied",
  message: "A penalty of MWK 500 has been applied...",
  type: "penalty_applied",
  read: false,
  createdAt: Timestamp
}
```

---

## Collection Structure Summary

```
Firestore Root
│
├── users/{userId}
│   └── groupMemberships[] (array of group references)
│
└── groups/{groupId}
    │
    ├── (Main Group Document)
    │   ├── rules: { seedMoney, monthlyContribution, serviceFee, loanInterest, ... }
    │   ├── admins: []
    │   ├── statistics: {}
    │   ├── advancedSettings: {}
    │   └── governance: {}
    │
    ├── members/{memberId}
    │   └── financialSummary: {}
    │
    ├── payments/
    │   ├── {year}_SeedMoney/ (year summary document)
    │   │   └── {memberId}/PaymentDetails
    │   ├── {year}_MonthlyContributions/ (year summary document)
    │   │   └── {memberId}/{year}_{monthName}
    │   └── {year}_ServiceFee/ (year summary document)
    │       └── {memberId}/PaymentDetails
    │
    ├── loans/{loanId}
    │   └── payments/{paymentId}
    │
    ├── notifications/{notificationId}
    │
    └── penalties/{penaltyId}
```

---

## Data Flow Examples

### Payment Flow:
1. User uploads payment → Payment document status = "pending"
2. Admin reviews → Admin updates status = "approved"
3. System updates → Member financialSummary updated
4. System updates → Group statistics updated
5. System creates → Notification sent to member

### Loan Flow:
1. Member requests loan → Loan document created (status: "pending")
2. Notification sent → All admins notified
3. Admin approves → Loan status = "approved", notification to member
4. Member repays → Loan payment record created
5. Loan updated → amountRepaid increased, if complete → status = "completed"
