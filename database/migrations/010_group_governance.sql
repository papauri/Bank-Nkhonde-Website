-- 010: Group governance documents (the written rules).
--
-- The Firebase app had a "manage rules" page where an admin writes the group's
-- rules as free text AND/OR uploads a rules PDF (the real-world example is the
-- "Money Masters Saving Rules and Regulations" document). The SQL schema had
-- NOWHERE to store either — `groups` has only name/description/status, and
-- group_rules holds the numeric money policy, not the prose.
--
-- Without these columns:
--   - manage_rules (admin) has nothing to save to,
--   - view_rules (member) has nothing to read, so members cannot see the rules
--     they are bound by.
--
-- Additive only: three nullable columns on `groups`. Nothing is dropped, no
-- existing row changes. (`groups` is a MySQL reserved word — backticked.)
--
-- NOTE: no inline COLUMN COMMENT clauses — run_migrations.php splits on ';' and
-- a semicolon inside a quoted comment truncates the statement (see 009).

ALTER TABLE `groups`
  ADD COLUMN governanceRulesText MEDIUMTEXT NULL,
  ADD COLUMN rulesDocumentUrl VARCHAR(512) NULL,
  ADD COLUMN rulesDocumentName VARCHAR(255) NULL;
