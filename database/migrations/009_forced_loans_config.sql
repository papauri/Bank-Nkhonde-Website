-- 009: Optional, configurable forced (compulsory) loans.
--
-- THE RULE (from Money Masters Saving Rules and Regulations, implemented as a
-- per-group toggle):
--   At cycle end, if money remains after voluntary loans, the group may push
--   COMPULSORY loans onto members who have borrowed less, so everyone borrows
--   ~equally and pays ~equal interest (interest is refunded per-member at
--   share-out — see cycle_compute_payout() in api/handlers/cycle.php).
--
--   The admin reviews a TENTATIVE list (cycle.forced.preview) and then
--   originates loans manually via the existing loans.force endpoint. This
--   migration adds only the CONFIGURATION for that preview; it writes no
--   loans and changes no other behaviour.
--
-- Default is OFF: turning this on changes which members are pushed to
-- borrow, so no existing group may be affected without an admin explicitly
-- opting in — same posture as shareOutPenalties (006).
--
-- TWO target methods:
--   fixed_amount            -- target = group_rules.loanRulesMinCycleLoanAmount
--                               (the column already exists; reused as-is, no
--                               new column for this method).
--   percentage_of_highest   -- target = the highest single active member's
--                               cycle borrowing * forcedLoansPercentageOfHighest / 100.
--
-- forcedLoansPercentageOfHighest is NULL when the fixed method is in use.

-- NOTE: no inline COLUMN COMMENT clauses — this project's migration runner
-- (run_migrations.php) splits on ';' and cannot handle a semicolon inside a
-- quoted string, so a COMMENT containing one truncates the statement. The
-- header above is the documentation instead.

ALTER TABLE group_rules
  ADD COLUMN forcedLoansEnabled TINYINT(1) NOT NULL DEFAULT 0
    AFTER loanRulesMinCycleLoanAmount,
  ADD COLUMN forcedLoansMethod ENUM('fixed_amount','percentage_of_highest') NOT NULL DEFAULT 'fixed_amount'
    AFTER forcedLoansEnabled,
  ADD COLUMN forcedLoansPercentageOfHighest DECIMAL(5,2) NULL
    AFTER forcedLoansMethod;
