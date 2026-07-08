-- Tabella reclami cliente (Complaints) nel DB CRM.
-- pms_customer_id = riferimento logico ad Anagra.CodCli. stato: 'aperto' | 'risolto'.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_complaints')
CREATE TABLE customer_complaints (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,
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
