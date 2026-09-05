/**
 * Le'Perle — приём заявок художниц (Vercel Serverless Function).
 * Принимает multipart-форму, загружает фото в Notion (File Upload API)
 * и создаёт страницу в приватной базе заявок.
 *
 * ENV (Vercel → Project Settings → Environment Variables):
 *   NOTION_TOKEN        — Internal Integration Secret (secret_... / ntn_...)
 *   NOTION_DATABASE_ID  — ID базы заявок
 */
const Busboy = require("busboy");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

const MAX_FILES = 15;
const MAX_SIZE = 20 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!NOTION_TOKEN || !DATABASE_ID) return res.status(500).json({ error: "Сервер не налаштований (немає Notion-ключів)." });

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (e) {
    console.error("Parse error:", e);
    return res.status(400).json({ error: "Не вдалося обробити форму." });
  }

  const { fields, files } = parsed;

  // honeypot
  if (fields.website) return res.status(200).json({ ok: true });

  if (!fields.name) return res.status(400).json({ error: "Не вказано ім'я." });
  if (!fields.telegram) return res.status(400).json({ error: "Не вказано Telegram." });

  try {
    const fileBlocks = [];
    for (const f of files.slice(0, MAX_FILES)) {
      if (!f.data.length || f.data.length > MAX_SIZE) continue;
      const id = await uploadFileToNotion(f);
      if (id) fileBlocks.push({ type: "file_upload", file_upload: { id }, name: f.filename || "photo.jpg" });
    }

    const properties = buildProperties(fields, fileBlocks);
    // фото также вставляем в тіло сторінки — щоб портфоліо переглядалось як галерея
    const children = fileBlocks.map(function (b) {
      return { object: "block", type: "image", image: { type: "file_upload", file_upload: { id: b.file_upload.id } } };
    });
    const r = await fetch(NOTION_API + "/pages", {
      method: "POST",
      headers: notionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties, children }),
    });

    if (!r.ok) {
      console.error("Notion page error:", r.status, await safeText(r));
      return res.status(502).json({ error: "Не вдалося зберегти заявку. Спробуйте пізніше." });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Submit error:", e);
    return res.status(500).json({ error: "Внутрішня помилка. Спробуйте ще раз." });
  }
};

/* ---------- Notion helpers ---------- */

function notionHeaders(extra) {
  return Object.assign({
    Authorization: "Bearer " + NOTION_TOKEN,
    "Notion-Version": NOTION_VERSION,
  }, extra || {});
}

async function uploadFileToNotion(file) {
  const createRes = await fetch(NOTION_API + "/file_uploads", {
    method: "POST",
    headers: notionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename: file.filename || "photo.jpg",
      content_type: file.mimeType || "image/jpeg",
    }),
  });
  if (!createRes.ok) {
    console.error("file_uploads create failed:", createRes.status, await safeText(createRes));
    return null;
  }
  const created = await createRes.json();
  const uploadUrl = created.upload_url || (NOTION_API + "/file_uploads/" + created.id + "/send");

  const fd = new FormData();
  fd.append("file", new Blob([file.data], { type: file.mimeType || "image/jpeg" }), file.filename || "photo.jpg");

  const sendRes = await fetch(uploadUrl, {
    method: "POST",
    headers: notionHeaders(),
    body: fd,
  });
  if (!sendRes.ok) {
    console.error("file_uploads send failed:", sendRes.status, await safeText(sendRes));
    return null;
  }
  return created.id;
}

function buildProperties(f, fileBlocks) {
  const p = {};
  p["Ім'я"] = { title: [{ text: { content: f.name.slice(0, 200) } }] };
  if (f.telegram) p["Telegram"] = richText(f.telegram);
  if (f.phone) p["Телефон"] = { phone_number: f.phone };
  if (f.age) p["Вік"] = richText(f.age);
  if (f.city) p["Місто"] = richText(f.city);
  if (f.links) p["Посилання на роботи"] = { url: normalizeUrl(f.links) };
  if (f.comment) p["Коментар"] = richText(f.comment);
  if (f.experience) p["Досвід розпису"] = richText(f.experience);
  if (f.style) p["Стиль"] = richText(f.style);
  if (f.perday) p["Фігурок на день"] = richText(f.perday);
  if (f.hours) p["Годин на день"] = richText(f.hours);
  if (f.materials) p["Є матеріали"] = richText(f.materials);
  if (f.freezer) p["Є фрезер"] = richText(f.freezer);
  if (f.test) p["Готова на тестове"] = richText(f.test);
  if (f.start) p["Коли готова почати"] = richText(f.start);
  p["Ознайомлена з умовами"] = { checkbox: f.ack === "yes" };
  if (fileBlocks.length) p["Портфоліо (фото)"] = { files: fileBlocks };
  return p;
}

function richText(s) { return { rich_text: [{ text: { content: String(s).slice(0, 2000) } }] }; }
function normalizeUrl(s) { return /^https?:\/\//i.test(s) ? s : "https://" + s.replace(/^\/+/, ""); }

/* ---------- multipart parser (поток запроса Vercel) ---------- */

function parseMultipart(req) {
  return new Promise(function (resolve, reject) {
    const contentType = req.headers["content-type"] || "";
    if (contentType.indexOf("multipart/form-data") === -1) {
      return reject(new Error("Not multipart"));
    }
    const bb = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_SIZE } });
    const fields = {};
    const files = [];

    bb.on("field", function (name, val) { fields[name] = val; });
    bb.on("file", function (name, stream, info) {
      const chunks = [];
      stream.on("data", function (d) { chunks.push(d); });
      stream.on("end", function () {
        const data = Buffer.concat(chunks);
        if (data.length) files.push({ field: name, data: data, filename: info.filename, mimeType: info.mimeType });
      });
    });
    bb.on("error", reject);
    bb.on("close", function () { resolve({ fields: fields, files: files }); });

    req.pipe(bb);
  });
}

async function safeText(r) { try { return await r.text(); } catch (e) { return ""; } }
