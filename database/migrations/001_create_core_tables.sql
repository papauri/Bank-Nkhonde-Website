-- 001_create_core_tables.sql
-- Bank Nkhonde: core identity + group organisation tables.
-- Firebase -> MySQL migration, cycle 4 (scaffold-first, not yet executed).
-- InnoDB / utf8mb4 / utf8mb4_unicode_ci throughout. All money columns DECIMAL(15,2).

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- users  (global profile; uid is the Firebase Auth UID, kept as local PK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  uid               VARCHAR(128)  NOT NULL,
  email             VARCHAR(255)  NOT NULL,
  fullName          VARCHAR(255)  NOT NULL,
  phone             VARCHAR(20)   NULL,
  whatsappNumber    VARCHAR(20)   NULL,
  profileImageUrl   TEXT          NULL,
  dateOfBirth       DATETIME      NULL,
  address           TEXT          NULL,
  nationality       VARCHAR(100)  NULL,
  occupation        VARCHAR(255)  NULL,
  emailVerified     TINYINT(1)    NOT NULL DEFAULT 0,
  -- Firebase Auth held credentials; MySQL has nothing. NULL = not yet
  -- migrated / must reset password. See SYSTEM_MAP Unknowns #12.
  passwordHash      VARCHAR(255)  NULL,
  createdAt         DATETIME      NOT NULL,
  updatedAt         DATETIME      NOT NULL,
  PRIMARY KEY (uid),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `groups` (
  groupId       VARCHAR(128)  NOT NULL,
  groupName     VARCHAR(255)  NOT NULL,
  description   TEXT          NULL,
  status        ENUM('active','inactive','completed') NOT NULL DEFAULT 'active',
  createdBy     VARCHAR(128)  NOT NULL,
  createdAt     DATETIME      NOT NULL,
  updatedAt     DATETIME      NOT NULL,
  PRIMARY KEY (groupId),
  KEY idx_groups_createdBy (createdBy),
  CONSTRAINT fk_groups_createdBy FOREIGN KEY (createdBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- group_rules  (one row per group)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_rules (
  groupRuleId                             INT UNSIGNED AUTO_INCREMENT,
  groupId                                 VARCHAR(128)  NOT NULL,

  -- Seed money
  seedMoneyAmount                         DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  seedMoneyDueDate                        DATETIME      NULL,
  seedMoneyRequired                       TINYINT(1)    NOT NULL DEFAULT 1,
  seedMoneyAllowPartialPayment            TINYINT(1)    NOT NULL DEFAULT 0,
  seedMoneyMaxPaymentMonths               INT           NULL,
  seedMoneyMustBeFullyPaid                TINYINT(1)    NOT NULL DEFAULT 0,

  -- Monthly contribution
  monthlyContributionAmount               DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  monthlyContributionRequired             TINYINT(1)    NOT NULL DEFAULT 1,
  monthlyContributionDayOfMonth           INT           NULL,
  monthlyContributionAllowPartialPayment  TINYINT(1)    NOT NULL DEFAULT 0,

  -- Service fee
  serviceFeeAmount                        DECIMAL(15,2) NULL,
  serviceFeeRequired                      TINYINT(1)    NOT NULL DEFAULT 0,
  serviceFeeDueDate                       DATETIME      NULL,
  serviceFeePerCycle                      TINYINT(1)    NULL,
  serviceFeeNonRefundable                 TINYINT(1)    NULL,
  serviceFeeDescription                   TEXT          NULL,

  -- Loan interest
  loanInterestRateMonth1                  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  loanInterestRateMonth2                  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  loanInterestRateMonth3                  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  loanInterestCalculationMethod           ENUM('reduced_balance','flat_rate') NOT NULL DEFAULT 'reduced_balance',
  loanInterestMaxRepaymentMonths          INT           NOT NULL DEFAULT 3,

  -- Penalties
  loanPenaltyRate                         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  loanPenaltyType                         ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage',
  loanPenaltyGracePeriodDays              INT           NOT NULL DEFAULT 0,
  contributionPenaltyDailyRate            DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  contributionPenaltyMonthlyRate          DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  contributionPenaltyType                 ENUM('percentage') NOT NULL DEFAULT 'percentage',
  contributionPenaltyGracePeriodDays      INT           NOT NULL DEFAULT 0,

  -- Cycle
  cycleDurationStartDate                  DATETIME      NOT NULL,
  cycleDurationEndDate                    DATETIME      NULL,
  cycleDurationMonths                     INT           NOT NULL DEFAULT 12,
  cycleDurationAutoRenew                  TINYINT(1)    NOT NULL DEFAULT 0,

  -- Loan limits
  loanRulesMaxLoanAmount                  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  loanRulesMinCycleLoanAmount             DECIMAL(15,2) NULL,
  loanRulesMaxActiveLoansByMember         INT           NOT NULL DEFAULT 1,
  loanRulesRequireCollateral              TINYINT(1)    NOT NULL DEFAULT 0,
  loanRulesMinRepaymentMonths             INT           NOT NULL DEFAULT 1,
  loanRulesMaxRepaymentMonths             INT           NOT NULL DEFAULT 3,

  PRIMARY KEY (groupRuleId),
  UNIQUE KEY uq_group_rules_groupId (groupId),
  CONSTRAINT fk_group_rules_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- group_admins  (normalised from groups.admins[])
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_admins (
  groupAdminId  INT AUTO_INCREMENT,
  groupId       VARCHAR(128)  NOT NULL,
  uid           VARCHAR(128)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  name          VARCHAR(255)  NOT NULL,
  role          ENUM('admin','senior_admin') NOT NULL,
  addedAt       DATETIME      NOT NULL,
  PRIMARY KEY (groupAdminId),
  UNIQUE KEY uq_group_admins_group_uid (groupId, uid),
  KEY idx_group_admins_uid (uid),
  CONSTRAINT fk_group_admins_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_group_admins_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- group_statistics  (derived cache; recompute from source tables, one per group)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_statistics (
  groupStatisticId  INT AUTO_INCREMENT,
  groupId           VARCHAR(128)  NOT NULL,
  totalMembers      INT           NOT NULL DEFAULT 0,
  activeLoans       INT           NOT NULL DEFAULT 0,
  totalCollected    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalDisbursed    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  lastUpdated       DATETIME      NOT NULL,
  PRIMARY KEY (groupStatisticId),
  UNIQUE KEY uq_group_statistics_groupId (groupId),
  CONSTRAINT fk_group_statistics_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- members  (composite PK groupId+uid; userId column dropped — duplicate of uid)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  groupId                       VARCHAR(128)  NOT NULL,
  uid                           VARCHAR(128)  NOT NULL,
  fullName                      VARCHAR(255)  NOT NULL,
  email                         VARCHAR(255)  NOT NULL,
  phone                         VARCHAR(20)   NULL,
  whatsappNumber                VARCHAR(20)   NULL,
  profileImageUrl               TEXT          NULL,
  role                          ENUM('member','admin','senior_admin') NOT NULL DEFAULT 'member',
  status                        ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  joinedAt                      DATETIME      NOT NULL,
  invitedBy                     VARCHAR(128)  NULL,
  seedMoneyPaid                 TINYINT(1)    NOT NULL DEFAULT 0,
  monthlyContributionsCurrent   TINYINT(1)    NOT NULL DEFAULT 0,
  eligibleForLoan                TINYINT(1)    NOT NULL DEFAULT 0,
  createdAt                     DATETIME      NOT NULL,
  updatedAt                     DATETIME      NOT NULL,
  PRIMARY KEY (groupId, uid),
  KEY idx_members_uid (uid),
  KEY idx_members_invitedBy (invitedBy),
  CONSTRAINT fk_members_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_members_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_members_invitedBy FOREIGN KEY (invitedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- member_financial_summary  (derived cache from members.financialSummary)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_financial_summary (
  memberFinancialSummaryId  INT AUTO_INCREMENT,
  groupId                   VARCHAR(128)  NOT NULL,
  uid                       VARCHAR(128)  NOT NULL,
  totalPaid                 DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalArrears              DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalPending               DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalLoans                DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalLoansPaid            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalPenalties            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  lastPaymentDate           DATETIME      NULL,
  lastUpdated               DATETIME      NOT NULL,
  PRIMARY KEY (memberFinancialSummaryId),
  UNIQUE KEY uq_member_financial_summary_group_uid (groupId, uid),
  CONSTRAINT fk_mfs_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mfs_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
