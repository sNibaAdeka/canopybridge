# IronEchoVisuals 0.4 — восстановленный проект, source-only

Плагин перенесён из `sNibaAdeka/iron-echo` main `415e386a` в восстановленный проект Claude. Модуль `IronEchoVisuals` содержит UMG menu/HUD, shoulder camera, pooled cosmetic sparks и confirmed-contact feedback. Он остаётся выключенным до регистрации интегратором; Unreal/UHT не запускались.

Адаптер к **ROBOT_VISUAL_CONTRACT 1.1** находится в `Tools/Unreal/Art/Integration/IronEchoContractVisuals`. Его нужно установить как **модуль проекта** `Source/IronEchoContractVisuals`, поскольку он зависит от игрового модуля `IronEcho`. Внутри плагина оставлен только независимый визуальный модуль. Точный патч регистрации и порядок — `Docs/Art/CONTRACT_CAMERA_INTEGRATION.md`.

`AIEContractCameraRig` автоматически читает GameState, выбирает соперника/грушу, принимает HitConfirmed/Blocked, направляет реакцию соответствующему защитнику и удаляет delegate при EndPlay. GuardBroken сопровождается HitConfirmed в CombatSim и не рисуется второй раз. Training bag не даёт металлических искр. Сокеты используются в мировых сантиметрах; здоровье и урон не вычисляются в этом слое.

`SetPresentationReducedMotion` отключает camera pulse/hold и сокращает искры. Пока экран настройки этой опции не подключён. `GetDefenderReactionPlayRate` предназначен для чтения на game thread и копирования в cosmetic-only клип реакции. AnimBP, нокдаун/подъём и подключение HUD/menu к данным игры пока **не реализованы**.

Материал и отдельный Art data asset создаёт `Tools/Unreal/Art/prepare_contract_camera.py`. Скрипт читает ссылки из Tech Realistic, сохраняет только `/Game/Art/**`, останавливается при PIE/несохранённых изменениях/существующем DA и удерживает единоличную блокировку записи. Он не запускает старые генераторы и не меняет Config.

На Mac прошли 10 portable contact-policy scenarios (тестируется только стандартный C++ policy header). Это не подтверждает компиляцию плагина, GPU/UMG/AnimGraph и packaged build. Бюджет 48 sparks, bounded event histories по 512, reaction hold 40–65 ms с gap 100 ms — настройки кода, не измерения производительности RTX 3050.
