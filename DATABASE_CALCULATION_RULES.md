# Database Calculation Rules - Bank Nkhonde ROSCA

This document explains the calculation rules and database structure for financial calculations in the Bank Nkhonde ROSCA platform.

---

## 1. Monthly Penalty Calculation

**Purpose**: Percentage extra that members must pay for missed monthly contributions.

**Structure**:
```javascript
rules.monthlyPenalty: {
  rate: number,              // Percentage (e.g., 5 for 5%)
  type: "percentage",        // Always percentage
  gracePeriodDays: number    // Days before penalty applies
}
```

**Calculation**:
- **Penalty Amount** = `Missed Monthly Contribution × (monthlyPenalty.rate / 100)`
- Applied to: Missed monthly contribution payments
- Same rate for all members in the group
- Example: If monthly contribution is MWK 500,000 and penalty is 5%, penalty = MWK 25,000

---

## 2. Loan Penalty Calculation

**Purpose**: Percentage extra on top of monthly loan payments if the member misses the loan payment deadline.

**Structure**:
```javascript
rules.loanPenalty: {
  rate: number,              // Percentage (e.g., 10 for 10%)
  type: "percentage",        // Always percentage
  gracePeriodDays: number    // Days before penalty applies
}
```

**Calculation**:
- **Penalty Amount** = `Missed Loan Payment × (loanPenalty.rate / 100)`
- Applied to: Missed loan repayment installments
- Same rate for all members in the group
- Example: If loan payment due is MWK 200,000 and penalty is 10%, penalty = MWK 20,000

---

## 3. Seed Money Payment Structure

**Purpose**: Initial contribution required when joining the group.

**Structure**:
```javascript
rules.seedMoney: {
  amount: number,                    // Same for all members (MWK)
  dueDate: Timestamp,               // Initial due date
  required: true,                    // Must be fully paid
  allowPartialPayment: true,         // Can pay in installments
  maxPaymentMonths: number,          // Max months to complete (default: 2, admin configurable)
  mustBeFullyPaid: true              // Must be fully paid within maxPaymentMonths
}
```

**Payment Rules**:
- **Same amount** for all members in the group
- Can be paid **in full** or **within maxPaymentMonths** (default: 2 months)
- Admin can configure `maxPaymentMonths` when creating the group
- **Must be fully paid** - cannot be skipped
- Partial payments are allowed, but total must equal `amount` within the period

**Example**:
- Seed Money: MWK 1,000,000
- Max Payment Months: 2
- Member can pay: MWK 500,000 in Month 1, MWK 500,000 in Month 2
- OR: MWK 1,000,000 in Month 1 (full payment)

---

## 4. Monthly Contributions

**Purpose**: Regular monthly payments required from all members.

**Structure**:
```javascript
rules.monthlyContribution: {
  amount: number,           // Same for all members (MWK)
  required: true,
  dayOfMonth: number,       // Same due day for all (e.g., 5 for 5th of month)
  allowPartialPayment: true // Can pay partial amounts
}
```

**Rules**:
- **Same amount** for all members in the group
- **Same due day** for all members (e.g., 5th of every month)
- Partial payments allowed
- Monthly penalty applies if payment is missed

---

## 5. Loan Repayment with Tiered Interest

**Purpose**: Loans can have different interest rates per month based on remaining balance.

**Structure**:
```javascript
rules.loanInterest: {
  month1: number,                    // % interest for 1st month (on full loan amount)
  month2: number,                    // % interest for 2nd month (on remaining balance)
  month3AndBeyond: number,           // % interest for 3rd+ months (on remaining balance)
  calculationMethod: "balance_based" // Interest calculated on remaining balance
}
```

**Calculation Method**:

### Month 1:
- **Interest** = `Loan Amount × (month1 / 100)`
- **Total Due** = `Loan Amount + Interest`
- Example: Loan of MWK 400,000 with 15% interest
  - Interest = MWK 400,000 × 0.15 = MWK 60,000
  - Total Due = MWK 460,000

### Month 2:
- **Remaining Balance** = `Loan Amount - Amount Paid in Month 1`
- **Interest** = `Remaining Balance × (month2 / 100)`
- **Total Due** = `Remaining Balance + Interest`
- Example: If MWK 200,000 was paid in Month 1
  - Remaining Balance = MWK 400,000 - MWK 200,000 = MWK 200,000
  - Interest = MWK 200,000 × 0.15 = MWK 30,000
  - Total Due = MWK 230,000

### Month 3+:
- **Remaining Balance** = `Previous Balance - Amount Paid`
- **Interest** = `Remaining Balance × (month3AndBeyond / 100)`
- **Total Due** = `Remaining Balance + Interest`

**Loan Repayment Period**:
- Loans < MWK 500,000: Maximum 2 months repayment
- Loans ≥ MWK 500,000: Maximum 3 months repayment

**Repayment Schedule Example**:
```
Loan Amount: MWK 600,000
Month 1 Interest: 15%
Month 2 Interest: 10%
Month 3 Interest: 5%

Month 1:
  - Interest: MWK 600,000 × 15% = MWK 90,000
  - Total Due: MWK 690,000
  - If paid: MWK 300,000
  - Remaining: MWK 390,000

Month 2:
  - Interest: MWK 390,000 × 10% = MWK 39,000
  - Total Due: MWK 429,000
  - If paid: MWK 200,000
  - Remaining: MWK 229,000

Month 3:
  - Interest: MWK 229,000 × 5% = MWK 11,450
  - Total Due: MWK 240,450
  - Final payment: MWK 240,450
```

---

## 6. Uniformity Rules

All of the following are **the same for all members** within a group:

1. **Seed Money Amount**: `rules.seedMoney.amount`
2. **Monthly Contribution Amount**: `rules.monthlyContribution.amount`
3. **Monthly Penalty Rate**: `rules.monthlyPenalty.rate`
4. **Loan Penalty Rate**: `rules.loanPenalty.rate`
5. **Loan Interest Rates**: `rules.loanInterest.month1`, `month2`, `month3AndBeyond`
6. **Payment Due Days**: `rules.monthlyContribution.dayOfMonth`

**Individual Variations**:
- Members can have different payment schedules (as long as they meet deadlines)
- Members can pay different amounts per installment (partial payments)
- Loan amounts can differ per member
- Loan repayment schedules can differ (but follow same interest structure)

---

## 7. Database Structure Summary

### Group Rules (`groups/{groupId}/rules`)
```javascript
{
  seedMoney: {
    amount: number,              // Uniform for all members
    allowPartialPayment: true,
    maxPaymentMonths: 2           // Configurable by admin
  },
  monthlyContribution: {
    amount: number,               // Uniform for all members
    dayOfMonth: number           // Uniform for all members
  },
  loanInterest: {
    month1: number,               // Uniform for all loans
    month2: number,              // Uniform for all loans
    month3AndBeyond: number      // Uniform for all loans
  },
  loanPenalty: {
    rate: number                 // Uniform for all members
  },
  monthlyPenalty: {
    rate: number                 // Uniform for all members
  }
}
```

---

## 8. Calculation Examples

### Example 1: Monthly Contribution with Penalty
```
Monthly Contribution: MWK 500,000
Due Date: 5th of month
Payment Made: 10th of month (5 days late)
Monthly Penalty Rate: 5%

Penalty = MWK 500,000 × 5% = MWK 25,000
Total Due = MWK 500,000 + MWK 25,000 = MWK 525,000
```

### Example 2: Loan Payment with Penalty
```
Loan Payment Due: MWK 200,000
Due Date: 5th of month
Payment Made: 8th of month (3 days late)
Loan Penalty Rate: 10%

Penalty = MWK 200,000 × 10% = MWK 20,000
Total Due = MWK 200,000 + MWK 20,000 = MWK 220,000
```

### Example 3: Seed Money Partial Payment
```
Seed Money: MWK 1,000,000
Max Payment Months: 2

Month 1: Paid MWK 600,000
Month 2: Must pay remaining MWK 400,000
```

---

**Last Updated**: January 2026  
**Platform**: Bank Nkhonde ROSCA Platform  
**Currency**: Malawi Kwacha (MWK)
