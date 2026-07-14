-- 007_password_resets.sql
-- Single-use, expiring password reset tokens.
--
-- SECURITY: only the sha256 hash of the token is ever stored, never the raw token.
-- A reset token is a bearer credential: whoever holds it can take over the account
-- without knowing the old password. If this table leaked and it held raw tokens,
-- an attacker would gain the ability to take over every account with an outstanding
-- reset. Storing the hash means a DB leak yields nothing usable — the raw token
-- exists only in the email we send and in the link the user clicks.
--
-- usedAt is the single-use latch: non-null means the token has been spent and must
-- never be honoured again. Redemption flips it under a rowCount()===1 check so a
-- concurrent double-redeem loses.

CREATE TABLE IF NOT EXISTS password_resets (
  resetId     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid         VARCHAR(128) NOT NULL,
  tokenHash   CHAR(64)     NOT NULL,  -- sha256 hex of the RAW token. The raw token is NEVER stored.
  expiresAt   DATETIME     NOT NULL,
  usedAt      DATETIME     NULL,      -- single-use: non-null means spent
  requestedIp VARCHAR(45)  NULL,      -- 45 chars covers IPv6; may be null if REMOTE_ADDR is absent
  createdAt   DATETIME     NOT NULL,
  PRIMARY KEY (resetId),
  UNIQUE KEY uq_password_resets_tokenHash (tokenHash),
  KEY idx_password_resets_uid (uid),
  CONSTRAINT fk_password_resets_uid FOREIGN KEY (uid) REFERENCES users (uid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
