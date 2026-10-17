# 11 — OWNER CHECKLISTS (everything only Адёка can do, as exact scripts)

The AI must hand these to the owner in Russian, one at a time, with the expected result. Never ask the owner to write code.
Each script: **goal, time, what you need, steps, what to send back, what happens next.**

## 11.1 Vercel: connect the rating database (10 minutes, once)

Goal: make the ladder work.
Need: Vercel account access, the Supabase "secret key" for project `iron-echo`.
Steps:
1. Open https://supabase.com/dashboard → project **iron-echo** → Project Settings → API Keys.
2. Copy the **secret** key (starts with `sb_secret_`). Do NOT send it to anyone, including the AI.
3. Open https://vercel.com → your project (iron-echo-boxing) → Settings → Environment Variables.
4. Add `SUPABASE_URL` = `https://tboqtclodnlzqcllaaij.supabase.co` (Production + Preview).
5. Add `SUPABASE_SERVICE_KEY` = the secret key (Production + Preview), mark as Sensitive.
6. Add `EVENTS_ADMIN_TOKEN` = a random string you create (at least 24 characters); keep it in a password manager.
7. Go to Deployments → the latest → **Redeploy**.
8. Open the site and check the menu shows the expected version.
Send back: "готово" and the version you see on the site.
Next: the AI verifies `/api/ratings?ladder=keys` returns 200 and runs a rated bout test.

## 11.2 Check the live version after every release (1 minute)

1. Open https://iron-echo-boxing.vercel.app/play/ in a private window.
2. Look at the bottom of the menu: "версия X.Y.Z".
3. If it is older than the number the AI reported: Vercel → Deployments → Redeploy (uncheck "use existing build cache").
Send back: the version string you see.

## 11.3 Record yourself (Collection Mode) — W0 (about 45 minutes)

Goal: give the AI real data about your movements and your camera.
Need: laptop with webcam, space to stand 2–3 m from it, a lamp, 45 minutes.
Preparation:
- Close other browser tabs and heavy apps. Plug in the laptop. Use Chrome or Edge.
- Wear what you usually wear (not special clothes).
Steps for each of 3 conditions:
1. Open `https://iron-echo-boxing.vercel.app/play/?collect=1`.
2. Read and accept the consent screen (nothing but skeleton numbers is saved; no video).
3. Fill the short form.
4. **Condition A** — good light: lamp in front or daylight from the side. Stand ~2 m from the camera, in the middle.
5. Follow the voice/text cues: do each strike when it says "ДАВАЙ". Do it the way you would in the game. If you mess up, press "Повторить". Don't try to be perfect.
6. After block A: **Condition B** — dim light: switch off the main light, leave only the screen glow. Same cues.
7. **Condition C** — step back to ~3 m and 0.5 m to the side. Same cues.
8. At the end press "Скачать файл" for each (3 files `ironecho-session-….json.gz`).
Send back: the 3 files (drop into the shared folder / send via the method the AI named) and a few words: what felt wrong, which cues were confusing.
Next: the AI produces the first accuracy table within a day and tells you the three worst places.

## 11.4 Ask friends to record (W1/W2) — message to copy and send

Text (RU):
> Привет! Я делаю браузерную игру в бокс с роботом, где ты бьёшь перед веб-камерой. Нужна помощь: 12–40 минут записи движений.
> Видео НЕ записывается и не отправляется — только точки скелета (цифры). Ссылка: <ссылка ?collect=1>. Открой в Chrome или Edge, разреши камеру, следуй подсказкам.
> В конце нажми «Скачать файл» и пришли мне. Спасибо! Твой ник попадёт в список первопроходцев.
Instructions for you:
- Choose people with different heights/builds, someone with glasses, someone in loose clothes, different laptops/webcams.
- Ask each to do at least condition A; two of them all three.
- Collect files in one folder; tell the AI the number of files and what laptops they used.
Target: 8 people total (including you).

## 11.5 Latency measurement (30 minutes)

Goal: measure delay between your punch and the robot's reaction.
Need: a phone that records 60 fps (slow-motion mode is best), a tripod or a stack of books, laptop with camera.
Steps:
1. Open `https://iron-echo-boxing.vercel.app/play/?latency=1`. Choose Camera and calibrate.
2. Place the phone so it sees both **you (your arms)** and the **laptop screen** in one frame.
3. Start recording on the phone.
4. Throw 20 clear straight punches toward the screen, one every ~3 seconds, starting each from a still stance.
5. Stop recording. Send the video file.
Warning: in this mode a corner of the screen flashes white when a punch is recognised — if you are photosensitive, ask someone else to do it.
Next: the AI analyses frames and reports p50/p95 latency and what to fix.

## 11.6 Test on a weak laptop and another browser (20 minutes each)

Need: any older/cheaper laptop; Firefox or Safari if available.
Steps:
1. Open the site, press F3 once (shows numbers in the corner).
2. Play one bout with the keyboard, one with the camera.
3. Take a phone photo of the screen during the fight showing the F3 numbers (game fps, camera fps, ms).
4. Note: model of the laptop (Settings → About), browser and version, whether the fan was loud, whether it lagged.
Send back: the photos and notes.

## 11.7 Watch strangers play (the most valuable hour)

Need: 5 people who have never seen the game (friends of friends), a call or in-person.
Steps:
1. Send them only the link. Say nothing about controls.
2. Ask them to think aloud; start a stopwatch when they open the link.
3. Note the time when they first punch; note every moment they hesitate or ask a question.
4. After: three questions: "Что это за игра в одной фразе?", "Что бесило?", "Поиграл бы ещё?"
5. Record on the form from `Docs/Testing/ONBOARDING_TESTS.md` (the AI prepares the sheet).
Send back: the notes or a voice summary. The AI will convert them into fixes.

## 11.8 Windows app smoke test (15 minutes, on a real Windows PC)

1. Download `IronEcho-Windows.zip` from the site; unzip.
2. Run `IronEcho.exe`. If Windows says "Windows protected your PC" → "More info" → "Run anyway" (the app is not signed yet).
3. Does the game window open? Does the menu appear? Keyboard fight? Camera fight?
4. Turn the internet off and start again: does it still start?
5. Close and reopen: settings kept?
Send back: yes/no per step and a screenshot if something fails.

## 11.9 Decisions the owner must make (AI presents options with a recommendation)

| # | Decision | When | Recommended default |
|---|---|---|---|
| D1 | Which strikes via camera in v1 (after table) | Gate 1 | ship those ≥ target; beta 70–85 %; keyboard otherwise |
| D2 | English in v1 | Phase 4 start | yes (RU+EN) — doubles audience, cost low |
| D3 | Online duel in v1 | Gate 5 | beta if acceptance met, else hidden |
| D4 | Second camera | now | hidden (`?lab=1`) |
| D5 | Monetisation intent | before launch | none at launch; collect data |
| D6 | Launch date | Gate 6 | after closed test, midweek |
| D7 | Discord vs GitHub Discussions | Phase 5 | Discord (RU+EN channels) |
| D8 | Code-signing certificate for Windows | after traffic | wait for data |
| D9 | Move to CI releases (repo stops growing) | Phase 5 | yes, needs a GitHub secret from the owner |
| D10 | Custom domain | before launch | yes if budget allows (ask price first) |

## 11.10 Approvals required (the AI must ask and wait)

- Any public post, press contact, store/portal submission.
- Any purchase (domain, certificate, plan upgrades, TURN service).
- Enabling optional trace upload by default (privacy implication).
- Changing the privacy policy text.
- Publishing player-created content (clips) on the site.
- Any change that affects other projects of the owner.

## 11.11 What the owner should expect (so they stay motivated)

- After Phase 0: a tool to record themselves.
- After Phase 1: the first honest table: "camera catches X % of your punches".
- After Phase 2: a visible improvement they can feel in the same recording conditions.
- After Phase 4: a game that a stranger can start in seconds.
- After Phase 6: real players' numbers.
- Every Friday: a short report with numbers and next steps.

## 11.12 Troubleshooting for the owner (quick answers)

| Problem | Do |
|---|---|
| Camera black | close other apps using the camera (Zoom/Teams); reload; try Chrome |
| Game very laggy | close tabs; plug in laptop; Settings → Графика → Лёгкая; use Chrome on the discrete GPU (Windows Settings → Graphics) |
| Robot does not react | press F3: if camera fps < 15 → light/GPU problem; press F4 and send the file |
| Site shows old version | Vercel → Redeploy without cache; hard refresh Ctrl+F5 |
| Nickname taken | choose another; or contact the AI to check the claim token |
| Can't download recording | try another browser; allow downloads for the site |
