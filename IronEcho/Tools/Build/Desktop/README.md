# IRON ECHO — приложение для Windows (`IronEcho.exe`)

Один исполняемый файл с игрой внутри. Запускается двойным щелчком, открывает игру в отдельном окне Edge или Chrome
(режим `--app`: без вкладок и адресной строки), работает без интернета. Это обёртка над браузерной версией
(`Tools/Build/Web`); полноценная версия на Unreal собирается отдельно (`Tools/Build/Package-Windows.ps1`).

| Что | Как |
|---|---|
| Игра | `Build/Web/standalone`, вшита через `go:embed`: ядро правил (WebAssembly), роботы, ринг, three.js, MediaPipe, модель позы, шрифты |
| Сервер | `http://127.0.0.1:47310/` — порт постоянный, чтобы настройки и разрешение камеры сохранялись; если занят другой копией IRON ECHO, используется она, иначе любой свободный порт |
| Окно | Edge → Chrome → браузер по умолчанию; отдельный профиль `%LOCALAPPDATA%\IronEcho\browser` |
| Выход | закрыли окно → лаунчер завершается (страница пингует `/__ironecho`, сервер живёт, пока открыта игра) |
| Иконка, версия | голова Forge из `Docs/Reports/2026-10-04_head_gloves_v3/head_closeup.jpg` → ресурсы exe через `go-winres` (нужен доступ к прокси Go-модулей при сборке) |

## Сборка (Windows или Linux)

```
python Tools/Build/Web/build_web.py site          # с IRONECHO_WEBDEPS=<node_modules с three@0.170.0 и @mediapipe/tasks-vision@0.10.18>
python Tools/Build/Desktop/build_desktop.py       # Build/Desktop/IronEcho.exe, IronEcho-Windows.zip
python Tools/Build/Web/build_web.py public        # сайт: Build/Web/public (главная, /play, /download)
```

Нужен Go ≥ 1.22 (`IRONECHO_GO` или `go` в PATH). Без C-компилятора: exe собирается кросс-компиляцией.
Проверка без Windows: `Build/Desktop/ironecho-linux --serve 127.0.0.1:8799` раздаёт ту же игру.

## Ограничения

- Нет платной подписи кода: Windows SmartScreen покажет предупреждение («Подробнее» → «Выполнить в любом случае»).
- Нужен Edge или Chrome (Edge входит в Windows 10/11). Без них игра откроется в браузере по умолчанию.
- Проверено: **сам `IronEcho.exe` под Wine 9** (Windows-окружение на Linux) — раздаёт игру, офлайн-загрузка и камера
  через него проходят; с подложенным `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` лаунчер
  находит Edge, открывает `--app=http://127.0.0.1:47310/` с профилем `%LOCALAPPDATA%\IronEcho\browser` и
  завершается после закрытия окна. На настоящем Windows с настоящим Edge — первое испытание за автором.
- Антивирусы иногда настороженно относятся к неподписанным exe на Go; если Defender ругается — это ложное
  срабатывание, исходники в `launcher/`.

Проверка под Wine: `WINEPREFIX=<папка> wine64 Build/Desktop/IronEcho.exe --serve 127.0.0.1:8802`.
