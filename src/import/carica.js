// Caricamento nel DB CRM (read/write): upsert su booking_snapshot e
// customer_cumulativi. MERGE su chiave → un reimport aggiorna, non duplica.

async function upsertSnapshot(crmDb, r) {
  await crmDb.query(
    `MERGE booking_snapshot AS t
     USING (SELECT @codpratica AS codpratica) AS s ON t.codpratica = s.codpratica
     WHEN MATCHED THEN UPDATE SET
       pms_customer_id=@pmsCustomerId, dtarrivo=@dtarrivo, dtpartenza=@dtpartenza, notti=@notti,
       stato=@stato, source=@source, mercato=@mercato, camere=@camere, tipologia=@tipologia,
       trattamento=@trattamento, pax=@pax, imp_arrangiamento=@impArrangiamento, imp_extra=@impExtra,
       city_tax=@cityTax, vip_snapshot=@vipSnapshot, amenities_snapshot=@amenitiesSnapshot,
       valido_cumulativi=@validoCumulativi, pms_updated_at=@pmsUpdatedAt, imported_at=SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT
       (codpratica, pms_customer_id, dtarrivo, dtpartenza, notti, stato, source, mercato, camere,
        tipologia, trattamento, pax, imp_arrangiamento, imp_extra, city_tax, vip_snapshot,
        amenities_snapshot, valido_cumulativi, pms_updated_at, imported_at)
       VALUES
       (@codpratica, @pmsCustomerId, @dtarrivo, @dtpartenza, @notti, @stato, @source, @mercato, @camere,
        @tipologia, @trattamento, @pax, @impArrangiamento, @impExtra, @cityTax, @vipSnapshot,
        @amenitiesSnapshot, @validoCumulativi, @pmsUpdatedAt, SYSUTCDATETIME());`,
    r
  );
}

async function upsertCumulativi(crmDb, pmsCustomerId, c) {
  await crmDb.query(
    `MERGE customer_cumulativi AS t
     USING (SELECT @pmsCustomerId AS pms_customer_id) AS s ON t.pms_customer_id = s.pms_customer_id
     WHEN MATCHED THEN UPDATE SET
       n_soggiorni=@nSoggiorni, notti_totali=@nottiTotali, ltv=@ltv,
       spesa_media_soggiorno=@spesaMediaSoggiorno, spesa_media_rooms=@spesaMediaRooms,
       spesa_media_servizi=@spesaMediaServizi, ultima_source=@ultimaSource,
       prima_visita=@primaVisita, ultima_visita=@ultimaVisita, updated_at=SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT
       (pms_customer_id, n_soggiorni, notti_totali, ltv, spesa_media_soggiorno, spesa_media_rooms,
        spesa_media_servizi, ultima_source, prima_visita, ultima_visita, updated_at)
       VALUES
       (@pmsCustomerId, @nSoggiorni, @nottiTotali, @ltv, @spesaMediaSoggiorno, @spesaMediaRooms,
        @spesaMediaServizi, @ultimaSource, @primaVisita, @ultimaVisita, SYSUTCDATETIME());`,
    { pmsCustomerId, ...c }
  );
}

module.exports = { upsertSnapshot, upsertCumulativi };
