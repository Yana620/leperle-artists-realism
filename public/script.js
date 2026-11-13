/* ============ Le'Perle artist form ============ */
(function () {
  "use strict";

  var MAX_FILES = 15;
  var MAX_SIZE = 20 * 1024 * 1024;      // 20 MB на исходный файл (до сжатия)
  var TOTAL_BUDGET = 4.5 * 1024 * 1024; // лимит Netlify-запроса ~6 МБ, держим запас
  var COMPRESS_DIM = 1400;              // макс. сторона после сжатия
  var COMPRESS_Q = 0.78;
  // Эндпоинт серверной функции (Vercel: /api/submit).
  var ENDPOINT = "/api/submit";

  /* ---- Scroll reveal ---- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---- File handling ---- */
  var input = document.getElementById("photos");
  var dropzone = document.getElementById("dropzone");
  var previews = document.getElementById("previews");
  var selected = []; // {file, url}

  function renderPreviews() {
    previews.innerHTML = "";
    selected.forEach(function (item, idx) {
      var li = document.createElement("li");
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.file.name;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.innerHTML = "&times;";
      rm.setAttribute("aria-label", "Видалити фото");
      rm.addEventListener("click", function () {
        URL.revokeObjectURL(item.url);
        selected.splice(idx, 1);
        renderPreviews();
      });
      li.appendChild(img);
      li.appendChild(rm);
      previews.appendChild(li);
    });
  }

  function addFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList);
    var skippedLimit = false;
    arr.forEach(function (file) {
      if (selected.length >= MAX_FILES) { skippedLimit = true; return; }
      if (!/^image\//.test(file.type)) return;
      if (file.size > MAX_SIZE) {
        setStatus("Файл «" + file.name + "» завеликий і пропущений.", "error");
        return;
      }
      selected.push({ file: file, url: URL.createObjectURL(file) });
    });
    if (skippedLimit) setStatus("Максимум " + MAX_FILES + " фото — зайві пропущено.", "error");
    renderPreviews();
  }

  /* ---- Client-side image compression ----
     Netlify приймає ~6 МБ за запит, тому великі фото зменшуємо до 1400px JPEG. */
  function compressImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, COMPRESS_DIM / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          }, "image/jpeg", COMPRESS_Q);
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("is-drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("is-drag"); });
  });
  dropzone.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  /* ---- Status helper ---- */
  var statusEl = document.getElementById("formStatus");
  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = "form__status" + (type ? " is-" + type : "");
  }

  /* ---- Submit ---- */
  var form = document.getElementById("applyForm");

  form.addEventListener("change", function (e) {
    if (e.target.type === "radio") {
      var grp = e.target.closest(".field--choice");
      if (grp) grp.classList.remove("is-error");
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    // honeypot
    if (form.website.value) return;

    var name = form.name.value.trim();

    // все поля обов'язкові, окрім посилання на портфоліо (links)
    var requiredFields = [
      ["name", "Будь ласка, вкажіть ім'я."],
      ["telegram", "Вкажіть Telegram для зв'язку."],
      ["phone", "Вкажіть номер телефону."],
      ["age", "Вкажіть ваш вік."],
      ["city", "Напишіть, з якого ви міста."],
      ["experience", "Опишіть ваш досвід розпису."],
      ["style", "Оберіть, який стиль розпису вам ближче."],
      ["perday", "Оберіть, скільки фігурок на день готові робити."],
      ["hours", "Оберіть, скільки годин на день готові приділяти."],
      ["materials", "Оберіть, чи маєте матеріали для розпису."],
      ["freezer", "Оберіть, чи маєте фрезер."],
      ["test", "Дайте відповідь щодо тестового завдання."],
      ["start", "Оберіть, коли готові почати."],
      ["comment", "Заповніть, будь ласка, коментар."]
    ];
    for (var i = 0; i < requiredFields.length; i++) {
      var fld = form.elements[requiredFields[i][0]];
      if (!fld.value.trim()) {
        setStatus(requiredFields[i][1], "error");
        var isGroup = !fld.focus; // RadioNodeList (кнопки вибору)
        var target = isGroup ? document.getElementById("q-" + requiredFields[i][0]) : fld;
        if (isGroup) {
          target.classList.add("is-error");
          fld[0].focus({ preventScroll: true });
        } else {
          fld.focus();
        }
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (selected.length === 0) { setStatus("Додайте хоча б одне фото робіт.", "error"); return; }

    var ackLabel = document.querySelector(".ack");
    if (!form.ack.checked) {
      ackLabel.classList.add("is-error");
      setStatus("Будь ласка, підтвердіть, що ознайомились з умовами співпраці.", "error");
      ackLabel.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    ackLabel.classList.remove("is-error");

    var fd = new FormData();
    fd.append("name", name);
    fd.append("telegram", form.telegram.value.trim());
    fd.append("phone", form.phone.value.trim());
    fd.append("age", form.age.value.trim());
    fd.append("city", form.city.value.trim());
    fd.append("links", form.links.value.trim());
    fd.append("experience", form.experience.value);
    fd.append("style", form.elements["style"].value);
    fd.append("perday", form.elements["perday"].value);
    fd.append("hours", form.elements["hours"].value);
    fd.append("materials", form.elements["materials"].value);
    fd.append("freezer", form.elements["freezer"].value);
    fd.append("test", form.elements["test"].value);
    fd.append("start", form.elements["start"].value);
    fd.append("comment", form.comment.value.trim());
    fd.append("ack", form.ack.checked ? "yes" : "");

    form.classList.add("is-loading");
    setStatus("Готуємо фото…", "");

    Promise.all(selected.map(function (item) { return compressImage(item.file); }))
      .then(function (compressed) {
        var total = 0;
        compressed.forEach(function (f) { total += f.size; });
        if (total > TOTAL_BUDGET) {
          form.classList.remove("is-loading");
          setStatus("Фото займають забагато місця. Видаліть кілька або додайте менші файли.", "error");
          throw new Error("too-big");
        }
        compressed.forEach(function (f) { fd.append("photos", f, f.name); });
        setStatus("Надсилаємо заявку…", "");
        return sendForm(fd);
      })
      .catch(function (err) {
        if (err && err.message === "too-big") return;
        form.classList.remove("is-loading");
        setStatus("Помилка мережі. Перевірте з'єднання та спробуйте ще раз.", "error");
      });

    function sendForm(fd) {
      return fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
        .then(function (res) {
          form.classList.remove("is-loading");
          if (res.ok) {
            showSuccess(name);
          } else {
            setStatus((res.data && res.data.error) || "Не вдалося надіслати. Спробуйте ще раз.", "error");
          }
        });
    }
  });

  function showSuccess(name) {
    form.innerHTML =
      '<div class="form__done">' +
      '<div class="done-ico">✓</div>' +
      "<h3>Дякуємо, " + escapeHtml(name) + "!</h3>" +
      "<p>Ваша заявка отримана. Ми переглянемо портфоліо та зв'яжемося з вами у Telegram найближчим часом.</p>" +
      "</div>";
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
