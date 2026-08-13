-- Registro degli accessi.
--
-- È la risposta a "il CRM lo stanno usando?", che oggi non si può dare. Di chi
-- SCRIVE sappiamo già tutto — preferenze, allergie, reclami e note portano
-- autore e data — ma chi consulta e basta non lascia traccia da nessuna parte,
-- e una reception che apre venti schede al giorno sta usando il CRM anche se
-- non salva niente.
--
-- Si registrano anche i tentativi falliti: un utente che sbaglia password tre
-- volte al giorno è un problema di adozione, non di sicurezza, e va visto.
--
-- `utente_id` è nullo quando il nome utente non esiste proprio: non si può
-- collegare a nessuno, ma il tentativo va contato lo stesso. Per questo NON c'è
-- una chiave esterna: legherebbe il registro alla vita degli utenti, e
-- cancellare una persona cancellerebbe la storia dei suoi accessi — che è
-- esattamente quello che si vuole conservare.
--
-- Idempotente.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'crm_accessi')
CREATE TABLE crm_accessi (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  utente_id  INT           NULL,
  username   NVARCHAR(50)  NOT NULL,
  esito      NVARCHAR(20)  NOT NULL,   -- 'ok' | 'credenziali' | 'disattivato'
  created_at DATETIME2     NOT NULL CONSTRAINT DF_accessi_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_accessi_esito CHECK (esito IN ('ok', 'credenziali', 'disattivato'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accessi_created')
CREATE INDEX IX_accessi_created ON crm_accessi(created_at);
GO
