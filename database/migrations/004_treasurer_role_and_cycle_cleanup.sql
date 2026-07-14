-- 004: Treasurer role, forced-loan support, and dead-table cleanup.
--
-- Context (decided with the product owner, cycle 7):
--   * A `treasurer` physically holds the group's cash. There is no bank
--     integration — payments are recorded, not processed. The treasurer has
--     admin-equivalent permissions PLUS cash duties.
--     NOTE: this deliberately does NOT separate duties — a treasurer can both
--     approve a payment and manage members. Accepted trade-off for small groups.
--   * FORCED LOANS: at cycle end each member is refunded the interest THEY paid.
--     So a member who borrows little would be refunded little. To keep the
--     share-out fair, admins force loans onto members who are behind, until
--     everyone has borrowed ~equally and paid ~equal interest.
--     `group_rules.loanRulesMinCycleLoanAmount` is the per-cycle borrowing target.
--   * `badges` and `meetings` were in firestore.rules but had no code, no docs
--     and no UI, and were empty. Dropped with the owner's sign-off.
--     `transactions` is KEPT — it becomes the treasurer's cash ledger.

-- 1. Treasurer role -----------------------------------------------------------
ALTER TABLE members
  MODIFY COLUMN role ENUM('member','admin','senior_admin','treasurer')
  NOT NULL DEFAULT 'member';

ALTER TABLE group_admins
  MODIFY COLUMN role ENUM('admin','senior_admin','treasurer')
  NOT NULL;

-- 2. Forced-loan provenance ---------------------------------------------------
-- A forced loan is originated BY AN ADMIN, not requested by the borrower. It is
-- otherwise an ordinary loan: same interest engine, same repayment schedule.
-- Recording this matters — "the group made me take this" is a materially
-- different fact from "I asked for this", and a member may dispute it later.
ALTER TABLE loans
  ADD COLUMN isForced TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN forcedBy VARCHAR(128) NULL AFTER isForced,
  ADD COLUMN forcedReason TEXT NULL AFTER forcedBy,
  ADD CONSTRAINT fk_loans_forcedBy FOREIGN KEY (forcedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Cycle share-out ----------------------------------------------------------
-- One row per member per cycle, written when a cycle is closed out. Immutable
-- once settled: this is the record of what each member was actually paid.
CREATE TABLE IF NOT EXISTS cycle_payouts (
  payoutId          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  groupId           VARCHAR(128)  NOT NULL,
  uid               VARCHAR(128)  NOT NULL,
  cycleStartDate    DATETIME      NOT NULL,
  cycleEndDate      DATETIME      NOT NULL,

  -- The inputs, snapshotted so a payout can always be re-explained to a member
  -- even after later activity changes the underlying totals.
  totalContributed  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalBorrowed     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalInterestPaid DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  totalPenaltiesPaid DECIMAL(15,2) NOT NULL DEFAULT 0.00,

  -- The share-out itself. payoutAmount is what the member receives.
  groupInterestPool DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  payoutAmount      DECIMAL(15,2) NOT NULL DEFAULT 0.00,

  status            ENUM('draft','settled') NOT NULL DEFAULT 'draft',
  settledBy         VARCHAR(128)  NULL,
  settledAt         DATETIME      NULL,
  createdAt         DATETIME      NOT NULL,
  updatedAt         DATETIME      NOT NULL,

  PRIMARY KEY (payoutId),
  UNIQUE KEY uq_cycle_payout (groupId, uid, cycleStartDate),
  KEY idx_cycle_payouts_groupId (groupId),
  KEY idx_cycle_payouts_uid (uid),
  CONSTRAINT fk_cycle_payouts_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cycle_payouts_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cycle_payouts_settledBy FOREIGN KEY (settledBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Drop dead tables ---------------------------------------------------------
-- Verified empty (0 rows) before dropping. Signed off by the product owner.
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS meetings;
