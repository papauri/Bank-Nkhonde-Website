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
  whatsappNumber: string,         // WhatsApp number (can be different from phone)
  createdAt: Timestamp,           // Account creation date
  updatedAt: Timestamp,           // Last profile update
  profileImageUrl: string,        // Optional profile picture
  
  // Contact preferences
  contactPreferences: {
    preferredContactMethod: string,  // 'chat', 'phone', 'whatsapp', 'email'
    availableForChat: boolean,       // Whether available for in-app chat
    showPhoneNumber: boolean,        // Show phone in "Contact Admin" page
    showWhatsAppNumber: boolean,     // Show WhatsApp in "Contact Admin" page
    showEmail: boolean               // Show email in "Contact Admin" page
  },
  
  groupMemberships: [             // Array of group IDs where user is a member
    {
      groupId: string,
      role: string,               // 'admin', 'member', 'senior_admin'
      joinedAt: Timestamp,
      promotedToAdminAt: Timestamp,  // When promoted to admin (if applicable)
      promotedBy: string,            // Who promoted them
      permissions: object            // Role-specific permissions
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
  updatedAt: Timestamp,                // Last update timestamp
  lastModifiedBy: string,              // UID of last person to modify group
  status: string,                      // 'active', 'inactive', 'dissolved', 'suspended'
  
  // Group Rules and Regulations Documents
  rulesDocuments: [
    {
      documentId: string,              // Unique ID for document
      fileName: string,                // Original file name
      fileUrl: string,                 // Firebase Storage URL
      fileType: string,                // 'pdf', 'doc', 'docx'
      fileSize: number,                // File size in bytes
      version: number,                 // Version number (1, 2, 3, etc.)
      isCurrentVersion: boolean,       // Whether this is the active version
      
      // Metadata
      title: string,                   // Document title (e.g., "Group Rules and Regulations 2024")
      description: string,             // Brief description
      effectiveDate: Timestamp,        // When these rules take effect
      
      // Upload information
      uploadedBy: string,              // UID of admin who uploaded
      uploadedByName: string,
      uploadedAt: Timestamp,
      
      // Access tracking
      viewCount: number,               // How many times viewed
      downloadCount: number,           // How many times downloaded
      lastViewedAt: Timestamp,
      
      // Acknowledgment tracking
      requiresAcknowledgment: boolean, // Members must acknowledge reading
      acknowledgedBy: [                // List of members who acknowledged
        {
          uid: string,
          name: string,
          acknowledgedAt: Timestamp,
          ipAddress: string
        }
      ],
      
      // Status
      status: string,                  // 'draft', 'published', 'archived'
      archivedAt: Timestamp,
      archivedReason: string
    }
  ],
  
  // Quick reference to current rules document
  currentRulesDocument: {
    documentId: string,
    fileUrl: string,
    version: number,
    uploadedAt: Timestamp,
    effectiveDate: Timestamp
  },
  
  // Group Financial Rules (programmatic rules)
  rules: {
    seedMoney: {
      amount: number,                  // Required seed money amount
      dueDate: Timestamp,              // When seed money is due
      required: boolean,               // Whether seed money is mandatory
      allowPartialPayment: boolean     // Whether partial payments are allowed
    },
    monthlyContribution: {
      amount: number,                  // Monthly contribution amount
      required: boolean,               // Whether monthly contribution is mandatory
      dayOfMonth: number,              // Day of month when payment is due (1-31)
      allowPartialPayment: boolean     // Whether partial payments are allowed
    },
    interestRate: number,              // Loan interest rate percentage
    loanPenalty: {
      rate: number,                    // Penalty rate percentage
      type: string,                    // 'fixed', 'percentage'
      gracePeriodDays: number          // Days before penalty applies
    },
    monthlyPenalty: {
      rate: number,                    // Monthly penalty rate percentage
      type: string,                    // 'fixed', 'percentage'
      gracePeriodDays: number          // Days before penalty applies
    },
    cycleDuration: {
      startDate: Timestamp,            // Cycle start date
      endDate: Timestamp,              // Cycle end date (optional)
      months: number,                  // Number of months in cycle
      autoRenew: boolean               // Whether to automatically start new cycle
    },
    loanRules: {                       // Additional loan-specific rules
      maxLoanAmount: number,           // Maximum loan a member can take
      minLoanAmount: number,           // Minimum loan amount
      maxActiveLoansByMember: number,  // How many active loans per member
      requireCollateral: boolean,      // Whether collateral is required
      minRepaymentMonths: number,      // Minimum repayment period
      maxRepaymentMonths: number       // Maximum repayment period
    },
    customRules: [                     // Array for flexible custom rules
      {
        name: string,
        description: string,
        value: any,
        createdAt: Timestamp,
        createdBy: string
      }
    ]
  },
  
  // Group Statistics (updated in real-time)
  statistics: {
    totalMembers: number,
    activeMembers: number,             // Members with 'active' status
    totalFunds: number,                // Current available funds
    totalLoansActive: number,          // Total outstanding loan amount
    totalLoansRepaid: number,          // Historical total of repaid loans
    totalArrears: number,              // Total outstanding arrears
    totalPenalties: number,            // Total penalties accrued
    lastUpdated: Timestamp             // When statistics were last calculated
  },
  
  // Admin Information
  admins: [                            // Array of admin UIDs
    {
      uid: string,
      email: string,
      fullName: string,
      phone: string,                   // Admin contact phone
      whatsappNumber: string,          // Admin WhatsApp number (can be different)
      role: string,                    // 'senior_admin', 'admin'
      assignedAt: Timestamp,
      assignedBy: string,              // Who assigned this admin
      isContactAdmin: boolean,         // Show in "Contact Admin" page
      canPromoteMembers: boolean,      // Permission to promote members to admin
      permissions: {
        canApprovePayments: boolean,
        canApproveLoan: boolean,
        canAddMembers: boolean,
        canRemoveMembers: boolean,
        canPromoteToAdmin: boolean,
        canDemoteAdmin: boolean,
        canSendBroadcasts: boolean,
        canManageSettings: boolean,
        canViewReports: boolean
      }
    }
  ],
  
  // Contact Information (for "Contact Admin" page)
  contactInfo: {
    primaryAdmin: {
      uid: string,
      fullName: string,
      email: string,
      phone: string,
      whatsappNumber: string,
      profileImageUrl: string,
      role: string,
      availableForChat: boolean,       // Show in-app chat option
      preferredContactMethod: string   // 'chat', 'phone', 'whatsapp', 'email'
    },
    secondaryAdmins: [                 // Other admins available for contact
      {
        uid: string,
        fullName: string,
        email: string,
        phone: string,
        whatsappNumber: string,
        profileImageUrl: string,
        role: string,
        availableForChat: boolean
      }
    ],
    groupEmail: string,                // General group email
    groupPhone: string,                // General group phone
    officeHours: string,               // E.g., "Mon-Fri 9am-5pm"
    emergencyContact: {
      name: string,
      phone: string,
      relationship: string             // E.g., "Senior Admin", "Group Secretary"
    }
  },
  
  // Bank Account Details (for group deposits/payments)
  bankAccountDetails: {
    // Primary account
    primaryAccount: {
      bankName: string,                // "National Bank of Malawi", "Standard Bank", etc.
      accountName: string,             // Account holder name
      accountNumber: string,           // Account number
      accountType: string,             // 'savings', 'current', 'business'
      branchName: string,              // Bank branch
      branchCode: string,              // Branch code (if applicable)
      swiftCode: string,               // For international (if applicable)
      currency: string,                // 'MWK', 'USD', etc.
      
      // QR Code for mobile money
      mobileMoneyNumber: string,       // Airtel Money, TNM Mpamba number
      mobileMoneyProvider: string,     // 'Airtel Money', 'TNM Mpamba', 'FDH Mobile'
      mobileMoneyQRCode: string,       // URL to QR code image
      
      // Status
      isActive: boolean,
      isPrimary: boolean,
      addedBy: string,
      addedAt: Timestamp,
      verifiedBy: string,
      verifiedAt: Timestamp
    },
    
    // Alternative accounts (optional)
    alternativeAccounts: [
      {
        accountId: string,
        bankName: string,
        accountName: string,
        accountNumber: string,
        accountType: string,
        branchName: string,
        purpose: string,               // 'loan_disbursement', 'savings', 'emergency_fund'
        isActive: boolean,
        addedBy: string,
        addedAt: Timestamp
      }
    ],
    
    // Mobile Money Details
    mobileMoney: {
      airtelMoney: {
        enabled: boolean,
        number: string,
        accountName: string,
        qrCodeUrl: string
      },
      tnmMpamba: {
        enabled: boolean,
        number: string,
        accountName: string,
        qrCodeUrl: string
      },
      fdhMobile: {
        enabled: boolean,
        number: string,
        accountName: string,
        qrCodeUrl: string
      }
    },
    
    // Payment Instructions
    paymentInstructions: {
      preferredMethod: string,         // 'bank_transfer', 'mobile_money', 'cash'
      bankTransferInstructions: string, // Step-by-step guide
      mobileMoneyInstructions: string,
      cashDepositInstructions: string,
      referenceFormat: string,         // How members should format payment reference
      proofRequired: boolean,          // Whether proof of payment is required
      approvalTimeframe: string        // "Within 24 hours", etc.
    },
    
    // Visibility Settings
    visibility: {
      showToAllMembers: boolean,       // Show account details to all members
      showOnDashboard: boolean,        // Display on user dashboard
      allowDownload: boolean,          // Allow downloading account details as PDF
      restrictedFields: [string]       // Fields to hide from regular members
    },
    
    // Update tracking
    lastUpdatedBy: string,
    lastUpdatedAt: Timestamp,
    updateHistory: [
      {
        updatedBy: string,
        updatedByName: string,
        updatedAt: Timestamp,
        changes: string                // Description of changes
      }
    ]
  },
  
  // Badge and Alert Configuration
  badgeSettings: {
    enabled: boolean,                  // Master toggle for badges
    
    // Payment Reminders
    paymentReminders: {
      enabled: boolean,
      daysBeforeDue: number,           // Show badge X days before due date
      showOnDashboard: boolean,
      badgeColor: string,              // 'red', 'yellow', 'blue', 'green'
      badgeText: string                // Custom text for badge
    },
    
    // Overdue Payments
    overduePayments: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      sendNotification: boolean        // Auto-send notification
    },
    
    // Pending Loan Approvals (Admin only)
    pendingLoans: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      notifyAdmins: boolean
    },
    
    // Upcoming Loan Repayments
    upcomingLoanRepayments: {
      enabled: boolean,
      daysBeforeDue: number,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string
    },
    
    // Overdue Loan Repayments
    overdueLoanRepayments: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      autoApplyPenalty: boolean
    },
    
    // Penalties Accrued
    penaltiesAccrued: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      thresholdAmount: number          // Show badge if penalties exceed this
    },
    
    // Low Group Funds (Admin only)
    lowGroupFunds: {
      enabled: boolean,
      thresholdAmount: number,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      notifyAdmins: boolean
    },
    
    // Pending Payment Approvals (Admin only)
    pendingApprovals: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string,
      notifyAdmins: boolean
    },
    
    // Unread Messages
    unreadMessages: {
      enabled: boolean,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string
    },
    
    // Meeting Reminders
    meetingReminders: {
      enabled: boolean,
      daysBeforeMeeting: number,
      showOnDashboard: boolean,
      badgeColor: string,
      badgeText: string
    },
    
    // Custom Badges (Admin configurable)
    customBadges: [
      {
        id: string,
        name: string,
        description: string,
        enabled: boolean,
        condition: string,             // 'manual', 'automatic'
        triggerType: string,           // 'date', 'amount', 'count', 'custom'
        triggerValue: any,
        showOnDashboard: boolean,
        badgeColor: string,
        badgeText: string,
        targetAudience: string,        // 'all', 'admins', 'members', 'specific'
        createdBy: string,
        createdAt: Timestamp
      }
    ]
  },
  
  // Activity tracking
  activityLog: {
    lastPaymentApproved: Timestamp,
    lastLoanApproved: Timestamp,
    lastMemberAdded: Timestamp,
    lastMeetingDate: Timestamp,
    lastBadgeConfigUpdate: Timestamp
  }
}
```

**Subcollections**:
- `members`: Individual member data for this group
- `payments`: Payment tracking per year/type
- `loans`: Loan records
- `transactions`: Financial transaction history
- `messages`: Group messaging and support tickets
- `broadcasts`: Group-wide announcements from admins
- `badges`: Active badges for members (auto-generated and manual)
- `adminRoleChanges`: History of member promotions/demotions
- `monthlyReports`: Monthly financial summaries and reports
- `meetings`: Meeting records (optional)
- `notifications`: Group-specific notifications (deprecated - use root notifications collection)

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
  addedBy: string,                // UID of person who added this member
  status: string,                 // 'active', 'inactive', 'suspended', 'left'
  lastActive: Timestamp,          // Last time member was active
  
  // Profile Information
  profileImageUrl: string,        // Member's profile picture URL
  profileImageUpdatedAt: Timestamp, // When profile picture was last updated
  profileImageUpdatedBy: string,  // UID of who updated (admin or user themselves)
  
  // Member-specific settings
  collateral: string,             // Collateral information (optional)
  customPaymentRules: {           // Override group defaults if needed
    seedMoney: number,            // Custom seed money amount
    monthlyContribution: number,  // Custom monthly contribution
    applyPenalties: boolean,      // Whether to apply penalties to this member
    notes: string                 // Reason for custom rules
  },
  
  // Guarantors and Surety
  guarantors: [
    {
      guarantorId: string,        // Unique ID for guarantor
      name: string,               // Guarantor's full name
      phone: string,              // Guarantor's phone number
      email: string,              // Guarantor's email
      relationship: string,       // 'family', 'friend', 'colleague', 'other'
      idNumber: string,           // National ID or other ID number
      address: string,            // Physical address
      occupation: string,         // Guarantor's occupation
      employer: string,           // Employer name
      
      // Agreement details
      agreedToGuarantee: boolean,
      agreedAt: Timestamp,
      maxGuaranteeAmount: number, // Maximum amount willing to guarantee
      
      // Contact verification
      phoneVerified: boolean,
      emailVerified: boolean,
      verifiedBy: string,         // Admin who verified
      verifiedAt: Timestamp,
      
      // Documents
      documents: [
        {
          type: string,           // 'id_copy', 'signature', 'proof_of_income', 'other'
          url: string,
          uploadedAt: Timestamp,
          uploadedBy: string
        }
      ],
      
      // Status
      status: string,             // 'active', 'inactive', 'revoked'
      notes: string,
      addedBy: string,            // Admin who added guarantor
      addedAt: Timestamp
    }
  ],
  
  surety: {
    // Surety provided by member for the group
    suretyType: string,           // 'property', 'cash', 'asset', 'guarantor', 'none'
    suretyValue: number,          // Estimated value
    description: string,          // Description of surety
    
    // Property details (if applicable)
    propertyDetails: {
      type: string,               // 'land', 'house', 'vehicle', 'other'
      location: string,
      titleDeedNumber: string,
      estimatedValue: number,
      ownershipProof: string      // Document URL
    },
    
    // Asset details (if applicable)
    assetDetails: {
      type: string,
      description: string,
      serialNumber: string,
      estimatedValue: number,
      photos: [string]            // Array of photo URLs
    },
    
    // Documents
    documents: [
      {
        type: string,
        url: string,
        uploadedAt: Timestamp,
        uploadedBy: string
      }
    ],
    
    // Verification
    verified: boolean,
    verifiedBy: string,           // Admin who verified
    verifiedAt: Timestamp,
    verificationNotes: string,
    
    // Status
    status: string,               // 'pending_verification', 'verified', 'rejected'
    addedBy: string,
    addedAt: Timestamp,
    updatedAt: Timestamp
  },
  
  // Financial Summary (frequently updated)
  financialSummary: {
    totalPaid: number,            // Total amount paid to group
    totalArrears: number,         // Total outstanding arrears
    totalLoans: number,           // Total active loan amount
    totalLoansPaid: number,       // Total loans repaid
    totalPenalties: number,       // Total penalties incurred
    lastPaymentDate: Timestamp,   // When last payment was made
    lastPaymentAmount: number,    // Amount of last payment
    creditScore: number           // Optional: 0-100 based on payment history
  },
  
  // Payment tracking history
  paymentHistory: {
    totalPaymentsMade: number,    // Count of payments
    totalPaymentsLate: number,    // Count of late payments
    totalPaymentsMissed: number,  // Count of missed payments
    averageDaysLate: number,      // Average days late for payments
    onTimePaymentRate: number     // Percentage of on-time payments
  },
  
  // Loan tracking history
  loanHistory: {
    totalLoansRequested: number,  // Count of loan requests
    totalLoansApproved: number,   // Count of approved loans
    totalLoansDenied: number,     // Count of denied loans
    totalLoansActive: number,     // Count of currently active loans
    totalLoansCompleted: number,  // Count of fully repaid loans
    totalLoansDefaulted: number,  // Count of defaulted loans
    lastLoanDate: Timestamp,      // When last loan was taken
    lastLoanAmount: number        // Amount of last loan
  },
  
  // Personal Financial Overview (for user dashboard)
  personalFinancialOverview: {
    // Current Status Summary
    currentStatus: {
      memberSince: Timestamp,
      daysAsMember: number,
      currentBalance: number,        // Net position (contributions - loans - arrears)
      accountStatus: string,         // 'good_standing', 'arrears', 'defaulted', 'suspended'
      healthScore: number            // 0-100 score based on payment history and compliance
    },
    
    // What I Owe
    whatIOwe: {
      totalOwed: number,             // Total amount currently owed
      
      // Breakdown by type
      seedMoneyOwed: number,
      monthlyContributionsOwed: number,
      loanRepaymentsOwed: number,
      penaltiesOwed: number,
      otherOwed: number,
      
      // Upcoming payments
      upcomingPayments: [
        {
          type: string,              // 'seed_money', 'monthly_contribution', 'loan_repayment'
          amount: number,
          dueDate: Timestamp,
          daysUntilDue: number,
          status: string,            // 'upcoming', 'due_soon', 'overdue'
          paymentId: string          // Reference to payment document
        }
      ],
      
      // Overdue items
      overduePayments: [
        {
          type: string,
          amount: number,
          originalDueDate: Timestamp,
          daysOverdue: number,
          penaltyAccrued: number,
          paymentId: string
        }
      ]
    },
    
    // What I've Paid
    whatIvePaid: {
      totalPaidToDate: number,       // All-time total
      totalPaidThisYear: number,
      totalPaidThisMonth: number,
      totalPaidPreviousMonth: number,
      
      // Breakdown
      seedMoneyPaid: number,
      monthlyContributionsPaid: number,
      loanRepaymentsPaid: number,
      penaltiesPaid: number,
      
      // Recent payments
      recentPayments: [
        {
          type: string,
          amount: number,
          paidDate: Timestamp,
          approvedDate: Timestamp,
          status: string,
          paymentId: string
        }
      ],
      
      // Payment streak
      consecutiveOnTimePayments: number,
      lastOnTimePayment: Timestamp
    },
    
    // My Loans
    myLoans: {
      activeLoanCount: number,
      totalActiveLoanAmount: number,
      totalLoanRepaymentsDue: number,
      
      // Active loans detail
      activeLoans: [
        {
          loanId: string,
          loanAmount: number,
          interestRate: number,
          totalRepayable: number,
          amountPaid: number,
          amountRemaining: number,
          disbursedDate: Timestamp,
          
          // Repayment schedule
          nextPaymentDue: {
            amount: number,
            dueDate: Timestamp,
            daysUntilDue: number,
            installmentNumber: number
          },
          
          // Full schedule
          repaymentSchedule: [
            {
              installmentNumber: number,
              amount: number,
              dueDate: Timestamp,
              status: string,          // 'paid', 'pending', 'overdue'
              paidDate: Timestamp,
              amountPaid: number
            }
          ],
          
          // Loan status
          status: string,                // 'active', 'completed', 'in_arrears', 'defaulted'
          daysInArrears: number,
          penaltiesOnLoan: number,
          expectedCompletionDate: Timestamp,
          progressPercentage: number     // How much of loan is repaid
        }
      ],
      
      // Completed loans
      completedLoansCount: number,
      totalCompletedLoansAmount: number,
      averageRepaymentTime: number       // Days to repay on average
    },
    
    // My Contributions to Group
    myContributionsToGroup: {
      totalContributed: number,          // Lifetime contributions
      shareOfGroupFunds: number,         // Percentage of total group funds
      eligibleForLoanAmount: number,     // Based on contributions
      
      // Contribution breakdown
      contributionBreakdown: {
        seedMoney: number,
        monthlyContributions: number,
        loanInterestPaid: number,
        penalties: number,
        otherContributions: number
      }
    },
    
    // When My Loans Will Be Paid Off
    loanProjections: {
      // If paying on time
      onTimeCompletionDate: Timestamp,
      onTimeTotalCost: number,           // Principal + interest (no penalties)
      
      // Current trajectory (with any delays)
      projectedCompletionDate: Timestamp,
      projectedTotalCost: number,        // Including current penalties
      
      // Early payoff option
      earlyPayoffAmount: number,         // What to pay to clear all loans now
      earlyPayoffSavings: number,        // Interest saved by early payoff
      
      // Individual loan projections
      loanByLoanProjections: [
        {
          loanId: string,
          currentDueDate: Timestamp,
          projectedDueDate: Timestamp,
          remainingPayments: number,
          totalRemaining: number
        }
      ]
    },
    
    // My Position in Group
    myPositionInGroup: {
      complianceRanking: number,         // 1 = best, N = worst
      totalMembers: number,
      percentileRanking: number,         // Top X% of members
      
      // Comparison to group average
      vsGroupAverage: {
        myPaymentRate: number,
        groupAveragePaymentRate: number,
        myArrears: number,
        groupAverageArrears: number,
        myLoans: number,
        groupAverageLoans: number
      }
    },
    
    // Alerts and Notifications
    financialAlerts: [
      {
        alertType: string,               // 'payment_due', 'overdue', 'loan_repayment', 'penalty'
        severity: string,                // 'info', 'warning', 'urgent', 'critical'
        message: string,
        amount: number,
        dueDate: Timestamp,
        actionRequired: string
      }
    ],
    
    // Last updated
    lastCalculated: Timestamp,
    calculatedBy: string                 // 'system' or admin UID
  },
  
  // Activity tracking
  activityLog: {
    lastLogin: Timestamp,
    lastPaymentSubmitted: Timestamp,
    lastLoanRequest: Timestamp,
    lastProfileUpdate: Timestamp,
    lastFinancialOverviewViewed: Timestamp,
    updatedBy: string             // UID of last person to update this record
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
  updatedAt: Timestamp,
  totalExpected: number,          // Total expected from all members
  totalReceived: number,          // Total actually received
  totalPending: number,           // Total pending approval
  totalRejected: number,          // Total rejected
  completionRate: number,         // Percentage of expected amount received
  
  // Tracking
  statistics: {
    totalMembers: number,         // Number of members expected to pay
    membersPaid: number,          // Number who have paid
    membersPending: number,       // Number with pending approval
    membersUnpaid: number,        // Number who haven't paid
    averageDaysToApproval: number,// Average time from submission to approval
    lastPaymentReceived: Timestamp
  }
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
  penalties: number,              // Penalties applied
  approvalStatus: string,         // 'unpaid', 'pending', 'approved', 'rejected'
  paymentStatus: string,          // 'unpaid', 'partial', 'paid', 'overpaid'
  dueDate: Timestamp,
  
  // Payment timing tracking
  submittedAt: Timestamp,         // When member first submitted payment
  firstReminderSent: Timestamp,   // When first reminder was sent
  lastReminderSent: Timestamp,    // When last reminder was sent
  paidAt: Timestamp,              // When payment was made (member submission)
  approvedAt: Timestamp,          // When payment was approved (admin approval)
  rejectedAt: Timestamp,          // When payment was rejected (if applicable)
  
  // Time tracking
  daysLate: number,               // Number of days payment was late
  daysToApproval: number,         // Days from submission to approval
  
  // Who did what
  approvedBy: string,             // UID of admin who approved
  rejectedBy: string,             // UID of admin who rejected
  remindersSentBy: [string],      // UIDs of admins who sent reminders
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  // Payment proof and verification
  proofOfPayment: {
    imageUrl: string,
    uploadedAt: Timestamp,
    verifiedBy: string,           // UID of admin who verified
    verifiedAt: Timestamp,
    notes: string                 // Admin notes about verification
  },
  
  // Payment history for this record (supports partial payments)
  paymentInstallments: [
    {
      amount: number,
      paidAt: Timestamp,
      approvedAt: Timestamp,
      approvedBy: string,
      proofUrl: string,
      notes: string
    }
  ],
  
  // Administrative notes
  adminNotes: [
    {
      note: string,
      createdBy: string,
      createdAt: Timestamp
    }
  ]
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
  borrowerEmail: string,
  loanAmount: number,
  interestRate: number,           // Interest rate at time of loan
  totalRepayable: number,         // Principal + interest
  amountPaid: number,
  amountRemaining: number,
  
  status: string,                 // 'pending', 'approved', 'active', 'paid', 'defaulted', 'cancelled'
  
  // Request and approval tracking
  requestedAt: Timestamp,
  reviewedAt: Timestamp,          // When admin first reviewed
  approvedAt: Timestamp,
  approvedBy: string,             // UID of admin who approved
  rejectedAt: Timestamp,
  rejectedBy: string,             // UID of admin who rejected
  disbursedAt: Timestamp,         // When loan was actually disbursed
  disbursedBy: string,            // UID of admin who disbursed
  completedAt: Timestamp,         // When fully repaid
  defaultedAt: Timestamp,         // When marked as defaulted
  
  // Repayment tracking
  repaymentSchedule: [
    {
      installmentNumber: number,  // 1, 2, 3, etc.
      dueDate: Timestamp,
      amount: number,
      amountPaid: number,
      status: string,             // 'pending', 'paid', 'partial', 'overdue'
      paidAt: Timestamp,
      daysOverdue: number,
      penaltyApplied: number
    }
  ],
  
  // Penalty tracking
  penalties: {
    totalPenalties: number,
    penaltyRate: number,
    penaltiesApplied: [
      {
        amount: number,
        reason: string,
        appliedAt: Timestamp,
        appliedBy: string
      }
    ]
  },
  
  // Loan details
  collateral: string,
  collateralValue: number,        // Estimated value
  purpose: string,
  purposeCategory: string,        // 'business', 'education', 'medical', 'emergency', 'other'
  repaymentPeriodMonths: number,  // Number of months for repayment
  
  // History and tracking
  paymentHistory: [
    {
      amount: number,
      paidAt: Timestamp,
      approvedBy: string,
      proofUrl: string,
      notes: string
    }
  ],
  
  // Administrative tracking
  adminNotes: [
    {
      note: string,
      createdBy: string,
      createdAt: Timestamp
    }
  ],
  
  // Guarantors (optional)
  guarantors: [
    {
      uid: string,
      fullName: string,
      relationship: string,
      phone: string,
      agreedAt: Timestamp
    }
  ],
  
  // Document tracking
  documents: [
    {
      type: string,               // 'collateral_proof', 'agreement', 'id_copy'
      url: string,
      uploadedAt: Timestamp,
      uploadedBy: string
    }
  ],
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastModifiedBy: string
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
  transactionType: string,        // 'payment', 'loan_disbursement', 'loan_repayment', 'withdrawal', 'penalty', 'refund', 'fee'
  category: string,               // 'income', 'expense'
  amount: number,
  balanceBefore: number,          // Group balance before transaction
  balanceAfter: number,           // Group balance after transaction
  
  // User information
  userId: string,                 // User involved in transaction
  userName: string,
  userEmail: string,
  
  description: string,
  status: string,                 // 'pending', 'completed', 'cancelled', 'failed'
  
  // Timing
  initiatedAt: Timestamp,         // When transaction was initiated
  completedAt: Timestamp,         // When transaction was completed
  cancelledAt: Timestamp,         // When transaction was cancelled
  
  // Who did what
  initiatedBy: string,            // UID of person who initiated
  approvedBy: string,             // UID of admin who approved
  cancelledBy: string,            // UID of person who cancelled
  processedBy: string,            // UID of admin who processed
  
  // Timestamps
  createdAt: Timestamp,
  processedAt: Timestamp,
  
  // References to related documents
  metadata: {
    paymentType: string,
    paymentId: string,            // Reference to payment document
    loanId: string,               // Reference to loan document
    referenceNumber: string,      // External reference (e.g., bank transaction ID)
    proofUrl: string,
    notes: string
  },
  
  // Audit trail
  auditLog: [
    {
      action: string,             // 'created', 'approved', 'completed', 'cancelled'
      performedBy: string,
      performedAt: Timestamp,
      notes: string
    }
  ]
}
```

---

### 8. **groups/{groupId}/messages** (Subcollection)
Communication and support system for members and admins.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  messageId: string,              // Same as document ID
  ticketNumber: string,           // Human-readable ticket number (e.g., "MSG-001")
  
  // Message Classification
  type: string,                   // 'support_ticket', 'query', 'complaint', 'payment_query', 'loan_query', 'general'
  category: string,               // 'payment', 'loan', 'account', 'technical', 'financial', 'administrative'
  priority: string,               // 'low', 'medium', 'high', 'urgent'
  status: string,                 // 'open', 'in_progress', 'waiting_for_user', 'resolved', 'closed'
  
  // Participants
  createdBy: string,              // UID of person who created message/ticket
  createdByName: string,
  createdByEmail: string,
  createdByRole: string,          // 'member', 'admin', 'senior_admin'
  
  assignedTo: string,             // UID of admin assigned to handle
  assignedToName: string,
  assignedAt: Timestamp,
  
  // Subject and Content
  subject: string,                // Message subject/title
  initialMessage: string,         // First message content
  
  // Financial Context (if applicable)
  relatedTo: {
    entityType: string,           // 'payment', 'loan', 'transaction', 'none'
    entityId: string,             // ID of related payment/loan/transaction
    amount: number,               // Amount in question (if financial)
    reference: string             // Additional reference
  },
  
  // Conversation Thread
  messageThread: [
    {
      messageId: string,          // Unique ID for this message in thread
      sentBy: string,             // UID of sender
      sentByName: string,
      sentByRole: string,
      message: string,
      sentAt: Timestamp,
      attachments: [
        {
          fileName: string,
          fileUrl: string,
          fileType: string,       // 'image', 'pdf', 'document'
          uploadedAt: Timestamp
        }
      ],
      readBy: [                   // Track who has read this message
        {
          uid: string,
          readAt: Timestamp
        }
      ]
    }
  ],
  
  // Status Tracking
  createdAt: Timestamp,
  updatedAt: Timestamp,
  firstResponseAt: Timestamp,     // When admin first responded
  resolvedAt: Timestamp,
  closedAt: Timestamp,
  reopenedAt: Timestamp,
  
  // Time Tracking for SLA
  responseTime: number,           // Minutes from creation to first response
  resolutionTime: number,         // Minutes from creation to resolution
  
  // Resolution
  resolution: {
    resolvedBy: string,           // UID of person who resolved
    resolvedByName: string,
    resolutionNotes: string,
    resolutionDate: Timestamp,
    actionTaken: string,          // Description of action taken
    satisfactionRating: number    // 1-5 rating from user (optional)
  },
  
  // Administrative Notes (private, not visible to member)
  adminNotes: [
    {
      note: string,
      createdBy: string,
      createdByName: string,
      createdAt: Timestamp,
      isPrivate: boolean          // Private notes only admins can see
    }
  ],
  
  // Escalation
  escalated: boolean,
  escalatedTo: string,            // UID of senior admin
  escalatedAt: Timestamp,
  escalationReason: string,
  
  // Audit Trail
  auditLog: [
    {
      action: string,             // 'created', 'assigned', 'responded', 'resolved', 'reopened', 'closed'
      performedBy: string,
      performedByName: string,
      performedAt: Timestamp,
      notes: string
    }
  ],
  
  // Tags for filtering and searching
  tags: [string],                 // ['urgent', 'payment-issue', 'requires-followup']
  
  // Attachments summary
  hasAttachments: boolean,
  attachmentCount: number
}
```

---

### 9. **groups/{groupId}/broadcasts** (Subcollection)
Group-wide announcements and reminders from admins to all members.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  broadcastId: string,            // Same as document ID
  
  // Broadcast Type and Category
  type: string,                   // 'announcement', 'reminder', 'alert', 'meeting_notice', 'payment_reminder', 'general'
  category: string,               // 'payment', 'loan', 'meeting', 'administrative', 'urgent', 'informational'
  priority: string,               // 'low', 'medium', 'high', 'urgent'
  
  // Content
  title: string,                  // Broadcast title/subject
  message: string,                // Broadcast message content
  
  // Rich Content (optional)
  richContent: {
    html: string,                 // HTML formatted message
    markdown: string,             // Markdown formatted message
    summary: string               // Short summary for previews
  },
  
  // Sender Information
  sentBy: string,                 // UID of admin who sent broadcast
  sentByName: string,
  sentByEmail: string,
  sentByRole: string,             // 'admin' or 'senior_admin'
  
  // Targeting
  targetAudience: string,         // 'all_members', 'members_only', 'admins_only', 'custom'
  targetMemberIds: [string],      // If custom, list of specific member UIDs
  excludeMemberIds: [string],     // Members to exclude from broadcast
  
  // Delivery Settings
  deliveryChannels: {
    inApp: boolean,               // Show in app notifications
    email: boolean,               // Send email
    sms: boolean                  // Send SMS (if enabled)
  },
  
  // Scheduling
  scheduledFor: Timestamp,        // When to send (null for immediate)
  sentAt: Timestamp,              // When actually sent
  expiresAt: Timestamp,           // When broadcast expires (optional)
  
  // Related Context
  relatedTo: {
    entityType: string,           // 'payment', 'loan', 'meeting', 'transaction', 'none'
    entityId: string,             // ID of related entity
    dueDate: Timestamp,           // If it's a reminder for something due
    amount: number                // If financial reminder
  },
  
  // Action Button (optional)
  actionButton: {
    text: string,                 // Button text (e.g., "Pay Now", "View Details")
    url: string,                  // URL to navigate to
    type: string                  // 'payment', 'loan', 'meeting', 'custom'
  },
  
  // Attachments
  attachments: [
    {
      fileName: string,
      fileUrl: string,
      fileType: string,           // 'image', 'pdf', 'document'
      fileSize: number,           // In bytes
      uploadedAt: Timestamp
    }
  ],
  
  // Delivery Tracking
  deliveryStats: {
    totalRecipients: number,      // Total members targeted
    delivered: number,            // Successfully delivered
    read: number,                 // Number who read the message
    failed: number,               // Delivery failures
    emailsSent: number,
    smsSent: number,
    lastUpdated: Timestamp
  },
  
  // Individual Recipient Status
  recipients: [
    {
      uid: string,
      name: string,
      email: string,
      status: string,             // 'pending', 'delivered', 'read', 'failed'
      deliveredAt: Timestamp,
      readAt: Timestamp,
      notificationId: string,     // Reference to created notification
      emailSent: boolean,
      smsSent: boolean
    }
  ],
  
  // Status
  status: string,                 // 'draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp,
  cancelledBy: string,
  
  // Statistics
  readRate: number,               // Percentage of recipients who read (read/delivered * 100)
  responseRate: number,           // If action button exists, click rate
  
  // Admin Notes
  adminNotes: string,             // Private notes about this broadcast
  
  // Recurrence (for scheduled reminders)
  recurrence: {
    enabled: boolean,
    frequency: string,            // 'daily', 'weekly', 'monthly', 'custom'
    interval: number,             // Every X days/weeks/months
    endDate: Timestamp,           // When to stop recurring
    lastSent: Timestamp
  },
  
  // Audit Trail
  auditLog: [
    {
      action: string,             // 'created', 'scheduled', 'sent', 'cancelled', 'edited'
      performedBy: string,
      performedByName: string,
      performedAt: Timestamp,
      details: string
    }
  ]
}
```

---

### 10. **groups/{groupId}/badges** (Subcollection)
Active badges for members - auto-generated based on conditions or manually created by admins.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  badgeId: string,                // Same as document ID
  
  // Badge Information
  type: string,                   // 'payment_reminder', 'overdue_payment', 'pending_loan', 'loan_repayment_due', 'penalty_accrued', 'low_funds', 'pending_approval', 'unread_messages', 'meeting_reminder', 'custom'
  category: string,               // 'payment', 'loan', 'penalty', 'administrative', 'financial', 'informational'
  severity: string,               // 'info', 'warning', 'urgent', 'critical'
  
  // Target
  targetUserId: string,           // Specific user this badge is for (null for group-wide)
  targetUserName: string,
  targetAudience: string,         // 'all', 'admins', 'members', 'specific_user'
  
  // Display
  title: string,                  // Badge title
  message: string,                // Badge message/description
  shortText: string,              // Short text for badge display
  icon: string,                   // Icon name or emoji
  color: string,                  // 'red', 'yellow', 'blue', 'green', 'orange', 'purple'
  priority: number,               // Display priority (1-10, higher = more important)
  
  // Visibility
  showOnDashboard: boolean,
  showInNotifications: boolean,
  showOnCard: string,             // Which card to show on: 'payments', 'loans', 'profile', 'overview'
  
  // Badge Source
  source: string,                 // 'auto_generated', 'manual', 'system'
  generatedBy: string,            // System rule or admin UID
  generatedByName: string,
  
  // Related Entity
  relatedTo: {
    entityType: string,           // 'payment', 'loan', 'penalty', 'meeting', 'message', 'none'
    entityId: string,
    amount: number,               // Relevant amount
    dueDate: Timestamp,           // Relevant due date
    daysUntilDue: number,         // Calculated days
    daysOverdue: number           // Calculated overdue days
  },
  
  // Action
  actionRequired: boolean,        // Does this badge require action?
  actionType: string,             // 'pay', 'approve', 'respond', 'view', 'none'
  actionUrl: string,              // URL to navigate when badge clicked
  actionText: string,             // Text for action button
  
  // Status
  status: string,                 // 'active', 'resolved', 'dismissed', 'expired'
  active: boolean,                // Quick check if badge should be displayed
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  expiresAt: Timestamp,           // When badge auto-expires
  resolvedAt: Timestamp,          // When issue was resolved
  dismissedAt: Timestamp,         // When user dismissed badge
  dismissedBy: string,            // Who dismissed it
  
  // Interaction Tracking
  views: number,                  // How many times badge was viewed
  clicks: number,                 // How many times action was clicked
  lastViewedAt: Timestamp,
  lastClickedAt: Timestamp,
  
  // Auto-resolution
  autoResolve: boolean,           // Auto-resolve when condition met
  autoResolveCondition: string,   // Condition for auto-resolution
  
  // Recurrence (for recurring badges)
  isRecurring: boolean,
  recurrenceRule: string,         // 'daily', 'weekly', 'monthly'
  lastRecurredAt: Timestamp,
  
  // Metadata
  metadata: object,               // Additional data
  configuredFrom: string,         // Reference to badge setting that generated this
  
  // Audit
  auditLog: [
    {
      action: string,             // 'created', 'viewed', 'clicked', 'dismissed', 'resolved'
      performedBy: string,
      performedAt: Timestamp
    }
  ]
}
```

---

### 11. **groups/{groupId}/adminRoleChanges** (Subcollection)
History of admin promotions and demotions for accountability.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  changeId: string,               // Same as document ID
  
  // Who was affected
  affectedUserId: string,         // UID of person promoted/demoted
  affectedUserName: string,
  affectedUserEmail: string,
  
  // Change details
  changeType: string,             // 'promoted', 'demoted', 'permissions_updated', 'removed'
  
  // Previous and new roles
  previousRole: string,           // 'member', 'admin', 'senior_admin', null
  newRole: string,                // 'admin', 'senior_admin', 'member', null
  
  // Permissions
  previousPermissions: object,    // Previous permission set
  newPermissions: object,         // New permission set
  
  // Who made the change
  performedBy: string,            // UID of admin who made change
  performedByName: string,
  performedByRole: string,        // Role of person making change
  
  // Reason and notes
  reason: string,                 // Reason for promotion/demotion
  adminNotes: string,             // Private admin notes
  
  // Contact info changes (if applicable)
  contactInfoUpdated: boolean,
  addedToContactPage: boolean,    // Added to "Contact Admin" page
  removedFromContactPage: boolean,
  
  // Timing
  effectiveDate: Timestamp,       // When change takes effect
  createdAt: Timestamp,
  
  // Notification
  notificationSent: boolean,
  notificationSentAt: Timestamp,
  
  // Approval (for senior role changes)
  requiresApproval: boolean,      // Senior admin changes may need approval
  approvedBy: string,
  approvedAt: Timestamp,
  
  // Audit
  metadata: {
    ipAddress: string,
    userAgent: string,
    changeSource: string          // 'admin_dashboard', 'api', 'system'
  }
}
```

---

### 12. **groups/{groupId}/monthlyReports** (Subcollection)
Monthly financial summaries and accounting reports for admin and user dashboards.

**Document ID**: Format: `{YYYY}_{MM}` (e.g., "2024_01" for January 2024)
**Fields**:
```javascript
{
  reportId: string,               // Same as document ID
  year: number,                   // Report year
  month: number,                  // Report month (1-12)
  monthName: string,              // "January", "February", etc.
  
  // Report Period
  periodStart: Timestamp,         // First day of month
  periodEnd: Timestamp,           // Last day of month
  
  // Money Received Summary
  moneyReceived: {
    totalReceived: number,        // Total money received this month
    seedMoneyReceived: number,    // Seed money received
    monthlyContributionsReceived: number,
    loanRepaymentsReceived: number,
    penaltiesReceived: number,
    otherReceived: number,
    
    // Breakdown by source
    byPaymentType: [
      {
        type: string,             // 'seed_money', 'monthly_contribution', 'loan_repayment', 'penalty'
        amount: number,
        count: number             // Number of transactions
      }
    ],
    
    // Member-wise breakdown
    byMember: [
      {
        uid: string,
        name: string,
        amountPaid: number,
        paymentsCount: number
      }
    ]
  },
  
  // Money Loaned Out Summary
  moneyLoanedOut: {
    totalLoanedOut: number,       // Total money loaned this month
    numberOfLoans: number,        // Count of loans disbursed
    averageLoanAmount: number,
    largestLoan: number,
    smallestLoan: number,
    
    // Loan disbursements list
    loansDisbursed: [
      {
        loanId: string,
        borrowerId: string,
        borrowerName: string,
        amount: number,
        interestRate: number,
        disbursedDate: Timestamp,
        repaymentMonths: number
      }
    ]
  },
  
  // Loan Rotation List (Tentative/Compulsory)
  loanRotationList: {
    // Members eligible for loans this month
    eligibleMembers: [
      {
        uid: string,
        name: string,
        position: number,          // Queue position
        eligibilityStatus: string, // 'eligible', 'pending_payment', 'on_hold', 'already_has_loan'
        maxEligibleAmount: number, // Based on contributions and group rules
        contributionsPaid: number,
        arrears: number,
        creditScore: number,
        hasActiveLoans: boolean,
        lastLoanDate: Timestamp,
        priority: string,          // 'high', 'medium', 'low' (based on contributions, payment history)
        notes: string
      }
    ],
    
    // Compulsory rotation (if applicable)
    compulsoryRotation: {
      enabled: boolean,
      currentPosition: number,    // Which position in rotation
      nextInLine: [               // Next members to receive loans
        {
          uid: string,
          name: string,
          position: number,
          scheduledMonth: string  // "2024_02"
        }
      ]
    }
  },
  
  // Loan Repayments Due This Month
  loanRepaymentsDue: {
    totalDue: number,             // Total loan repayments due
    totalReceived: number,        // Total actually received
    totalPending: number,         // Total still pending
    totalOverdue: number,         // Overdue from previous months
    
    // Members with repayments due
    dueThisMonth: [
      {
        uid: string,
        name: string,
        loanId: string,
        installmentNumber: number,
        amountDue: number,
        amountPaid: number,
        amountRemaining: number,
        dueDate: Timestamp,
        status: string,           // 'paid', 'partial', 'pending', 'overdue'
        paidDate: Timestamp,
        daysOverdue: number
      }
    ]
  },
  
  // Loan Defaulters / Non-Payers
  loanDefaulters: {
    totalDefaulted: number,       // Total amount in default
    numberOfDefaulters: number,
    
    // Members who haven't paid loans
    defaultersList: [
      {
        uid: string,
        name: string,
        loanId: string,
        originalLoanAmount: number,
        amountOutstanding: number,
        installmentsMissed: number,
        lastPaymentDate: Timestamp,
        daysSinceLastPayment: number,
        totalOverdue: number,
        penaltiesAccrued: number,
        status: string,           // 'late', 'defaulted', 'in_arrears'
        contactAttempts: number,
        lastContactDate: Timestamp,
        collateral: string,
        guarantors: [string]      // Guarantor names
      }
    ]
  },
  
  // Group Financial Summary
  groupFinancials: {
    openingBalance: number,       // Balance at start of month
    closingBalance: number,       // Balance at end of month
    totalIncome: number,          // All money received
    totalExpenditure: number,     // All money loaned out + expenses
    netChange: number,            // Closing - Opening
    
    // Breakdown
    totalAssets: number,          // Money in hand + loans outstanding
    totalLoansOutstanding: number,
    cashInHand: number,
    totalArrears: number,
    totalPenalties: number
  },
  
  // Member Statistics
  memberStats: {
    totalMembers: number,
    activeMembers: number,
    membersWhoPaid: number,       // Paid this month
    membersInArrears: number,
    membersWithLoans: number,
    newMembersAdded: number
  },
  
  // Payment Compliance
  paymentCompliance: {
    seedMoneyCompliance: number,  // Percentage
    monthlyContributionCompliance: number,
    loanRepaymentCompliance: number,
    overallCompliance: number
  },
  
  // Report Metadata
  generatedAt: Timestamp,
  generatedBy: string,            // UID of who generated (system or admin)
  status: string,                 // 'draft', 'final', 'archived'
  notes: string,                  // Admin notes for the month
  
  // Previous month comparison
  comparisonToPreviousMonth: {
    moneyReceivedChange: number,  // Percentage change
    moneyLoanedOutChange: number,
    balanceChange: number,
    complianceChange: number
  }
}
```

---

### 13. **invitationCodes** (Root Collection)
Manages registration approval codes for new group creation.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  code: string,                   // 8-character registration code
  approved: boolean,              // Whether code is approved by senior admin
  used: boolean,                  // Whether code has been used
  
  // Timing
  createdAt: Timestamp,
  approvedAt: Timestamp,
  usedAt: Timestamp,
  expiresAt: Timestamp,           // Optional expiration date
  
  // Who did what
  approvedBy: string,             // UID of senior admin who approved
  rejectedBy: string,             // UID of admin who rejected (if applicable)
  usedBy: string,                 // UID of user who used the code
  
  // Status tracking
  status: string,                 // 'pending', 'approved', 'rejected', 'used', 'expired'
  
  // Associated data
  associatedEmail: string,        // Email of person requesting (optional)
  associatedGroupName: string,    // Group name created with this code
  
  // Notes
  adminNotes: string,             // Notes from admin review
  
  // Audit
  auditLog: [
    {
      action: string,             // 'created', 'approved', 'rejected', 'used'
      performedBy: string,
      performedAt: Timestamp,
      notes: string
    }
  ]
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
  acceptedBy: string,             // UID when invitation is accepted
  cancelledAt: Timestamp,
  cancelledBy: string,
  
  // Tracking
  remindersSent: number,          // Count of reminder emails sent
  lastReminderSent: Timestamp,
  
  // Notes
  invitationMessage: string       // Custom message from inviter
}
```

---

### 10. **systemSettings** (Root Collection)
Global system configuration.

**Document ID**: "config"
**Fields**:
```javascript
{
  maintenanceMode: boolean,
  maintenanceModeMessage: string,
  allowNewRegistrations: boolean,
  maxGroupsPerUser: number,
  defaultCycleDuration: number,   // In months
  supportEmail: string,
  supportPhone: string,
  
  // Feature flags
  features: {
    enableLoans: boolean,
    enableMeetings: boolean,
    enableNotifications: boolean,
    enableMultiCurrency: boolean
  },
  
  // System limits
  limits: {
    maxMembersPerGroup: number,
    maxActiveLoanPerMember: number,
    maxFileUploadSize: number,    // In MB
    sessionTimeoutMinutes: number
  },
  
  // Last updated
  updatedAt: Timestamp,
  updatedBy: string
}
```

---

### 11. **auditLogs** (Root Collection)
System-wide audit logging for critical actions.

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  logId: string,                  // Same as document ID
  action: string,                 // 'user_created', 'group_created', 'payment_approved', 'loan_approved', etc.
  category: string,               // 'authentication', 'authorization', 'financial', 'administrative'
  severity: string,               // 'info', 'warning', 'error', 'critical'
  
  // Who and where
  performedBy: string,            // UID of user who performed action
  performedByName: string,
  performedByEmail: string,
  ipAddress: string,              // IP address of user
  userAgent: string,              // Browser/device information
  
  // What and when
  entityType: string,             // 'user', 'group', 'payment', 'loan', 'transaction'
  entityId: string,               // ID of the entity affected
  groupId: string,                // Associated group (if applicable)
  
  // Details
  description: string,
  changesData: object,            // Before/after values for updates
  metadata: object,               // Additional context
  
  // Result
  status: string,                 // 'success', 'failure', 'partial'
  errorMessage: string,           // If action failed
  
  // Timestamp
  createdAt: Timestamp,
  
  // For investigation
  flagged: boolean,               // Flag for suspicious activity
  flaggedReason: string,
  investigatedBy: string,
  investigatedAt: Timestamp
}
```

---

### 12. **notifications** (Root Collection)
Individual user notifications (created from broadcasts, system events, or direct messages).

**Document ID**: Auto-generated
**Fields**:
```javascript
{
  notificationId: string,
  recipientId: string,            // UID of recipient
  recipientEmail: string,
  recipientName: string,
  
  // Notification Type and Source
  type: string,                   // 'payment_due', 'payment_approved', 'loan_approved', 'meeting_reminder', 'broadcast', 'message_received', 'system_announcement'
  source: string,                 // 'system', 'broadcast', 'direct_message', 'automatic'
  priority: string,               // 'low', 'medium', 'high', 'urgent'
  
  // Content
  title: string,
  message: string,
  shortMessage: string,           // Short preview for mobile/toast
  
  // Rich Content (optional)
  richContent: {
    html: string,
    markdown: string,
    imageUrl: string              // Featured image
  },
  
  // Action
  actionUrl: string,              // URL to navigate to when clicked
  actionText: string,             // Text for action button
  actionType: string,             // 'payment', 'loan', 'message', 'meeting', 'custom'
  
  // Group context
  groupId: string,                // Associated group (if applicable)
  groupName: string,
  
  // Broadcast Reference (if from broadcast)
  broadcastId: string,            // Reference to broadcast document
  isBroadcast: boolean,           // True if from group broadcast
  
  // Message Reference (if from message)
  messageId: string,              // Reference to message/ticket
  isMessageNotification: boolean,
  
  // Status and Read Tracking
  status: string,                 // 'sent', 'delivered', 'read', 'failed', 'expired'
  read: boolean,
  readAt: Timestamp,
  dismissed: boolean,             // User dismissed notification
  dismissedAt: Timestamp,
  
  // Delivery channels
  channels: {
    inApp: boolean,
    email: boolean,
    sms: boolean,
    push: boolean                 // Push notification (future)
  },
  
  // Delivery Status
  deliveryStatus: {
    inApp: string,                // 'sent', 'delivered', 'failed'
    email: string,
    sms: string,
    emailSentAt: Timestamp,
    smsSentAt: Timestamp,
    emailError: string,
    smsError: string
  },
  
  // Timestamps
  createdAt: Timestamp,
  sentAt: Timestamp,
  deliveredAt: Timestamp,
  expiresAt: Timestamp,           // When notification expires
  
  // Categorization and Filtering
  category: string,               // 'payment', 'loan', 'meeting', 'administrative', 'financial', 'system'
  tags: [string],                 // For filtering: ['urgent', 'payment-due', 'requires-action']
  
  // Related Entity
  relatedTo: {
    entityType: string,           // 'payment', 'loan', 'meeting', 'transaction', 'broadcast', 'message'
    entityId: string,
    amount: number,               // If financial
    dueDate: Timestamp            // If has deadline
  },
  
  // Sender Information (if sent by admin/user)
  sentBy: string,                 // UID of sender (for broadcasts/messages)
  sentByName: string,
  sentByRole: string,
  
  // Interaction Tracking
  interactions: {
    clicked: boolean,
    clickedAt: Timestamp,
    actionTaken: boolean,         // Did user complete the action
    actionTakenAt: Timestamp
  },
  
  // Attachments (if any)
  attachments: [
    {
      fileName: string,
      fileUrl: string,
      fileType: string
    }
  ],
  
  // Metadata
  metadata: object,               // Additional context
  
  // For recurring notifications
  isRecurring: boolean,
  recurringSourceId: string       // Reference to recurring broadcast
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
