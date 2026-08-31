import "./style.css";

import {
  Camera,
  MediaTypeSelection
} from "@capacitor/camera";

import {
  Filesystem,
  Directory
} from "@capacitor/filesystem";

import { Share } from "@capacitor/share";
import { PDFDocument } from "pdf-lib";
import Sortable from "sortablejs";

const $ = (id) => document.getElementById(id);

const state = {
  pages: [],
  busy: false,
  sortable: null,
  latestId: null,
  editor: null
};

const DB_NAME = "statArchiveCreateEntryTest";
const DB_VERSION = 1;
const STORE = "entries";
const MAX_EDITOR_EDGE = 1600;


/* ============================================================
   LOCAL TEST LIBRARY
   ============================================================ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, {
          keyPath: "id"
        });
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


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function setError(msg = "") {
  $("errorBox").textContent = msg;
  $("errorBox").hidden = !msg;
}


function setProgress(pct, msg) {
  $("progressWrap").hidden = false;

  $("progressBar").style.width =
    `${Math.max(0, Math.min(100, pct))}%`;

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
  return [
    slug(subject) || "Document",
    slug(type) || "Paper",
    year
  ]
    .filter(Boolean)
    .join("_") + ".pdf";
}


function bytesLabel(n) {
  if (n < 1024) {
    return `${n} B`;
  }

  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`;
  }

  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}


function validateForm() {
  const subject =
    $("subjectInput").value.trim();

  const type =
    $("typeInput").value;

  const year =
    $("yearInput").value.trim();

  if (!subject) {
    throw new Error(
      "Choose or enter a subject."
    );
  }

  if (!type) {
    throw new Error(
      "Choose a paper type."
    );
  }

  if (!/^(19|20)\d{2}$/.test(year)) {
    throw new Error(
      "Enter a valid 4-digit year."
    );
  }

  if (!state.pages.length) {
    throw new Error(
      "Add at least one photo."
    );
  }

  return {
    subject,
    type,
    year
  };
}


function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;
}


function makePage(blob) {
  return {
    id: newId(),

    originalBlob: blob,

    blob,

    url:
      URL.createObjectURL(blob),

    edit: {
      rotation: 0,

      filter: "original",

      crop: {
        x: 0.03,
        y: 0.03,
        w: 0.94,
        h: 0.94
      }
    }
  };
}


async function mediaResultToBlob(result) {
  if (!result?.webPath) {
    throw new Error(
      "The selected image could not be read."
    );
  }

  const response =
    await fetch(result.webPath);

  if (!response.ok) {
    throw new Error(
      "Couldn't read one of the selected photos."
    );
  }

  return await response.blob();
}


/* ============================================================
   CAMERA + MULTI-SELECT GALLERY
   ============================================================ */

async function capturePhoto() {
  setError("");

  const result =
    await Camera.takePhoto({
      quality: 90,

      targetWidth: 2200,
      targetHeight: 2200,

      correctOrientation: true,

      saveToGallery: false,

      includeMetadata: true,

      editable: "no"
    });

  const blob =
    await mediaResultToBlob(
      result
    );

  const page =
    makePage(blob);

  state.pages.push(page);

  renderPages();

  await openPageEditor(
    page.id
  );
}


async function chooseMultiplePhotos() {
  setError("");

  const {
    results
  } =
    await Camera.chooseFromGallery({
      mediaType:
        MediaTypeSelection.Photo,

      allowMultipleSelection: true,

      limit: 20,

      quality: 90,

      targetWidth: 2200,
      targetHeight: 2200,

      correctOrientation: true,

      includeMetadata: true,

      editable: "no"
    });

  if (!results?.length) {
    return;
  }

  const addedIds = [];

  for (
    const result
    of results
  ) {
    const blob =
      await mediaResultToBlob(
        result
      );

    const page =
      makePage(blob);

    state.pages.push(page);

    addedIds.push(
      page.id
    );
  }

  renderPages();

  /*
   * Open the first selected page
   * immediately in the editor.
   *
   * Apply & next lets you edit the
   * rest one after another.
   */
  if (addedIds.length) {
    await openPageEditor(
      addedIds[0]
    );
  }
}


/* ============================================================
   PAGE EDITOR UI

   Crop
   Rotate
   Original
   Magic
   Grayscale
   B&W
   ============================================================ */

function installEditorUI() {
  if (
    $("pageEditorOverlay")
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.textContent = `

    .sheet-backdrop[hidden],
    .page-editor-backdrop[hidden] {
      display: none !important;
    }


    .page-editor-backdrop {
      position: fixed;

      inset: 0;

      z-index: 100000;

      background: #05080dcc;

      display: flex;

      align-items: stretch;
      justify-content: center;

      padding:
        env(safe-area-inset-top)
        0
        env(safe-area-inset-bottom);

      backdrop-filter:
        blur(5px);
    }


    .page-editor {
      width:
        min(760px, 100%);

      height: 100%;

      display: flex;

      flex-direction:
        column;

      background:
        #0c131c;

      color:
        #edf4fb;
    }


    .page-editor-head {
      display: flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap: 12px;

      padding:
        12px 14px;

      border-bottom:
        1px solid #263343;

      flex:
        0 0 auto;
    }


    .page-editor-head strong {
      font-size:
        15px;
    }


    .page-editor-head small {
      display:
        block;

      color:
        #9aabba;

      margin-top:
        2px;
    }


    .page-editor-head button {
      padding:
        8px 11px;
    }


    .page-editor-stage {
      position:
        relative;

      flex:
        1 1 auto;

      min-height:
        0;

      display:
        flex;

      align-items:
        center;

      justify-content:
        center;

      padding:
        12px;

      overflow:
        hidden;

      background:
        #070b10;

      touch-action:
        none;
    }


    #pageEditorCanvas {
      display:
        block;

      max-width:
        100%;

      max-height:
        100%;

      box-shadow:
        0 12px 40px #0008;
    }


    .crop-box {
      position:
        absolute;

      border:
        2px solid #7de3f5;

      box-shadow:
        0 0 0 9999px #0006;

      touch-action:
        none;

      cursor:
        move;
    }


    .crop-box:before,
    .crop-box:after {
      content: "";

      position:
        absolute;

      pointer-events:
        none;
    }


    .crop-box:before {
      left:
        33.333%;

      right:
        33.333%;

      top:
        0;

      bottom:
        0;

      border-left:
        1px solid #7de3f5;

      border-right:
        1px solid #7de3f5;
    }


    .crop-box:after {
      top:
        33.333%;

      bottom:
        33.333%;

      left:
        0;

      right:
        0;

      border-top:
        1px solid #7de3f5;

      border-bottom:
        1px solid #7de3f5;
    }


    .crop-handle {
      position:
        absolute;

      width:
        22px;

      height:
        22px;

      border-radius:
        50%;

      background:
        #fff;

      border:
        3px solid #7de3f5;

      z-index:
        2;

      touch-action:
        none;
    }


    .crop-handle[data-handle="nw"] {
      left:
        -12px;

      top:
        -12px;
    }


    .crop-handle[data-handle="ne"] {
      right:
        -12px;

      top:
        -12px;
    }


    .crop-handle[data-handle="sw"] {
      left:
        -12px;

      bottom:
        -12px;
    }


    .crop-handle[data-handle="se"] {
      right:
        -12px;

      bottom:
        -12px;
    }


    .page-editor-controls {
      flex:
        0 0 auto;

      border-top:
        1px solid #263343;

      background:
        #101923;

      padding:
        10px 12px 12px;

      overflow-x:
        hidden;
    }


    .editor-row {
      display:
        flex;

      gap:
        8px;

      align-items:
        center;

      margin-bottom:
        9px;

      overflow-x:
        auto;

      padding-bottom:
        2px;
    }


    .editor-row:last-child {
      margin-bottom:
        0;
    }


    .editor-row button {
      white-space:
        nowrap;

      padding:
        9px 11px;
    }


    .editor-filter.active {
      background:
        #7de3f5;

      color:
        #041015;

      border-color:
        transparent;

      font-weight:
        800;
    }


    .editor-apply {
      background:
        #7de3f5 !important;

      color:
        #041015 !important;

      border-color:
        transparent !important;

      font-weight:
        800;
    }


    .editor-next {
      background:
        #7ee0a9 !important;

      color:
        #041015 !important;

      border-color:
        transparent !important;

      font-weight:
        800;
    }


    .editor-tip {
      color:
        #9aabba;

      font-size:
        11px;

      margin:
        0 0 8px;

      line-height:
        1.4;
    }


    .thumb-edit {
      background:
        #000c !important;
    }


    @media
    (max-width: 520px) {

      .page-editor-head {
        padding:
          10px 11px;
      }

      .page-editor-stage {
        padding:
          8px;
      }

      .page-editor-controls {
        padding:
          9px;
      }

      .editor-row button {
        padding:
          9px 10px;

        font-size:
          12px;
      }

    }

  `;

  document.head.appendChild(
    style
  );


  const overlay =
    document.createElement(
      "div"
    );

  overlay.id =
    "pageEditorOverlay";

  overlay.className =
    "page-editor-backdrop";

  overlay.hidden =
    true;


  overlay.innerHTML = `

    <div
      class="page-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pageEditorTitle"
    >

      <div
        class="page-editor-head"
      >

        <div>

          <strong
            id="pageEditorTitle"
          >
            Edit page
          </strong>

          <small
            id="pageEditorSubtitle"
          >
            Drag the corners to crop
          </small>

        </div>


        <button
          type="button"
          id="pageEditorCancelBtn"
        >
          Cancel
        </button>

      </div>


      <div
        class="page-editor-stage"
        id="pageEditorStage"
      >

        <canvas
          id="pageEditorCanvas"
        ></canvas>


        <div
          class="crop-box"
          id="pageEditorCropBox"
        >

          <span
            class="crop-handle"
            data-handle="nw"
          ></span>

          <span
            class="crop-handle"
            data-handle="ne"
          ></span>

          <span
            class="crop-handle"
            data-handle="sw"
          ></span>

          <span
            class="crop-handle"
            data-handle="se"
          ></span>

        </div>

      </div>


      <div
        class="page-editor-controls"
      >

        <p
          class="editor-tip"
        >
          Crop the paper, rotate if needed,
          then choose a document filter.
        </p>


        <div
          class="editor-row"
        >

          <button
            type="button"
            id="rotateLeftBtn"
          >
            ↶ Rotate left
          </button>

          <button
            type="button"
            id="rotateRightBtn"
          >
            ↷ Rotate right
          </button>

          <button
            type="button"
            id="editorResetBtn"
          >
            Reset
          </button>

        </div>


        <div
          class="editor-row"
          id="editorFilterRow"
        >

          <button
            type="button"
            class="editor-filter"
            data-filter="original"
          >
            Original
          </button>

          <button
            type="button"
            class="editor-filter"
            data-filter="magic"
          >
            ✨ Magic
          </button>

          <button
            type="button"
            class="editor-filter"
            data-filter="grayscale"
          >
            Grayscale
          </button>

          <button
            type="button"
            class="editor-filter"
            data-filter="bw"
          >
            B&amp;W
          </button>

        </div>


        <div
          class="editor-row"
        >

          <button
            type="button"
            id="editorApplyBtn"
            class="editor-apply"
          >
            Apply
          </button>

          <button
            type="button"
            id="editorApplyNextBtn"
            class="editor-next"
          >
            Apply &amp; next
          </button>

        </div>

      </div>

    </div>

  `;


  document.body.appendChild(
    overlay
  );


  $("pageEditorCancelBtn")
    .onclick =
      closePageEditor;


  $("rotateLeftBtn")
    .onclick =
      () =>
        rotateEditor(-90);


  $("rotateRightBtn")
    .onclick =
      () =>
        rotateEditor(90);


  $("editorResetBtn")
    .onclick =
      resetEditor;


  $("editorApplyBtn")
    .onclick =
      () =>
        applyEditor(false);


  $("editorApplyNextBtn")
    .onclick =
      () =>
        applyEditor(true);


  $("editorFilterRow")
    .addEventListener(
      "click",
      (event) => {

        const btn =
          event.target.closest(
            "[data-filter]"
          );

        if (
          !btn ||
          !state.editor
        ) {
          return;
        }

        state.editor.filter =
          btn.dataset.filter ||
          "original";

        redrawEditor(false);
      }
    );


  setupCropGestures();


  window.addEventListener(
    "resize",
    () => {

      if (
        state.editor &&
        !$(
          "pageEditorOverlay"
        ).hidden
      ) {
        positionCropBox();
      }

    }
  );
}


async function openPageEditor(
  pageId
) {
  installEditorUI();

  const page =
    state.pages.find(
      (p) =>
        p.id === pageId
    );

  if (!page) {
    return;
  }


  if (
    state.editor?.bitmap
  ) {
    state.editor.bitmap
      .close?.();
  }


  const bitmap =
    await createImageBitmap(
      page.originalBlob ||
      page.blob
    );


  const saved =
    page.edit || {};


  state.editor = {
    pageId,

    bitmap,

    rotation:
      Number(
        saved.rotation ||
        0
      ),

    filter:
      saved.filter ||
      "original",

    crop:
      saved.crop

        ? {
            ...saved.crop
          }

        : {
            x: 0.03,
            y: 0.03,
            w: 0.94,
            h: 0.94
          }
  };


  const index =
    state.pages.findIndex(
      (p) =>
        p.id === pageId
    );


  $("pageEditorTitle")
    .textContent =
      `Edit page ${index + 1}`;


  $("editorApplyNextBtn")
    .style.display =

      index <
      state.pages.length - 1

        ? "inline-flex"

        : "none";


  $("pageEditorOverlay")
    .hidden =
      false;


  document.body.style
    .overflow =
      "hidden";


  await redrawEditor(
    false
  );
}


function closePageEditor() {
  if (
    state.editor?.bitmap
  ) {
    state.editor.bitmap
      .close?.();
  }

  state.editor =
    null;

  $("pageEditorOverlay")
    .hidden =
      true;

  document.body.style
    .overflow =
      "";
}


function rotateEditor(delta) {
  if (!state.editor) {
    return;
  }

  state.editor.rotation =
    (
      state.editor.rotation +
      delta +
      360
    ) % 360;


  state.editor.crop = {
    x: 0.03,
    y: 0.03,
    w: 0.94,
    h: 0.94
  };


  redrawEditor(false);
}


function resetEditor() {
  if (!state.editor) {
    return;
  }

  state.editor.rotation =
    0;

  state.editor.filter =
    "original";

  state.editor.crop = {
    x: 0.03,
    y: 0.03,
    w: 0.94,
    h: 0.94
  };

  redrawEditor(false);
}


/* ============================================================
   ROTATION
   ============================================================ */

function drawOrientedBitmap(
  ctx,
  bitmap,
  rotation,
  targetW,
  targetH
) {
  ctx.save();


  if (rotation === 90) {

    ctx.translate(
      targetW,
      0
    );

    ctx.rotate(
      Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      targetH,
      targetW
    );

  } else if (
    rotation === 180
  ) {

    ctx.translate(
      targetW,
      targetH
    );

    ctx.rotate(
      Math.PI
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      targetW,
      targetH
    );

  } else if (
    rotation === 270
  ) {

    ctx.translate(
      0,
      targetH
    );

    ctx.rotate(
      -Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      targetH,
      targetW
    );

  } else {

    ctx.drawImage(
      bitmap,
      0,
      0,
      targetW,
      targetH
    );

  }


  ctx.restore();
}


/* ============================================================
   DOCUMENT FILTERS

   Original
   Magic
   Grayscale
   B&W
   ============================================================ */

function applyDocumentFilter(
  canvas,
  filter
) {
  if (
    filter === "original"
  ) {
    return;
  }


  const ctx =
    canvas.getContext(
      "2d",
      {
    
