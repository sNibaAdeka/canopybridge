# Сайт IRON ECHO 1.0 (готов к деплою)

Сгенерированная папка, коммитится целиком: статический хостинг (Vercel, Netlify) берёт её прямо из GitHub — root
directory `IronEcho/Tools/Build/Web/release`, без команды сборки.

| Путь | Что |
|---|---|
| `/` | главная: видео боя, «Играть в браузере», «Скачать для Windows», управление |
| `/play/` | вся игра одной страницей (камера ПК работает; телефон-камера — только в приложении) |
| `/download/IronEcho-Windows.zip` | приложение для Windows (`IronEcho.exe`, офлайн, телефон как камера) |
| `vercel.json`, `_headers`, `netlify.toml` | заголовки (камера разрешена на `/play`, zip — скачиванием) |

Пересборка: `build_web.py site` (с `IRONECHO_DOWNLOAD_URL=/download/IronEcho-Windows.zip`) →
`Tools/Build/Desktop/build_desktop.py` → `build_web.py public` → `build_web.py release`. Руками не править.
