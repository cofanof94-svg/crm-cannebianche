-- ============================================================================
-- CRM Direct Holiday — Fusione anagrafiche duplicate (virtual merge, lato CRM).
-- Il PMS è in sola lettura: qui NON si fondono i record fisici. Questa tabella
-- mappa un codice DUPLICATO al codice PRINCIPALE; a runtime la scheda aggrega
-- soggiorni/gusti/SPA/dati CRM su tutti i codici del gruppo. Reversibile.
-- Idempotente. DB: HolidayCanneBianche_CRM. pms_customer_id = Anagra.CodCli.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_merge')
CREATE TABLE customer_merge (
  pms_customer_id INT           NOT NULL PRIMARY KEY,  -- il DUPLICATO (membro)
  canonical_id    INT           NOT NULL,              -- il PRINCIPALE del gruppo
  autore_user_id  INT           NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_merge_user FOREIGN KEY (autore_user_id) REFERENCES users(id),
  CONSTRAINT CK_merge_noself CHECK (pms_customer_id <> canonical_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_merge_canonical')
CREATE INDEX IX_merge_canonical ON customer_merge(canonical_id);
GO
