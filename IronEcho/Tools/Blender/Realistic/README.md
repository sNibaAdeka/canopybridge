# Реалистичная графика IRON ECHO (владелец — Claude, решение автора 2026-10-02)

Всё строится кодом из этой папки, бинарники в git не нужны. Требуется Blender **4.5 LTS** (или `pip install bpy==4.5.*`
на Python 3.11). Техзадание и ворота качества — `Docs/Visual/REALISM_BRIEF.md`.

| Файл | Что делает |
|---|---|
| `rlib.py` | примитивы hard-surface, процедурные PBR-материалы: краска с лаком, сколы, **царапины**, пыль, масляные следы, алюминий, карбон, кожа, **обшарпанный бетон** (облезшая краска, подтёки, трещины, грязь у пола), **ржавая сталь** |
| `robot.py` | скелет по контракту, ливреи Forge/Ember, материалы, сборка робота из деталей `robot2.py`, позы (guard/jab/slip/block) |
| `robot2.py` | **детали роботов IE-2 (1.9.0, с нуля)**: бронепластины-оболочки (`hull`: лофт по сечениям-суперэллипсам), поршни, открытый позвоночник, силовой блок с номером на спине, сжатый механический кулак; два силуэта на одном скелете — `sparring` (Forge: округлые наплечники) и `champion` (Ember: гранёная броня, гребень, клинки на предплечьях) |
| `preview_robot.py` | быстрый студийный просмотр одного робота (≈ 1 мин): `--livery Forge|Ember --views front,side,back,bust,game --stance guard` |
| `ring.py` | ринг 20 футов, ТВ-свет, подземный индустриальный зал (стены, колонны, трубы, лампы, двери EXIT, балки), зрители |
| `render_showcase.py` | рендеры для оценки вида (Cycles) |
| `export_robot.py` | FBX + проверка контракта (без текстур) |
| `bake_robot.py` | **игровой путь**: запекание процедурных материалов в 4K BaseColor/Normal/ORM/Emissive, FBX с одним материалом, проверочный рендер `bake_check_*.png` |

## Команды

```bash
# вид (оценка автором)
python render_showcase.py --shots hero,detail,venue,game,wide --res 1600x900 --samples 96 --outdir out/
# в игру (Linux/облако или Windows с Blender)
python bake_robot.py --out ../../../ArtSource/Realistic/Export
# быстрый просмотр одной ливреи (≈ 1 мин на 4 ядрах)
python preview_robot.py --livery Ember --out out/ --views front,side,back
# веб-игра: запекание 2048 px + GLB обоих роботов (≈ 6 мин; на выходе bpy возможен код 139 — файлы уже записаны)
python export_web.py --out ../../../Build/Web/assets --what robots
```

Правила деталей IE-2 (`robot2.py`): часть конечности строится в системе своей кости (z — вдоль кости, x — вперёд, наружная сторона — −s·y,
s = +1 слева / −1 справа); голова, шея, грудь, живот, таз, ключицы и стопы — в мировых координатах позы покоя. Привязка жёсткая: одна деталь —
одна кость, поэтому детали соседних костей должны перекрываться шаром или кольцом в суставе, а не «впритык». Проверка в игре —
`node Tests/Web/selfcheck.js` (см. `Tests/Web/README.md`): если деталь стала толще, поправь капсулы в этом тесте и в `rig.js` (`body`, `SELF_*`).

Windows одной командой (Blender → текстуры → импорт в Unreal):
`powershell -ExecutionPolicy Bypass -File Tools\Build\Bake-Realistic.ps1 -Import`, затем
`Tools\Unreal\Tech\validate_robot.py` и в `Config/DefaultGame.ini` → `VisualConfig` на
`/Game/Tech/Realistic/DA_IronEchoVisuals_Realistic`.

## Бюджет

Робот: ≈ 119 тыс. треугольников, 1 материал, 4 текстуры 4K (≈ 55 МБ VRAM с мипами, BC5/BC7). Нормали запекаются в
OpenGL (+Y) — импорт в Unreal включает Flip Green Channel.
