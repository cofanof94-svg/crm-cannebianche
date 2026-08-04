-- ============================================================================
-- CRM Direct Holiday — Nucleo familiare: auto-popolamento iniziale.
-- Alla prima apertura di una scheda, il nucleo viene precompilato con i
-- co-occupanti delle prenotazioni (co-viaggiatori ricorrenti, o tutti se poche
-- prenotazioni; escluse le aziende). One-shot: customer_nucleo_init evita di
-- rifarlo. Tutti i membri restano poi modificabili/eliminabili a mano.
-- Idempotente. DB: HolidayCanneBianche_CRM.
-- ============================================================================

-- provenienza del membro: CodCli dell'occupante PMS (NULL = inserito a mano)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('customer_travel_party') AND name = 'pms_occupant_id')
ALTER TABLE customer_travel_party ADD pms_occupant_id INT NULL;
GO

-- marker "auto-popolamento già eseguito" per cliente (one-shot)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_nucleo_init')
CREATE TABLE customer_nucleo_init (
  pms_customer_id INT       NOT NULL PRIMARY KEY,   -- Anagra.CodCli
  created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
