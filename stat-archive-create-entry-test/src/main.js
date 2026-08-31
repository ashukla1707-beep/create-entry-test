import "./style.css";
import { Camera, MediaTypeSelection } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { PDFDocument } from "pdf-lib";
import Sortable from "sortablejs";

const $ = (id) => document.getElementById(id);
const DB_NAME = "statArchiveCreateEntryTest";
const DB_VERSION = 1;
const STORE = "entries";
const EDITOR_MAX_EDGE = 900;

const state = {
  pages: [],
  busy: false,
  sortable: null,
  latestId: null,
  editor: null,
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, {
          keyPath: "id",
        });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);

      fn(store, resolve, reject);

      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function dbPut(record) {
  return withStore(
    "readwrite",
    (store, resolve) => {
      store.put(record);

      store.transaction.oncomplete =
        () => resolve();
    }
  );
}

async function dbGetAll() {
  return withStore(
    "readonly",
    (store, resolve, reject) => {
      const req = store.getAll();

      req.onsuccess =
        () => resolve(req.result || []);

      req.onerror =
        () => reject(req.error);
    }
  );
}

async function dbGet(id) {
  return withStore(
    "readonly",
    (store, resolve, reject) => {
      const req = store.get(id);

      req.onsuccess =
        () =>
          resolve(
            req.result || null
          );

      req.onerror =
        () => reject(req.error);
    }
  );
}

async function dbDelete(id) {
  return withStore(
    "readwrite",
    (store, resolve) => {
      store.delete(id);

      store.transaction.oncomplete =
        () => resolve();
    }
  );
}

async function dbClear() {
  return withStore(
    "readwrite",
    (store, resolve) => {
      store.clear();

      store.transaction.oncomplete =
        () => resolve();
    }
  );
}

function setError(msg = "") {
  $("errorBox").textContent =
    msg;

  $("errorBox").hidden =
    !msg;
}

function setProgress(
  percent,
  msg
) {
  $("progressWrap").hidden =
    false;

  $("progressBar").style.width =
    `${Math.max(
      0,
      Math.min(
        100,
        percent
      )
    )}%`;

  $("progressText").textContent =
    msg;
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;
}

function slug(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(
      /[^\w\s-]/g,
      ""
    )
    .replace(/_/g, "-")
    .replace(
      /\s+/g,
      "-"
    )
    .replace(
      /-+/g,
      "-"
    )
    .replace(
      /^-|-$/g,
      ""
    );
}

function filenameFor(
  subject,
  type,
  year
) {
  return [
    slug(subject) ||
      "Document",

    slug(type) ||
      "Paper",

    year,
  ]
    .filter(Boolean)
    .join("_") +
    ".pdf";
}

function bytesLabel(n) {
  if (n < 1024) {
    return `${n} B`;
  }

  if (
    n <
    1024 * 1024
  ) {
    return `${Math.round(
      n / 1024
    )} KB`;
  }

  return `${(
    n /
    1024 /
    1024
  ).toFixed(1)} MB`;
}

function validateForm() {
  const subject =
    $("subjectInput")
      .value
      .trim();

  const type =
    $("typeInput").value;

  const year =
    $("yearInput")
      .value
      .trim();

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

  if (
    !/^(19|20)\d{2}$/.test(
      year
    )
  ) {
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
    year,
  };
}

async function mediaResultToBlob(
  result
) {
  if (
    !result?.webPath
  ) {
    throw new Error(
      "The selected image could not be read."
    );
  }

  const response =
    await fetch(
      result.webPath
    );

  if (!response.ok) {
    throw new Error(
      "Couldn't read the selected photo."
    );
  }

  return response.blob();
}

function makePage(blob) {
  return {
    id: newId(),

    originalBlob:
      blob,

    blob,

    url:
      URL.createObjectURL(
        blob
      ),

    edit: {
      rotation: 0,

      filter:
        "original",

      crop: {
        x: 0.03,
        y: 0.03,
        w: 0.94,
        h: 0.94,
      },
    },
  };
}

async function capturePhoto() {
  setError("");

  const result =
    await Camera.takePhoto({
      quality: 90,

      targetWidth:
        2200,

      targetHeight:
        2200,

      correctOrientation:
        true,

      saveToGallery:
        false,

      includeMetadata:
        true,

      editable:
        "no",
    });

  const page =
    makePage(
      await mediaResultToBlob(
        result
      )
    );

  state.pages.push(
    page
  );

  renderPages();

  await openEditor(
    page.id
  );
}

async function chooseMultiplePhotos() {
  setError("");

  const {
    results,
  } =
    await Camera.chooseFromGallery(
      {
        mediaType:
          MediaTypeSelection.Photo,

        allowMultipleSelection:
          true,

        limit: 20,

        quality: 90,

        targetWidth:
          2200,

        targetHeight:
          2200,

        correctOrientation:
          true,

        includeMetadata:
          true,

        editable:
          "no",
      }
    );

  if (
    !results?.length
  ) {
    return;
  }

  const ids = [];

  for (
    const result
    of results
  ) {
    const page =
      makePage(
        await mediaResultToBlob(
          result
        )
      );

    state.pages.push(
      page
    );

    ids.push(
      page.id
    );
  }

  renderPages();

  await openEditor(
    ids[0]
  );
}

function installEditor() {
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
    .page-editor-backdrop[hidden],
    .sheet-backdrop[hidden] {
      display:none!important;
    }

    .page-editor-backdrop {
      position:fixed;
      inset:0;
      z-index:100000;
      background:#05080de8;
      display:flex;
      justify-content:center;
    }

    .page-editor {
      width:min(760px,100%);
      height:100dvh;
      background:#0c131c;
      color:#edf4fb;
      display:flex;
      flex-direction:column;
      padding-bottom:env(safe-area-inset-bottom);
    }

    .pe-head,
    .pe-controls {
      flex:0 0 auto;
      padding:10px 12px;
      background:#101923;
    }

    .pe-head {
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom:1px solid #263343;
    }

    .pe-stage {
      position:relative;
      flex:1;
      min-height:0;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:10px;
      overflow:hidden;
      background:#070b10;
      touch-action:none;
    }

    #peCanvas {
      display:block;
      max-width:100%;
      max-height:100%;
      box-shadow:0 10px 30px #0008;
    }

    #cropBox {
      position:absolute;
      border:2px solid #7de3f5;
      box-shadow:0 0 0 9999px #0007;
      touch-action:none;
    }

    .crop-handle {
      position:absolute;
      width:24px;
      height:24px;
      border-radius:50%;
      background:white;
      border:3px solid #7de3f5;
      z-index:2;
      touch-action:none;
    }

    [data-handle="nw"] {
      left:-13px;
      top:-13px;
    }

    [data-handle="ne"] {
      right:-13px;
      top:-13px;
    }

    [data-handle="sw"] {
      left:-13px;
      bottom:-13px;
    }

    [data-handle="se"] {
      right:-13px;
      bottom:-13px;
    }

    .pe-controls {
      border-top:1px solid #263343;
    }

    .pe-row {
      display:flex;
      gap:8px;
      overflow-x:auto;
      margin-bottom:8px;
    }

    .pe-row:last-child {
      margin-bottom:0;
    }

    .pe-row button {
      white-space:nowrap;
      padding:9px 11px;
    }

    .pe-filter.active,
    .pe-apply {
      background:#7de3f5!important;
      color:#041015!important;
      border-color:transparent!important;
      font-weight:800;
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
    >

      <div class="pe-head">

        <div>
          <strong id="peTitle">
            Edit page
          </strong>

          <div
            style="
              font-size:11px;
              color:#9aabba;
            "
          >
            Crop, rotate and enhance
          </div>
        </div>

        <button
          id="peCancel"
          type="button"
        >
          Cancel
        </button>

      </div>

      <div
        class="pe-stage"
        id="peStage"
      >

        <canvas
          id="peCanvas"
        ></canvas>

        <div id="cropBox">

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

      <div class="pe-controls">

        <div class="pe-row">

          <button
            id="rotL"
            type="button"
          >
            ↶ Left
          </button>

          <button
            id="rotR"
            type="button"
          >
            ↷ Right
          </button>

          <button
            id="peReset"
            type="button"
          >
            Reset
          </button>

        </div>

        <div
          class="pe-row"
          id="filterRow"
        >

          <button
            class="pe-filter"
            data-filter="original"
            type="button"
          >
            Original
          </button>

          <button
            class="pe-filter"
            data-filter="magic"
            type="button"
          >
            ✨ Magic
          </button>

          <button
            class="pe-filter"
            data-filter="grayscale"
            type="button"
          >
            Grayscale
          </button>

          <button
            class="pe-filter"
            data-filter="bw"
            type="button"
          >
            B&W
          </button>

        </div>

        <div class="pe-row">

          <button
            class="pe-apply"
            id="peApply"
            type="button"
          >
            Apply
          </button>

          <button
            class="pe-apply"
            id="peApplyNext"
            type="button"
          >
            Apply & next
          </button>

        </div>

      </div>

    </div>
  `;

  document.body.appendChild(
    overlay
  );

  $("peCancel").onclick =
    closeEditor;

  $("rotL").onclick =
    () =>
      rotateEditor(-90);

  $("rotR").onclick =
    () =>
      rotateEditor(90);

  $("peReset").onclick =
    resetEditor;

  $("peApply").onclick =
    () =>
      applyEditor(false);

  $("peApplyNext").onclick =
    () =>
      applyEditor(true);

  $("filterRow").onclick =
    (e) => {
      const btn =
        e.target.closest(
          "[data-filter]"
        );

      if (
        !btn ||
        !state.editor
      ) {
        return;
      }

      state.editor.filter =
        btn.dataset.filter;

      redrawEditor();
    };

  setupCropGestures();
}

async function openEditor(
  pageId
) {
  installEditor();

  const page =
    state.pages.find(
      (p) =>
        p.id === pageId
    );

  if (!page) {
    return;
  }

  state.editor?.bitmap
    ?.close?.();

  const bitmap =
    await createImageBitmap(
      page.originalBlob
    );

  state.editor = {
    pageId,

    bitmap,

    rotation:
      page.edit.rotation ||
      0,

    filter:
      page.edit.filter ||
      "original",

    crop: {
      ...(
        page.edit.crop || {
          x: 0.03,
          y: 0.03,
          w: 0.94,
          h: 0.94,
        }
      ),
    },
  };

  const index =
    state.pages.findIndex(
      (p) =>
        p.id === pageId
    );

  $("peTitle").textContent =
    `Edit page ${
      index + 1
    }`;

  $("peApplyNext").style.display =
    index <
    state.pages.length - 1
      ? "inline-flex"
      : "none";

  $("pageEditorOverlay")
    .hidden =
      false;

  document.body.style.overflow =
    "hidden";

  redrawEditor();
}

function closeEditor() {
  state.editor?.bitmap
    ?.close?.();

  state.editor =
    null;

  $("pageEditorOverlay")
    .hidden =
      true;

  document.body.style.overflow =
    "";
}

function rotateEditor(
  delta
) {
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
    h: 0.94,
  };

  redrawEditor();
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
    h: 0.94,
  };

  redrawEditor();
}

function drawRotated(
  ctx,
  bitmap,
  rotation,
  w,
  h
) {
  ctx.save();

  if (
    rotation === 90
  ) {
    ctx.translate(
      w,
      0
    );

    ctx.rotate(
      Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      h,
      w
    );

  } else if (
    rotation === 180
  ) {
    ctx.translate(
      w,
      h
    );

    ctx.rotate(
      Math.PI
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      w,
      h
    );

  } else if (
    rotation === 270
  ) {
    ctx.translate(
      0,
      h
    );

    ctx.rotate(
      -Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      h,
      w
    );

  } else {
    ctx.drawImage(
      bitmap,
      0,
      0,
      w,
      h
    );
  }

  ctx.restore();
}

function applyFilter(
  canvas,
  filter
) {
  if (
    filter ===
    "original"
  ) {
    return;
  }

  const ctx =
    canvas.getContext(
      "2d",
      {
        willReadFrequently:
          true,
      }
    );

  const image =
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const d =
    image.data;

  if (
    filter ===
    "grayscale"
  ) {
    for (
      let i = 0;
      i < d.length;
      i += 4
    ) {
      const lum =
        0.299 * d[i] +
        0.587 *
          d[i + 1] +
        0.114 *
          d[i + 2];

      d[i] =
        lum;

      d[i + 1] =
        lum;

      d[i + 2] =
        lum;
    }

  } else if (
    filter === "bw"
  ) {
    let sum = 0;
    let count = 0;

    for (
      let i = 0;
      i < d.length;
      i += 16
    ) {
      sum +=
        0.299 * d[i] +
        0.587 *
          d[i + 1] +
        0.114 *
          d[i + 2];

      count++;
    }

    const threshold =
      Math.max(
        125,
        Math.min(
          200,
          (
            sum /
            Math.max(
              1,
              count
            )
          ) * 0.96
        )
      );

    for (
      let i = 0;
      i < d.length;
      i += 4
    ) {
      const lum =
        0.299 * d[i] +
        0.587 *
          d[i + 1] +
        0.114 *
          d[i + 2];

      const v =
        lum >=
        threshold
          ? 255
          : 0;

      d[i] =
        v;

      d[i + 1] =
        v;

      d[i + 2] =
        v;
    }

  } else if (
    filter ===
    "magic"
  ) {
    /*
     * STRONGER DOCUMENT MAGIC FILTER
     *
     * - stronger white-paper cleanup
     * - darker writing
     * - reduced yellow/grey colour cast
     * - higher contrast
     */

    const histogram =
      new Uint32Array(
        256
      );

    let samples =
      0;

    for (
      let i = 0;
      i < d.length;
      i += 16
    ) {
      const lum =
        Math.max(
          0,
          Math.min(
            255,
            Math.round(
              0.299 * d[i] +
              0.587 *
                d[i + 1] +
              0.114 *
                d[i + 2]
            )
          )
        );

      histogram[lum]++;

      samples++;
    }

    const lowTarget =
      samples *
      0.02;

    const highTarget =
      samples *
      0.97;

    let low =
      0;

    let high =
      255;

    let count =
      0;

    for (
      let i = 0;
      i < 256;
      i++
    ) {
      count +=
        histogram[i];

      if (
        count >=
        lowTarget
      ) {
        low =
          i;

        break;
      }
    }

    count =
      0;

    for (
      let i = 0;
      i < 256;
      i++
    ) {
      count +=
        histogram[i];

      if (
        count >=
        highTarget
      ) {
        high =
          i;

        break;
      }
    }

    if (
      high - low <
      45
    ) {
      low =
        Math.max(
          0,
          low - 25
        );

      high =
        Math.min(
          255,
          high + 25
        );
    }

    const range =
      Math.max(
        1,
        high - low
      );

    for (
      let i = 0;
      i < d.length;
      i += 4
    ) {
      const r =
        d[i];

      const g =
        d[i + 1];

      const b =
        d[i + 2];

      const lum =
        Math.max(
          1,
          0.299 * r +
          0.587 * g +
          0.114 * b
        );

      let mapped =
        (
          (
            lum -
            low
          ) *
          255
        ) /
        range;

      mapped =
        Math.max(
          0,
          Math.min(
            255,
            mapped
          )
        );

      /*
       * Whiten paper strongly.
       */
      if (
        mapped >
        185
      ) {
        mapped =
          185 +
          (
            mapped -
            185
          ) *
          1.9;
      }

      /*
       * Darken handwriting / text.
       */
      if (
        mapped <
        105
      ) {
        mapped *=
          0.72;
      }

      if (
        mapped <
        55
      ) {
        mapped *=
          0.72;
      }

      mapped =
        Math.max(
          0,
          Math.min(
            255,
            mapped
          )
        );

      const scale =
        mapped /
        lum;

      let nr =
        r *
        scale;

      let ng =
        g *
        scale;

      let nb =
        b *
        scale;

      /*
       * Stronger desaturation.
       */
      const gray =
        (
          nr +
          ng +
          nb
        ) /
        3;

      nr =
        gray +
        (
          nr -
          gray
        ) *
        0.38;

      ng =
        gray +
        (
          ng -
          gray
        ) *
        0.38;

      nb =
        gray +
        (
          nb -
          gray
        ) *
        0.38;

      /*
       * Final contrast boost.
       */
      const contrast =
        1.18;

      nr =
        (
          nr -
          128
        ) *
        contrast +
        128;

      ng =
        (
          ng -
          128
        ) *
        contrast +
        128;

      nb =
        (
          nb -
          128
        ) *
        contrast +
        128;

      d[i] =
        Math.max(
          0,
          Math.min(
            255,
            nr
          )
        );

      d[i + 1] =
        Math.max(
          0,
          Math.min(
            255,
            ng
          )
        );

      d[i + 2] =
        Math.max(
          0,
          Math.min(
            255,
            nb
          )
        );
    }
  }

  ctx.putImageData(
    image,
    0,
    0
  );
}

function redrawEditor() {
  if (
    !state.editor
  ) {
    return;
  }

  const {
    bitmap,
    rotation,
    filter,
  } =
    state.editor;

  const rotated =
    rotation === 90 ||
    rotation === 270;

  const naturalW =
    rotated
      ? bitmap.height
      : bitmap.width;

  const naturalH =
    rotated
      ? bitmap.width
      : bitmap.height;

  /*
   * Faster editing preview.
   *
   * Final PDF still uses
   * the normal 1600px compression.
   */
  const scale =
    Math.min(
      1,
      EDITOR_MAX_EDGE /
        Math.max(
          naturalW,
          naturalH
        )
    );

  const w =
    Math.max(
      1,
      Math.round(
        naturalW *
        scale
      )
    );

  const h =
    Math.max(
      1,
      Math.round(
        naturalH *
        scale
      )
    );

  const canvas =
    $("peCanvas");

  canvas.width =
    w;

  canvas.height =
    h;

  const ctx =
    canvas.getContext(
      "2d",
      {
        alpha:
          false,

        willReadFrequently:
          true,
      }
    );

  ctx.fillStyle =
    "#fff";

  ctx.fillRect(
    0,
    0,
    w,
    h
  );

  drawRotated(
    ctx,
    bitmap,
    rotation,
    w,
    h
  );

  applyFilter(
    canvas,
    filter
  );

  document
    .querySelectorAll(
      ".pe-filter"
    )
    .forEach(
      (btn) => {
        btn.classList.toggle(
          "active",
          btn.dataset
            .filter ===
            filter
        );
      }
    );

  requestAnimationFrame(
    positionCropBox
  );
}

function positionCropBox() {
  if (
    !state.editor
  ) {
    return;
  }

  const stageRect =
    $("peStage")
      .getBoundingClientRect();

  const canvasRect =
    $("peCanvas")
      .getBoundingClientRect();

  const c =
    state.editor.crop;

  const box =
    $("cropBox");

  box.style.left =
    `${
      canvasRect.left -
      stageRect.left +
      c.x *
        canvasRect.width
    }px`;

  box.style.top =
    `${
      canvasRect.top -
      stageRect.top +
      c.y *
        canvasRect.height
    }px`;

  box.style.width =
    `${
      c.w *
      canvasRect.width
    }px`;

  box.style.height =
    `${
      c.h *
      canvasRect.height
    }px`;
}

function setupCropGestures() {
  const box =
    $("cropBox");

  let drag =
    null;

  box.addEventListener(
    "pointerdown",
    (e) => {
      if (
        !state.editor
      ) {
        return;
      }

      e.preventDefault();

      const rect =
        $("peCanvas")
          .getBoundingClientRect();

      drag = {
        id:
          e.pointerId,

        handle:
          e.target
            .closest(
              "[data-handle]"
            )
            ?.dataset
            .handle ||
          "move",

        x:
          e.clientX,

        y:
          e.clientY,

        crop: {
          ...state.editor.crop,
        },

        w:
          rect.width,

        h:
          rect.height,
      };

      box.setPointerCapture?.(
        e.pointerId
      );
    }
  );

  box.addEventListener(
    "pointermove",
    (e) => {
      if (
        !drag ||
        !state.editor ||
        e.pointerId !==
          drag.id
      ) {
        return;
      }

      e.preventDefault();

      const dx =
        (
          e.clientX -
          drag.x
        ) /
        Math.max(
          1,
          drag.w
        );

      const dy =
        (
          e.clientY -
          drag.y
        ) /
        Math.max(
          1,
          drag.h
        );

      const s =
        drag.crop;

      const min =
        0.08;

      let {
        x,
        y,
        w,
        h,
      } = s;

      if (
        drag.handle ===
        "move"
      ) {
        x =
          Math.max(
            0,
            Math.min(
              1 - w,
              s.x + dx
            )
          );

        y =
          Math.max(
            0,
            Math.min(
              1 - h,
              s.y + dy
            )
          );

      } else {

        if (
          drag.handle.includes(
            "w"
          )
        ) {
          const nx =
            Math.max(
              0,
              Math.min(
                s.x +
                  s.w -
                  min,
                s.x +
                  dx
              )
            );

          w =
            s.x +
            s.w -
            nx;

          x =
            nx;
        }

        if (
          drag.handle.includes(
            "e"
          )
        ) {
          w =
            Math.max(
              min,
              Math.min(
                1 -
                  s.x,
                s.w +
                  dx
              )
            );
        }

        if (
          drag.handle.includes(
            "n"
          )
        ) {
          const ny =
            Math.max(
              0,
              Math.min(
                s.y +
                  s.h -
                  min,
                s.y +
                  dy
              )
            );

          h =
            s.y +
            s.h -
            ny;

          y =
            ny;
        }

        if (
          drag.handle.includes(
            "s"
          )
        ) {
          h =
            Math.max(
              min,
              Math.min(
                1 -
                  s.y,
                s.h +
                  dy
              )
            );
        }
      }

      state.editor.crop = {
        x,
        y,
        w,
        h,
      };

      positionCropBox();
    }
  );

  const stop =
    (e) => {
      if (
        drag &&
        e.pointerId ===
          drag.id
      ) {
        drag =
          null;
      }
    };

  box.addEventListener(
    "pointerup",
    stop
  );

  box.addEventListener(
    "pointercancel",
    stop
  );
}

async function canvasToJpeg(
  canvas,
  quality = 0.82
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      canvas.toBlob(
        (blob) => {
          if (
            blob
          ) {
            resolve(
              blob
            );
          } else {
            reject(
              new Error(
                "Could not save edited page."
              )
            );
          }
        },

        "image/jpeg",

        quality
      );
    }
  );
}

async function applyEditor(
  openNext
) {
  if (
    !state.editor
  ) {
    return;
  }

  const index =
    state.pages.findIndex(
      (p) =>
        p.id ===
        state.editor.pageId
    );

  if (
    index <
    0
  ) {
    return;
  }

  const canvas =
    $("peCanvas");

  const c =
    state.editor.crop;

  const sx =
    Math.round(
      c.x *
      canvas.width
    );

  const sy =
    Math.round(
      c.y *
      canvas.height
    );

  const sw =
    Math.max(
      1,
      Math.round(
        c.w *
        canvas.width
      )
    );

  const sh =
    Math.max(
      1,
      Math.round(
        c.h *
        canvas.height
      )
    );

  const out =
    document.createElement(
      "canvas"
    );

  out.width =
    sw;

  out.height =
    sh;

  const ctx =
    out.getContext(
      "2d",
      {
        alpha:
          false,
      }
    );

  ctx.fillStyle =
    "#fff";

  ctx.fillRect(
    0,
    0,
    sw,
    sh
  );

  ctx.drawImage(
    canvas,

    sx,
    sy,
    sw,
    sh,

    0,
    0,
    sw,
    sh
  );

  /*
   * Lower quality than before
   * to make Apply & next faster.
   */
  const edited =
    await canvasToJpeg(
      out,
      0.82
    );

  const page =
    state.pages[index];

  URL.revokeObjectURL(
    page.url
  );

  page.blob =
    edited;

  page.url =
    URL.createObjectURL(
      edited
    );

  page.edit = {
    rotation:
      state.editor.rotation,

    filter:
      state.editor.filter,

    crop: {
      ...state.editor.crop,
    },
  };

  const nextId =
    openNext &&
    index <
      state.pages.length -
        1
      ? state.pages[
          index + 1
        ].id
      : null;

  closeEditor();

  renderPages();

  if (
    nextId
  ) {
    /*
     * Allow Android/WebView to repaint
     * before decoding the next image.
     *
     * This makes Apply & next feel
     * much less frozen.
     */
    await new Promise(
      (resolve) => {
        requestAnimationFrame(
          () => {
            requestAnimationFrame(
              resolve
            );
          }
        );
      }
    );

    await openEditor(
      nextId
    );
  }
}

function renderPages() {
  $("pageCount")
    .textContent =
      `${
        state.pages.length
      } ${
        state.pages.length ===
        1
          ? "page"
          : "pages"
      }`;

  $("generateBtn")
    .disabled =
      state.busy ||
      !state.pages.length;

  $("thumbStrip")
    .innerHTML =
      state.pages
        .map(
          (p, i) => `
            <div
              class="thumb"
              data-id="${p.id}"
            >

              <img
                src="${p.url}"
                alt="Page ${
                  i + 1
                }"
              >

              <div
                class="page-no"
              >
                ${i + 1}
              </div>

              <div
                class="thumb-actions"
              >

                <button
                  type="button"
                  data-act="edit"
                >
                  ✎
                </button>

                <button
                  type="button"
                  data-act="retake"
                >
                  ↻
                </button>

                <button
                  type="button"
                  data-act="delete"
                >
                  ✕
                </button>

              </div>

              <div
                class="drag"
              >
                ☰
              </div>

            </div>
          `
        )
        .join("") +

      `
        <button
          type="button"
          id="addMoreBtn"
          class="add-more"
        >
          ＋
          <span>
            Add page
          </span>
        </button>
      `;

  $("addMoreBtn")
    .onclick =
      showSource;

  state.sortable
    ?.destroy();

  state.sortable =
    new Sortable(
      $("thumbStrip"),
      {
        animation:
          160,

        draggable:
          ".thumb",

        handle:
          ".drag",

        ghostClass:
          "ghost",

        chosenClass:
          "chosen",

        onEnd(evt) {
          const a =
            evt.oldDraggableIndex;

          const b =
            evt.newDraggableIndex;

          if (
            a == null ||
            b == null ||
            a === b
          ) {
            return;
          }

          const [
            moved,
          ] =
            state.pages.splice(
              a,
              1
            );

          state.pages.splice(
            b,
            0,
            moved
          );

          renderPages();
        },
      }
    );
}

async function retake(
  id
) {
  const index =
    state.pages.findIndex(
      (p) =>
        p.id === id
    );

  if (
    index <
    0
  ) {
    return;
  }

  const result =
    await Camera.takePhoto({
      quality: 90,

      targetWidth:
        2200,

      targetHeight:
        2200,

      correctOrientation:
        true,

      saveToGallery:
        false,

      includeMetadata:
        true,

      editable:
        "no",
    });

  const blob =
    await mediaResultToBlob(
      result
    );

  const page =
    state.pages[index];

  URL.revokeObjectURL(
    page.url
  );

  page.originalBlob =
    blob;

  page.blob =
    blob;

  page.url =
    URL.createObjectURL(
      blob
    );

  page.edit = {
    rotation: 0,

    filter:
      "original",

    crop: {
      x: 0.03,
      y: 0.03,
      w: 0.94,
      h: 0.94,
    },
  };

  renderPages();

  await openEditor(
    id
  );
}

function resetComposer() {
  state.pages.forEach(
    (p) =>
      URL.revokeObjectURL(
        p.url
      )
  );

  state.pages =
    [];

  $("progressWrap")
    .hidden =
      true;

  $("progressBar")
    .style.width =
      "0%";

  setError("");

  $("createPanel")
    .hidden =
      false;

  $("successPanel")
    .hidden =
      true;

  renderPages();
}

async function compress(
  blob,
  maxWidth = 1600,
  quality = 0.7
) {
  const bitmap =
    await createImageBitmap(
      blob
    );

  try {
    let w =
      bitmap.width;

    let h =
      bitmap.height;

    if (
      w >
      maxWidth
    ) {
      const r =
        maxWidth /
        w;

      w =
        Math.round(
          w *
          r
        );

      h =
        Math.round(
          h *
          r
        );
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      w;

    canvas.height =
      h;

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha:
            false,
        }
      );

    ctx.fillStyle =
      "#fff";

    ctx.fillRect(
      0,
      0,
      w,
      h
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      w,
      h
    );

    return canvasToJpeg(
      canvas,
      quality
    );

  } finally {
    bitmap.close?.();
  }
}

async function generatePdf() {
  if (
    state.busy
  ) {
    return;
  }

  try {
    setError("");

    const {
      subject,
      type,
      year,
    } =
      validateForm();

    state.busy =
      true;

    $("generateBtn")
      .disabled =
        true;

    const pdf =
      await PDFDocument.create();

    const filename =
      filenameFor(
        subject,
        type,
        year
      );

    pdf.setTitle(
      filename.replace(
        /\.pdf$/i,
        ""
      ),
      {
        showInWindowTitleBar:
          true,
      }
    );

    pdf.setCreator(
      "Stat Archive Create Entry Test"
    );

    pdf.setProducer(
      "Stat Archive Create Entry Test"
    );

    pdf.setCreationDate(
      new Date()
    );

    for (
      let i = 0;
      i <
      state.pages.length;
      i++
    ) {
      setProgress(
        5 +
          (
            i /
            state.pages.length
          ) *
          55,

        `Compressing page ${
          i + 1
        } of ${
          state.pages.length
        }…`
      );

      const jpg =
        await compress(
          state.pages[i]
            .blob
        );

      const image =
        await pdf.embedJpg(
          await jpg
            .arrayBuffer()
        );

      const pageW =
        595;

      const pageH =
        pageW *
        image.height /
        image.width;

      const page =
        pdf.addPage([
          pageW,
          pageH,
        ]);

      page.drawImage(
        image,
        {
          x: 0,
          y: 0,

          width:
            pageW,

          height:
            pageH,
        }
      );
    }

    setProgress(
      72,
      "Finalizing PDF…"
    );

    const bytes =
      await pdf.save({
        useObjectStreams:
          true,
      });

    const blob =
      new Blob(
        [bytes],
        {
          type:
            "application/pdf",
        }
      );

    const id =
      newId();

    const record = {
      id,

      subject,

      type,

      year,

      filename,

      uploadedBy:
        "LOCAL TEST USER",

      uploadedAt:
        new Date()
          .toISOString(),

      size:
        blob.size,

      pdf:
        blob,
    };

    setProgress(
      88,
      "Saving to local test library…"
    );

    await dbPut(
      record
    );

    state.latestId =
      id;

    setProgress(
      100,
      "Saved locally"
    );

    $("createPanel")
      .hidden =
        true;

    $("successPanel")
      .hidden =
        false;

    $("successText")
      .textContent =
        `${filename} · ${
          bytesLabel(
            blob.size
          )
        } · ${
          state.pages.length
        } pages`;

    await renderLibrary();

  } catch (err) {
    console.error(
      err
    );

    setError(
      err?.message ||
      "Could not generate PDF."
    );

  } finally {
    state.busy =
      false;

    $("generateBtn")
      .disabled =
        !state.pages.length;
  }
}

function blobToBase64(
  blob
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader();

      reader.onloadend =
        () => {
          const s =
            String(
              reader.result ||
              ""
            );

          resolve(
            s.includes(",")
              ? s.split(
                  ","
                )[1]
              : s
          );
        };

      reader.onerror =
        () =>
          reject(
            new Error(
              "Could not prepare the PDF."
            )
          );

      reader.readAsDataURL(
        blob
      );
    }
  );
}

async function savePdfTemporarily(
  record
) {
  const result =
    await Filesystem.writeFile(
      {
        path:
          `test-pdfs/${record.filename}`,

        data:
          await blobToBase64(
            record.pdf
          ),

        directory:
          Directory.Cache,

        recursive:
          true,
      }
    );

  return result.uri;
}

async function viewRecord(
  id
) {
  try {
    const record =
      await dbGet(id);

    if (
      !record
    ) {
      throw new Error(
        "PDF not found."
      );
    }

    const uri =
      await savePdfTemporarily(
        record
      );

    await Share.share({
      title:
        record.filename,

      text:
        "Open this generated PDF",

      url:
        uri,

      dialogTitle:
        "Open PDF with",
    });

  } catch (err) {
    alert(
      err?.message ||
      "Could not open this PDF."
    );
  }
}

async function downloadRecord(
  id
) {
  try {
    const record =
      await dbGet(id);

    if (
      !record
    ) {
      throw new Error(
        "PDF not found."
      );
    }

    await Filesystem.writeFile(
      {
        path:
          record.filename,

        data:
          await blobToBase64(
            record.pdf
          ),

        directory:
          Directory.Documents,

        recursive:
          true,
      }
    );

    alert(
      `PDF saved successfully.\n\n${record.filename}`
    );

  } catch (err) {
    try {
      const record =
        await dbGet(id);

      if (
        !record
      ) {
        throw new Error(
          "PDF not found."
        );
      }

      const uri =
        await savePdfTemporarily(
          record
        );

      await Share.share({
        title:
          record.filename,

        text:
          "Save this generated PDF",

        url:
          uri,

        dialogTitle:
          "Save or share PDF",
      });

    } catch (e) {
      alert(
        e?.message ||
        "Could not save this PDF."
      );
    }
  }
}

async function renderLibrary() {
  const rows =
    (
      await dbGetAll()
    ).sort(
      (a, b) =>
        new Date(
          b.uploadedAt
        ) -
        new Date(
          a.uploadedAt
        )
    );

  if (
    !rows.length
  ) {
    $("libraryGrid")
      .innerHTML =
        `
          <div
            class="empty-library"
          >
            No test PDFs yet.
          </div>
        `;

    return;
  }

  $("libraryGrid")
    .innerHTML =
      rows
        .map(
          (r) => `
            <article
              class="card"
              data-id="${r.id}"
            >

              <div class="subject">
                ${r.subject}
              </div>

              <h3>
                ${r.filename}
              </h3>

              <div class="meta">
                ${r.type}
                ·
                ${r.year}
                ·
                ${bytesLabel(
                  r.size
                )}
              </div>

              <div class="meta">
                Uploaded by
                ${r.uploadedBy}
              </div>

              <div class="card-actions">

                <button
                  type="button"
                  data-act="view"
                >
                  View PDF
                </button>

                <button
                  type="button"
                  data-act="download"
                >
                  Download PDF
                </button>

                <button
                  type="button"
                  data-act="delete"
                >
                  Delete
                </button>

              </div>

            </article>
          `
        )
        .join("");
}

function showSource() {
  $("sourceSheet")
    .hidden =
      false;
}

function hideSource() {
  $("sourceSheet")
    .hidden =
      true;
}

installEditor();

$("addPhotosBtn")
  .onclick =
    showSource;

$("firstAddBtn")
  .onclick =
    showSource;

$("cancelSourceBtn")
  .onclick =
    hideSource;

$("cameraBtn")
  .onclick =
    async () => {
      hideSource();

      try {
        await capturePhoto();

      } catch (e) {
        if (
          !String(
            e?.message ||
            ""
          )
            .toLowerCase()
            .includes(
              "cancel"
            )
        ) {
          setError(
            e?.message ||
            "Camera failed."
          );
        }
      }
    };

$("galleryBtn")
  .onclick =
    async () => {
      hideSource();

      try {
        await chooseMultiplePhotos();

      } catch (e) {
        if (
          !String(
            e?.message ||
            ""
          )
            .toLowerCase()
            .includes(
              "cancel"
            )
        ) {
          setError(
            e?.message ||
            "Gallery selection failed."
          );
        }
      }
    };

$("thumbStrip")
  .addEventListener(
    "click",
    async (e) => {
      const thumb =
        e.target.closest(
          ".thumb"
        );

      if (
        !thumb
      ) {
        return;
      }

      const id =
        thumb.dataset.id;

      if (
        e.target.closest(
          '[data-act="edit"]'
        )
      ) {
        await openEditor(
          id
        );

        return;
      }

      if (
        e.target.closest(
          '[data-act="delete"]'
        )
      ) {
        const i =
          state.pages.findIndex(
            (p) =>
              p.id === id
          );

        if (
          i >= 0
        ) {
          URL.revokeObjectURL(
            state.pages[i]
              .url
          );

          state.pages.splice(
            i,
            1
          );

          renderPages();
        }

        return;
      }

      if (
        e.target.closest(
          '[data-act="retake"]'
        )
      ) {
        try {
          await retake(
            id
          );

        } catch (err) {
          if (
            !String(
              err?.message ||
              ""
            )
              .toLowerCase()
              .includes(
                "cancel"
              )
          ) {
            setError(
              err?.message ||
              "Retake failed."
            );
          }
        }
      }
    }
  );

$("generateBtn")
  .onclick =
    generatePdf;

$("addAnotherBtn")
  .onclick =
    resetComposer;

$("viewLibraryBtn")
  .onclick =
    () =>
      $("libraryPanel")
        .scrollIntoView({
          behavior:
            "smooth",

          block:
            "start",
        });

$("downloadLatestBtn")
  .onclick =
    () =>
      state.latestId &&
      downloadRecord(
        state.latestId
      );

$("libraryGrid")
  .addEventListener(
    "click",
    async (e) => {
      const card =
        e.target.closest(
          ".card"
        );

      if (
        !card
      ) {
        return;
      }

      const id =
        card.dataset.id;

      if (
        e.target.closest(
          '[data-act="view"]'
        )
      ) {
        await viewRecord(
          id
        );

        return;
      }

      if (
        e.target.closest(
          '[data-act="download"]'
        )
      ) {
        await downloadRecord(
          id
        );

        return;
      }

      if (
        e.target.closest(
          '[data-act="delete"]'
        )
      ) {
        await dbDelete(
          id
        );

        await renderLibrary();
      }
    }
  );

$("clearLibraryBtn")
  .onclick =
    async () => {
      if (
        !confirm(
          "Delete every PDF from this local TEST library?"
        )
      ) {
        return;
      }

      await dbClear();

      await renderLibrary();
    };

renderLibrary();
