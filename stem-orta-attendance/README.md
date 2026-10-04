# STEM Orta — отчёт посещаемости

Белый статический сайт (HTML/CSS/JS, без сборки). Данные берёт из Google Meet автоматически.

## Как это работает
Google Meet → **Apps Script** (раз в час) → JSON → сайт.
- Участники и время в звонке: Meet REST API (`conferenceRecords.participants.participantSessions`).
- Заметки: Google Doc «Notes by Gemini» из Drive организатора, привязывается к уроку по дате.
- «Присутствовал» = пробыл ≥ порога (по умолчанию 50% урока, переключается на сайте).

## Запуск (10 минут)
1. script.google.com → новый проект → вставить `apps-script/Code.gs`, заполнить `CONFIG.STUDENTS` и `MEET_CODE`.
2. Services (+) → **Google Meet API** (v2). Запустить `refresh()` и выдать доступы.
3. Triggers → `refresh` → по времени → каждый час.
4. Deploy → Web app (Execute as: Me, Who has access: Anyone) → URL в `config.js` → `DATA_URL`.
5. Хостинг: GitHub Pages / Netlify — папка `stem-orta-attendance`.

Локально: `python3 -m http.server` в этой папке. Сейчас в `data/attendance.json` демо-данные (`"demo": true`).

## Нюансы
- Имена в Meet берутся из аккаунта ученика; если отличаются от списка — добавьте в `aliases`.
- Gemini-заметки требуют Workspace-план с этой функцией; без них урок просто без заметок.
- Данные детей: ограничьте доступ к сайту (Netlify password / Cloudflare Access), не публикуйте открыто.
