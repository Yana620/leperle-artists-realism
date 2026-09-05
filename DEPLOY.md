# Le'Perle — деплой лендинга на Vercel

## Что заливаем
Всю папку `C:\Users\Anasa\leperle-artists` целиком. Важные части:
- `public/` — сам сайт (index.html, styles.css, script.js, img/)
- `api/submit.js` — серверная функция: принимает заявку, грузит фото в Notion
- `vercel.json` — говорит Vercel отдавать сайт из `public/`
- `package.json` — зависимость busboy для разбора формы

(`netlify/` и `netlify.toml` — старый вариант под Netlify, Vercel их игнорирует, можно удалить.)

## Шаг 0. Ключ Notion (если ещё нет)
1. https://www.notion.so/my-integrations → **New integration** (Internal), имя любое.
2. Скопировать **Internal Integration Secret** (`secret_...` или `ntn_...`).
3. В Notion открыть базу **Le'Perle — Заявки художниць** → ••• → **Connections** → подключить эту интеграцию.

## Шаг 1. Залить код
**Вариант A — GitHub (рекомендую):** создать репозиторий, залить папку, на vercel.com → **Add New → Project** → импортировать репозиторий.

**Вариант B — без GitHub, через CLI с этого компа:**
```powershell
cd C:\Users\Anasa\leperle-artists
npx vercel login
npx vercel --prod
```

## Шаг 2. Переменные окружения
Vercel → проект → **Settings → Environment Variables**, добавить две:
- `NOTION_TOKEN` = секрет из шага 0
- `NOTION_DATABASE_ID` = `5d8c9d7235014dfeb279724c1197185b`

После добавления — **Redeploy** (Deployments → ⋯ → Redeploy).

## Шаг 3. Проверка
Открыть выданный URL (вида `leperle-artists.vercel.app`), отправить тестовую заявку
с парой фото — она должна появиться в базе Notion с вложениями.

## Свой домен (потом)
Settings → Domains → добавить `artists.le-perle.com.ua` → прописать CNAME в DNS домена.
