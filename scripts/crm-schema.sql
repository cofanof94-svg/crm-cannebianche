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

-- Qui c'era customer_notes, il "diario" interno previsto dalle prime specifiche
-- di Fase 2. Non è mai stata usata da nessuna riga di src/ o web/: le sue
-- funzioni sono finite nelle preferenze, nella nota personale e nei reclami.
-- Eliminata il 13/08/2026 (scripts/crm-drop-note.sql), che contiene anche le
-- due righe che c'erano dentro. Non ricrearla qui: uno schema che descrive una
-- tabella che nessuno usa fa perdere tempo a chi lo legge.

-- Reclami cliente (Complaints). stato: 'aperto' | 'risolto'.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_complaints')
CREATE TABLE customer_complaints (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,   -- riferimento logico ad Anagra.CodCli
  autore_user_id  INT           NOT NULL,
  testo           NVARCHAR(MAX) NOT NULL,
  stato           NVARCHAR(20)  NOT NULL DEFAULT 'aperto',
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  resolved_at     DATETIME2     NULL,
  CONSTRAINT FK_complaints_user FOREIGN KEY (autore_user_id) REFERENCES users(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_complaints_customer')
CREATE INDEX IX_complaints_customer ON customer_complaints(pms_customer_id);
GO
