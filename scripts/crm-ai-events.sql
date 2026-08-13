-- Registro delle chiamate all'AI e di cosa ne è stato fatto.
--
-- Finora finivano solo in un `console.log`: sapevamo quante preferenze erano
-- state salvate, ma non quante ne aveva proposte l'AI. Manca cioè il
-- denominatore — senza, non si può dire se il suggeritore è bravo o se lo si
-- ignora, e nemmeno se la spesa vale.
--
-- Due tipi di riga, distinti da `azione`:
--   'generato'  — una chiamata all'AI. Porta quante proposte ha prodotto e com'è
--                 andata (riuscita, guasto, oppure nessuna informazione trovata).
--   'accettato' — l'operatore ha confermato UNA delle proposte. Il conto degli
--                 accettati diviso le proposte generate è il tasso di adozione.
--
-- Non si registra l'"ignorato": una proposta scartata è indistinguibile da una
-- semplicemente non guardata, e contarle insieme darebbe un numero che sembra
-- preciso e non lo è.
--
-- Idempotente.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ai_events')
CREATE TABLE ai_events (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  funzione        NVARCHAR(30)  NOT NULL,   -- 'briefing' | 'suggerimenti' | 'note-personali'
  azione          NVARCHAR(20)  NOT NULL,   -- 'generato' | 'accettato'
  pms_customer_id INT           NULL,       -- l'ospite: riferimento logico ad Anagra.CodCli
  utente_id       INT           NOT NULL,
  n_proposte      INT           NULL,       -- solo per 'generato'
  esito           NVARCHAR(20)  NOT NULL CONSTRAINT DF_ai_events_esito DEFAULT 'ok',
  dettaglio       NVARCHAR(400) NULL,       -- il testo accettato, o il motivo del guasto
  created_at      DATETIME2     NOT NULL CONSTRAINT DF_ai_events_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ai_events_user FOREIGN KEY (utente_id) REFERENCES users(id),
  CONSTRAINT CK_ai_events_azione CHECK (azione IN ('generato', 'accettato')),
  CONSTRAINT CK_ai_events_esito  CHECK (esito IN ('ok', 'guasto', 'vuoto'))
);
GO

-- Le interrogazioni saranno quasi tutte "in questo periodo": l'indice sta sulla data.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_events_created')
CREATE INDEX IX_ai_events_created ON ai_events(created_at);
GO
