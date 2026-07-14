-- 003_create_communications_and_audit.sql
-- Bank Nkhonde: notifications, messaging, invitations, misc, and the audit
-- log. Requires 001 (users, groups) and 002 (payments, loans) to have run.
--
-- DESIGN DECISION: `notifications` and `group_notifications` are merged into
-- one `notifications` table (they were identical except group_notifications
-- had a non-null groupId). The duplicate `recipientId` column is dropped —
-- it duplicated `userId`.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- notifications  (merged notifications + group_notifications)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  notificationId  VARCHAR(128)  NOT NULL,
  userId          VARCHAR(128)  NOT NULL,
  type            VARCHAR(100)  NOT NULL,
  title           VARCHAR(255)  NOT NULL,
  message         TEXT          NOT NULL,
  groupId         VARCHAR(128)  NULL,
  groupName       VARCHAR(255)  NULL,
  senderId        VARCHAR(128)  NULL,
  paymentType     VARCHAR(50)   NULL,
  paymentId       VARCHAR(128)  NULL,
  loanId          VARCHAR(128)  NULL,
  amount          DECIMAL(15,2) NULL,
  `read`          TINYINT(1)    NOT NULL DEFAULT 0,
  readAt          DATETIME      NULL,
  dismissed       TINYINT(1)    NOT NULL DEFAULT 0,
  dismissedAt     DATETIME      NULL,
  createdAt       DATETIME      NOT NULL,
  -- UNKNOWN: TTL / expiry enforcement mechanism for expiresAt is not
  -- documented (SYSTEM_MAP Unknowns #9). Column is stored, not enforced here.
  expiresAt       DATETIME      NULL,

  PRIMARY KEY (notificationId),
  KEY idx_notifications_userId_read (userId, `read`),
  KEY idx_notifications_groupId (groupId),
  KEY idx_notifications_senderId (senderId),
  KEY idx_notifications_paymentId (paymentId),
  KEY idx_notifications_loanId (loanId),

  CONSTRAINT fk_notifications_userId FOREIGN KEY (userId)
    REFERENCES users (uid) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_senderId FOREIGN KEY (senderId)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_paymentId FOREIGN KEY (paymentId)
    REFERENCES payments (paymentId) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_loanId FOREIGN KEY (loanId)
    REFERENCES loans (loanId) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  messageId      VARCHAR(128)  NOT NULL,
  groupId        VARCHAR(128)  NOT NULL,
  subject        VARCHAR(255)  NOT NULL,
  body           TEXT          NOT NULL,
  createdBy      VARCHAR(128)  NOT NULL,
  createdByName  VARCHAR(255)  NOT NULL,
  assignedTo     VARCHAR(128)  NULL,
  status         ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  priority       ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  createdAt      DATETIME      NOT NULL,
  updatedAt      DATETIME      NOT NULL,
  resolvedAt     DATETIME      NULL,

  PRIMARY KEY (messageId),
  KEY idx_messages_groupId (groupId),
  KEY idx_messages_createdBy (createdBy),
  KEY idx_messages_assignedTo (assignedTo),

  CONSTRAINT fk_messages_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_messages_createdBy FOREIGN KEY (createdBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_messages_assignedTo FOREIGN KEY (assignedTo)
    REFERENCES users (uid) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- message_replies  (normalised from messages.replies[])
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_replies (
  replyId          INT AUTO_INCREMENT,
  messageId        VARCHAR(128)  NOT NULL,
  groupId          VARCHAR(128)  NOT NULL,
  uid              VARCHAR(128)  NOT NULL,
  userName         VARCHAR(255)  NOT NULL,
  message          TEXT          NOT NULL,
  createdAt        DATETIME      NOT NULL,
  attachmentsJson  JSON          NULL,

  PRIMARY KEY (replyId),
  KEY idx_message_replies_messageId (messageId),
  KEY idx_message_replies_groupId (groupId),
  KEY idx_message_replies_uid (uid),

  CONSTRAINT fk_message_replies_messageId FOREIGN KEY (messageId)
    REFERENCES messages (messageId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_replies_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_replies_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- broadcasts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcasts (
  broadcastId  VARCHAR(128)  NOT NULL,
  groupId      VARCHAR(128)  NOT NULL,
  title        VARCHAR(255)  NOT NULL,
  message      TEXT          NOT NULL,
  createdBy    VARCHAR(128)  NOT NULL,
  createdAt    DATETIME      NOT NULL,
  updatedAt    DATETIME      NOT NULL,

  PRIMARY KEY (broadcastId),
  KEY idx_broadcasts_groupId (groupId),
  KEY idx_broadcasts_createdBy (createdBy),

  CONSTRAINT fk_broadcasts_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_broadcasts_createdBy FOREIGN KEY (createdBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invitations
-- Fields partly inferred — not in DATABASE_DOCUMENTATION.md, only in rules
-- and a Cloud Function trigger (SYSTEM_MAP Unknowns #4: expiry/resend
-- semantics unknown, not modelled here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  invitationId  VARCHAR(128)  NOT NULL,
  invitedEmail  VARCHAR(255)  NOT NULL,
  invitedBy     VARCHAR(128)  NOT NULL,
  groupId       VARCHAR(128)  NOT NULL,
  status        ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  createdAt     DATETIME      NOT NULL,
  respondedAt   DATETIME      NULL,

  PRIMARY KEY (invitationId),
  KEY idx_invitations_groupId (groupId),
  KEY idx_invitations_invitedBy (invitedBy),
  KEY idx_invitations_invitedEmail (invitedEmail),

  CONSTRAINT fk_invitations_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_invitations_invitedBy FOREIGN KEY (invitedBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invitation_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitation_codes (
  codeId      VARCHAR(128)  NOT NULL,
  code        VARCHAR(100)  NOT NULL,
  groupId     VARCHAR(128)  NOT NULL,
  groupName   VARCHAR(255)  NOT NULL,
  createdBy   VARCHAR(128)  NOT NULL,
  createdAt   DATETIME      NOT NULL,
  expiresAt   DATETIME      NULL,
  maxUses     INT           NULL,
  usedCount   INT           NOT NULL DEFAULT 0,
  status      ENUM('active','expired','revoked') NOT NULL DEFAULT 'active',

  PRIMARY KEY (codeId),
  UNIQUE KEY uq_invitation_codes_code (code),
  KEY idx_invitation_codes_groupId (groupId),
  KEY idx_invitation_codes_createdBy (createdBy),

  CONSTRAINT fk_invitation_codes_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_codes_createdBy FOREIGN KEY (createdBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invitation_code_uses  (normalised from invitation_codes.usedBy[])
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitation_code_uses (
  codeUseId  INT AUTO_INCREMENT,
  codeId     VARCHAR(128)  NOT NULL,
  uid        VARCHAR(128)  NOT NULL,
  usedAt     DATETIME      NOT NULL,

  PRIMARY KEY (codeUseId),
  UNIQUE KEY uq_invitation_code_uses_code_uid (codeId, uid),
  KEY idx_invitation_code_uses_uid (uid),

  CONSTRAINT fk_invitation_code_uses_codeId FOREIGN KEY (codeId)
    REFERENCES invitation_codes (codeId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_code_uses_uid FOREIGN KEY (uid)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- meetings
-- UNKNOWN: referenced in firestore.rules but entirely undocumented
-- (SYSTEM_MAP Unknowns #3). Location, attendees, agenda, date/time field
-- names, and status values are all unknown. Only identity + group scoping +
-- a timestamp are created here; do not add business fields until confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  meetingId  VARCHAR(128)  NOT NULL,
  groupId    VARCHAR(128)  NOT NULL,
  createdAt  DATETIME      NOT NULL,

  PRIMARY KEY (meetingId),
  KEY idx_meetings_groupId (groupId),

  CONSTRAINT fk_meetings_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- badges
-- UNKNOWN: referenced in firestore.rules but entirely undocumented
-- (SYSTEM_MAP Unknowns #2). Status values, award mechanism, and
-- `targetAudience` values are all unknown. groupId is nullable because it is
-- unknown whether badges are per-group or global.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
  badgeId    VARCHAR(128)  NOT NULL,
  groupId    VARCHAR(128)  NULL,
  createdAt  DATETIME      NOT NULL,

  PRIMARY KEY (badgeId),
  KEY idx_badges_groupId (groupId),

  CONSTRAINT fk_badges_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- system_settings
-- UNKNOWN: referenced in firestore.rules but entirely undocumented
-- (SYSTEM_MAP Unknowns #5). Key names and value types are unknown; groupId
-- is nullable because it is unknown whether settings are per-group or global.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  settingId  VARCHAR(128)  NOT NULL,
  groupId    VARCHAR(128)  NULL,
  createdAt  DATETIME      NOT NULL,
  updatedAt  DATETIME      NOT NULL,

  PRIMARY KEY (settingId),
  KEY idx_system_settings_groupId (groupId),

  CONSTRAINT fk_system_settings_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- monthly_reports
-- UNKNOWN: mentioned alongside transactions/badges/meetings/system_settings
-- as "defined in firestore.rules but NOT documented" (SYSTEM_MAP line 149).
-- No unknown-number was assigned to it in SYSTEM_MAP, but no field list
-- exists either — treated the same as the other unknown tables: identity +
-- group scoping + a timestamp only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_reports (
  reportId   VARCHAR(128)  NOT NULL,
  groupId    VARCHAR(128)  NOT NULL,
  createdAt  DATETIME      NOT NULL,

  PRIMARY KEY (reportId),
  KEY idx_monthly_reports_groupId (groupId),

  CONSTRAINT fk_monthly_reports_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- audit_logs  (immutable — insert only, never updated or deleted by the app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  logId             VARCHAR(128)  NOT NULL,
  action            VARCHAR(100)  NOT NULL,
  entityType        VARCHAR(100)  NOT NULL,
  entityId          VARCHAR(128)  NOT NULL,
  performedBy       VARCHAR(128)  NOT NULL,
  performedByName   VARCHAR(255)  NOT NULL,
  performedByRole   VARCHAR(50)   NOT NULL,
  groupId           VARCHAR(128)  NOT NULL,
  groupName         VARCHAR(255)  NOT NULL,
  changesBeforeJson JSON          NULL,
  changesAfterJson  JSON          NULL,
  ipAddress         VARCHAR(45)   NULL,
  userAgent         TEXT          NULL,
  `timestamp`       DATETIME      NOT NULL,

  PRIMARY KEY (logId),
  KEY idx_audit_logs_groupId (groupId),
  KEY idx_audit_logs_performedBy (performedBy),
  KEY idx_audit_logs_entity (entityType, entityId),

  CONSTRAINT fk_audit_logs_performedBy FOREIGN KEY (performedBy)
    REFERENCES users (uid) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_audit_logs_groupId FOREIGN KEY (groupId)
    REFERENCES `groups` (groupId) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
