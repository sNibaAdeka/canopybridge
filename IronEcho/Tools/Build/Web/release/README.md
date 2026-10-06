# Опубликованный релиз IRON ECHO 1.0

Сгенерированные файлы, которые раздаются публично прямо из этого репозитория (`raw.githubusercontent.com`):

| Файл | Откуда | Зачем |
|---|---|---|
| `index.html` | `Build/Web/IronEcho-Public.html` (`build_web.py site` с `IRONECHO_DOWNLOAD_URL`) | вся игра одной страницей (с камерой); Netlify импортирует её по ссылке |
| `IronEcho-Windows.zip` | `Build/Desktop/IronEcho-Windows.zip` (`Tools/Build/Desktop/build_desktop.py`) | приложение для Windows, на него ведёт кнопка «Скачать для Windows» |

Обновление: пересобрать оба, скопировать сюда, закоммитить, повторить импорт в Netlify (тот же `claude_design_project_id`
обновляет сайт на месте). Не редактировать вручную.
