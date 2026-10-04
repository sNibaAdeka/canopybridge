/**
 * STEM Orta — сбор посещаемости из Google Meet + заметок Gemini.
 * Включите: Services (+) → Google Meet API (идентификатор Meet) и Drive API не нужен (используется DriveApp).
 * Опубликуйте: Deploy → Web app (Execute as: Me, Access: Anyone) и вставьте URL в config.js сайта.
 * Триггер: Triggers → refresh() → Time-driven → каждый час.
 */
const CONFIG = {
  MEET_CODE: '',                 // код вашей повторяющейся встречи, напр. 'abc-defg-hij' ('' = все встречи)
  COURSE: 'STEM Orta',
  DAYS_BACK: 120,
  // Ученики. aliases — как они могут отображаться в Meet (имя на аккаунте/устройстве)
  STUDENTS: [
    // {id:'s1', name:'Айдар Нурлан', email:'', aliases:['Aidar N']},
  ],
  NOTES_TITLE_HINTS: ['Notes by Gemini', 'Заметки Gemini', 'Заметки от Gemini']
};

function refresh() {
  const since = new Date(Date.now() - CONFIG.DAYS_BACK * 864e5).toISOString();
  const recs = [];
  let tok;
  do {
    const r = Meet.ConferenceRecords.list({ filter: `start_time>="${since}"`, pageToken: tok, pageSize: 100 });
    (r.conferenceRecords || []).forEach(c => recs.push(c));
    tok = r.nextPageToken;
  } while (tok);

  const sessions = recs.filter(matchesCode_).map(buildSession_).sort((a, b) => a.date < b.date ? -1 : 1);
  const out = { course: CONFIG.COURSE, updatedAt: new Date().toISOString(), students: CONFIG.STUDENTS, sessions };
  PropertiesService.getScriptProperties().setProperty('data', JSON.stringify(out));
  return out;
}

function matchesCode_(c) {
  if (!CONFIG.MEET_CODE) return true;
  const sp = Meet.Spaces.get(c.space);
  return sp.meetingCode === CONFIG.MEET_CODE;
}

function buildSession_(c) {
  const start = new Date(c.startTime), end = c.endTime ? new Date(c.endTime) : new Date();
  const people = {};
  let tok;
  do {
    const r = Meet.ConferenceRecords.Participants.list(c.name, { pageToken: tok, pageSize: 250 });
    (r.participants || []).forEach(p => {
      const name = (p.signedinUser || p.anonymousUser || p.phoneUser || {}).displayName || 'Unknown';
      let mins = 0, t2;
      do {
        const ss = Meet.ConferenceRecords.Participants.ParticipantSessions.list(p.name, { pageToken: t2 });
        (ss.participantSessions || []).forEach(s => {
          const a = new Date(s.startTime), b = s.endTime ? new Date(s.endTime) : end;
          mins += Math.max(0, (b - a) / 6e4);
        });
        t2 = ss.nextPageToken;
      } while (t2);
      people[name] = (people[name] || 0) + Math.round(mins);
    });
    tok = r.nextPageToken;
  } while (tok);

  const day = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const notes = findNotes_(start);
  return {
    id: c.name.split('/').pop(), date: day, title: CONFIG.COURSE + ' · ' + day,
    duration: Math.round((end - start) / 6e4),
    notesUrl: notes ? notes.url : '', summary: notes ? notes.snippet : '',
    attendees: Object.keys(people).map(n => ({ name: n, email: '', minutes: people[n] }))
  };
}

// Заметки Gemini — Google Doc в Drive организатора, созданный в день урока
function findNotes_(start) {
  const from = new Date(start.getTime() - 3 * 36e5).toISOString();
  const to = new Date(start.getTime() + 36 * 36e5).toISOString();
  const hint = CONFIG.NOTES_TITLE_HINTS.map(h => `title contains '${h}'`).join(' or ');
  const it = DriveApp.searchFiles(`(${hint}) and createdDate >= '${from}' and createdDate <= '${to}'`);
  if (!it.hasNext()) return null;
  const f = it.next();
  let snippet = '';
  try { snippet = DocumentApp.openById(f.getId()).getBody().getText().replace(/\s+/g, ' ').slice(0, 350) + '…'; } catch (e) {}
  return { url: f.getUrl(), snippet };
}

function doGet() {
  const raw = PropertiesService.getScriptProperties().getProperty('data');
  return ContentService.createTextOutput(raw || JSON.stringify(refresh())).setMimeType(ContentService.MimeType.JSON);
}
