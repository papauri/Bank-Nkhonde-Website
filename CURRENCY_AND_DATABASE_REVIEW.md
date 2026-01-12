# Currency & Database Structure Review - Malawi Kwacha (MWK)

## Summary

All currency in the Bank Nkhonde ROSCA platform is **Malawi Kwacha (MWK)**. This document reviews the current state and identifies areas for standardization.

---

## Currency Status ✅

### Current State
- **All currency formatting functions use "MWK" prefix** ✅
- **All displays show "MWK" in the UI** ✅
- **Database fields store numbers (not strings with currency)** ✅

### Currency Formatting Functions
All scripts correctly format currency as:
```javascript
function formatCurrency(amount) {
  return `MWK ${parseFloat(amount || 0).toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}
```

**Status**: ✅ **PASSING** - All currency is correctly in MWK

---

## Database Structure Review ⚠️

### Issue Found: Inconsistent Payment Path Structure

There is an **inconsistency** in how monthly contribution payments are stored:

#### ❌ Current Issue: Mixed Usage of `userId` vs `sanitizedName`

**Files using `userId` (CORRECT):**
- `scripts/registration.js` - Uses `userId` for monthly contributions
- `scripts/user_dashboard.js` - Uses `userId` 
- `scripts/seed_money_overview.js` - Uses `userId` for seed money

**Files using `sanitizedName` (INCONSISTENT):**
- `scripts/manage_payments.js` - Uses `sanitizedName` for monthly contributions
- `scripts/group_table.js` - Uses `sanitizedName` for monthly contributions
- `scripts/contributions_overview.js` - Uses `sanitizedName` for monthly contributions
- `scripts/financial_reports.js` - Uses `sanitizedName` for monthly contributions

#### Recommended Structure (Standard)

**Seed Money:**
```
groups/{groupId}/payments/{YYYY}_SeedMoney/{userId}/PaymentDetails
```
✅ **CORRECT** - Currently using `userId`

**Monthly Contributions:**
```
groups/{groupId}/payments/{YYYY}_MonthlyContributions/{userId}/{YYYY}_{MonthName}
```
⚠️ **INCONSISTENT** - Some files use `sanitizedName`, should use `userId`

---

## Database Field Names Review ✅

### Payment Document Fields

All payment documents use correct field names:
- `totalAmount` - Amount due in MWK
- `amountPaid` - Amount paid in MWK
- `arrears` - Outstanding balance in MWK
- `approvalStatus` - Status: "unpaid", "pending", "approved", "rejected"
- `paymentStatus` - Status: "unpaid", "partial", "paid", "overpaid"
- `paymentType` - "Seed Money" or "Monthly Contribution"
- `dueDate` - Timestamp
- `paidAt` - Timestamp
- `approvedAt` - Timestamp
- `proofOfPayment` - Object with imageUrl

**Status**: ✅ **PASSING** - Field names are logical and consistent

### Loan Document Fields

All loan documents use correct field names:
- `loanAmount` - Principal in MWK
- `totalRepayable` - Principal + interest in MWK
- `amountPaid` - Amount paid in MWK
- `amountRemaining` - Outstanding in MWK
- `interestRate` - Percentage (e.g., 15 for 15%)
- `status` - "pending", "approved", "active", "completed", "defaulted"

**Status**: ✅ **PASSING** - Field names are logical and consistent

### Group Rules Fields

Group rules use correct field names:
- `rules.seedMoney.amount` - Seed money amount in MWK
- `rules.monthlyContribution.amount` - Monthly contribution in MWK
- `rules.interestRate` - Interest rate percentage
- `rules.loanPenalty.rate` - Daily penalty in MWK (e.g., 5000)
- `rules.monthlyPenalty.rate` - Monthly penalty percentage

**Status**: ✅ **PASSING** - Field names are logical and consistent

---

## Payment Type Naming ✅

### Consistent Usage

**Display Names:**
- `"Seed Money"` - For display in UI
- `"Monthly Contribution"` - For display in UI
- `"Loan Repayment"` - For display in UI

**Collection Names:**
- `"SeedMoney"` - For collection path (no spaces)
- `"MonthlyContributions"` - For collection path (no spaces, plural)

**Status**: ✅ **PASSING** - Naming is consistent

---

## Status Values ✅

### Approval Status
- `"unpaid"` - Not yet submitted
- `"pending"` - Submitted, awaiting admin approval
- `"approved"` - Approved by admin
- `"rejected"` - Rejected by admin

### Payment Status
- `"unpaid"` - No payment made
- `"partial"` - Partial payment made
- `"paid"` - Fully paid
- `"overpaid"` - Overpaid

**Status**: ✅ **PASSING** - Status values are logical and consistent

---

## Recommendations

### 1. Standardize Monthly Contribution Paths ⚠️

**Current**: Mixed usage of `sanitizedName` and `userId`

**Recommendation**: 
- **Standardize to use `userId` (Firebase Auth UID)** for all payment paths
- This is more secure and consistent with Seed Money structure
- **Note**: If there is existing data using `sanitizedName`, migration will be needed

### 2. Add Currency Field to Documents (Optional Enhancement)

Consider adding a `currency: "MWK"` field to all payment and loan documents for clarity:
```javascript
{
  // ... other fields ...
  currency: "MWK"  // Always "MWK" for Malawi
}
```

### 3. Verify All Amount Fields Store Numbers

**Status**: ✅ **PASSING** - All amount fields store numbers, not strings

---

## Action Items

### Priority 1: Database Path Standardization ⚠️
- [ ] Update `scripts/manage_payments.js` to use `userId` instead of `sanitizedName`
- [ ] Update `scripts/group_table.js` to use `userId` instead of `sanitizedName`
- [ ] Update `scripts/contributions_overview.js` to use `userId` instead of `sanitizedName`
- [ ] Update `scripts/financial_reports.js` to use `userId` instead of `sanitizedName`
- [ ] **If existing data exists**: Create migration script to move data from `sanitizedName` paths to `userId` paths

### Priority 2: Currency Field Addition (Optional)
- [ ] Add `currency: "MWK"` field to all payment documents
- [ ] Add `currency: "MWK"` field to all loan documents
- [ ] Add `currency: "MWK"` field to group rules

---

## Conclusion

### ✅ What's Working
1. **All currency is correctly in MWK** - All displays and formatting use "MWK" prefix
2. **Field names are logical** - All database fields have clear, meaningful names
3. **Status values are consistent** - Standardized status values throughout
4. **Seed Money structure is correct** - Uses `userId` consistently

### ⚠️ What Needs Attention
1. **Monthly Contribution paths are inconsistent** - Mixed usage of `sanitizedName` vs `userId`
2. **Should standardize to `userId`** - More secure and consistent with Seed Money

### 📋 Standard Structure (Recommended)

**Seed Money:**
```
groups/{groupId}/payments/{YYYY}_SeedMoney/{userId}/PaymentDetails
```

**Monthly Contributions:**
```
groups/{groupId}/payments/{YYYY}_MonthlyContributions/{userId}/{YYYY}_{MonthName}
```

**All amounts in MWK, stored as numbers, displayed with "MWK" prefix.**

---

**Last Updated**: January 2026  
**Currency**: Malawi Kwacha (MWK)  
**Country**: Malawi  
**Platform**: Bank Nkhonde ROSCA Platform
