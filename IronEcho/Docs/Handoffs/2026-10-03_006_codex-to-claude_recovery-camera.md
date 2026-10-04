# 006 Codex → Claude: проект восстановлен, camera adapter 1.1

## Статус

open; передачи 001–003 прочитаны, разделение Realistic принято. Подготовлена передача в этом файле;
сообщение в чат Claude не отправлялось.

## Контекст

Из вложения облачной сессии восстановлен bundle с девятью коммитами до `2b3773e`.
Все исходные коммиты сохранены в `sNibaAdeka/iron-echo`, ветка `claude/recovered-wizardly-pascal`.
Добавления Codex — `codex/contract-1.1-integration`. Main арта и исходные файлы Claude не изменены.
Постоянный выбор общего checkout остаётся решением автора; восстановленные ветки уже можно скачивать.

## Что готово

Source plugin Codex, проектный camera adapter по фактическому контракту 1.1, ограниченные sparks и
маршрутизация confirmed contacts правильному защитнику. Данные камеры берутся из GameState; здоровье,
таймеры и повреждения в presentation не рассчитываются. Груша получает отклик камеры без metal sparks.
Registration patch создан и прошёл `git apply --check`, но не применён к файлам Claude.
Editor-script сохраняет только новый Art config/material и читает Tech Realistic ссылки.

Проверки и оставшиеся ограничения — `Docs/Art/RECOVERY_AND_INTEGRATION_QA.json` и
`Docs/Art/CONTRACT_CAMERA_INTEGRATION.md`. Core 58/58, tracker 36 passed + 1 skipped (нет weights),
robot validation unit tests 6/6, portable contact policy 10/10. Unreal не запускался.

## Что нужно от получателя

Принять точную установку module + registration patch из инструкции, собрать UBT/UHT на Windows,
импортировать свои Realistic assets, запустить Art setup и проверить PIE/package.
Не объявлять source-only плагин или генераторы готовой игрой. В этой поставке HUD/menu ещё не подключены
к gameplay; AnimBP нокдауна/подъёма и физические испытания камеры остаются открытыми.
Сохранить последние изменения головы/перчаток из облачной working tree отдельно: bundle заканчивается
realism-v2 renders и не доказывает наличие последующей переделки.

## Файлы и блокировки

Codex меняет только Plugins/IronEchoVisuals, Tools/Unreal/Art, Docs/Art и этот исходящий handoff.
Source/.uproject/Config/Tracking/Realistic не изменены. Бинарные ассеты здесь не записывались;
долгих новых блокировок нет. Для монтажа module ownership переходит интегратору, камеры остаются задачей Codex.

## Запрос изменения контракта

Изменение schema 1.1 не требуется. Необходима регистрация проектного presentation adapter как описано
в патче (без изменений существующего gameplay). Следующая задача Codex — UI adapter и AnimBP по 1.1.

## Вопросы

Нужен фактический Windows build log для проверки Unreal API; готового exe в текущем bundle нет.
