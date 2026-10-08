# Сайт IRON ECHO 1.4

Опубликован: https://iron-echo-boxing.vercel.app (Vercel, проект `iron-echo-boxing`, root directory ниже).

Сгенерированная папка, коммитится целиком: статический хостинг (Vercel, Netlify) берёт её прямо из GitHub — root
directory `IronEcho/Tools/Build/Web/release`, без команды сборки.

| Путь | Что |
|---|---|
| `/` | главная: видео боя, «Играть в браузере», «Скачать для Windows», управление |
| `/play/` | вся игра одной страницей (камера ПК; вторая камера — телефон по QR, см. `/phone/`) |
| `/phone/` | страница телефона: включает камеру и шлёт видео в игру по WebRTC (открывается по QR из игры) |
| `/download/IronEcho-Windows.zip` | приложение для Windows (`IronEcho.exe`, офлайн, телефон как камера) |
| `/api/ratings` | сервер рейтинга одиночных боёв (Vercel-функция из `api/` и `lib/`; нужны переменные `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, схема `rating_schema.sql`; см. `Tools/Build/Web/api/README.md`) |
| `vercel.json`, `_headers`, `netlify.toml` | заголовки (камера разрешена на `/play`, zip — скачиванием) |

Пересборка: `build_web.py site` (с `IRONECHO_DOWNLOAD_URL=/download/IronEcho-Windows.zip`) →
`Tools/Build/Desktop/build_desktop.py` → `build_web.py public` → `build_web.py release`. Руками не править.
