-- ---------------------------------------------------------------------------
-- 008_loan_payments_rejection.sql
--
-- Adds a rejection path to loan_payments so an admin can REJECT a pending loan
-- repayment (the repayments.reject endpoint). The payments and loans tables
-- already carry this exact audit trio; loan_payments was the only ledger table
-- missing it. Additive only: one new ENUM value + three nullable columns + an
-- index + an FK. Nothing is dropped, no existing row changes.
-- ---------------------------------------------------------------------------

ALTER TABLE loan_payments
  MODIFY status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE loan_payments
  ADD COLUMN rejectedBy VARCHAR(128) NULL AFTER approvedAt,
  ADD COLUMN rejectedAt DATETIME NULL AFTER rejectedBy,
  ADD COLUMN rejectionReason TEXT NULL AFTER rejectedAt;

ALTER TABLE loan_payments
  ADD KEY idx_loan_payments_rejectedBy (rejectedBy);

ALTER TABLE loan_payments
  ADD CONSTRAINT fk_loan_payments_rejectedBy FOREIGN KEY (rejectedBy)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE;
