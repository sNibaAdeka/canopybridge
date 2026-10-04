# Balance — отчёт по сотням боёв на настоящем ядре

Прогоняет полные бои `IronEchoRules` (3 уровня бота × 4 модели игрока из `Tests/CoreRules/HumanModel.h`) и печатает
таблицу: доли побед, решения судей, досрочные в 1-м раунде, нокдауны, темп и точность ударов.

```bash
R=../../../Source/IronEchoRules
g++ -std=c++20 -O2 -I$R/Public -I../../CoreRules BalanceStats.cpp $(ls $R/Private/*.cpp | grep -v Module) -o BalanceStats
./BalanceStats 300     # 300 боёв на пару, ~2 с
```

Последний отчёт: `Docs/Reports/2026-10-04_balance/README.md`. Охранные границы в CTest: `Tests/CoreRules/TestBalance.cpp`.
