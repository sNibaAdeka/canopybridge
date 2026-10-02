# SimFrames — кадры боя из ядра правил (без Unreal)

Прогоняет полный бой на настоящем `IronEchoRules` (тот же код, что в игре) против бота; игрок — сценарий,
похожий на человека (реакция 0.35–0.52 с с учётом задержки камеры, 50 % блок / 20 % уклон / 30 % пропуск,
джебы, кроссы, двойки). Рисует кадры заглушками. **Это не скриншоты Unreal и не графика Codex.**

```bash
R=../../../Source/IronEchoRules
g++ -std=c++20 -O2 -I$R/Public BoutDump.cpp $(ls $R/Private/*.cpp | grep -v Module) -o BoutDump
./BoutDump 2 2 > bout.jsonl          # seed 2, бот Hard (0 Easy, 1 Normal, 2 Hard)
pip install pillow && python render_frames.py bout.jsonl
```

Выход: `01_countdown.png` … `07_result.png` (1280×720). Готовые кадры — `Docs/Reports/2026-10-02_sim_frames/`.
