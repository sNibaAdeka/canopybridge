# Сайт IRON ECHO 1.12

Опубликован: https://iron-echo-boxing.vercel.app (Vercel, проект `iron-echo-boxing`, root directory ниже).

Сгенерированная папка, коммитится целиком: статический хостинг (Vercel, Netlify) берёт её прямо из GitHub — root
directory `IronEcho/Tools/Build/Web/release`, без команды сборки.

| Путь | Что |
|---|---|
| `/` | главная: «Играть с камерой», шесть соперников (портреты из игры: `media/foes/`), видео боя, управление, «Скачать для Windows» |
| `/play/` | игра: страница, ассеты и **все библиотеки и модель распознавания со своего домена** (`play/vendor/`: three.js, MediaPipe, модель позы full, PeerJS, шрифты) — заблокированный или медленный CDN не ломает камеру. Модель «Высокая точность» (30 МБ) не кладётся, грузится из хранилища Google по выбору игрока |
| `/phone/` | страница телефона: включает камеру и шлёт видео в игру по WebRTC (открывается по QR из игры) |
| `/privacy/` | «Камера и данные»: что игра делает с камерой и что собирает статистика |
| `/download/IronEcho-Windows.zip` | приложение для Windows (`IronEcho.exe`, офлайн, телефон как камера) |
| `/api/ratings` | сервер рейтинга одиночных боёв (Vercel-функция из `api/` и `lib/`; нужны переменные `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, схема `rating_schema.sql`; см. `Tools/Build/Web/api/README.md`) |
| `/api/events` | анонимная статистика (схема `events_schema.sql`, отчёт — запросы `events_report.sql` в SQL-редакторе Supabase) |
| `vercel.json`, `_headers`, `netlify.toml` | заголовки (камера разрешена на `/play`, `vendor` кэшируется неделю, zip — скачиванием) и ежедневный вызов `/api/ratings` (cron 05:23 UTC), чтобы бесплатная база не засыпала без посетителей |

Пересборка: `build_web.py site` (с `IRONECHO_DOWNLOAD_URL=/download/IronEcho-Windows.zip`) →
`Tools/Build/Desktop/build_desktop.py` → `build_web.py public` → `build_web.py release`. Руками не править.
