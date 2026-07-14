-- 002_create_payments_and_loans.sql
-- Bank Nkhonde: money tables. Zero FLOAT/DOUBLE — every amount is DECIMAL(15,2),
-- every rate is DECIMAL(5,2). Requires 001_create_core_tables.sql to have run
-- (users, groups).
--
-- DESIGN DECISION: the three Firestore collections
-- payments_seed_money / payments_monthly_contribution / payments_service_fee
-- are consolidated into ONE `payments` table with a `paymentType` discriminator
-- (Firestore-isms #11 in SYSTEM_MAP). Type-specific columns (month / perCycle /
-- nonRefundable / description) are nullable here and only populated for the
-- matching paymentType.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- payments  (consolidated seed money / monthly contribution / service fee)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  paymentId                    VARCHAR(128)  NOT NULL,
  paymentType                  ENUM('seed_money','monthly_contribution','service_fee') NOT NULL,
  groupId                      VARCHAR(128)  NOT NULL,
  year                          INT           NOT NULL,
  uid                           VARCHAR(128)  NOT NULL,
  totalAmount                  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  amountPaid                   DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  arrears                       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  approvalStatus                ENUM('unpaid','pending','approved','rejected','completed') NOT NULL DEFAULT 'unpaid',
  -- Preserve the original inconsistent capitalisation from Firestore.
  paymentStatus                 ENUM('Pending','Completed') NOT NULL DEFAULT 'Pending',
  dueDate                       DATETIME      NOT NULL,
  paidAt                        DATETIME      NULL,
  paymentMethod                 ENUM('cash','bank_transfer','mobile_money') NULL,
  notes                         TEXT          NULL,
  recordedManually              TINYINT(1)    NOT NULL DEFAULT 0,
  isAdvancedPayment             TINYINT(1)    NOT NULL DEFAULT 0,

  -- Proof of payment (flattened from nested object)
  proofOfPaymentImageUrl        TEXT          NULL,
  proofOfPaymentFileName        VARCHAR(255)  NULL,
  proofOfPaymentFileSize        INT           NULL,
  proofOfPaymentUploadedBy      VARCHAR(128)  NULL,
  proofOfPaymentUploadedAt      DATETIME      NULL,
  proofOfPaymentVerifiedBy      VARCHAR(128)  NULL,
  proofOfPaymentVerifiedAt      DATETIME      NULL,

  -- Approval audit
  approvedBy                    VARCHAR(128)  NULL,
  approvedAt                    DATETIME      NULL,
  rejectedBy                    VARCHAR(128)  NULL,
  rejectedAt                    DATETIME      NULL,
  rejectionReason                TEXT          NULL,

  -- Type-specific (nullable; populated per paymentType)
  month                          ENUM('January','February','March','April','May','June',
                                       'July','August','September','October','November','December') NULL,
  perCycle                       TINYINT(1)    NULL,
  nonRefundable                  TINYINT(1)    NULL,
  description                    TEXT          NULL,

  createdAt                      DATETIME      NOT NULL,
  updatedAt                      DATETIME      NOT NULL,

  PRIMARY KEY (paymentId),
  KEY idx_payments_group_uid (groupId, uid),
  KEY idx_payments_group_year (groupId, year),
  KEY idx_payments_uid (uid),
  KEY idx_payments_approvedBy (approvedBy),
  KEY idx_payments_rejectedBy (rejectedBy),
  KEY idx_payments_proofUploadedBy (proofOfPaymentUploadedBy),
  KEY idx_payments_proofVerifiedBy (proofOfPaymentVerifiedBy),

  CONSTRAINT fk_payments_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_approvedBy FOREIGN KEY (approvedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_rejectedBy FOREIGN KEY (rejectedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_proofUploadedBy FOREIGN KEY (proofOfPaymentUploadedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_proofVerifiedBy FOREIGN KEY (proofOfPaymentVerifiedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loans (
  loanId                     VARCHAR(128)  NOT NULL,
  groupId                    VARCHAR(128)  NOT NULL,
  loanNumber                 VARCHAR(50)   NOT NULL,
  borrowerId                 VARCHAR(128)  NOT NULL,
  borrowerName               VARCHAR(255)  NOT NULL,
  borrowerEmail              VARCHAR(255)  NOT NULL,
  principalAmount            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  approvedAmount             DECIMAL(15,2) NULL,
  status                     ENUM('pending','approved','rejected','disbursed','completed','defaulted') NOT NULL DEFAULT 'pending',
  repaymentPeriod            INT           NOT NULL,
  interestRateMonth1         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  interestRateMonth2         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  interestRateMonth3         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  -- SYSTEM_MAP Unknowns #6: the loan interest formula (how totalInterest and
  -- monthlyPayment are actually derived from the rates + calculationMethod)
  -- is not documented anywhere. These columns store the result, not the formula.
  totalInterest               DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalRepayment              DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  monthlyPayment              DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  disbursedAmount             DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  disbursedAt                 DATETIME      NULL,
  disbursedBy                 VARCHAR(128)  NULL,
  disbursementMethod          ENUM('cash','bank_transfer','mobile_money') NULL,
  requestedAt                 DATETIME      NOT NULL,
  approvedBy                  VARCHAR(128)  NULL,
  approvedAt                  DATETIME      NULL,
  rejectedBy                  VARCHAR(128)  NULL,
  rejectedAt                  DATETIME      NULL,
  rejectionReason              TEXT          NULL,
  purpose                      TEXT          NOT NULL,
  collateral                   TEXT          NULL,
  guarantorName                VARCHAR(255)  NULL,
  guarantorPhone               VARCHAR(20)   NULL,
  guarantorRelationship        VARCHAR(100)  NULL,
  amountRepaid                 DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  remainingBalance             DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  penaltiesCharged             DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  createdAt                    DATETIME      NOT NULL,
  updatedAt                    DATETIME      NOT NULL,
  completedAt                  DATETIME      NULL,

  PRIMARY KEY (loanId),
  UNIQUE KEY uq_loans_loanNumber (loanNumber),
  KEY idx_loans_group_uid (groupId, borrowerId),
  KEY idx_loans_group_status (groupId, status),
  KEY idx_loans_borrowerId (borrowerId),
  KEY idx_loans_disbursedBy (disbursedBy),
  KEY idx_loans_approvedBy (approvedBy),
  KEY idx_loans_rejectedBy (rejectedBy),

  CONSTRAINT fk_loans_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loans_borrowerId FOREIGN KEY (borrowerId)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loans_disbursedBy FOREIGN KEY (disbursedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_loans_approvedBy FOREIGN KEY (approvedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_loans_rejectedBy FOREIGN KEY (rejectedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- loan_payments  (repayments made against a loan)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_payments (
  paymentId                 VARCHAR(128)  NOT NULL,
  loanId                    VARCHAR(128)  NOT NULL,
  groupId                   VARCHAR(128)  NOT NULL,
  uid                       VARCHAR(128)  NOT NULL,
  userName                  VARCHAR(255)  NOT NULL,
  amount                    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  principalPortion          DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  interestPortion           DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  penaltyPortion            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  scheduledMonth            INT           NOT NULL,
  scheduledAmount           DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status                    ENUM('pending','approved') NOT NULL DEFAULT 'pending',
  approvedBy                VARCHAR(128)  NULL,
  approvedAt                DATETIME      NULL,
  proofOfPaymentImageUrl    TEXT          NULL,
  proofOfPaymentUploadedAt  DATETIME      NULL,
  paidAt                    DATETIME      NOT NULL,
  createdAt                 DATETIME      NOT NULL,
  paymentMethod             ENUM('cash','bank_transfer','mobile_money') NULL,
  notes                     TEXT          NULL,

  PRIMARY KEY (paymentId),
  KEY idx_loan_payments_loanId (loanId),
  KEY idx_loan_payments_group_uid (groupId, uid),
  KEY idx_loan_payments_uid (uid),
  KEY idx_loan_payments_approvedBy (approvedBy),

  CONSTRAINT fk_loan_payments_loanId FOREIGN KEY (loanId)
    REFERENCES loans (loanId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loan_payments_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loan_payments_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loan_payments_approvedBy FOREIGN KEY (approvedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- loan_repayment_schedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_repayment_schedule (
  scheduleId     INT AUTO_INCREMENT,
  loanId         VARCHAR(128)  NOT NULL,
  month          INT           NOT NULL,
  dueDate        DATETIME      NOT NULL,
  principalDue   DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  interestDue    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalDue       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  amountPaid     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  balance        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status         ENUM('pending','paid','overdue') NOT NULL DEFAULT 'pending',
  paidAt         DATETIME      NULL,

  PRIMARY KEY (scheduleId),
  UNIQUE KEY uq_loan_repayment_schedule_loan_month (loanId, month),
  KEY idx_loan_repayment_schedule_loanId (loanId),

  CONSTRAINT fk_loan_repayment_schedule_loanId FOREIGN KEY (loanId)
    REFERENCES loans (loanId) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- transactions
-- UNKNOWN: this collection appears in firestore.rules but is undocumented.
-- Whether it is a generic ledger entry, a duplicate/mirror of payments, and
-- the valid values of its `type` field are all unknown (SYSTEM_MAP Unknowns #1).
-- Only the fields that can be safely inferred (identity, group/user scoping,
-- an amount, and a timestamp) are created here. Do not add business fields
-- until the real schema is confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  transactionId  VARCHAR(128)  NOT NULL,
  groupId        VARCHAR(128)  NOT NULL,
  uid            VARCHAR(128)  NULL,
  -- UNKNOWN: `type` enum values (ledger entry kind) are not documented.
  amount         DECIMAL(15,2) NULL,
  createdAt      DATETIME      NOT NULL,

  PRIMARY KEY (transactionId),
  KEY idx_transactions_groupId (groupId),
  KEY idx_transactions_uid (uid),

  CONSTRAINT fk_transactions_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_transactions_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
