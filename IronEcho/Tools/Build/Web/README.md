# Браузерная версия IRON ECHO

Играбельный бой прямо в браузере, пока Unreal-сборка не проверена на ПК. Это не отдельная игра «по мотивам»:
правила, тайминги, бот, нокдауны и судьи — **то же ядро `Source/IronEchoRules`**, скомпилированное в WebAssembly.

| Что | Откуда | Как проверено |
|---|---|---|
| Правила боя, бот, судьи | `Source/IronEchoRules` → `bridge/IronEchoWeb.cpp` (C API) → zig `wasm32-wasi` | нативная сборка = WebAssembly = wasm2js, бит-в-бит на 7200 кадрах (`check_core.mjs`) |
| Ввод камерой | порт `Tracking/iron_echo_tracker` в `site/src/pose.js` + MediaPipe PoseLandmarker (full) | удары совпадают с Python-трекером бит-в-бит, блок/наклон до 5·10⁻⁶ (`check/check_pose.mjs`) |
| Роботы IE-1 | `Tools/Blender/Realistic/export_web.py`: игровая геометрия, упрощённая до ~72 тыс. треугольников, запечённые 2K-текстуры | контракт робота: 0 ошибок |
| Ринг и зал | ринг — геометрия по размерам `ring.py` + запечённое полотно; зал — равнопромежуточная панорама Cycles | скриншоты в headless Chromium |
| Анимация | порт `robot.pose()` (аналитическая IK) в `site/src/rig.js`, процедурные удары/реакции в `anim.js` | там же |

## Как играть

- **Ссылка (артефакт claude.ai)** — клавиатура, мышь или сенсорные кнопки. Камера в артефакте запрещена песочницей.
- **С камерой** — кнопка «Версия с камерой — скачать» в меню артефакта или файл `Build/Web/IronEcho-Camera.html`
  после сборки. Один файл, открывается двойным щелчком в Chrome/Edge (разрешить камеру; нужен интернет для three.js
  и MediaPipe с CDN). Калибровка: стойка → уклон влево → уклон вправо, ~10 с.

Клавиши: `J` джеб, `K` кросс, `Пробел`/`S` блок (держать; при нокдауне — держать, чтобы встать), `A`/`D` уклоны,
`Esc` пауза. Мышь: ЛКМ — джеб, ПКМ — кросс.

## Сборка

```bash
# инструменты: zig 0.13 (pip install ziglang==0.13.0), node 18+, npm i binaryen gltfpack, Pillow, Blender 4.5 (bpy)
python Tools/Blender/Realistic/export_web.py --out Build/Web/assets     # роботы, полотно, панорама (~30 мин CPU)
IRONECHO_BINARYEN=node_modules/binaryen/bin IRONECHO_GLTFPACK=node_modules/gltfpack/cli.js \
  python Tools/Build/Web/build_web.py all                                 # ядро + проверки + сайт
```

Выход: `Build/Web/site/index.html` (фрагмент для артефакта), `play.html` (то же для локального сервера),
`assets/`, `Build/Web/IronEcho-Camera.html` (самодостаточный файл с камерой). `Build/` не коммитится.

Шаги `build_web.py`: `core` — zig → `ironecho_core.wasm` (~41 КБ) + wasm2js-резерв + сверка с нативным двойником;
`check` — сверка порта трекера с Python; `site` — JPEG-текстуры, квантование GLB (`gltfpack -kv -vtf -vn 10`),
склейка модулей `site/src/*.js` (без сборщика: уникальные имена верхнего уровня), сборка страниц.

## Ограничения

- Не проверено на людях: кадры и пороги трекера подтверждаются испытаниями (`Docs/Testing/HUMAN_TRIALS.md`).
- В контейнере WebGL программный (~1 к/с): производительность на RTX 3050 не измерялась.
- Нет удержания/клинча, хуков, апперкотов и ударов в корпус (как и в ядре v1.2).
- three.js 0.170 и MediaPipe 0.10.18 грузятся с jsdelivr; без интернета страница не запустится.
