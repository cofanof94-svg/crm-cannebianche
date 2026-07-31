-- ============================================================================
-- CRM Direct Holiday — Import ibrido: tabelle snapshot nel DB CRM.
-- Deriva da DOCS/2026-07-30-crm-import-ibrido-design.md.
-- Idempotente. DB: HolidayCanneBianche_CRM. Popolate da `npm run import` (SELECT
-- dal PMS, INSERT/UPDATE solo sul CRM). Il PMS resta in sola lettura.
-- ============================================================================

-- Snapshot di UNA prenotazione (per codpratica). Denormalizzato per query rapide,
-- con i campi congelati al momento dell'import (VIP/Amenities) e gli importi già
-- "puliti" (city tax separata).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'booking_snapshot')
CREATE TABLE booking_snapshot (
  id                 INT IDENTITY(1,1) PRIMARY KEY,
  codpratica         INT           NOT NULL UNIQUE,   -- chiave PMS della prenotazione
  pms_customer_id    INT           NOT NULL,          -- codclinterm (referente) = Anagra.CodCli
  dtarrivo           DATE          NULL,
  dtpartenza         DATE          NULL,
  notti              INT           NULL,
  stato              NVARCHAR(20)  NULL,              -- Confermata | Completata | Cancellata
  source             NVARCHAR(60)  NULL,              -- da SourcePrenota (decodificato)
  mercato            NVARCHAR(60)  NULL,              -- da PrenotaProvenienze (decodificato)
  camere             NVARCHAR(100) NULL,
  tipologia          NVARCHAR(120) NULL,              -- da Tipologie (decodificato)
  trattamento        NVARCHAR(20)  NULL,
  pax                INT           NULL,
  imp_arrangiamento  DECIMAL(12,2) NULL,              -- lordo folio
  imp_extra          DECIMAL(12,2) NULL,              -- extra, city tax ESCLUSA
  city_tax           DECIMAL(12,2) NULL,              -- separata (non nei ricavi)
  vip_snapshot       NVARCHAR(20)  NULL,              -- Anagra.CodVip congelato all'import
  amenities_snapshot NVARCHAR(MAX) NULL,              -- Prenota.ListaCodAmenities congelato
  valido_cumulativi  BIT           NOT NULL DEFAULT 0,-- 0 per Cancellate / record spazzatura
  pms_updated_at     DATETIME2     NULL,              -- marcatore incrementale (UpdatedAtNewDH)
  imported_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_snapshot_customer')
CREATE INDEX IX_snapshot_customer ON booking_snapshot(pms_customer_id);
GO

-- Cumulativi per cliente (1:1), materializzati a fine import da booking_snapshot
-- dove valido_cumulativi = 1.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_cumulativi')
CREATE TABLE customer_cumulativi (
  pms_customer_id       INT           NOT NULL PRIMARY KEY,   -- Anagra.CodCli
  n_soggiorni           INT           NOT NULL DEFAULT 0,
  notti_totali          INT           NOT NULL DEFAULT 0,
  ltv                   DECIMAL(12,2) NOT NULL DEFAULT 0,
  spesa_media_soggiorno DECIMAL(12,2) NOT NULL DEFAULT 0,
  spesa_media_rooms     DECIMAL(12,2) NOT NULL DEFAULT 0,
  spesa_media_servizi   DECIMAL(12,2) NOT NULL DEFAULT 0,
  ultima_source         NVARCHAR(60)  NULL,
  prima_visita          DATE          NULL,
  ultima_visita         DATE          NULL,
  updated_at            DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
