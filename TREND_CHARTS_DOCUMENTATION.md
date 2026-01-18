# Trend Charts Documentation

This document describes what each trend chart displays and how they work.

## Admin Analytics (`pages/analytics.html` / `scripts/analytics.js`)

### 1. Monthly Income vs Expenses Trend Chart
**Location:** Above pie charts in Financial Trends section  
**Element ID:** `monthlyTrendChart`  
**Display Logic:**
- **X-Axis:** Months (Jan, Feb, Mar, ... up to current month)
- **Y-Axis:** Amount (MWK) scaled to show relative values
- **Bars:**
  - **Green Bar (Income):** Total collections per month
    - Includes: Seed Money (in first month), Monthly Contributions, Service Fees
    - Only counts payments with `approvalStatus === "approved"` or `paymentStatus === "completed"`
  - **Red Bar (Expenses):** Total loan disbursements per month
    - Only counts loans with status: "active", "repaid", or "approved"
    - Uses `disbursedAt` date to determine month
- **Purpose:** Shows monthly cash flow trend - income vs outgoing loans
- **Scaling:** Auto-scales based on maximum value across all months
- **Empty State:** Chart container hidden if no data

### 2. Overall Payment Status Pie Chart
**Location:** Pie charts grid  
**Element ID:** `overall-payment-chart`  
**Display Logic:**
- **Segments:**
  - **Paid (Green):** Total amount paid across all payment types (seed money + monthly + service fee)
  - **Remaining (Red):** Total arrears across all payment types
- **Center Display:** Percentage paid (0-100%) and total due amount
- **Calculation:** 
  - `totalCollected = sum of all approved/completed payments`
  - `totalArrears = sum of all outstanding amounts`
  - `totalDue = totalCollected + totalArrears`
- **Updates:** Recalculates from actual payment records

### 3. Seed Money Status Pie Chart
**Location:** Pie charts grid  
**Element ID:** `seed-money-chart`  
**Display Logic:**
- **Segments:**
  - **Paid (Green):** Total seed money collected from all members
  - **Remaining (Red):** Total seed money still outstanding
- **Center Display:** Percentage paid and total seed money amount
- **Data Source:** `groups/{groupId}/payments/{year}_SeedMoney/{memberId}/PaymentDetails`
- **Only shows if:** Seed money amount > 0

### 4. Monthly Contributions Status Pie Chart
**Location:** Pie charts grid  
**Element ID:** `monthly-contributions-chart`  
**Display Logic:**
- **Segments:**
  - **Paid (Green):** Total monthly contributions collected from all members across all months
  - **Remaining (Red):** Total monthly contributions still outstanding
- **Center Display:** Percentage paid and total monthly contributions expected
- **Data Source:** `groups/{groupId}/payments/{year}_MonthlyContributions/{memberId}/{year}_{monthName}`
- **Includes:** All months in the current year cycle
- **Only shows if:** Monthly contributions amount > 0

### 5. Service Fee Status Pie Chart
**Location:** Pie charts grid  
**Element ID:** `service-fee-chart`  
**Display Logic:**
- **Segments:**
  - **Paid (Blue/Info):** Total service fees collected from all members
  - **Remaining (Yellow/Warning):** Total service fees still outstanding
- **Center Display:** Percentage paid and total service fee amount
- **Data Source:** `groups/{groupId}/payments/{year}_ServiceFee/{memberId}/PaymentDetails`
- **Only shows if:** Service fee is enabled (amount > 0) for the group
- **Note:** Service fees are one-time per cycle, non-refundable

### 6. Income vs Expenses Pie Chart
**Location:** Pie charts grid  
**Element ID:** `income-expenses-chart`  
**Display Logic:**
- **Segments:**
  - **Collections (Accent/Blue):** Total income (all approved payments + loan interest)
    - Includes: Seed Money, Monthly Contributions, Service Fees, Loan Interest Earned
  - **Disbursements (Gray):** Total loans given out
    - Includes: All active, approved, or repaid loans
- **Center Display:** Percentage of income vs total financial activity
- **Purpose:** Shows overall financial position - money coming in vs going out
- **Only shows if:** Either totalIncome > 0 or totalExpenses > 0

---

## User Analytics (`pages/user_analytics.html` / `scripts/user_analytics.js`)

### 1. Contribution Trend Bar Chart
**Location:** Contribution Trend section  
**Element ID:** `chartContainer`  
**Display Logic:**
- **X-Axis:** Last 6 months (or all available months if less than 6)
- **Y-Axis:** Amount paid (MWK) scaled relative to expected amount
- **Bars:** 
  - **Height:** Proportional to `userPaid / expectedAmount` ratio
  - **Color:** Gradient accent (var(--bn-gradient-accent))
  - **Data Points:** Each bar shows:
    - Amount paid that month
    - Expected monthly contribution amount
    - Percentage: (paid / expected) * 100
- **Calculation:**
  - For each month: Loads user's monthly contribution document
  - Checks both new structure (`amountPaid`) and old structure (`paid` array)
  - Only counts approved/completed payments
  - Includes seed money in first month if paid
  - Includes service fee if paid
- **Empty State:** Shows "No contribution data available yet" if no payments
- **Animation:** Bars animate from bottom to actual height on load

---

## Data Loading and Updates

### When Charts Update:
1. **Page Load:** Charts load automatically when:
   - User selects a group (admin analytics)
   - User selects a group or first group auto-selected (user analytics)
2. **Tab Switch:** Charts reload when switching between tabs
3. **Data Changes:** Charts do NOT auto-update - page refresh required
   - To update: Reload page or change group selector

### Data Sources:
- **Payments:** 
  - Seed Money: `groups/{groupId}/payments/{year}_SeedMoney/{memberId}/PaymentDetails`
  - Monthly: `groups/{groupId}/payments/{year}_MonthlyContributions/{memberId}/{year}_{monthName}`
  - Service Fee: `groups/{groupId}/payments/{year}_ServiceFee/{memberId}/PaymentDetails`
- **Loans:** `groups/{groupId}/loans/{loanId}`
- **Members:** `groups/{groupId}/members/{memberId}` (for financial summaries)

### Payment Status Filtering:
- **Included:** `approvalStatus === "approved"` OR `paymentStatus === "completed"`
- **Excluded:** `approvalStatus === "pending"` or `"unpaid"`
- **Reason:** Only count money that has been verified and collected

### Service Fee Integration:
- **Included in:** All income calculations, payment status charts, member performance
- **Tracked separately:** Has its own pie chart (if enabled)
- **Payment Type:** Marked as "Service Fee" with `perCycle: true` and `nonRefundable: true`
- **Calculation:** Treated same as seed money - one-time payment per cycle

---

## Chart Behavior

### Empty States:
- **No Data:** Shows empty state message with icon
- **No Payments:** Charts hidden or show 0% completion
- **No Group Selected:** Charts show empty state with prompt to select group

### Animations:
- **Pie Charts:** Segments fade in sequentially
- **Bar Charts:** Bars grow from 0% to actual height
- **Timing:** 0.5-0.8s transitions for smooth appearance

### Responsive:
- **Pie Charts:** Grid layout adapts to screen size (auto-fit, min 280px)
- **Bar Charts:** Flex layout with bars sized relative to container
- **Mobile:** Charts stack vertically, maintain readability

---

## Calculation Notes

### Income Calculations:
1. Seed Money: Sum of all approved seed money payments (year-based)
2. Monthly Contributions: Sum of all approved monthly payments across all months
3. Service Fees: Sum of all approved service fee payments (year-based)
4. Loan Interest: Sum of interest earned from repaid/active loans
5. **Total Income = Seed Money + Monthly + Service Fees + Loan Interest**

### Expense Calculations:
1. Loan Disbursements: Sum of all loan amounts for active/approved/repaid loans
2. **Total Expenses = Sum of all loan disbursements**

### Net Profit:
- **Net Profit = Total Income - Total Expenses**
- Positive = More money collected than loaned out
- Negative = More money loaned out than collected

### Member Performance:
- **Payment Rate = (Total Paid / Total Due) * 100**
- **Total Due = Total Paid + Total Arrears**
- Breakdown includes: Seed Money, Monthly Contributions, Service Fees
- Sorted by payment rate (highest first)

---

## Future Enhancements

Potential additions:
1. **Year-over-year comparison:** Show trends across multiple years
2. **Forecasting:** Predict future income/expenses based on payment patterns
3. **Payment method breakdown:** Pie chart showing cash vs mobile money vs bank transfer
4. **Member payment timeline:** Individual member contribution trends
5. **Loan repayment trends:** Chart showing loan repayment patterns over time
