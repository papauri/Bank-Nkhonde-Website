# Database Relationships and Foreign Keys

This document describes all foreign key relationships in the Bank Nkhonde database structure.

## Key Relationships

### 1. User ↔ Groups (Many-to-Many)
**Primary Document:** `users/{userId}`
**Relationship Field:** `groupMemberships[]` (array)
```javascript
{
  groupMemberships: [
    {
      groupId: "group_id_1",
      role: "member" | "admin" | "senior_admin",
      joinedAt: Timestamp
    }
  ]
}
```
**Reverse Reference:** `groups/{groupId}/members/{userId}` exists if user is a member

---

### 2. Group ↔ Members (One-to-Many)
**Primary Collection:** `groups/{groupId}/members/{memberId}`
**Foreign Key:** `memberId` = `userId` from `users` collection
**Relationship Validation:** `groups/{groupId}/members/{userId}.uid` must equal `users/{userId}.uid`

**Key Fields:**
- `uid`: References `users/{userId}`
- `userId`: Same as `uid` (for consistency)
- `role`: "member", "admin", or "senior_admin"
- `financialSummary`: Calculated from payment records

---

### 3. Member ↔ Payments (One-to-Many)
**Primary Collections:**
- `groups/{groupId}/payments/{year}_SeedMoney/{memberId}/PaymentDetails`
- `groups/{groupId}/payments/{year}_MonthlyContributions/{memberId}/{year}_{monthName}`
- `groups/{groupId}/payments/{year}_ServiceFee/{memberId}/PaymentDetails`

**Foreign Key:** `userId` in payment document must match `memberId` in path

**Relationship Validation:**
```javascript
// Payment document must have:
{
  userId: memberId,  // Must match path segment
  memberId: memberId,  // Optional, for clarity
  paymentType: "Seed Money" | "Monthly Contribution" | "Service Fee"
}
```

---

### 4. Member ↔ Loans (One-to-Many)
**Primary Collection:** `groups/{groupId}/loans/{loanId}`
**Foreign Key:** `borrowerId` must match `memberId`

**Relationship Validation:**
```javascript
{
  borrowerId: memberId,  // Must match groups/{groupId}/members/{memberId}
  borrowerName: memberFullName,  // For display purposes
  borrowerEmail: memberEmail  // For notifications
}
```

---

### 5. Loan ↔ Loan Payments (One-to-Many)
**Primary Collection:** `groups/{groupId}/loans/{loanId}/payments/{paymentId}`
**Foreign Key:** Payment implicitly linked via collection path

**Relationship Validation:**
- Payment belongs to loan by being in `loans/{loanId}/payments/` subcollection
- No explicit `loanId` field needed (path provides relationship)

---

### 6. Member ↔ Notifications (One-to-Many)
**Primary Collection:** `groups/{groupId}/notifications/{notificationId}`
**Foreign Keys:** `userId` and `recipientId` both reference member

**Relationship Validation:**
```javascript
{
  userId: memberId,  // Primary recipient
  recipientId: memberId,  // Duplicate for backward compatibility
  groupId: groupId,  // Groups the notification
  senderId: adminId | memberId  // Who sent it
}
```

---

### 7. Member ↔ Penalties (One-to-Many)
**Primary Collection:** `groups/{groupId}/penalties/{penaltyId}`
**Foreign Key:** `memberId` references member

**Relationship Validation:**
```javascript
{
  memberId: memberId,  // Must match groups/{groupId}/members/{memberId}
  type: "seed_money_penalty" | "monthly_contribution_penalty",
  relatedMonth: "January 2024" | null,  // For monthly penalties
  appliedBy: adminId  // Who applied the penalty
}
```

---

## Relationship Integrity Rules

### Rule 1: Member Consistency
- If `groups/{groupId}/members/{memberId}` exists, then `users/{memberId}` must exist
- `groups/{groupId}/members/{memberId}.uid` must equal `memberId`

### Rule 2: Payment Consistency
- All payment documents must have `userId` matching the `memberId` in their path
- `groups/{groupId}/payments/{year}_{PaymentType}/{memberId}/...` must have `userId: memberId`

### Rule 3: Loan Consistency
- `groups/{groupId}/loans/{loanId}.borrowerId` must reference an existing member
- `groups/{groupId}/members/{borrowerId}` must exist

### Rule 4: Notification Consistency
- `groups/{groupId}/notifications/{notificationId}.userId` must reference an existing member
- `groups/{groupId}/notifications/{notificationId}.groupId` must match the group

### Rule 5: Financial Summary Consistency
- `groups/{groupId}/members/{memberId}.financialSummary` should be calculated from actual payment records
- Use `recalculateMemberFinancialSummary()` utility function to ensure accuracy

---

## Service Fee Integration

Service fees follow the same relationship pattern as seed money and monthly contributions:

**Path:** `groups/{groupId}/payments/{year}_ServiceFee/{memberId}/PaymentDetails`

**Special Fields:**
- `perCycle: true` - Indicates this is a one-time fee per cycle
- `nonRefundable: true` - Service fees are not refundable
- `paymentType: "Service Fee"` - Identifies payment type

**Relationship:** Same as other payment types - `userId` must match `memberId` in path

---

## Indexes for Relationships

The following indexes support relationship queries:

1. **Payment Queries by Member:**
   - Index: `PaymentDetails` collection group on `userId` + `approvalStatus` + `updatedAt`
   - Supports: Finding all payments for a member across all groups

2. **Payment Queries by Type:**
   - Index: `PaymentDetails` collection group on `paymentType` + `approvalStatus` + `dueDate`
   - Supports: Finding all payments of a specific type with a specific status

3. **Loan Queries by Borrower:**
   - Index: `loans` collection on `status` + `requestedAt`
   - Supports: Finding all loans for a borrower filtered by status

4. **Notification Queries:**
   - Index: `notifications` collection on `recipientId` + `read` + `createdAt`
   - Supports: Finding unread notifications for a member

---

## Data Integrity Utilities

Use the utility functions in `scripts/utils_financial.js`:

1. **`recalculateMemberFinancialSummary(groupId, memberId)`**
   - Recalculates financial summary from actual payment records
   - Includes: seed money, monthly contributions, service fees, loans, penalties
   - Always calculates from source data for accuracy

2. **`verifyPaymentRelationships(groupId, memberId)`**
   - Verifies all payment documents have correct foreign key references
   - Checks: userId matches memberId, all payment types included
   - Returns: true if all relationships are valid

---

## Best Practices

1. **Always use memberId consistently:**
   - In payment paths: `payments/{year}_{Type}/{memberId}/...`
   - In payment documents: `userId: memberId`
   - In loan documents: `borrowerId: memberId`

2. **Recalculate financial summaries after payment changes:**
   - Don't manually update financialSummary fields
   - Use `recalculateMemberFinancialSummary()` utility function

3. **Verify relationships when adding new members:**
   - Ensure `users/{userId}` exists before creating `groups/{groupId}/members/{userId}`
   - Initialize all payment types (seed money, monthly, service fee)

4. **Include service fees in all financial calculations:**
   - Service fees are now part of the payment structure
   - Include in arrears calculations, financial summaries, reports

5. **Maintain referential integrity:**
   - When deleting a member, consider impact on payments, loans, notifications
   - Use soft deletes (status: "inactive") rather than hard deletes
