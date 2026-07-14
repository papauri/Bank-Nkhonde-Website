-- 006: Optional penalty share-out.
--
-- THE RULE (from the product owner, cycle 9):
--   A group may OPTIONALLY share out its penalty income at cycle end, on top of
--   the interest refund.
--
-- HOW PENALTIES ARE SHARED — and why it is not a refund:
--   Interest is REFUNDED to the member who paid it (fair, because forced loans
--   equalise how much everyone borrows). Penalties are NOT refunded that way.
--   Refunding a fine to the person fined would make the fine meaningless — being
--   late would cost nothing.
--
--   Instead the penalty pot is SPLIT EQUALLY across all active members. The late
--   payer really loses the money; the group collectively gains it; the offender
--   gets back only their 1/N share like everyone else.
--
--   payout(member) = interestPaid(member)                      -- always
--                  + (penaltyPool / activeMemberCount)         -- only when the toggle is on
--
--   Any indivisible remainder (a pot of 1000 across 3 members) goes to the
--   earliest-joined members, one minor unit each, so the payouts still sum to the
--   pot EXACTLY. The reconciliation invariant in cycle.php is absolute.
--
-- Default is OFF: turning this on changes what every member is paid, so no
-- existing group's share-out may change without an admin explicitly opting in.

ALTER TABLE group_rules
  ADD COLUMN shareOutPenalties TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'When 1, the cycle penalty pot is split EQUALLY across active members and added to each payout. Penalties are never refunded to the member who paid them — that would nullify the penalty.'
    AFTER contributionPenaltyGracePeriodDays;

-- Snapshot the penalty side of the share-out onto the payout record, so a
-- settled payout can always be re-explained to a member: "this is your interest
-- refund, this is your share of the group's penalty income."
ALTER TABLE cycle_payouts
  ADD COLUMN groupPenaltyPool DECIMAL(15,2) NOT NULL DEFAULT 0.00
    COMMENT 'Total penalties paid by all members during the cycle.'
    AFTER groupInterestPool,
  ADD COLUMN penaltyShare DECIMAL(15,2) NOT NULL DEFAULT 0.00
    COMMENT 'This member''s equal share of groupPenaltyPool. Zero when shareOutPenalties = 0.'
    AFTER groupPenaltyPool,
  ADD COLUMN interestRefund DECIMAL(15,2) NOT NULL DEFAULT 0.00
    COMMENT 'The interest this member personally paid and is refunded. payoutAmount = interestRefund + penaltyShare.'
    AFTER penaltyShare;
