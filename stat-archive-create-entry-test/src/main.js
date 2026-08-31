import "./style.css";

import {
  Camera,
  CameraResultType,
  CameraSource
} from "@capacitor/camera";

import {
  Filesystem,
  Directory
} from "@capacitor/filesystem";

import {
  Share
} from "@capacitor/share";

import {
  PDFDocument
} from "pdf-lib";

import Sortable from "sortablejs";
const $ = (id) => document.getElementById(id);

const state = {
  pages: [],
  busy: false,
  sortable: null,
  latestId: null
};

const DB_NAME = "statArchiveCreateEntryTest";
const DB_VERSION = 1;
const STORE = "entries";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function dbGetAll() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

async function dbGet(id) {
  const db = await openDb();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row;
}

async function dbDelete(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function dbClear() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function setError(msg = "") {
  $("errorBox").textContent = msg;
  $("errorBox").hidden = !msg;
}

function setProgress(pct, msg) {
  $("progressWrap").hidden = false;
  $("progressBar").style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $("progressText").textContent = msg;
}

function slug(s) {
  return String(s || "")
    .trim()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function filenameFor(subject, type, year) {
  return [slug(subject) || "Document", slug(type) || "Paper", year].filter(Boolean).join("_") + ".pdf";
}

function bytesLabel(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function validateForm() {
  const subject = $("subjectInput").value.trim();
  const type = $("typeInput").value;
  const year = $("yearInput").value.trim();

  if (!subject) throw new Error("Choose or enter a subject.");
  if (!type) throw new Error("Choose a paper type.");
  if (!/^(19|20)\d{2}$/.test(year)) throw new Error("Enter a valid 4-digit year.");
  if (!state.pages.length) throw new Error("Add at least one photo.");
  return { subject, type, year };
}

async function photoToBlob(photo) {
  if (photo.webPath) {
    const res = await fetch(photo.webPath);
    if (!res.ok) throw new Error("Couldn't read the selected photo.");
    return await res.blob();
  }
  if (photo.dataUrl) return await (await fetch(photo.dataUrl)).blob();
  throw new Error("Camera did not return a readable image.");
}

async function pickPhoto(source) {
  setError("");
  const photo = await Camera.getPhoto({
    source,
    resultType: CameraResultType.Uri,
    quality: 90,
    width: 2200,
    correctOrientation: true,
    allowEditing: false,
    saveToGallery: false
  });
  const blob = await photoToBlob(photo);
  state.pages.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`,
    blob,
    url: URL.createObjectURL(blob)
  });
  renderPages();
}

async function compress(blob, maxWidth = 1600, quality = 0.70) {
  const bmp = await createImageBitmap(blob);
  try {
    let w = bmp.width, h = bmp.height;
    if (w > maxWidth) {
      const r = maxWidth / w;
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((resolve, reject) =>
      c.toBlob(b => b ? resolve(b) : reject(new Error("Compression failed.")), "image/jpeg", quality)
    );
    return out;
  } finally {
    bmp.close?.();
  }
}

function renderPages() {
  $("pageCount").textContent = `${state.pages.length} ${state.pages.length === 1 ? "page" : "pages"}`;
  $("generateBtn").disabled = state.busy || !state.pages.length;

  $("thumbStrip").innerHTML = state.pages.map((p, i) => `
    <div class="thumb" data-id="${p.id}">
      <img src="${p.url}" alt="Page ${i + 1}">
      <div class="page-no">${i + 1}</div>
      <div class="thumb-actions">
        <button type="button" data-act="retake" aria-label="Retake">↻</button>
        <button type="button" data-act="delete" aria-label="Delete">✕</button>
      </div>
      <div class="drag" aria-label="Drag to reorder">☰</div>
    </div>
  `).join("") + `<button type="button" id="addMoreBtn" class="add-more">＋<span>Add page</span></button>`;

  $("addMoreBtn").onclick = showSource;

  state.sortable?.destroy();
  state.sortable = new Sortable($("thumbStrip"), {
    animation: 160,
    draggable: ".thumb",
    handle: ".drag",
    ghostClass: "ghost",
    chosenClass: "chosen",
    onEnd(evt) {
      const oldIndex = evt.oldDraggableIndex;
      const newIndex = evt.newDraggableIndex;
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
      const [moved] = state.pages.splice(oldIndex, 1);
      state.pages.splice(newIndex, 0, moved);
      renderPages();
    }
  });
}

async function retake(id) {
  const idx = state.pages.findIndex(p => p.id === id);
  if (idx < 0) return;
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 90,
    width: 2200,
    correctOrientation: true,
    allowEditing: false,
    saveToGallery: false
  });
  const blob = await photoToBlob(photo);
  URL.revokeObjectURL(state.pages[idx].url);
  state.pages[idx] = { ...state.pages[idx], blob, url: URL.createObjectURL(blob) };
  renderPages();
}

function resetComposer() {
  state.pages.forEach(p => URL.revokeObjectURL(p.url));
  state.pages = [];
  $("progressWrap").hidden = true;
  $("progressBar").style.width = "0%";
  setError("");
  $("createPanel").hidden = false;
  $("successPanel").hidden = true;
  renderPages();
}

async function generatePdf() {
  if (state.busy) return;
  try {
    setError("");
    const { subject, type, year } = validateForm();
    state.busy = true;
    $("generateBtn").disabled = true;

    const pdf = await PDFDocument.create();
    const filename = filenameFor(subject, type, year);
    pdf.setTitle(filename.replace(/\.pdf$/i, ""), { showInWindowTitleBar: true });
    pdf.setCreator("Stat Archive Create Entry Test");
    pdf.setProducer("Stat Archive Create Entry Test");
    pdf.setCreationDate(new Date());

    for (let i = 0; i < state.pages.length; i++) {
      setProgress(5 + (i / state.pages.length) * 55, `Compressing page ${i + 1} of ${state.pages.length}…`);
      const jpgBlob = await compress(state.pages[i].blob, 1600, 0.70);
      const image = await pdf.embedJpg(await jpgBlob.arrayBuffer());

      const pageW = 595;
      const pageH = pageW * image.height / image.width;
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
    }

    setProgress(72, "Finalizing PDF…");
    const bytes = await pdf.save({ useObjectStreams: true });
    const blob = new Blob([bytes], { type: "application/pdf" });

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
    const record = {
      id,
      subject,
      type,
      year,
      filename,
      uploadedBy: "LOCAL TEST USER",
      uploadedAt: new Date().toISOString(),
      size: blob.size,
      pdf: blob
    };

    setProgress(88, "Saving to local test library…");
    await dbPut(record);
    state.latestId = id;

    setProgress(100, "Saved locally");
    $("createPanel").hidden = true;
    $("successPanel").hidden = false;
    $("successText").textContent = `${filename} · ${bytesLabel(blob.size)} · ${state.pages.length} pages`;
    await renderLibrary();
  } catch (err) {
    console.error(err);
    setError(err?.message || "Could not generate PDF.");
  } finally {
    state.busy = false;
    $("generateBtn").disabled = !state.pages.length;
  }
}

async function downloadRecord(id) {
  const r = await dbGet(id);
  if (!r) return;
  const url = URL.createObjectURL(r.pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function viewRecord(id) {
  const r = await dbGet(id);
  if (!r) return;
  const url = URL.createObjectURL(r.pdf);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function renderLibrary() {
  const rows = (await dbGetAll()).sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  if (!rows.length) {
    $("libraryGrid").innerHTML = `<div class="empty-library">No test PDFs yet.</div>`;
    return;
  }
  $("libraryGrid").innerHTML = rows.map(r => `
    <article class="card" data-id="${r.id}">
      <div class="subject">${r.subject}</div>
      <h3>${r.filename}</h3>
      <div class="meta">${r.type} · ${r.year} · ${bytesLabel(r.size)}</div>
      <div class="meta">Uploaded by ${r.uploadedBy}</div>
      <div class="card-actions">
        <button type="button" data-act="view">View PDF</button>
        <button type="button" data-act="download">Download PDF</button>
        <button type="button" data-act="delete">Delete</button>
      </div>
    </article>
  `).join("");
}

function showSource() { $("sourceSheet").hidden = false; }
function hideSource() { $("sourceSheet").hidden = true; }

$("addPhotosBtn").onclick = showSource;
$("firstAddBtn").onclick = showSource;
$("cancelSourceBtn").onclick = hideSource;

$("cameraBtn").onclick = async () => {
  hideSource();
  try { await pickPhoto(CameraSource.Camera); }
  catch (e) {
    if (!String(e?.message || "").toLowerCase().includes("cancel")) setError(e?.message || "Camera failed.");
  }
};

$("galleryBtn").onclick = async () => {
  hideSource();
  try { await pickPhoto(CameraSource.Photos); }
  catch (e) {
    if (!String(e?.message || "").toLowerCase().includes("cancel")) setError(e?.message || "Gallery failed.");
  }
};

$("thumbStrip").addEventListener("click", async (e) => {
  const thumb = e.target.closest(".thumb");
  if (!thumb) return;
  const id = thumb.dataset.id;
  if (e.target.closest('[data-act="delete"]')) {
    const idx = state.pages.findIndex(p => p.id === id);
    if (idx >= 0) {
      URL.revokeObjectURL(state.pages[idx].url);
      state.pages.splice(idx, 1);
      renderPages();
    }
  } else if (e.target.closest('[data-act="retake"]')) {
    try { await retake(id); }
    catch (err) {
      if (!String(err?.message || "").toLowerCase().includes("cancel")) setError(err?.message || "Retake failed.");
    }
  }
});

$("generateBtn").onclick = generatePdf;
$("addAnotherBtn").onclick = resetComposer;
$("viewLibraryBtn").onclick = () => $("libraryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
$("downloadLatestBtn").onclick = () => state.latestId && downloadRecord(state.latestId);

$("libraryGrid").addEventListener("click", async (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-act="view"]')) await viewRecord(id);
  if (e.target.closest('[data-act="download"]')) await downloadRecord(id);
  if (e.target.closest('[data-act="delete"]')) {
    await dbDelete(id);
    await renderLibrary();
  }
});

$("clearLibraryBtn").onclick = async () => {
  if (!confirm("Delete every PDF from this local TEST library?")) return;
  await dbClear();
  await renderLibrary();
};

renderLibrary();
