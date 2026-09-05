/**
 * Le'Perle — приём заявок художниц.
 * Парсит multipart-форму, загружает фото в Notion (File Upload API)
 * и создаёт страницу в приватной базе заявок.
 *
 * ENV (задаются в Netlify → Site settings → Environment variables):
 *   NOTION_TOKEN        — Internal Integration Secret (secret_...)
 *   NOTION_DATABASE_ID  — ID базы заявок
 */
const Busboy = require("busboy");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

const MAX_FILES = 15;
const MAX_SIZE = 5 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!NOTION_TOKEN || !DATABASE_ID) return json(500, { error: "Сервер не налаштований (немає Notion-ключів)." });

  let parsed;
  try {
    parsed = await parseMultipart(event);
  } catch (e) {
    return json(400, { error: "Не вдалося обробити форму." });
  }

  const { fields, files } = parsed;

  // honeypot
  if (fields.website) return json(200, { ok: true });

  if (!fields.name) return json(400, { error: "Не вказано ім'я." });
  if (!fields.telegram) return json(400, { error: "Не вказано Telegram." });

  try {
    // 1. Загружаем фото в Notion
    const fileBlocks = [];
    for (const f of files.slice(0, MAX_FILES)) {
      if (!f.data.length || f.data.length > MAX_SIZE) continue;
      const id = await uploadFileToNotion(f);
      if (id) fileBlocks.push({ type: "file_upload", file_upload: { id }, name: f.filename || "photo.jpg" });
    }

    // 2. Создаём страницу
    const properties = buildProperties(fields, fileBlocks);
    const res = await notion("/pages", "POST", {
      parent: { database_id: DATABASE_ID },
      properties,
    });

    if (!res.ok) {
      console.error("Notion page error:", res.status, res.body);
      return json(502, { error: "Не вдалося зберегти заявку. Спробуйте пізніше." });
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("Submit error:", e);
    return json(500, { error: "Внутрішня помилка. Спробуйте ще раз." });
  }
};

/* ---------- Notion helpers ---------- */

function notionHeaders(extra) {
  return Object.assign({
    Authorization: "Bearer " + NOTION_TOKEN,
    "Notion-Version": NOTION_VERSION,
  }, extra || {});
}

async function notion(path, method, body) {
  const r = await fetch(NOTION_API + path, {
    method: method,
    headers: notionHeaders({ "Content-Type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, body: text };
}

async function uploadFileToNotion(file) {
  // step 1: create file upload object
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

  // step 2: send the bytes (multipart/form-data with field "file")
  const fd = new FormData();
  fd.append("file", new Blob([file.data], { type: file.mimeType || "image/jpeg" }), file.filename || "photo.jpg");

  const sendRes = await fetch(uploadUrl, {
    method: "POST",
    headers: notionHeaders(), // let fetch set multipart content-type/boundary
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
  if (f.city) p["Місто"] = richText(f.city);
  if (f.links) p["Посилання на роботи"] = { url: normalizeUrl(f.links) };
  if (f.comment) p["Коментар"] = richText(f.comment);
  if (f.experience) p["Досвід розпису"] = richText(f.experience);
  if (f.perday) p["Фігурок на день"] = richText(f.perday);
  if (f.hours) p["Годин на день"] = richText(f.hours);
  if (f.materials) p["Є матеріали"] = richText(f.materials);
  if (f.freezer) p["Є фрезер"] = richText(f.freezer);
  if (f.test) p["Готова на тестове"] = richText(f.test);
  if (f.start) p["Коли готова почати"] = richText(f.start);
  if (fileBlocks.length) p["Портфоліо (фото)"] = { files: fileBlocks };
  return p;
}

function richText(s) { return { rich_text: [{ text: { content: String(s).slice(0, 2000) } }] }; }
function normalizeUrl(s) { return /^https?:\/\//i.test(s) ? s : "https://" + s.replace(/^\/+/, ""); }

/* ---------- multipart parser ---------- */

function parseMultipart(event) {
  return new Promise(function (resolve, reject) {
    const headers = lowerKeys(event.headers || {});
    const contentType = headers["content-type"];
    if (!contentType || contentType.indexOf("multipart/form-data") === -1) {
      return reject(new Error("Not multipart"));
    }
    const bb = Busboy({ headers: { "content-type": contentType }, limits: { files: MAX_FILES, fileSize: MAX_SIZE } });
    const fields = {};
    const files = [];

    bb.on("field", function (name, val) { fields[name] = val; });
    bb.on("file", function (name, stream, info) {
      const chunks = [];
      stream.on("data", function (d) { chunks.push(d); });
      stream.on("limit", function () { /* skip oversize */ });
      stream.on("end", function () {
        const data = Buffer.concat(chunks);
        if (data.length) files.push({ field: name, data: data, filename: info.filename, mimeType: info.mimeType });
      });
    });
    bb.on("error", reject);
    bb.on("close", function () { resolve({ fields: fields, files: files }); });

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
    bb.end(body);
  });
}

/* ---------- utils ---------- */
function lowerKeys(o) { const r = {}; for (const k in o) r[k.toLowerCase()] = o[k]; return r; }
function json(code, obj) { return { statusCode: code, headers: Object.assign({ "Content-Type": "application/json" }, CORS), body: JSON.stringify(obj) }; }
async function safeText(r) { try { return await r.text(); } catch (e) { return ""; } }
