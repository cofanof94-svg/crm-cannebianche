-- ============================================================================
-- CRM Direct Holiday — Ambito delle preferenze (personale vs nucleo).
-- Una preferenza 'nucleo' è condivisa (visibile) su tutti i membri del nucleo;
-- una 'personale' resta solo sul singolo. Default 'nucleo' (la maggior parte
-- delle preferenze è di nucleo). Le intolleranze restano sempre personali.
-- Idempotente. DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('customer_preferences') AND name = 'ambito')
ALTER TABLE customer_preferences ADD ambito NVARCHAR(20) NOT NULL CONSTRAINT DF_pref_ambito DEFAULT 'nucleo';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_pref_ambito')
ALTER TABLE customer_preferences ADD CONSTRAINT CK_pref_ambito CHECK (ambito IN (N'personale', N'nucleo'));
GO
