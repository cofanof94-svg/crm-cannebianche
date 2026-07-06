IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
CREATE TABLE users (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  username      NVARCHAR(50)  NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL,
  role          NVARCHAR(20)  NOT NULL,
  attivo        BIT           NOT NULL DEFAULT 1,
  created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_notes')
CREATE TABLE customer_notes (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,   -- riferimento logico ad Anagra.CodCli
  autore_user_id  INT           NOT NULL,
  testo           NVARCHAR(MAX) NOT NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_notes_user FOREIGN KEY (autore_user_id) REFERENCES users(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notes_customer')
CREATE INDEX IX_notes_customer ON customer_notes(pms_customer_id);
GO
