# Money Masters Saving Rules and Regulations

## Table of Contents
1. [Introduction](#introduction)
2. [Group Formation](#group-formation)
3. [Membership](#membership)
4. [Financial Contributions](#financial-contributions)
5. [Loans and Borrowing](#loans-and-borrowing)
6. [Penalties and Fines](#penalties-and-fines)
7. [Interest Rates](#interest-rates)
8. [Payment Cycles](#payment-cycles)
9. [Roles and Responsibilities](#roles-and-responsibilities)
10. [Record Keeping](#record-keeping)
11. [Dispute Resolution](#dispute-resolution)
12. [Termination and Exit](#termination-and-exit)

---

## 1. Introduction

Money Masters is a digital platform designed to facilitate Rotating Savings and Credit Associations (ROSCAs) and Village Savings and Loan Associations (VSLAs). This document outlines the rules and regulations that govern the operation of savings groups on the platform.

### Purpose
- To promote savings culture among members
- To provide accessible credit to members
- To foster financial literacy and discipline
- To create a transparent and accountable savings system

---

## 2. Group Formation

### 2.1 Registration Requirements
- **Admin Registration**: One person must register as the group admin
- **Group Name**: Must be unique and identifiable
- **Minimum Members**: Groups should have a minimum number of active members (recommended: 5-30)
- **Group Agreement**: All members must agree to the group's financial terms

### 2.2 Group Configuration
When creating a group, the admin must configure:
- **Seed Money**: Initial capital contribution required from each member
- **Seed Money Due Date**: Deadline for initial capital payment
- **Interest Rate**: Annual interest rate for loans (percentage)
- **Monthly Contribution**: Regular monthly savings amount (MWK)
- **Loan Penalty**: Late payment penalty rate for loans (percentage)
- **Monthly Penalty**: Penalty for late monthly contributions (percentage)
- **Cycle Start Date**: Beginning of the savings cycle (12 months)

### 2.3 Group Validation
- All financial parameters must be agreed upon by founding members
- Changes to group parameters require member consensus
- Group configurations are recorded in the system with timestamps

---

## 3. Membership

### 3.1 Joining a Group
- **Invitation System**: New members can join through approved invitation codes
- **Admin Approval**: Group admins must approve new member applications
- **Multiple Groups**: Users can belong to multiple savings groups
- **Dual Roles**: Admins are also regular members and have the same financial obligations

### 3.2 Member Information
Each member must provide:
- Full legal name
- Valid email address
- Phone number (with international format)
- Secure password (minimum 6 characters)

### 3.3 Member Roles
- **Admin**: Manages group, approves payments, oversees operations
- **User/Member**: Participates in savings, can access loans, makes contributions

### 3.4 Member Rights
- Access to personal financial records
- View group financial status
- Apply for loans
- Switch between admin and user views (if admin)
- Participate in group decisions

### 3.5 Member Responsibilities
- Make timely monthly contributions
- Pay seed money by the due date
- Repay loans according to agreed terms
- Keep personal information updated
- Maintain confidentiality of group financial matters

---

## 4. Financial Contributions

### 4.1 Seed Money
- **Purpose**: Initial capital to establish the group's loan fund
- **Amount**: Set by group during formation
- **Due Date**: Must be paid within the specified timeframe
- **Non-refundable**: Until group cycle completion or dissolution
- **Late Payment**: Subject to penalties as configured

### 4.2 Monthly Contributions
- **Frequency**: Monthly, on specified cycle dates
- **Amount**: Fixed amount set during group formation (MWK)
- **Payment Methods**: Multiple payment methods supported
- **Recording**: All payments tracked with date, amount, and method
- **Approval**: Admin must approve payments before they're recorded

### 4.3 Payment Tracking
The system tracks:
- Total amount due
- Total amount paid
- Arrears (outstanding balance)
- Payment status (paid/unpaid/pending)
- Payment history with timestamps
- Surplus payments

### 4.4 Payment Calculation Formula
```
Arrears = Total Due - Total Paid
Penalty = Arrears × (Penalty Rate / 100) [if past due date]
Total Due = Arrears + Penalty
Surplus = Total Paid - (Total Due + Penalty) [if overpaid]
```

---

## 5. Loans and Borrowing

### 5.1 Loan Eligibility
Members are eligible to borrow if they have:
- Paid their seed money in full
- Up-to-date monthly contributions
- No outstanding loan arrears
- Been a member for a minimum period (group-specific)

### 5.2 Loan Terms
- **Interest Rate**: Set during group formation (annual percentage)
- **Repayment Period**: Agreed upon during loan application
- **Maximum Amount**: Limited by group fund availability
- **Collateral**: May be required (documented in system)
- **Guarantors**: May be required by group policy

### 5.3 Loan Application Process
1. Member submits loan application
2. Admin reviews application
3. Group discusses and approves/rejects
4. Loan disbursed if approved
5. Repayment schedule created

### 5.4 Loan Repayment
- **Regular Payments**: According to agreed schedule
- **Payment Tracking**: System records all repayments
- **Outstanding Balance**: Calculated as: Loan Amount - Total Repaid
- **Early Repayment**: Allowed (with recalculated interest)
- **Late Payment Penalty**: Penalty Rate × Outstanding Amount

### 5.5 Loan Records
The system maintains:
- Loan ID and reference number
- Borrower information
- Loan amount
- Interest rate
- Repayment schedule
- Payment history
- Outstanding balance
- Penalty amounts
- Loan status

---

## 6. Penalties and Fines

### 6.1 Monthly Contribution Penalties
- **Trigger**: Payment not made by cycle date
- **Calculation**: Arrears × (Monthly Penalty Rate / 100)
- **Application**: Applied automatically after due date
- **Accumulation**: Compounds if not addressed
- **Cap**: May have maximum penalty limit (group policy)

### 6.2 Loan Penalties
- **Trigger**: Loan payment missed or delayed
- **Calculation**: Outstanding Amount × (Loan Penalty Rate / 100)
- **Application**: Applied per agreed schedule
- **Impact**: Affects future loan eligibility

### 6.3 Penalty Payment
- Penalties must be paid along with arrears
- System tracks penalty amounts separately
- No contribution considered complete until penalties cleared

### 6.4 Penalty Waivers
- May be granted by group decision
- Must be documented
- Requires admin approval in system

---

## 7. Interest Rates

### 7.1 Loan Interest
- **Rate Type**: Annual percentage rate (APR)
- **Configuration**: Set during group formation
- **Range**: Recommended 0-100% (configurable)
- **Application**: Applied to outstanding loan balance
- **Calculation**: Proportional to loan duration

### 7.2 Interest Distribution
- Interest collected goes to group fund
- May be distributed among members at cycle end
- Distribution method decided by group policy

### 7.3 Interest Rate Changes
- Require member consensus
- Apply to new loans only (existing loans maintain original rate)
- Must be documented in system

---

## 8. Payment Cycles

### 8.1 Cycle Structure
- **Duration**: 12 months (standard)
- **Start Date**: Configured during group formation
- **Monthly Dates**: Auto-generated for 12 months
- **Cycle Tracking**: System maintains cycle calendar

### 8.2 Cycle Dates
The system generates:
- ISO date format for calculations
- Friendly date format for display
- Year and month components
- Timestamp for precise tracking

### 8.3 Payment Due Dates
- **Seed Money**: Specific due date set at formation
- **Monthly Contributions**: Monthly cycle dates
- **Loan Repayments**: Per agreed schedule
- **Grace Period**: May be allowed (group policy)

### 8.4 Cycle Completion
At the end of 12 months:
- Final accounting performed
- Profits/interest distributed
- Seed money may be returned
- Option to start new cycle
- Records archived

---

## 9. Roles and Responsibilities

### 9.1 Group Admin
**Responsibilities:**
- Create and configure group
- Approve new member applications
- Review and approve payments
- Approve loan applications
- Monitor group financial health
- Resolve disputes
- Maintain accurate records
- Communicate with members

**Obligations:**
- Same financial obligations as regular members
- Must pay seed money and monthly contributions
- Subject to same penalties if late
- Can access both admin and user views

**Powers:**
- Approve/reject payments
- Approve/reject loan applications
- View all member records
- Generate reports
- Modify payment statuses

### 9.2 Regular Members
**Responsibilities:**
- Make timely contributions
- Repay loans on schedule
- Attend group meetings (if required)
- Participate in group decisions
- Maintain account security

**Rights:**
- View personal financial records
- Access group summary information
- Apply for loans
- Submit payments
- View payment history

### 9.3 System Responsibilities
The platform automatically:
- Calculates arrears and penalties
- Tracks all payments and loans
- Generates payment schedules
- Maintains audit trail
- Provides financial summaries
- Enforces data consistency

---

## 10. Record Keeping

### 10.1 Financial Records
The system maintains complete records of:
- All contributions (seed money and monthly)
- All loan transactions
- All repayments
- All penalties
- Payment methods
- Approval statuses
- Timestamps for all transactions

### 10.2 Member Records
Stored securely for each member:
- Personal information
- Group memberships
- Roles (admin/user)
- Financial balances
- Payment history
- Loan history
- Collateral information

### 10.3 Group Records
Maintained for each group:
- Group configuration
- Admin details
- Member list
- Payment summary (total due, paid, arrears)
- Approved payments
- Pending payments
- Loan portfolio
- Cycle dates
- Activity logs

### 10.4 Data Security
- All data encrypted in transit and at rest
- Firebase Authentication for secure access
- Role-based access control
- Audit trails for all modifications
- Regular backups

### 10.5 Data Access
- Members: Own records only
- Admins: All group member records
- System: Automated calculations and summaries
- Privacy: Email and phone kept confidential

---

## 11. Dispute Resolution

### 11.1 Dispute Types
- Payment disputes
- Loan approval disputes
- Penalty disputes
- Membership disputes
- Admin decisions

### 11.2 Resolution Process
1. **Internal Resolution**: Admin reviews and mediates
2. **Group Discussion**: Members vote if needed
3. **Documentation**: All decisions recorded in system
4. **Implementation**: System updated to reflect resolution

### 11.3 Escalation
- Disputes unresolved internally may require external mediation
- Group may establish dispute committee
- Platform provides complete transaction history for evidence

---

## 12. Termination and Exit

### 12.1 Member Exit
**Voluntary Exit:**
- Member must clear all arrears
- Outstanding loans must be repaid
- Penalties must be settled
- Share of group fund calculated
- Formal exit recorded in system

**Involuntary Exit:**
- Repeated violation of rules
- Fraud or misconduct
- Prolonged non-payment
- Admin approval required
- Group vote may be required

### 12.2 Group Dissolution
**Process:**
1. All loans must be repaid
2. Final accounting performed
3. Profits distributed
4. Seed money returned
5. Records archived
6. Group status set to inactive

**Requirements:**
- Member consensus
- Admin coordination
- Complete financial settlement
- Documentation of final state

### 12.3 Data Retention
- Financial records retained per legal requirements
- Inactive groups archived
- Member data retained for audit purposes
- Privacy rights respected per policy

---

## Appendix A: System Features Supporting Rules

### Validation Features
- Email uniqueness check (prevents duplicate accounts)
- Field-level validation (ensures data quality)
- Password strength requirements (minimum 6 characters)
- Phone number validation (international format)
- Numeric validation (amounts and percentages)
- Date validation (cannot be in past)

### Calculation Features
- Automatic arrears calculation
- Penalty calculation based on configured rates
- Surplus tracking
- Total due computation
- Outstanding balance tracking

### Approval Workflow
- Payment approval required before recording
- Loan approval process
- Multi-step validation before database writes
- Batch operations for data consistency

### Reporting Features
- Payment summaries
- Group financial health
- Individual member balances
- Loan portfolio status
- Activity logs

### Security Features
- Firebase Authentication
- Role-based access (admin/user)
- Secure password storage
- Session management
- Audit trails

---

## Appendix B: Best Practices

### For Admins
1. Review all payment submissions promptly
2. Maintain regular communication with members
3. Keep accurate records
4. Be fair and transparent in decisions
5. Plan for group sustainability
6. Monitor group financial health
7. Address arrears early

### For Members
1. Pay contributions on time
2. Only borrow what you can repay
3. Communicate if facing payment difficulties
4. Keep login credentials secure
5. Verify payment records regularly
6. Participate in group decisions
7. Respect group rules

### For Groups
1. Set realistic contribution amounts
2. Define clear loan policies
3. Establish fair penalty rates
4. Document all important decisions
5. Plan for emergencies
6. Review rules periodically
7. Foster trust and accountability

---

## Appendix C: Technical Implementation

### Database Structure
```
users/
  {userId}/
    - uid
    - fullName
    - email
    - phone
    - roles: ["admin", "user"]
    - groupMemberships: [groupId1, groupId2, ...]
    - createdAt

groups/
  {groupId}/
    - groupId
    - groupName
    - seedMoney
    - seedMoneyDueDate
    - interestRate
    - monthlyContribution
    - loanPenalty
    - monthlyPenalty
    - cycleStartDate
    - cycleDates[]
    - displayCycleDates[]
    - status
    - adminDetails[]
    - paymentSummary
    - createdAt
    
    members/
      {userId}/
        - uid
        - fullName
        - email
        - phone
        - role
        - joinedAt
        - collateral
        - balances[]
    
    payments/
      {year}_SeedMoney/
        {userId}/
          PaymentDetails/
            - userId
            - fullName
            - paymentType
            - totalAmount
            - arrears
            - approvalStatus
            - paymentStatus
            - dueDate
            - createdAt
      
      {year}_MonthlyContributions/
        {userId}/
          {year}_{month}/
            - userId
            - fullName
            - paymentType
            - totalAmount
            - arrears
            - approvalStatus
            - paymentStatus
            - dueDate
            - createdAt
    
    loans/
      {loanId}/
        - borrowerId
        - amount
        - interestRate
        - status
        - repayments[]
        - createdAt
```

### Key Algorithms

**Penalty Calculation:**
```javascript
const arrears = Math.max(totalDue - totalPaid, 0);
const penalty = (arrears > 0 && isPastDue) 
  ? arrears * (penaltyRate / 100) 
  : 0;
const totalDue = arrears + penalty;
```

**Validation Flow:**
1. Field-level validation (client-side)
2. Form submission validation
3. Email existence check
4. Firebase Auth user creation
5. Batch write to Firestore (atomic)
6. Success confirmation

---

## Version Control

**Document Version:** 1.0  
**Last Updated:** January 10, 2026  
**Platform Version:** Compatible with Bank Nkhonde v1.0+  
**Effective Date:** Upon group formation  

---

## Acknowledgments

These rules and regulations are designed to support transparent, accountable, and sustainable savings groups. They align with best practices from Village Savings and Loan Associations (VSLAs) and Rotating Savings and Credit Associations (ROSCAs) worldwide.

---

## Contact and Support

For questions about these rules and regulations, please contact your group admin or the Bank Nkhonde support team through the platform.

---

*This document should be reviewed and customized by each group to match their specific needs and local regulations.*
