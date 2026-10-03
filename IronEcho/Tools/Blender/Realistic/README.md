# Реалистичная графика IRON ECHO (владелец — Claude, решение автора 2026-10-02)

Всё строится кодом из этой папки, бинарники в git не нужны. Требуется Blender **4.5 LTS** (или `pip install bpy==4.5.*`
на Python 3.11). Техзадание и ворота качества — `Docs/Visual/REALISM_BRIEF.md`.

| Файл | Что делает |
|---|---|
| `rlib.py` | примитивы hard-surface, процедурные PBR-материалы: краска с лаком, сколы, **царапины**, пыль, масляные следы, алюминий, карбон, кожа, **обшарпанный бетон** (облезшая краска, подтёки, трещины, грязь у пола), **ржавая сталь** |
| `robot.py` | робот IE-1, ливреи Forge/Ember, скелет по контракту, позы (guard/jab/slip/block) |
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
```

Windows одной командой (Blender → текстуры → импорт в Unreal):
`powershell -ExecutionPolicy Bypass -File Tools\Build\Bake-Realistic.ps1 -Import`, затем
`Tools\Unreal\Tech\validate_robot.py` и в `Config/DefaultGame.ini` → `VisualConfig` на
`/Game/Tech/Realistic/DA_IronEchoVisuals_Realistic`.

## Бюджет

Робот: ≈ 119 тыс. треугольников, 1 материал, 4 текстуры 4K (≈ 55 МБ VRAM с мипами, BC5/BC7). Нормали запекаются в
OpenGL (+Y) — импорт в Unreal включает Flip Green Channel.
