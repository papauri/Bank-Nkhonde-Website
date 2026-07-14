-- 005: Fixed daily penalties.
--
-- THE RULE (from the product owner, cycle 8):
--   A late payer is charged a FIXED MWK AMOUNT PER DAY, starting after the grace
--   period expires, accruing every day until the debt is cleared.
--   It is NOT a percentage of arrears, and it is NOT a one-off fee.
--
-- What the code actually did before this: `group_table.js:153` charged
--   penalty = arrears * (rate / 100)
-- once, the instant the due date passed, ignoring the grace period entirely —
-- while the overdue notification told members they were accruing "X% per day".
-- The code, the schema and the member-facing copy all disagreed. This migration
-- makes the schema able to express the rule the owner actually wants.
--
-- Why new columns instead of reusing loanPenaltyRate:
--   loanPenaltyRate is DECIMAL(5,2) — max 999.99. That is fine for a percentage
--   but CANNOT HOLD a fixed daily amount of 1,000 MWK or more; the insert would
--   be rejected or truncated. A money column must be DECIMAL(15,2) like every
--   other monetary value in this schema.
--
-- The old percentage columns are KEPT, not dropped: loanPenaltyType /
-- contributionPenaltyType select which mechanism a group uses, so a group can
-- still run percentage penalties if it wants to.

-- Fixed daily penalty amounts (used when the matching *PenaltyType = 'fixed') --
ALTER TABLE group_rules
  ADD COLUMN loanPenaltyDailyAmount DECIMAL(15,2) NULL
    COMMENT 'Fixed MWK charged per day past grace, while a loan balance is outstanding. Used when loanPenaltyType = fixed.'
    AFTER loanPenaltyRate,
  ADD COLUMN contributionPenaltyDailyAmount DECIMAL(15,2) NULL
    COMMENT 'Fixed MWK charged per day past grace, while a contribution is in arrears. Used when contributionPenaltyType = fixed.'
    AFTER contributionPenaltyDailyRate;

-- contributionPenaltyType could only ever be 'percentage'. The owner wants fixed
-- daily amounts, so the enum must be able to say so.
ALTER TABLE group_rules
  MODIFY COLUMN contributionPenaltyType ENUM('percentage','fixed')
  NOT NULL DEFAULT 'percentage';

-- Penalty ledger ------------------------------------------------------------
-- Penalties ACCRUE DAILY and are therefore recomputed on read from the overdue
-- item's due date — there is no cron, and a stored running total would be stale
-- the next morning. This table records only penalties that have been SETTLED
-- (waived or paid), i.e. facts that stop accruing and must not be recomputed.
--
-- A waiver is a real financial decision (an admin forgiving a member's debt), so
-- it is recorded with who did it and why — never silently zeroed.
CREATE TABLE IF NOT EXISTS penalty_settlements (
  settlementId    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  groupId         VARCHAR(128)  NOT NULL,
  uid             VARCHAR(128)  NOT NULL,

  -- Exactly one of these is set: the penalty is against a loan or a payment.
  loanId          VARCHAR(128)  NULL,
  paymentId       VARCHAR(128)  NULL,

  accruedFrom     DATETIME      NOT NULL COMMENT 'First chargeable day (dueDate + grace).',
  accruedTo       DATETIME      NOT NULL COMMENT 'Day the accrual was stopped.',
  daysCharged     INT UNSIGNED  NOT NULL,
  dailyAmount     DECIMAL(15,2) NOT NULL,
  amountAccrued   DECIMAL(15,2) NOT NULL COMMENT 'daysCharged * dailyAmount.',
  amountPaid      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  amountWaived    DECIMAL(15,2) NOT NULL DEFAULT 0.00,

  status          ENUM('paid','waived','partial') NOT NULL,
  waivedReason    TEXT          NULL,
  settledBy       VARCHAR(128)  NOT NULL,
  settledAt       DATETIME      NOT NULL,
  createdAt       DATETIME      NOT NULL,

  PRIMARY KEY (settlementId),
  KEY idx_penalty_settlements_group_uid (groupId, uid),
  KEY idx_penalty_settlements_loanId (loanId),
  KEY idx_penalty_settlements_paymentId (paymentId),
  CONSTRAINT fk_penalty_settlements_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_penalty_settlements_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_penalty_settlements_loanId FOREIGN KEY (loanId)
    REFERENCES loans (loanId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_penalty_settlements_paymentId FOREIGN KEY (paymentId)
    REFERENCES payments (paymentId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_penalty_settlements_settledBy FOREIGN KEY (settledBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
