# Bank Nkhonde - Technical Documentation

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Database Structure](#database-structure)
4. [File Structure](#file-structure)
5. [Authentication & Authorization](#authentication--authorization)
6. [Core Features Implementation](#core-features-implementation)
7. [Design System](#design-system)
8. [Email Service](#email-service)
9. [Deployment](#deployment)
10. [Security](#security)

---

## System Architecture

### Overview
Bank Nkhonde is a Firebase-powered Single Page Application (SPA) with a multi-tenant architecture supporting independent ROSCA groups.

### Architecture Pattern
- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Backend**: Firebase (Firestore, Auth, Storage, Functions)
- **State Management**: Session Storage + Real-time Firestore listeners
- **Styling**: Custom CSS with design system tokens

### Key Design Decisions
1. **Multi-Group Support**: Groups are completely isolated - separate rules, members, finances
2. **Mobile-First**: All UI components optimized for touch and small screens
3. **Offline-Capable**: Local caching with Firebase offline persistence
4. **Non-Blocking Operations**: Email and notifications don't block critical flows
5. **Audit Everything**: All financial actions logged with user, timestamp, IP

---

## Technology Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Custom design system, CSS Grid, Flexbox
- **JavaScript (ES6+)** - Modules, async/await, Promises
- **No Framework** - Vanilla JS for performance and simplicity

### Backend (Firebase)
- **Firebase Authentication** - Email/password auth
- **Cloud Firestore** - NoSQL database
- **Firebase Storage** - File uploads (profile pics, payment proofs, PDFs)
- **Cloud Functions** - Email sending (SMTP via Nodemailer)

### Libraries
- **intl-tel-input** - International phone number formatting
- **Chart.js** - Data visualization
- **jsPDF** - PDF generation
- **SheetJS (xlsx)** - Excel export
- **Nodemailer** - Email sending (server-side)

### Development Tools
- **PHP Built-in Server** - Local development (`php -S 127.0.0.1:8000`)
- **Firebase CLI** - Function deployment
- **Git** - Version control

---

## Database Structure

### Firestore Collections

#### Root Collections

##### 1. `users` (Global User Profiles)
```javascript
{
  uid: string,
  email: string,
  fullName: string,
  phone: string,
  whatsappNumber: string,
  profileImageUrl: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  groupMemberships: [
    {
      groupId: string,
      groupName: string,
      role: string, // 'senior_admin', 'admin', 'member'
      joinedAt: Timestamp
    }
  ]
}
```

##### 2. `groups` (Group Configurations)
```javascript
{
  groupId: string,
  groupName: string,
  description: string,
  createdAt: Timestamp,
  createdBy: string,
  status: 'active' | 'inactive',
  
  // Financial Rules
  rules: {
    seedMoney: {
      amount: number,
      dueDate: string,
      required: boolean
    },
    monthlyContribution: {
      amount: number,
      dayOfMonth: number,
      required: boolean
    },
    loanInterest: {
      rates: {
        month1: number,
        month2: number,
        month3: number
      },
      calculationMethod: 'reduced_balance' | 'flat_rate',
      maxRepaymentMonths: number
    },
    contributionPenalty: {
      type: 'percentage' | 'fixed',
      dailyRate: number,
      dailyFixed: number,
      maxCap: number,
      maxCapFixed: number,
      gracePeriodDays: number
    },
    loanRules: {
      maxLoanAmount: number,
      minCycleLoanAmount: number, // Min each member must borrow
      requireCollateral: boolean,
      loanPeriodCalculation: 'auto' | 'manual' | 'fixed'
    },
    cycleDuration: {
      months: number,
      startDate: string,
      endDate: string
    }
  },
  
  // Governance
  governance: {
    rules: string, // Text rules
    rulesDocumentUrl: string, // PDF URL
    lastUpdated: Timestamp
  },
  
  // Statistics
  statistics: {
    totalMembers: number,
    totalFunds: number,
    totalLoansActive: number,
    totalArrears: number
  },
  
  // Admins
  admins: [
    {
      uid: string,
      fullName: string,
      email: string,
      role: 'senior_admin' | 'admin',
      permissions: {...}
    }
  ]
}
```

#### Group Subcollections

##### `groups/{groupId}/members`
```javascript
{
  uid: string,
  fullName: string,
  email: string,
  phone: string,
  role: 'member' | 'admin' | 'senior_admin',
  joinedAt: Timestamp,
  status: 'active' | 'inactive',
  
  financialSummary: {
    totalContributed: number,
    totalLoansReceived: number,
    totalLoansPaid: number,
    activeLoans: number,
    arrears: number,
    penalties: number
  }
}
```

##### `groups/{groupId}/payments` (Year-based documents)
```javascript
// Document: "2024_MonthlyContribution_01"
{
  year: 2024,
  month: 1,
  paymentType: 'MonthlyContribution' | 'SeedMoney',
  totalExpected: number,
  totalReceived: number,
  
  // User payments (subcollection)
  userPayments: {
    [userId]: {
      userId: string,
      fullName: string,
      totalAmount: number,
      amountPaid: number,
      arrears: number,
      approvalStatus: 'pending' | 'approved' | 'rejected',
      paymentStatus: 'unpaid' | 'partial' | 'paid',
      proofOfPayment: {
        imageUrl: string,
        uploadedAt: Timestamp
      }
    }
  }
}
```

##### `groups/{groupId}/loans`
```javascript
{
  loanId: string,
  borrowerId: string,
  borrowerName: string,
  loanAmount: number,
  interestRate: number,
  totalRepayable: number,
  amountPaid: number,
  amountRemaining: number,
  status: 'pending' | 'approved' | 'disbursed' | 'repaid' | 'defaulted',
  requestedAt: Timestamp,
  approvedAt: Timestamp,
  repaymentSchedule: [
    {
      month: number,
      dueDate: Timestamp,
      amount: number,
      paid: boolean
    }
  ]
}
```

##### `groups/{groupId}/notifications`
```javascript
{
  notificationId: string,
  type: 'broadcast' | 'payment_reminder' | 'loan_update',
  title: string,
  message: string,
  createdBy: string,
  createdAt: Timestamp,
  targetUsers: ['all'] | [userId1, userId2],
  readBy: [userId1, userId2]
}
```

##### 3. `invitationCodes` (Registration Approval)
```javascript
{
  code: string, // 8-character code
  approved: boolean,
  used: boolean,
  status: 'pending' | 'approved' | 'rejected' | 'used',
  createdAt: Timestamp,
  approvedAt: Timestamp,
  approvedBy: string
}
```

### Database Indexes
Required composite indexes:
```json
[
  {
    "collectionGroup": "payments",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "paymentType", "order": "ASCENDING" },
      { "fieldPath": "year", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "loans",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "requestedAt", "order": "DESCENDING" }
    ]
  }
]
```

---

## File Structure

```
Bank-Nkhonde-Website/
├── index.html                      # Landing page
├── login.html                      # Login page
├── config.php                      # Environment configuration
│
├── pages/                          # Application pages
│   ├── admin_dashboard.html        # Admin dashboard
│   ├── user_dashboard.html         # User dashboard
│   ├── admin_registration.html     # Group registration
│   ├── settings.html               # User settings
│   ├── manage_loans.html           # Loan management
│   ├── manage_payments.html        # Payment management
│   ├── manage_members.html         # Member management
│   ├── analytics.html              # Analytics page
│   ├── financial_reports.html      # Report generation
│   ├── contacts.html               # Member contacts
│   ├── view_rules.html             # View group rules
│   └── messages.html               # Notifications
│
├── scripts/                        # JavaScript modules
│   ├── firebaseConfig.js           # Firebase initialization
│   ├── registration.js             # Registration logic
│   ├── admin_dashboard.js          # Admin dashboard logic
│   ├── user_dashboard.js           # User dashboard logic
│   ├── manage_loans.js             # Loan management logic
│   ├── manage_payments.js          # Payment management logic
│   ├── manage_members.js           # Member management logic
│   ├── analytics.js                # Analytics logic
│   ├── financial_reports.js        # Report generation
│   ├── settings.js                 # Settings logic
│   ├── emailService.js             # Email functions
│   ├── invitation_code.js          # Invitation code logic
│   ├── modal-utils.js              # Modal utilities
│   └── error-logging.js            # Error logging
│
├── styles/                         # CSS stylesheets
│   ├── design-system.css           # Design tokens & components
│   ├── pages.css                   # Shared page styles
│   ├── dashboard.css               # Dashboard styles
│   └── login.css                   # Login page styles
│
├── config/                         # Configuration files
│   └── email.config.js             # Email SMTP settings
│
├── functions/                      # Firebase Cloud Functions
│   ├── index.js                    # Email functions
│   ├── package.json
│   └── node_modules/
│
├── assets/                         # Static assets
│   ├── favicon.png
│   └── images/
│
├── ABOUT_BANK_NKHONDE.md           # User-facing documentation
├── TECHNICAL_DOCUMENTATION.md      # This file
├── .gitignore
└── README.md
```

---

## Authentication & Authorization

### Authentication Flow

1. **User Registration**
   ```javascript
   // Create Firebase user
   const userCredential = await createUserWithEmailAndPassword(auth, email, password);
   const user = userCredential.user;
   
   // Create user document in Firestore
   await setDoc(doc(db, "users", user.uid), {
     uid: user.uid,
     email: email,
     fullName: name,
     createdAt: Timestamp.now()
   });
   ```

2. **Admin Registration (with Approval)**
   - Admin fills registration form
   - System generates 8-character invitation code
   - Code stored in `invitationCodes` collection with `status: 'pending'`
   - Senior admin approves/rejects code
   - On approval: User created + Group created + Admin added to group

3. **Login**
   ```javascript
   const userCredential = await signInWithEmailAndPassword(auth, email, password);
   const user = userCredential.user;
   
   // Load user's group memberships
   const userDoc = await getDoc(doc(db, "users", user.uid));
   const groups = userDoc.data().groupMemberships;
   ```

### Authorization Levels

#### Role Hierarchy
1. **Senior Admin** - Full control (create, delete, manage all)
2. **Admin** - Manage operations (approve payments, manage loans)
3. **Member** - View own data, make requests

#### Permission Checks
```javascript
// Check if user is admin of a group
function isGroupAdmin(userId, groupId) {
  const groupDoc = await getDoc(doc(db, "groups", groupId));
  const admins = groupDoc.data().admins;
  return admins.some(admin => admin.uid === userId);
}

// Firestore Security Rules example
match /groups/{groupId} {
  allow read: if isGroupMember(groupId);
  allow write: if isGroupAdmin(groupId);
  
  match /members/{userId} {
    allow read: if isGroupMember(groupId);
    allow write: if isGroupAdmin(groupId);
  }
}
```

---

## Core Features Implementation

### 1. Group Selection Flow

**Problem**: User can belong to multiple groups
**Solution**: Group selection overlay on dashboard

```javascript
// Admin Dashboard
async function loadAdminGroups() {
  const groupsSnapshot = await getDocs(
    query(collection(db, "groups"), 
          where("admins", "array-contains", { uid: currentUser.uid }))
  );
  
  // Display group selection overlay
  groupsSnapshot.forEach(doc => {
    const group = doc.data();
    renderGroupCard(group);
  });
}

// On group selection
function selectGroup(groupId) {
  sessionStorage.setItem('selectedGroupId', groupId);
  location.reload(); // Reload dashboard with selected group
}
```

### 2. Payment Management

**Flow**: Upload → Approve → Update Financials

```javascript
// User uploads payment
async function uploadPayment(groupId, paymentType, amount, proofImage) {
  // Upload image to Firebase Storage
  const imageRef = ref(storage, `payments/${groupId}/${Date.now()}_${proofImage.name}`);
  await uploadBytes(imageRef, proofImage);
  const imageUrl = await getDownloadURL(imageRef);
  
  // Create payment record
  const paymentDoc = {
    userId: currentUser.uid,
    groupId: groupId,
    paymentType: paymentType,
    amount: amount,
    approvalStatus: 'pending',
    proofOfPayment: {
      imageUrl: imageUrl,
      uploadedAt: Timestamp.now()
    }
  };
  
  await addDoc(collection(db, `groups/${groupId}/payments`), paymentDoc);
}

// Admin approves payment
async function approvePayment(groupId, paymentId) {
  const paymentRef = doc(db, `groups/${groupId}/payments/${paymentId}`);
  const payment = (await getDoc(paymentRef)).data();
  
  // Update payment status
  await updateDoc(paymentRef, {
    approvalStatus: 'approved',
    approvedAt: Timestamp.now(),
    approvedBy: currentUser.uid
  });
  
  // Update member financial summary
  const memberRef = doc(db, `groups/${groupId}/members/${payment.userId}`);
  await updateDoc(memberRef, {
    'financialSummary.totalContributed': increment(payment.amount),
    'financialSummary.arrears': increment(-payment.amount)
  });
  
  // Send notification
  await sendNotification(payment.userId, 'Payment Approved', 
                        `Your ${paymentType} payment has been approved.`);
}
```

### 3. Loan Management

**Calculation**: Reduced Balance Interest

```javascript
function calculateLoanRepayment(loanAmount, interestRates, months) {
  let remainingBalance = loanAmount;
  const schedule = [];
  
  for (let month = 1; month <= months; month++) {
    // Get interest rate for this month
    const rate = interestRates[`month${month}`] || interestRates.month3;
    
    // Calculate interest on remaining balance
    const interest = (remainingBalance * rate) / 100;
    
    // Principal payment (equal installments)
    const principal = loanAmount / months;
    
    // Total monthly payment
    const monthlyPayment = principal + interest;
    
    schedule.push({
      month: month,
      principal: principal,
      interest: interest,
      total: monthlyPayment,
      remainingBalance: remainingBalance - principal
    });
    
    remainingBalance -= principal;
  }
  
  return schedule;
}
```

### 4. Penalty Calculation

**Auto-Penalties**: Daily compound after grace period

```javascript
function calculatePenalty(originalAmount, dueDate, penaltySettings) {
  const today = new Date();
  const due = new Date(dueDate);
  
  // Check grace period
  const daysLate = Math.floor((today - due) / (1000 * 60 * 60 * 24));
  if (daysLate <= penaltySettings.gracePeriodDays) {
    return 0;
  }
  
  const daysOverdue = daysLate - penaltySettings.gracePeriodDays;
  
  if (penaltySettings.type === 'percentage') {
    // Percentage-based penalty
    const penalty = (originalAmount * penaltySettings.dailyRate * daysOverdue) / 100;
    const maxPenalty = (originalAmount * penaltySettings.maxCap) / 100;
    return Math.min(penalty, maxPenalty);
  } else {
    // Fixed amount penalty
    const penalty = penaltySettings.dailyFixed * daysOverdue;
    return Math.min(penalty, penaltySettings.maxCapFixed);
  }
}
```

### 5. Financial Reports

**Export**: PDF and Excel

```javascript
async function generateFinancialReport(groupId, startDate, endDate) {
  // Fetch data
  const members = await getGroupMembers(groupId);
  const payments = await getPayments(groupId, startDate, endDate);
  const loans = await getLoans(groupId, startDate, endDate);
  
  // Calculate totals
  const totalIncome = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalDisbursed = loans.reduce((sum, l) => sum + l.loanAmount, 0);
  const netPosition = totalIncome - totalDisbursed;
  
  // Generate PDF
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Financial Report', 20, 20);
  doc.setFontSize(12);
  doc.text(`Period: ${startDate} to ${endDate}`, 20, 30);
  
  // Add data tables
  doc.autoTable({
    head: [['Member', 'Contributions', 'Loans', 'Arrears']],
    body: members.map(m => [
      m.fullName,
      formatCurrency(m.totalContributed),
      formatCurrency(m.totalLoansReceived),
      formatCurrency(m.arrears)
    ])
  });
  
  doc.save('financial-report.pdf');
  
  // Generate Excel
  const ws = XLSX.utils.json_to_sheet(members.map(m => ({
    'Member': m.fullName,
    'Contributions': m.totalContributed,
    'Loans': m.totalLoansReceived,
    'Arrears': m.arrears
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, 'financial-report.xlsx');
}
```

---

## Design System

### Color Palette
```css
:root {
  /* Primary Colors */
  --bn-primary: #047857;        /* Deep Emerald Green */
  --bn-primary-light: #059669;
  --bn-primary-dark: #065f46;
  
  /* Accent Colors */
  --bn-accent: #F59E0B;         /* Gold */
  --bn-accent-light: #FCD34D;
  --bn-accent-dark: #D97706;
  
  /* Neutrals */
  --bn-dark: #0A1628;           /* Deep Navy */
  --bn-gray-800: #1F2937;
  --bn-gray: #6B7280;
  --bn-gray-lighter: #E5E7EB;
  --bn-white: #FFFFFF;
  
  /* Semantic Colors */
  --bn-success: #10B981;
  --bn-warning: #F59E0B;
  --bn-danger: #EF4444;
  --bn-info: #3B82F6;
}
```

### Typography
```css
:root {
  --bn-font-family: 'Manrope', -apple-system, system-ui, sans-serif;
  
  /* Font Sizes */
  --bn-text-xs: 0.75rem;    /* 12px */
  --bn-text-sm: 0.875rem;   /* 14px */
  --bn-text-base: 1rem;     /* 16px */
  --bn-text-lg: 1.125rem;   /* 18px */
  --bn-text-xl: 1.25rem;    /* 20px */
  --bn-text-2xl: 1.5rem;    /* 24px */
  --bn-text-3xl: 1.875rem;  /* 30px */
  
  /* Font Weights */
  --bn-weight-normal: 400;
  --bn-weight-medium: 500;
  --bn-weight-semibold: 600;
  --bn-weight-bold: 700;
  --bn-weight-extrabold: 800;
}
```

### Spacing
```css
:root {
  --bn-space-1: 0.25rem;    /* 4px */
  --bn-space-2: 0.5rem;     /* 8px */
  --bn-space-3: 0.75rem;    /* 12px */
  --bn-space-4: 1rem;       /* 16px */
  --bn-space-5: 1.25rem;    /* 20px */
  --bn-space-6: 1.5rem;     /* 24px */
  --bn-space-8: 2rem;       /* 32px */
  --bn-space-10: 2.5rem;    /* 40px */
  --bn-space-12: 3rem;      /* 48px */
}
```

### Components

#### Button Classes
```css
.btn {
  padding: var(--bn-space-3) var(--bn-space-6);
  border-radius: var(--bn-radius-lg);
  font-weight: var(--bn-weight-semibold);
  transition: all 0.2s ease;
}

.btn-accent {
  background: var(--bn-gradient-accent);
  color: var(--bn-dark);
}

.btn-primary {
  background: var(--bn-primary);
  color: white;
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--bn-gray-lighter);
}
```

#### Card Classes
```css
.card {
  background: var(--bn-white);
  border-radius: var(--bn-radius-xl);
  box-shadow: var(--bn-shadow-md);
  padding: var(--bn-space-6);
}

.glassmorphism-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
}
```

---

## Email Service

### Configuration

**File**: `config/email.config.js`

```javascript
const emailConfig = {
  smtp: {
    host: 'mail.promanaged-it.com',
    port: 465,
    secure: true,
    auth: {
      user: '_mainaccount@promanaged-it.com',
      pass: '2:p2WpmX[0YTs7'
    }
  },
  from: {
    name: 'Bank Nkhonde',
    email: '_mainaccount@promanaged-it.com'
  }
};
```

### Cloud Functions

**File**: `functions/index.js`

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: emailConfig.smtp.host,
  port: emailConfig.smtp.port,
  secure: emailConfig.smtp.secure,
  auth: emailConfig.smtp.auth
});

exports.sendRegistrationWelcome = functions.https.onCall(async (data) => {
  const mailOptions = {
    from: `"${emailConfig.from.name}" <${emailConfig.from.email}>`,
    to: data.email,
    subject: 'Welcome to Bank Nkhonde',
    html: `<h1>Welcome ${data.userName}!</h1>...`
  };
  
  await transporter.sendMail(mailOptions);
  return { success: true };
});
```

### Deploy
```bash
cd functions
npm install
firebase deploy --only functions
```

---

## Deployment

### Local Development

```bash
# Start PHP server
php -S 127.0.0.1:8000

# Or for network access
php -S 0.0.0.0:8000
```

### Production Deployment

1. **Update Configuration**
   ```php
   // config.php
   define('ENVIRONMENT', 'PROD'); // Change from 'UAT' to 'PROD'
   ```

2. **Deploy to Web Server**
   - Upload files via FTP/SFTP
   - Point domain to root directory
   - Configure SSL/HTTPS

3. **Deploy Cloud Functions**
   ```bash
   firebase deploy --only functions
   ```

4. **Verify Deployment**
   - Test login/registration
   - Test email sending
   - Test payment upload
   - Test all CRUD operations

---

## Security

### Firebase Security Rules

**File**: `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isSignedIn() {
      return request.auth != null;
    }
    
    function isGroupMember(groupId) {
      return isSignedIn() && 
             exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid));
    }
    
    function isGroupAdmin(groupId) {
      return isSignedIn() && 
             get(/databases/$(database)/documents/groups/$(groupId)).data.admins
             .hasAny([{uid: request.auth.uid}]);
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isSignedIn();
      allow write: if isSignedIn() && request.auth.uid == userId;
    }
    
    // Groups collection
    match /groups/{groupId} {
      allow read: if isGroupMember(groupId);
      allow create: if isSignedIn();
      allow update: if isGroupAdmin(groupId);
      allow delete: if isGroupAdmin(groupId);
      
      // Members subcollection
      match /members/{userId} {
        allow read: if isGroupMember(groupId);
        allow write: if isGroupAdmin(groupId);
      }
      
      // Payments subcollection
      match /payments/{paymentId} {
        allow read: if isGroupMember(groupId);
        allow create: if isGroupMember(groupId);
        allow update: if isGroupAdmin(groupId);
      }
      
      // Loans subcollection
      match /loans/{loanId} {
        allow read: if isGroupMember(groupId);
        allow create: if isGroupMember(groupId);
        allow update: if isGroupAdmin(groupId);
      }
    }
    
    // Invitation codes
    match /invitationCodes/{codeId} {
      allow read: if true;
      allow create: if true;
      allow update: if isSignedIn();
      allow delete: if isSignedIn();
    }
  }
}
```

### Best Practices

1. **Never commit credentials**
   - Add to `.gitignore`: `config/email.config.js`
   - Use environment variables in production

2. **Input Validation**
   - Validate all user inputs on client and server
   - Sanitize before database writes

3. **File Uploads**
   - Limit file size (10MB max)
   - Validate file types (images, PDFs only)
   - Use Firebase Storage security rules

4. **Authentication**
   - Enforce strong passwords (6+ characters, mixed case, numbers)
   - Implement password strength indicators
   - Use Firebase email verification

5. **Authorization**
   - Always check user roles before sensitive operations
   - Use Firestore security rules as second layer of defense

---

## Error Handling

### Centralized Error Logging

**File**: `scripts/error-logging.js`

```javascript
export function logError(context, error, severity = 'medium') {
  const errorLog = {
    context: context,
    message: error.message,
    code: error.code,
    severity: severity,
    timestamp: new Date().toISOString(),
    userId: currentUser?.uid,
    userAgent: navigator.userAgent
  };
  
  console.error(`[${severity.toUpperCase()}] ${context}:`, error);
  
  // Log to Firestore for critical errors
  if (severity === 'critical' || severity === 'high') {
    addDoc(collection(db, 'errorLogs'), errorLog);
  }
}
```

### Usage
```javascript
try {
  await approvePayment(groupId, paymentId);
} catch (error) {
  logError('Payment Approval', error, 'high');
  showErrorModal('Payment Error', 'Failed to approve payment. Please try again.');
}
```

---

## Performance Optimization

### Lazy Loading
```javascript
// Load heavy modules only when needed
const { sendEmail } = await import('./emailService.js');
```

### Firestore Pagination
```javascript
const pageSize = 20;
let lastVisible = null;

async function loadNextPage() {
  let q = query(collection(db, 'groups/xyz/payments'), 
                orderBy('createdAt', 'desc'), 
                limit(pageSize));
  
  if (lastVisible) {
    q = query(q, startAfter(lastVisible));
  }
  
  const snapshot = await getDocs(q);
  lastVisible = snapshot.docs[snapshot.docs.length - 1];
  
  return snapshot.docs.map(doc => doc.data());
}
```

### Caching
```javascript
// Cache group data in session
if (sessionStorage.getItem('groupData')) {
  groupData = JSON.parse(sessionStorage.getItem('groupData'));
} else {
  groupData = await fetchGroupData(groupId);
  sessionStorage.setItem('groupData', JSON.stringify(groupData));
}
```

---

## Troubleshooting

### Common Issues

**1. CORS Error with Cloud Functions**
- **Cause**: Functions not deployed
- **Fix**: `firebase deploy --only functions`

**2. Email Not Sending**
- **Cause**: SMTP credentials incorrect or functions not deployed
- **Fix**: Check `config/email.config.js` and redeploy functions
- **Note**: Email is non-blocking, registration will still succeed

**3. Group Data Not Loading**
- **Cause**: No group selected
- **Fix**: Ensure `sessionStorage.getItem('selectedGroupId')` returns a value

**4. Permission Denied Errors**
- **Cause**: Firestore security rules blocking access
- **Fix**: Check user role and update security rules if needed

**5. Payment Upload Fails**
- **Cause**: File too large or wrong format
- **Fix**: Limit to 10MB, accept only images

---

## API Reference

### Firebase Config
```javascript
// firebaseConfig.js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "banknkonde.firebaseapp.com",
  projectId: "banknkonde",
  storageBucket: "banknkonde.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

### Helper Functions

```javascript
// Format currency
function formatCurrency(amount) {
  return `MWK ${parseInt(amount || 0).toLocaleString('en-US')}`;
}

// Show toast notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Open/close modals
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('active');
  document.body.style.overflow = '';
}
```

---

## Contact & Support

**Technical Support**: _mainaccount@promanaged-it.com  
**Phone**: +265 991 234 567

---

**Last Updated**: January 2026  
**Version**: 2.0  
**License**: Proprietary
