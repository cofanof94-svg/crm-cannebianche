// Dati finti per il server di sviluppo (scripts/dev-mock.js).
//
// Servono a lavorare su frontend e backend quando il DB dell'hotel non è
// raggiungibile (fuori dalla rete: `getaddrinfo ENOTFOUND cb-dh`). Le forme dei
// record rispecchiano quelle reali osservate sul PMS: camere multiple per pratica,
// note lunghissime, tariffe a gradini nella pianificazione, occupanti per camera.
// Nomi e importi sono inventati.
//
// La "data di lavoro" è calcolata da oggi, così gli arrivi e i soggiorni in corso
// restano sempre coerenti con il giorno in cui si sviluppa.

const giorno = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const oggi = new Date(`${iso(Date.now())}T00:00:00Z`).getTime();
const piu = (n) => iso(oggi + n * giorno);

const DATA_LAVORO = piu(0);

// --- Anagrafiche -----------------------------------------------------------
// CodVip: 'V1' classificazione, 'IN' ospite indesiderato, vuoto = nessuna.
const ANAGRAFICHE = [
  { CodCli: 1001, Cognome: 'TOSTI', Nome: 'CARLO', email: 'c.tosti@example.it', Telefono: '0805551001', Cellulare: '3391001001', Citta: 'BARI', CodNaz: 'I', dtNascita: '1968-04-12', CodFis: 'TSTCRL68D12A662X', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: 'Cliente storico, sempre stessa camera.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1002, Cognome: 'HEUSER', Nome: 'HENRY MICHAEL', email: 'h.heuser@example.com', Telefono: '', Cellulare: '+4915112345', Citta: 'MÜNCHEN', CodNaz: 'D', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1003, Cognome: 'HAEFLIGER', Nome: 'SANDRA', email: 's.haefliger@example.ch', Telefono: '', Cellulare: '+41791234567', Citta: 'ZÜRICH', CodNaz: 'CH', dtNascita: '1979-08-30', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1004, Cognome: 'PAGLIUSO', Nome: 'ROBERT RALPH', email: 'rr.pagliuso@example.com', Telefono: '', Cellulare: '+13475550142', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: '1971-02-19', CodFis: '', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: 'Gruppo famiglia, 4 camere.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1005, Cognome: 'BORSOS', Nome: 'ANNAMÁRIA', email: 'a.borsos@example.hu', Telefono: '', Cellulare: '+36301234567', Citta: 'BUDAPEST', CodNaz: 'H', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1006, Cognome: 'DI PIETRANGELO', Nome: 'CARMINE', email: 'c.dipietrangelo@example.it', Telefono: '0805551006', Cellulare: '3391006006', Citta: 'FOGGIA', CodNaz: 'I', dtNascita: '1962-11-03', CodFis: 'DPTCMN62S03D643K', CodVip: 'IN', DesVip: 'OSPITE INDESIDERATO', Annotazioni: 'Contestazioni ripetute sul conto.', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'S', PrivacyCessioneDati: 'S' },
  { CodCli: 1007, Cognome: 'SILLANO', Nome: 'CINZIA', email: 'c.sillano@example.it', Telefono: '', Cellulare: '3391007007', Citta: 'TORINO', CodNaz: 'I', dtNascita: '1974-06-21', CodFis: 'SLLCNZ74H61L219R', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1008, Cognome: 'ANDERSEN', Nome: 'ERIK THOGER', email: 'e.andersen@example.dk', Telefono: '', Cellulare: '+4520123456', Citta: 'AARHUS', CodNaz: 'DK', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // occupanti / accompagnatori
  { CodCli: 1101, Cognome: 'TOSTI', Nome: 'GIULIA', email: '', Telefono: '', Cellulare: '', Citta: 'BARI', CodNaz: 'I', dtNascita: '1972-09-15', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1102, Cognome: 'PAGLIUSO', Nome: 'ROSEMARIE', email: '', Telefono: '', Cellulare: '', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // compleanno OGGI, dentro il soggiorno della pratica 70104: serve a vedere la
  // ricorrenza (e il nome cliccabile) nelle card senza dover forzare i dati
  { CodCli: 1103, Cognome: 'PAGLIUSO', Nome: 'NATALIA', email: '', Telefono: '', Cellulare: '', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: piu(0).replace(/^\d{4}/, '2014'), CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1104, Cognome: 'HAEFLIGER', Nome: 'MARKUS', email: '', Telefono: '', Cellulare: '', Citta: 'ZÜRICH', CodNaz: 'CH', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // duplicato volutamente simile a 1001 (stesso cognome/nome/data di nascita)
  { CodCli: 1201, Cognome: 'TOSTI', Nome: 'CARLO', email: 'carlo.tosti@example.it', Telefono: '', Cellulare: '3391001001', Citta: 'BARI', CodNaz: 'I', dtNascita: '1968-04-12', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
];

const NOTA_LUNGA = `PAGANO TUTTO
4 camere: 1 MJS + 2 SUP + 1 CLS — 6AD + 2CH (under 10y) BB
Rosemarie Pagliuso, Natalia Pagliuso, Raphael Pagliuso, Robert Pagliuso JR
€ 1.870,00 PER 2 NOTTI (${piu(-6)}, ${piu(-5)}) 1550 + €320 sofabed
€ 1.920,00 PER 3 NOTTI (${piu(-4)}, ${piu(-3)}, ${piu(-2)}) 1600 + €320 sofabed
€ 2.070,00 PER 2 NOTTI (${piu(-1)}, ${piu(0)}) 1750 + €320 sofabed
Transfer da BRI il giorno dell'arrivo, volo AZ1613 ore 14:20.
Culla in camera 226. Tavolo riservato ristorante ore 20:30 per tutta la permanenza.
Cena di compleanno da concordare con la maître — la signora compie gli anni durante il soggiorno.
TOT: € 13.640,00 — saldo alla partenza con AMEX.`;

// --- Prenotazioni ----------------------------------------------------------
// stato: 'incasa' | 'partenza' (parte oggi) | 'checkout' (già uscito) | 'arrivo'
const PRENOTAZIONI = [
  { codpratica: 70101, codCliente: 1001, camere: '101', tipologie: 'SUP', dtarrivo: piu(-1), dtpartenza: piu(6), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 410, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 320, note: 'Camera alta, lontano ascensore. Cuscino rigido. Quotidiano italiano ogni mattina.', occupanti: [{ codCli: 1001, camera: '101' }, { codCli: 1101, camera: '101' }] },
  { codpratica: 70102, codCliente: 1002, camere: '102', tipologie: 'CLS', dtarrivo: piu(-2), dtpartenza: piu(3), trattamento: 'B&B', tariffa: 'WEB', extra: 95, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 240, note: '', occupanti: [{ codCli: 1002, camera: '102' }] },
  { codpratica: 70103, codCliente: 1003, camere: '103, 104', tipologie: 'SUP', dtarrivo: piu(-4), dtpartenza: piu(2), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 780, stato: 'incasa', paxAdulti: 4, paxBambini: 0, tariffaNotte: 290, note: 'Due camere comunicanti se possibile.', occupanti: [{ codCli: 1003, camera: '103' }, { codCli: 1104, camera: '104' }] },
  { codpratica: 70104, codCliente: 1004, camere: '109, 218, 224, 226', tipologie: 'JS, SUP, CLS', dtarrivo: piu(-6), dtpartenza: piu(1), trattamento: 'B&B', tariffa: 'DIRETTO', extra: 2340, stato: 'incasa', paxAdulti: 6, paxBambini: 2, tariffaNotte: 1750, note: NOTA_LUNGA, occupanti: [{ codCli: 1004, camera: '109' }, { codCli: 1102, camera: '218' }, { codCli: 1103, camera: '224' }] },
  { codpratica: 70105, codCliente: 1005, camere: '106', tipologie: 'CLS', dtarrivo: piu(-1), dtpartenza: piu(4), trattamento: 'B&B', tariffa: 'WEB', extra: 0, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 230, note: 'Late check-out richiesto, da confermare.', occupanti: [{ codCli: 1005, camera: '106' }] },
  { codpratica: 70106, codCliente: 1006, camere: '124', tipologie: 'CLS', dtarrivo: piu(-3), dtpartenza: piu(0), trattamento: 'Pensione Completa', tariffa: 'BAR', extra: 160, stato: 'checkout', paxAdulti: 1, paxBambini: 0, tariffaNotte: 250, note: 'Verificare il conto extra prima della partenza.', occupanti: [{ codCli: 1006, camera: '124' }] },
  { codpratica: 70107, codCliente: 1007, camere: '232, 234', tipologie: 'JSF', dtarrivo: piu(-1), dtpartenza: piu(0), trattamento: 'B&B', tariffa: 'DIRETTO', extra: 220, stato: 'partenza', paxAdulti: 3, paxBambini: 1, tariffaNotte: 620, note: 'Navetta per aeroporto alle 11:00.', occupanti: [{ codCli: 1007, camera: '232' }] },
  { codpratica: 70108, codCliente: 1008, camere: '205', tipologie: 'SUP', dtarrivo: piu(-2), dtpartenza: piu(5), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 315, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 300, note: '', occupanti: [{ codCli: 1008, camera: '205' }] },
  // arrivi di oggi
  { codpratica: 70201, codCliente: 1201, camere: '211', tipologie: 'SUP', dtarrivo: piu(0), dtpartenza: piu(5), trattamento: 'Mezza Pensione', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 310, oraArrivo: '15.30', note: 'Prima volta in hotel. Arrivo previsto nel pomeriggio.', occupanti: [] },
  { codpratica: 70202, codCliente: 1003, camere: '215', tipologie: 'CLS', dtarrivo: piu(0), dtpartenza: piu(2), trattamento: 'B&B', tariffa: 'BAR', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 245, oraArrivo: '', note: '', occupanti: [] },
];

// Pianificazione di soggiorno: tariffe a gradini per notte (GG = indice notte
// 1-based dell'intero soggiorno). Solo per qualche pratica, come nella realtà.
const PIANIFICAZIONE = {
  70101: [{ GG: 2, impoEur: 300 }, { GG: 4, impoEur: 345 }, { GG: 6, impoEur: 300 }],
  70104: [{ GG: 3, impoEur: 1600 }, { GG: 6, impoEur: 1750 }],
};

// Soggiorni conclusi (StorPrenota) → alimentano storico cliente e "ospite di ritorno".
const STORICO = [
  { codpratica: 60011, codCli: 1001, dtarrivo: '2025-08-02', dtpartenza: '2025-08-09', camere: '101', arrangiamento: 2240, extra: 380 },
  { codpratica: 60012, codCli: 1001, dtarrivo: '2024-07-20', dtpartenza: '2024-07-27', camere: '101', arrangiamento: 2100, extra: 410 },
  { codpratica: 60013, codCli: 1001, dtarrivo: '2023-08-11', dtpartenza: '2023-08-16', camere: '103', arrangiamento: 1500, extra: 220 },
  { codpratica: 60021, codCli: 1004, dtarrivo: '2025-08-01', dtpartenza: '2025-08-08', camere: '109', arrangiamento: 9800, extra: 1980 },
  { codpratica: 60031, codCli: 1007, dtarrivo: '2022-08-14', dtpartenza: '2022-08-19', camere: '232', arrangiamento: 2600, extra: 300 },
  { codpratica: 60032, codCli: 1007, dtarrivo: '2021-08-10', dtpartenza: '2021-08-15', camere: '230', arrangiamento: 2400, extra: 190 },
  { codpratica: 60041, codCli: 1006, dtarrivo: '2024-06-05', dtpartenza: '2024-06-08', camere: '124', arrangiamento: 750, extra: 90 },
];

// Consumi F&B e SPA per la scheda ospite.
const GUSTI = {
  1001: [
    { codArt: 'AMARONE', nome: 'AMARONE DELLA VALPOLICELLA', fb: 'B', grp: 'VINI ROSSI', volte: 6, qta: 6, eur: 480 },
    { codArt: 'CAFFLEC', nome: 'CAFFÈ LECCESE', fb: 'B', grp: 'BEV.CALDE', volte: 14, qta: 14, eur: 56 },
    { codArt: 'CRUDOPS', nome: 'CRUDO DI PESCE', fb: 'F', grp: 'ANTIPASTI', volte: 4, qta: 4, eur: 180 },
  ],
  1004: [
    { codArt: 'CHAMPB', nome: 'CHAMPAGNE BRUT', fb: 'B', grp: 'BOLLICINE', volte: 8, qta: 9, eur: 1080 },
    { codArt: 'COCAZ', nome: 'COCA COLA ZERO', fb: 'B', grp: 'BEV.BI', volte: 12, qta: 15, eur: 75 },
  ],
};

const SPA = {
  1001: [{ nome: 'MASSAGGIO DECONTRATTURANTE', grp: 'SPA', volte: 3, qta: 3, eur: 330 }],
  1007: [
    { nome: 'PERCORSO ACQUA', grp: 'SPA', volte: 2, qta: 4, eur: 160 },
    { nome: 'SERENITY', grp: 'SPA', volte: 1, qta: 1, eur: 140 },
  ],
};

// --- Dati CRM iniziali (poi modificabili dall'app, restano in memoria) -------
const CRM_INIZIALE = {
  preferenze: [
    { id: 1, pms_customer_id: 1001, reparto: 'F&B', categoria: 'F&B', testo: 'Predilige Amarone a cena', ambito: 'nucleo', autore: 'admin' },
    { id: 2, pms_customer_id: 1001, reparto: 'Rooms', categoria: 'Camera', testo: 'Camera lato mare, piano alto', ambito: 'nucleo', autore: 'admin' },
    { id: 3, pms_customer_id: 1001, reparto: 'F&B', categoria: 'F&B', testo: 'Caffè leccese al mattino', ambito: 'nucleo', autore: 'reception' },
    { id: 4, pms_customer_id: 1004, reparto: 'Rooms', categoria: 'Camera', testo: 'Cuscini extra e culla', ambito: 'nucleo', autore: 'admin' },
    { id: 5, pms_customer_id: 1007, reparto: 'SPA', categoria: 'Persona', testo: 'Prenota sempre percorso acqua', ambito: 'personale', autore: 'admin' },
  ],
  intolleranze: [
    { id: 1, pms_customer_id: 1004, testo: 'Lattosio', autore: 'admin' },
    { id: 2, pms_customer_id: 1102, testo: 'Frutta a guscio', autore: 'reception' },
    { id: 3, pms_customer_id: 1008, testo: 'Glutine', autore: 'admin' },
  ],
  complaints: [
    { id: 1, pms_customer_id: 1006, testo: 'Rumore dal corridoio, camera cambiata', stato: 'risolto', periodo: 'giu 2024', follow_up: 'Spostato in 118 lato mare, upgrade gratuito per le due notti restanti.', autore: 'admin' },
    { id: 2, pms_customer_id: 1006, testo: 'Contestazione conto extra bar', stato: 'aperto', periodo: 'oggi', follow_up: null, autore: 'reception' },
    { id: 3, pms_customer_id: 1003, testo: 'Ritardo nella pulizia camera', stato: 'aperto', periodo: 'ieri', follow_up: null, autore: 'reception' },
    // Storico: risolto prima di questa evolutiva, quindi senza follow-up. Serve a
    // vedere che i vecchi reclami restano leggibili e non chiedono nulla.
    { id: 4, pms_customer_id: 1001, testo: 'Aria condizionata rumorosa in camera 101', stato: 'risolto', periodo: 'ago 2025', follow_up: null, autore: 'admin' },
  ],
  nucleo: [
    { id: 1, pms_customer_id: 1001, pms_occupant_id: 1101, tipo_relazione: 'Coniuge', nome: 'GIULIA', cognome: 'TOSTI', nota: '', autore: 'admin' },
    { id: 2, pms_customer_id: 1004, pms_occupant_id: 1102, tipo_relazione: 'Coniuge', nome: 'ROSEMARIE', cognome: 'PAGLIUSO', nota: 'Intollerante alla frutta a guscio', autore: 'admin' },
    { id: 3, pms_customer_id: 1004, pms_occupant_id: 1103, tipo_relazione: 'Figlio-a', nome: 'NATALIA', cognome: 'PAGLIUSO', nota: '', autore: 'admin' },
  ],
  profili: [
    { pms_customer_id: 1001, lingua: 'IT', note_personali: 'Direttore generale di un gruppo industriale pugliese. Rivolgersi come "Dottore".', data_nascita: null, autore: 'admin' },
    { pms_customer_id: 1004, lingua: 'EN', note_personali: null, data_nascita: null, autore: 'admin' },
    // 1003 arriva oggi ED è in casa: la stessa nota si vede su entrambe le pagine.
    // Volutamente più lunga di una riga, per vedere la sintesi nella card e il
    // testo intero nel suggerimento del mouse.
    {
      pms_customer_id: 1003, lingua: 'DE', data_nascita: null, autore: 'admin',
      note_personali: 'Amministratore delegato di un gruppo del fashion; viaggia spesso per lavoro. '
        + 'Chiede una scrivania in camera e la stampante alla reception per i documenti. Cena presto, mai dopo le 21.',
    },
  ],
  merge: [], // { pms_customer_id, canonical_id }
  // Marker one-shot dell'auto-popolamento del nucleo: per chi ha già un nucleo
  // compilato qui sopra è "già fatto", altrimenti l'app lo ri-popolerebbe con
  // relazioni 'Altro' duplicate alla prima apertura della scheda.
  nucleoInit: [1001, 1004],
};

module.exports = {
  DATA_LAVORO, piu, ANAGRAFICHE, PRENOTAZIONI, PIANIFICAZIONE, STORICO,
  GUSTI, SPA, CRM_INIZIALE,
};
