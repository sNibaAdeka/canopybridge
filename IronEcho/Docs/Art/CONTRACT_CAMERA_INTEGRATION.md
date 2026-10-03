# Камера и контакты — передача интегратору, контракт 1.1

Дата: 2026-10-03. Основа Claude: `2b3773eb2a4f042ec1bf9c7b242b39af958fbfc7`.
Исходные девять коммитов восстановлены из bundle и сохранены в ветке
`claude/recovered-wizardly-pascal` репозитория `sNibaAdeka/iron-echo`.
Ветка `codex/contract-1.1-integration` содержит эту основу и добавления Codex.
Она — кандидат для интеграции; `main` и постоянный выбор общего репозитория не менялись.

## Что действительно есть

Проект `IronEcho/IronEcho.uproject`, правила, трекер, оригинальные генераторы реалистичных роботов/ринга,
контракт 1.1 и рендеры Claude доступны через GitHub. Готовых `.blend`, `.fbx`, запечённых игровых текстур,
`.uasset`, `.umap` и Windows `.exe` в сохранённом коммите нет; крупные артефакты были вне Git.
Последующая переделка головы и перчаток могла остаться в облачной рабочей копии: этот bundle её не подтверждает.

`Plugins/IronEchoVisuals` содержит исходники Codex. Новый адаптер камеры лежит отдельно в
`Tools/Unreal/Art/Integration/IronEchoContractVisuals`, ожидает установки в Source интегратором.
Модуль проекта может зависеть от `IronEcho` и визуального плагина; зависимость плагина от gameplay
не используется. Основание: [правила зависимостей Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/plugins-in-unreal-engine).

## Точная установка для интегратора на Windows

Работать в отдельном checkout этой ветки. Закрыть Unreal. Сначала принять передачу регистрации:
это изменение `.uproject`, обоих Target.cs и добавление нового Source-модуля, которыми владеет Claude.
Codex подготовил патч и проверил его применимость, но не изменял эти файлы.

Из корня репозитория:

```powershell
git apply --check IronEcho/Tools/Unreal/Art/Integration/register_contract_module.patch
Copy-Item -Recurse IronEcho/Tools/Unreal/Art/Integration/IronEchoContractVisuals IronEcho/Source/IronEchoContractVisuals
git apply IronEcho/Tools/Unreal/Art/Integration/register_contract_module.patch
cd IronEcho
powershell -ExecutionPolicy Bypass -File Tools/Build/Bootstrap-Windows.ps1
powershell -ExecutionPolicy Bypass -File Tools/Build/Build-Editor.ps1
```

Не копировать поверх существующего `Source/IronEchoContractVisuals`; проверить его автора и изменения.
Проект сейчас указывает EngineAssociation `5.8`. Реальная установленная версия и toolchain должны пройти
bootstrap/сборку; совместимость с другим движком не подтверждена.

Для реалистичных мешей используется pipeline Claude `Tools/Build/Bake-Realistic.ps1 -Import`.
Бинарные файлы создаёт один назначенный писатель. Не запускать старые generators Codex.
После импорта Tech Realistic выполнить в Python console редактора:

```text
py "<checkout>/IronEcho/Tools/Unreal/Art/prepare_contract_camera.py"
```

Скрипт создаёт `/Game/Art/Config/DA_IronEchoVisuals`, который уже указан в исходном DefaultGame.ini,
копирует ссылки роботов/AnimBP из Tech Realistic при наличии и устанавливает GameCameraClass.
Config и Tech DA не правит. В отсутствие мешей остаются технические заглушки.
Если Art DA уже существует, скрипт останавливается для сохранения чужих ссылок; интегратор проверяет его
и назначает `IEContractCameraRig` в поле GameCameraClass вручную либо согласует отдельную правку.

После запуска PIE: F1 переключает клавиатуру, J/K — прямые, Space — блок, A/D — уклоны, F3 — теховерлей.
Режим по умолчанию — тренировка. Бой вызывается игровым `StartBout(Normal)`; наш menu ещё не привязан
к этой команде. Это проверка проекта, а не инструкция запуска готовой игры.

## Критерии приёмки

1. UBT/UHT собирают Editor и packaged Development Win64 с обоими модулями.
2. Камера следует игроку, показывает соперника; в тренировке смотрит на грушу. Проверить канаты/стойки,
   дистанции 100–150 см, смену режима и уничтожение целей.
3. HitConfirmed/Blocked дают один эффект; GuardBroken → HitConfirmed не удваивает его. При обмене
   ударами реакция относится к правильному защитнику. По груше нет металлических искр.
4. Повтор того же event не перезапускает эффект; одинаковые AttackId разных бойцов и новых матчей различимы.
   Отсутствие spark material оставляет камеру и реакционный policy рабочими.
5. `SetPresentationReducedMotion(true)` отключает тряску/hold; пакет содержит материал в cooked content.
6. Проверить реальные FPS/VRAM на RTX 3050 вместе с MediaPipe. Числа пока не измерены.

HUD/menu и AnimBP реакции/падения/подъёма остаются следующим этапом. Остановка клипа не подключена
к настоящему AnimBP: getter — подготовленный интерфейс, а не доказательство готового hit-stop.

## Уже проверено на Mac

Bundle integrity и SHA256; Gitleaks всей восстановленной истории — 0 findings.
AppleClang C++20 + ASan/UBSan: 58/58 тестов ядра. Python 3.12: 36 тестов трекера прошли, один
MediaPipe inference test пропущен без весов модели. Robot contract: 6/6. Contact policy: 10/10.
Python AST, JSON descriptor, generated include order и `git apply --check` прошли.
Отчёт: `RECOVERY_AND_INTEGRATION_QA.json`. Unreal/камера/Windows не запускались.
