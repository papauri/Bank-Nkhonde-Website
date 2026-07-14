-- 011: Optional KYC profile fields (guarantor, collateral, ID, next-of-kin).
--
-- These are per-PERSON attributes (not per-group-membership), so they live on
-- `users`, the same table as fullName/phone/occupation/etc.
--
-- Every field is OPTIONAL and NON-MANDATORY by explicit product decision: an
-- admin may skip or override any subset of these per member, and nothing may
-- require them before registration, member creation, or a loan can proceed.
-- All ten columns are therefore NULLable with no default requirement.
--
-- NOTE: no inline COLUMN COMMENT clauses — run_migrations.php splits on ';'
-- and a semicolon inside a quoted comment truncates the statement (see 009).

ALTER TABLE users
  ADD COLUMN guarantorName VARCHAR(255) NULL,
  ADD COLUMN guarantorPhone VARCHAR(20) NULL,
  ADD COLUMN guarantorRelationship VARCHAR(100) NULL,
  ADD COLUMN guarantorAddress TEXT NULL,
  ADD COLUMN collateralDescription TEXT NULL,
  ADD COLUMN idType VARCHAR(50) NULL,
  ADD COLUMN idNumber VARCHAR(100) NULL,
  ADD COLUMN nextOfKinName VARCHAR(255) NULL,
  ADD COLUMN nextOfKinPhone VARCHAR(20) NULL,
  ADD COLUMN nextOfKinRelationship VARCHAR(100) NULL;
