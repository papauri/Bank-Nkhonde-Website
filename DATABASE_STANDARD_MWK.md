# Database Structure Standard for Malawi Kwacha (MWK)
## Bank Nkhonde ROSCA Platform - Malawi

This document defines the standardized Firebase Firestore database structure for ROSCA groups in Malawi, ensuring all currency is in Malawi Kwacha (MWK) and the structure makes logical sense for payment tracking.

---

## Currency Standard

**ALL monetary values MUST be in Malawi Kwacha (MWK)**
- No USD, EUR, or other currencies
- All displays show "MWK" prefix
- All database fields store numbers (no currency symbols)
- Currency formatting: `MWK 1,234.56`

---

## Payment Collection Structure

### Standardized Payment Paths

```
groups/{groupId}/payments/
  ├── {YYYY}_SeedMoney (document)
  │     └── {userId} (subcollection)
  │           └── PaymentDetails (document) - Single seed money record
  │
  └── {YYYY}_MonthlyContributions (document)
        └── {userId} (subcollection)
              └── {YYYY}_{MonthName} (document) - One per month
                    Examples: "2024_January", "2024_February"
```

**IMPORTANT**: Use `userId` (Firebase Auth UID) NOT sanitized names for consistency and security.

---

## Document Structures

### 1. Seed Money Payment Document
**Path**: `groups/{groupId}/payments/{YYYY}_SeedMoney/{userId}/PaymentDetails`

```javascript
{
  // Identifiers
  userId: string,                    // Firebase Auth UID
  fullName: string,                  // Member's full name
  
  // Payment Details
  paymentType: "Seed Money",         // Fixed string
  totalAmount: number,               // Amount due in MWK (e.g., 1000000)
  amountPaid: number,                // Amount paid so far in MWK
  arrears: number,                   // Remaining balance in MWK
  
  // Status Tracking
  approvalStatus: string,            // "unpaid" | "pending" | "approved" | "rejected"
  paymentStatus: string,             // "unpaid" | "partial" | "paid" | "overpaid"
  
  // Dates
  dueDate: Timestamp,                // When payment is due
  paidAt: Timestamp | null,          // When member submitted payment
  approvedAt: Timestamp | null,      // When admin approved
  createdAt: Timestamp,
  updatedAt: Timestamp | null,
  
  // Payment Proof
  proofOfPayment: {
    imageUrl: string,                // URL to payment proof image
    uploadedAt: Timestamp | null,
    verifiedBy: string,              // Admin UID who verified
    verifiedAt: Timestamp | null
  },
  
  // Who processed
  approvedBy: string | null,         // Admin UID who approved
  rejectedBy: string | null,         // Admin UID who rejected (if applicable)
  
  // Currency (for clarity)
  currency: "MWK"                    // Always "MWK"
}
```

### 2. Monthly Contribution Payment Document
**Path**: `groups/{groupId}/payments/{YYYY}_MonthlyContributions/{userId}/{YYYY}_{MonthName}`

**Document ID Format**: `{YYYY}_{MonthName}` (e.g., "2024_January", "2024_February")

```javascript
{
  // Identifiers
  userId: string,                    // Firebase Auth UID
  fullName: string,                  // Member's full name
  month: string,                     // Full month name: "January", "February", etc.
  year: number,                      // Year: 2024
  
  // Payment Details
  paymentType: "Monthly Contribution", // Fixed string
  totalAmount: number,               // Expected amount in MWK per month
  amountPaid: number,                // Amount paid so far in MWK
  arrears: number,                   // Remaining balance in MWK
  
  // Status Tracking
  approvalStatus: string,            // "unpaid" | "pending" | "approved" | "rejected"
  paymentStatus: string,             // "unpaid" | "partial" | "paid" | "overpaid"
  
  // Dates
  dueDate: Timestamp,                // Due date for this month (typically 5th of month)
  paidAt: Timestamp | null,          // When member submitted payment
  approvedAt: Timestamp | null,      // When admin approved
  createdAt: Timestamp,
  updatedAt: Timestamp | null,
  
  // Payment Proof
  proofOfPayment: {
    imageUrl: string,                // URL to payment proof image
    uploadedAt: Timestamp | null,
    verifiedBy: string,              // Admin UID who verified
    verifiedAt: Timestamp | null
  },
  
  // Who processed
  approvedBy: string | null,         // Admin UID who approved
  rejectedBy: string | null,         // Admin UID who rejected (if applicable)
  
  // Currency (for clarity)
  currency: "MWK"                    // Always "MWK"
}
```

### 3. Loan Document
**Path**: `groups/{groupId}/loans/{loanId}`

```javascript
{
  // Identifiers
  loanId: string,                    // Auto-generated loan ID
  borrowerId: string,                // Firebase Auth UID
  borrowerName: string,
  borrowerEmail: string,
  
  // Loan Amounts (ALL in MWK)
  loanAmount: number,                // Principal loan amount in MWK
  interestRate: number,              // Interest rate percentage (e.g., 15 for 15%)
  totalRepayable: number,            // Principal + interest in MWK
  amountPaid: number,                // Amount paid so far in MWK
  amountRemaining: number,           // Outstanding balance in MWK
  
  // Status
  status: string,                    // "pending" | "approved" | "active" | "completed" | "defaulted" | "cancelled"
  
  // Dates
  requestedAt: Timestamp,
  approvedAt: Timestamp | null,
  disbursedAt: Timestamp | null,
  completedAt: Timestamp | null,
  
  // Repayment Schedule
  repaymentSchedule: [
    {
      installmentNumber: number,     // 1, 2, 3, etc.
      dueDate: Timestamp,
      amount: number,                // Amount due in MWK
      amountPaid: number,            // Amount paid in MWK
      status: string,                // "pending" | "paid" | "partial" | "overdue"
      paidAt: Timestamp | null
    }
  ],
  
  // Penalties (in MWK)
  penalties: {
    totalPenalties: number,          // Total penalties accrued in MWK
    penaltyRate: number,             // Penalty rate (e.g., 5000 for MWK 5,000 per day)
    dailyPenalty: number,            // Daily penalty amount in MWK
    penaltiesApplied: [
      {
        amount: number,              // Penalty amount in MWK
        reason: string,
        appliedAt: Timestamp
      }
    ]
  },
  
  // Currency
  currency: "MWK"                    // Always "MWK"
}
```

### 4. Group Rules (Amounts in MWK)
**Path**: `groups/{groupId}`

```javascript
{
  // ... other group fields ...
  
  rules: {
    seedMoney: {
      amount: number,                // Seed money amount in MWK (e.g., 1000000)
      dueDate: Timestamp,
      required: boolean
    },
    monthlyContribution: {
      amount: number,                // Monthly contribution in MWK (e.g., 500000)
      required: boolean,
      dayOfMonth: number             // Due day (e.g., 5 for 5th of month)
    },
    loanPenalty: {
      rate: number,                  // Daily penalty rate in MWK (e.g., 5000)
      gracePeriodDays: number        // Days before penalty applies
    },
    monthlyPenalty: {
      rate: number,                  // Monthly penalty rate percentage
      gracePeriodDays: number
    },
    interestRate: number             // Loan interest rate percentage
  },
  
  statistics: {
    totalFunds: number,              // Total group funds in MWK
    totalArrears: number,            // Total arrears in MWK
    totalLoansActive: number,        // Total active loans in MWK
    totalCollections: number         // Total collections in MWK
  },
  
  currency: "MWK"                    // Always "MWK"
}
```

---

## Key Naming Conventions

### Payment Types (Use consistently)
- **Seed Money**: `"Seed Money"` (display) / `"SeedMoney"` (collection name)
- **Monthly Contribution**: `"Monthly Contribution"` (display) / `"MonthlyContributions"` (collection name)
- **Loan Repayment**: `"Loan Repayment"` (display)

### Collection Names
- Use camelCase: `SeedMoney`, `MonthlyContributions`
- No spaces in collection/document IDs
- Use underscores only for date formatting: `{YYYY}_{MonthName}`

### Status Values
- `approvalStatus`: `"unpaid"`, `"pending"`, `"approved"`, `"rejected"`
- `paymentStatus`: `"unpaid"`, `"partial"`, `"paid"`, `"overpaid"`
- `loanStatus`: `"pending"`, `"approved"`, `"active"`, `"completed"`, `"defaulted"`

### User Identifiers
- **ALWAYS use `userId`** (Firebase Auth UID) in paths
- **NEVER use sanitized names** (like `sanitizedName`) in database paths
- Store `fullName` as a field for display purposes

---

## Currency Formatting Functions

All currency formatting should use this standard function:

```javascript
function formatCurrency(amount) {
  return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}
```

Example outputs:
- `formatCurrency(1000000)` → `"MWK 1,000,000.00"`
- `formatCurrency(500000)` → `"MWK 500,000.00"`
- `formatCurrency(1500.5)` → `"MWK 1,500.50"`

---

## Migration Notes

If existing data uses different structure:
1. **UserId vs SanitizedName**: Migrate paths from sanitized names to userId
2. **Currency fields**: Add `currency: "MWK"` field to all payment/loan documents
3. **Amount values**: Verify all amounts are stored as numbers (not strings with "MWK" prefix)
4. **Payment type strings**: Standardize to exact strings: "Seed Money", "Monthly Contribution"

---

## Example Payment Flow (Malawi ROSCA)

### 1. Group Registration (MWK amounts)
```javascript
// Group created with rules
rules: {
  seedMoney: { amount: 1000000 },        // MWK 1,000,000
  monthlyContribution: { amount: 500000 }, // MWK 500,000
  interestRate: 15,                       // 15% per month
  loanPenalty: { rate: 5000 }            // MWK 5,000 per day
}
```

### 2. Seed Money Payment Path
```
groups/group123/payments/2024_SeedMoney/user456/PaymentDetails
{
  userId: "user456",
  fullName: "John Mwale",
  paymentType: "Seed Money",
  totalAmount: 1000000,           // MWK 1,000,000
  amountPaid: 0,
  arrears: 1000000,
  currency: "MWK",
  approvalStatus: "unpaid"
}
```

### 3. Monthly Contribution Payment Path
```
groups/group123/payments/2024_MonthlyContributions/user456/2024_January
{
  userId: "user456",
  fullName: "John Mwale",
  paymentType: "Monthly Contribution",
  month: "January",
  year: 2024,
  totalAmount: 500000,            // MWK 500,000
  amountPaid: 0,
  arrears: 500000,
  currency: "MWK",
  approvalStatus: "unpaid",
  dueDate: Timestamp(2024-01-05)  // 5th January
}
```

---

## Important Rules for Malawi ROSCA

1. **All amounts stored as numbers** (not strings)
2. **All displays show "MWK" prefix**
3. **Use userId (UID) for all database paths** - Never use sanitized names
4. **Consistent month naming**: Full month names ("January", not "Jan" or "01")
5. **Standard date format**: 5th of month for monthly contributions (per rules)
6. **Penalty calculation**: MWK 5,000 per day (fixed amount, not percentage) for late loan payments

---

**Last Updated**: January 2026  
**Currency**: Malawi Kwacha (MWK)  
**Country**: Malawi  
**Platform**: Bank Nkhonde ROSCA Platform
