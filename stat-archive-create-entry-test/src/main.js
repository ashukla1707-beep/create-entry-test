import "./style.css";
import { Camera, MediaTypeSelection } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileViewer } from "@capacitor/file-viewer";
import { Share } from "@capacitor/share";
import { PDFDocument } from "pdf-lib";
import Sortable from "sortablejs";

const $ = (id) => document.getElementById(id);

const DB_NAME = "statArchiveCreateEntryTest";
const DB_VERSION = 1;
const STORE = "entries";

const EDITOR_MAX_EDGE = 1200;
const FINAL_MAX_EDGE = 2000;

const state = {
  pages: [],
  busy: false,
  sortable: null,
  latestId: null,
  editor: null,
  editorRedrawTimer: null,
};

const DEMO_SUBJECTS = [
  "Advanced Machine Learning",
  "Mathematical Statistics",
  "Probability Theory",
  "Sampling Theory",
  "Linear Models",
  "Statistical Inference",
  "Multivariate Analysis",
  "Design of Experiments",
  "Time Series",
  "Econometrics",
];

/* ============================================================
   LOCAL TEST LIBRARY
   ============================================================ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req =
      indexedDB.open(
        DB_NAME,
        DB_VERSION
      );

    req.onupgradeneeded =
      () => {
        const db =
          req.result;

        if (
          !db.objectStoreNames.contains(
            STORE
          )
        ) {
          db.createObjectStore(
            STORE,
            {
              keyPath: "id",
            }
          );
        }
      };

    req.onsuccess =
      () =>
        resolve(
          req.result
        );

    req.onerror =
      () =>
        reject(
          req.error
        );
  });
}

async function withStore(
  mode,
  fn
) {
  const db =
    await openDb();

  try {
    return await new Promise(
      (
        resolve,
        reject
      ) => {
        const tx =
          db.transaction(
            STORE,
            mode
          );

        fn(
          tx.objectStore(
            STORE
          ),
          resolve,
          reject,
          tx
        );

        tx.onerror =
          () =>
            reject(
              tx.error
            );
      }
    );

  } finally {
    db.close();
  }
}

async function dbPut(
  record
) {
  return withStore(
    "readwrite",
    (
      store,
      resolve,
      reject,
      tx
    ) => {
      store.put(
        record
      );

      tx.oncomplete =
        () =>
          resolve();

      tx.onabort =
        () =>
          reject(
            tx.error
          );
    }
  );
}

async function dbGetAll() {
  return withStore(
    "readonly",
    (
      store,
      resolve,
      reject
    ) => {
      const req =
        store.getAll();

      req.onsuccess =
        () =>
          resolve(
            req.result ||
              []
          );

      req.onerror =
        () =>
          reject(
            req.error
          );
    }
  );
}

async function dbGet(id) {
  return withStore(
    "readonly",
    (
      store,
      resolve,
      reject
    ) => {
      const req =
        store.get(id);

      req.onsuccess =
        () =>
          resolve(
            req.result ||
              null
          );

      req.onerror =
        () =>
          reject(
            req.error
          );
    }
  );
}

async function dbDelete(id) {
  return withStore(
    "readwrite",
    (
      store,
      resolve,
      reject,
      tx
    ) => {
      store.delete(id);

      tx.oncomplete =
        () =>
          resolve();

      tx.onabort =
        () =>
          reject(
            tx.error
          );
    }
  );
}

async function dbClear() {
  return withStore(
    "readwrite",
    (
      store,
      resolve,
      reject,
      tx
    ) => {
      store.clear();

      tx.oncomplete =
        () =>
          resolve();

      tx.onabort =
        () =>
          reject(
            tx.error
          );
    }
  );
}

/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function setError(
  msg = ""
) {
  $("errorBox")
    .textContent =
      msg;

  $("errorBox")
    .hidden =
      !msg;
}

function setProgress(
  percent,
  msg
) {
  $("progressWrap")
    .hidden =
      false;

  $("progressBar")
    .style.width =
      `${
        Math.max(
          0,
          Math.min(
            100,
            percent
          )
        )
      }%`;

  $("progressText")
    .textContent =
      msg;
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;
}

function slug(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .normalize(
      "NFKD"
    )
    .replace(
      /[^\w\s-]/g,
      ""
    )
    .replace(
      /_/g,
      "-"
    )
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
  if (
    n < 1024
  ) {
    return `${n} B`;
  }

  if (
    n <
    1024 * 1024
  ) {
    return `${
      Math.round(
        n / 1024
      )
    } KB`;
  }

  return `${
    (
      n /
      1024 /
      1024
    ).toFixed(1)
  } MB`;
}

function validateForm() {
  const subject =
    String(
      $("subjectInput")
        .value ||
      ""
    ).trim();

  const type =
    $("typeInput")
      .value;

  const year =
    $("yearInput")
      .value
      .trim();

  if (!subject) {
    throw new Error(
      "Choose a subject."
    );
  }

  if (!type) {
    throw new Error(
      "Choose a paper type."
    );
  }

  if (
    !/^(19|20)\d{2}$/
      .test(year)
  ) {
    throw new Error(
      "Enter a valid 4-digit year."
    );
  }

  if (
    !state.pages.length
  ) {
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

function nextPaint() {
  return new Promise(
    (resolve) => {
      requestAnimationFrame(
        () =>
          requestAnimationFrame(
            resolve
          )
      );
    }
  );
}

/* ============================================================
   SUBJECT SELECTOR
   ============================================================ */

function ensureSubjectSelector() {
  const current =
    $("subjectInput");

  if (!current) {
    return;
  }

  const existingNames =
    Array.isArray(
      window
        .statArchiveSubjects
    )
      ? window
          .statArchiveSubjects
          .map(
            (s) =>
              String(
                s?.name ||
                ""
              )
                .trim()
          )
          .filter(
            Boolean
          )
      : DEMO_SUBJECTS;

  if (
    current.tagName ===
      "SELECT" &&
    current.dataset
      .scannerReady ===
      "true"
  ) {
    return;
  }

  const select =
    document.createElement(
      "select"
    );

  select.id =
    "subjectInput";

  select.dataset
    .scannerReady =
      "true";

  const names =
    [
      ...new Set(
        existingNames
      ),
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b
          )
      );

  names.forEach(
    (name) => {
      const option =
        document
          .createElement(
            "option"
          );

      option.value =
        name;

      option.textContent =
        name;

      select
        .appendChild(
          option
        );
    }
  );

  const custom =
    document
      .createElement(
        "option"
      );

  custom.value =
    "__custom__";

  custom.textContent =
    "Other / custom subject…";

  select.appendChild(
    custom
  );

  const oldValue =
    String(
      current.value ||
      ""
    ).trim();

  current.replaceWith(
    select
  );

  if (
    oldValue &&
    names.includes(
      oldValue
    )
  ) {
    select.value =
      oldValue;
  }

  select.addEventListener(
    "change",
    () => {
      if (
        select.value !==
        "__custom__"
      ) {
        return;
      }

      const name =
        prompt(
          "Enter subject name:",
          ""
        );

      if (
        !name?.trim()
      ) {
        select.selectedIndex =
          0;

        return;
      }

      const clean =
        name.trim();

      const option =
        document
          .createElement(
            "option"
          );

      option.value =
        clean;

      option.textContent =
        clean;

      select.insertBefore(
        option,
        custom
      );

      select.value =
        clean;
    }
  );
}

/* ============================================================
   CAMERA / GALLERY
   ============================================================ */

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

  if (
    !response.ok
  ) {
    throw new Error(
      "Couldn't read the selected photo."
    );
  }

  return response.blob();
}

function defaultEdit() {
  return {
    rotation:
      0,

    filter:
      "magic",

    crop: {
      x:
        0.02,

      y:
        0.02,

      w:
        0.96,

      h:
        0.96,
    },
  };
}

function makePage(
  blob
) {
  return {
    id:
      newId(),

    originalBlob:
      blob,

    thumbUrl:
      URL.createObjectURL(
        blob
      ),

    edit:
      defaultEdit(),
  };
}

async function capturePhoto() {
  setError("");

  const result =
    await Camera.takePhoto(
      {
        quality:
          90,

        targetWidth:
          2600,

        targetHeight:
          2600,

        correctOrientation:
          true,

        saveToGallery:
          false,

        includeMetadata:
          true,

        editable:
          "no",
      }
    );

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
    await Camera
      .chooseFromGallery(
        {
          mediaType:
            MediaTypeSelection
              .Photo,

          allowMultipleSelection:
            true,

          limit:
            30,

          quality:
            90,

          targetWidth:
            2600,

          targetHeight:
            2600,

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

  const added =
    [];

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

    added.push(
      page.id
    );
  }

  renderPages();

  if (
    added.length
  ) {
    await openEditor(
      added[0]
    );
  }
}

/* ============================================================
   IMAGE RENDERING
   ============================================================ */

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

function clampByte(
  value
) {
  return Math.max(
    0,
    Math.min(
      255,
      value
    )
  );
}

/* ============================================================
   MAGIC FILTER

   Only two modes:
   ORIGINAL
   MAGIC

   Magic is default.
   ============================================================ */

function applyAdjustments(
  canvas,
  edit
) {
  const filter =
    edit.filter ||
    "magic";

  /*
   * Original means truly original.
   */
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

  /*
   * Build histogram.
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
      Math.round(
        0.299 *
          d[i] +

        0.587 *
          d[i + 1] +

        0.114 *
          d[i + 2]
      );

    histogram[
      clampByte(
        lum
      )
    ]++;

    samples++;
  }

  /*
   * Ignore very dark shadows
   * and very bright glare.
   */

  const lowTarget =
    samples *
    0.025;

  const highTarget =
    samples *
    0.965;

  let low =
    0;

  let high =
    255;

  let running =
    0;

  for (
    let i = 0;
    i < 256;
    i++
  ) {
    running +=
      histogram[i];

    if (
      running >=
      lowTarget
    ) {
      low = i;
      break;
    }
  }

  running =
    0;

  for (
    let i = 0;
    i < 256;
    i++
  ) {
    running +=
      histogram[i];

    if (
      running >=
      highTarget
    ) {
      high = i;
      break;
    }
  }

  if (
    high - low <
    55
  ) {
    low =
      Math.max(
        0,
        low - 30
      );

    high =
      Math.min(
        255,
        high + 30
      );
  }

  const range =
    Math.max(
      1,
      high - low
    );

  /*
   * Scanner-style enhancement.
   */

  for (
    let i = 0;
    i < d.length;
    i += 4
  ) {
    const originalR =
      d[i];

    const originalG =
      d[i + 1];

    const originalB =
      d[i + 2];

    const lum =
      Math.max(
        1,

        0.299 *
          originalR +

        0.587 *
          originalG +

        0.114 *
          originalB
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
      clampByte(
        mapped
      );

    /*
     * Whiten paper.
     */

    if (
      mapped >
      170
    ) {
      const t =
        (
          mapped -
          170
        ) /
        85;

      mapped +=
        (
          255 -
          mapped
        ) *
        Math.min(
          1,
          t * 1.8
        );

    } else if (
      mapped >
      125
    ) {
      /*
       * Lift mid-light areas.
       * Helps remove grey shadows.
       */
      mapped +=
        (
          mapped -
          125
        ) *
        0.34;
    }

    /*
     * Darken text.
     */

    if (
      mapped <
      125
    ) {
      mapped *=
        0.70;
    }

    if (
      mapped <
      70
    ) {
      mapped *=
        0.78;
    }

    mapped =
      clampByte(
        mapped
      );

    /*
     * Preserve some pen colour.
     */

    const scale =
      mapped /
      lum;

    let r =
      originalR *
      scale;

    let g =
      originalG *
      scale;

    let b =
      originalB *
      scale;

    /*
     * Remove paper colour cast,
     * but retain blue/red pen.
     */

    const gray =
      (
        r +
        g +
        b
      ) /
      3;

    const saturation =
      0.48;

    r =
      gray +
      (
        r -
        gray
      ) *
      saturation;

    g =
      gray +
      (
        g -
        gray
      ) *
      saturation;

    b =
      gray +
      (
        b -
        gray
      ) *
      saturation;

    /*
     * Final document contrast.
     */

    const contrast =
      1.20;

    r =
      (
        r -
        128
      ) *
      contrast +
      128;

    g =
      (
        g -
        128
      ) *
      contrast +
      128;

    b =
      (
        b -
        128
      ) *
      contrast +
      128;

    d[i] =
      clampByte(r);

    d[i + 1] =
      clampByte(g);

    d[i + 2] =
      clampByte(b);
  }

  ctx.putImageData(
    image,
    0,
    0
  );

  /*
   * Mild sharpening.
   */

  const source =
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const src =
    source.data;

  const sharpened =
    ctx.createImageData(
      canvas.width,
      canvas.height
    );

  const dst =
    sharpened.data;

  const width =
    canvas.width;

  const height =
    canvas.height;

  /*
   * Copy original processed pixels first.
   * This preserves border pixels.
   */

  dst.set(src);

  for (
    let y = 1;
    y < height - 1;
    y++
  ) {
    for (
      let x = 1;
      x < width - 1;
      x++
    ) {
      const p =
        (
          y *
          width +
          x
        ) *
        4;

      const left =
        p - 4;

      const right =
        p + 4;

      const up =
        p -
        width *
        4;

      const down =
        p +
        width *
        4;

      for (
        let channel = 0;
        channel < 3;
        channel++
      ) {
        const center =
          src[
            p +
            channel
          ];

        const neighbours =
          (
            src[
              left +
              channel
            ] +

            src[
              right +
              channel
            ] +

            src[
              up +
              channel
            ] +

            src[
              down +
              channel
            ]
          ) /
          4;

        dst[
          p +
          channel
        ] =
          clampByte(
            center +
            (
              center -
              neighbours
            ) *
            0.28
          );
      }

      dst[
        p + 3
      ] =
        255;
    }
  }

  ctx.putImageData(
    sharpened,
    0,
    0
  );
}

/* ============================================================
   RENDER EDITED IMAGE
   ============================================================ */

async function renderEditedCanvas(
  page,
  maxEdge,
  includeCrop = true
) {
  const bitmap =
    await createImageBitmap(
      page.originalBlob
    );

  try {
    const rotation =
      Number(
        page.edit.rotation ||
        0
      );

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

    const scale =
      Math.min(
        1,
        maxEdge /
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

    applyAdjustments(
      canvas,
      page.edit
    );

    if (
      !includeCrop
    ) {
      return canvas;
    }

    const c =
      page.edit.crop || {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      };

    const sx =
      Math.max(
        0,
        Math.round(
          c.x *
          canvas.width
        )
      );

    const sy =
      Math.max(
        0,
        Math.round(
          c.y *
          canvas.height
        )
      );

    const sw =
      Math.max(
        1,
        Math.min(
          canvas.width -
          sx,

          Math.round(
            c.w *
            canvas.width
          )
        )
      );

    const sh =
      Math.max(
        1,
        Math.min(
          canvas.height -
          sy,

          Math.round(
            c.h *
            canvas.height
          )
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

    const outCtx =
      out.getContext(
        "2d",
        {
          alpha:
            false,
        }
      );

    outCtx.fillStyle =
      "#fff";

    outCtx.fillRect(
      0,
      0,
      sw,
      sh
    );

    outCtx.drawImage(
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

    return out;

  } finally {
    bitmap.close?.();
  }
}

function canvasToJpeg(
  canvas,
  quality = 0.8
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(
                blob
              )
            : reject(
                new Error(
                  "Could not save image."
                )
              ),

        "image/jpeg",

        quality
      );
    }
  );
}

/* ============================================================
   EDITOR UI
   ============================================================ */

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
    .sheet-backdrop[hidden],
    .page-editor-backdrop[hidden]{
      display:none!important
    }

    .page-editor-backdrop{
      position:fixed;
      inset:0;
      z-index:100000;
      background:#05080dec;
      display:flex;
      justify-content:center
    }

    .page-editor{
      width:min(760px,100%);
      height:100dvh;
      background:#0c131c;
      color:#edf4fb;
      display:flex;
      flex-direction:column;
      padding-bottom:env(safe-area-inset-bottom)
    }

    .pe-head,
    .pe-controls{
      flex:0 0 auto;
      background:#101923;
      padding:10px 12px
    }

    .pe-head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom:1px solid #263343
    }

    .pe-stage{
      position:relative;
      flex:1;
      min-height:0;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:8px;
      overflow:hidden;
      background:#070b10;
      touch-action:none
    }

    #peCanvas{
      display:block;
      max-width:100%;
      max-height:100%;
      box-shadow:0 10px 30px #0008
    }

    #cropBox{
      position:absolute;
      border:2px solid #7de3f5;
      box-shadow:0 0 0 9999px #0007;
      touch-action:none
    }

    #cropBox:before,
    #cropBox:after{
      content:"";
      position:absolute;
      pointer-events:none
    }

    #cropBox:before{
      left:33.333%;
      right:33.333%;
      top:0;
      bottom:0;
      border-left:1px solid #7de3f599;
      border-right:1px solid #7de3f599
    }

    #cropBox:after{
      top:33.333%;
      bottom:33.333%;
      left:0;
      right:0;
      border-top:1px solid #7de3f599;
      border-bottom:1px solid #7de3f599
    }

    .crop-handle{
      position:absolute;
      width:24px;
      height:24px;
      border-radius:50%;
      background:white;
      border:3px solid #7de3f5;
      z-index:2;
      touch-action:none
    }

    [data-handle="nw"]{
      left:-13px;
      top:-13px
    }

    [data-handle="ne"]{
      right:-13px;
      top:-13px
    }

    [data-handle="sw"]{
      left:-13px;
      bottom:-13px
    }

    [data-handle="se"]{
      right:-13px;
      bottom:-13px
    }

    .pe-controls{
      border-top:1px solid #263343;
      max-height:44dvh;
      overflow:auto
    }

    .pe-row{
      display:flex;
      gap:8px;
      overflow-x:auto;
      margin-bottom:8px;
      align-items:center
    }

    .pe-row:last-child{
      margin-bottom:0
    }

    .pe-row button{
      white-space:nowrap;
      padding:9px 11px
    }

    .pe-filter.active,
    .pe-apply{
      background:#7de3f5!important;
      color:#041015!important;
      border-color:transparent!important;
      font-weight:800
    }

    .thumb-actions{
      max-width:94px;
      flex-wrap:wrap;
      justify-content:flex-end
    }

    .thumb-actions button{
      flex:0 0 26px
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
          <strong
            id="peTitle"
          >
            Edit page
          </strong>

          <div
            style="
              font-size:11px;
              color:#9aabba;
              margin-top:2px
            "
          >
            Crop · rotate · enhance
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

        <div
          id="cropBox"
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
        class="pe-controls"
      >

        <div
          class="pe-row"
        >

          <button
            id="rotL"
            type="button"
          >
            ↶ Rotate left
          </button>

          <button
            id="rotR"
            type="button"
          >
            ↷ Rotate right
          </button>

          <button
            id="peResetCrop"
            type="button"
          >
            Full crop
          </button>

          <button
            id="peReset"
            type="button"
          >
            Reset all
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

        </div>

        <div
          class="pe-row"
        >

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
            Apply &amp; next
          </button>

        </div>

      </div>
    </div>
  `;

  document.body.appendChild(
    overlay
  );

  $("peCancel")
    .onclick =
      closeEditor;

  $("rotL")
    .onclick =
      () =>
        rotateEditor(
          -90
        );

  $("rotR")
    .onclick =
      () =>
        rotateEditor(
          90
        );

  $("peResetCrop")
    .onclick =
      resetCrop;

  $("peReset")
    .onclick =
      resetEditor;

  $("peApply")
    .onclick =
      () =>
        applyEditor(
          false
        );

  $("peApplyNext")
    .onclick =
      () =>
        applyEditor(
          true
        );

  $("filterRow")
    .addEventListener(
      "click",
      (event) => {
        const btn =
          event.target
            .closest(
              "[data-filter]"
            );

        if (
          !btn ||
          !state.editor
        ) {
          return;
        }

        state.editor
          .edit
          .filter =
            btn.dataset
              .filter ||
            "original";

        syncEditorControls();

        scheduleEditorRedraw();
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

function scheduleEditorRedraw() {
  clearTimeout(
    state.editorRedrawTimer
  );

  state.editorRedrawTimer =
    setTimeout(
      redrawEditor,
      55
    );
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

  state.editor = {
    pageId,

    edit:
      JSON.parse(
        JSON.stringify(
          page.edit ||
          defaultEdit()
        )
      ),
  };

  const index =
    state.pages
      .findIndex(
        (p) =>
          p.id ===
          pageId
      );

  $("peTitle")
    .textContent =
      `Edit page ${
        index + 1
      }`;

  $("peApplyNext")
    .style.display =
      index <
      state.pages.length -
        1
        ? "inline-flex"
        : "none";

  $("pageEditorOverlay")
    .hidden =
      false;

  document.body
    .style
    .overflow =
      "hidden";

  syncEditorControls();

  await redrawEditor();
}

function closeEditor() {
  clearTimeout(
    state.editorRedrawTimer
  );

  state.editor =
    null;

  $("pageEditorOverlay")
    .hidden =
      true;

  document.body
    .style
    .overflow =
      "";
}

function syncEditorControls() {
  if (
    !state.editor
  ) {
    return;
  }

  const edit =
    state.editor.edit;

  document
    .querySelectorAll(
      ".pe-filter"
    )
    .forEach(
      (btn) => {
        btn.classList
          .toggle(
            "active",
            btn.dataset
              .filter ===
              edit.filter
          );
      }
    );
}

function rotateEditor(
  delta
) {
  if (
    !state.editor
  ) {
    return;
  }

  state.editor
    .edit
    .rotation =
      (
        Number(
          state.editor
            .edit
            .rotation ||
          0
        ) +
        delta +
        360
      ) %
      360;

  resetCrop(
    false
  );

  redrawEditor();
}

function resetCrop(
  redraw = true
) {
  if (
    !state.editor
  ) {
    return;
  }

  state.editor
    .edit
    .crop = {
      x:
        0.02,

      y:
        0.02,

      w:
        0.96,

      h:
        0.96,
    };

  if (
    redraw
  ) {
    positionCropBox();
  }
}

function resetEditor() {
  if (
    !state.editor
  ) {
    return;
  }

  state.editor.edit =
    defaultEdit();

  syncEditorControls();

  redrawEditor();
}

async function redrawEditor() {
  if (
    !state.editor
  ) {
    return;
  }

  const page =
    state.pages.find(
      (p) =>
        p.id ===
        state.editor
          .pageId
    );

  if (!page) {
    return;
  }

  const temp = {
    ...page,

    edit:
      state.editor.edit,
  };

  const rendered =
    await renderEditedCanvas(
      temp,
      EDITOR_MAX_EDGE,
      false
    );

  if (
    !state.editor ||
    state.editor.pageId !==
      page.id
  ) {
    return;
  }

  const canvas =
    $("peCanvas");

  canvas.width =
    rendered.width;

  canvas.height =
    rendered.height;

  canvas
    .getContext(
      "2d",
      {
        alpha:
          false,
      }
    )
    .drawImage(
      rendered,
      0,
      0
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
    state.editor
      .edit
      .crop;

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
    (event) => {
      if (
        !state.editor
      ) {
        return;
      }

      event.preventDefault();

      const canvasRect =
        $("peCanvas")
          .getBoundingClientRect();

      drag = {
        id:
          event.pointerId,

        handle:
          event.target
            .closest(
              "[data-handle]"
            )
            ?.dataset
            .handle ||
          "move",

        startX:
          event.clientX,

        startY:
          event.clientY,

        crop: {
          ...state.editor
            .edit
            .crop,
        },

        canvasW:
          canvasRect.width,

        canvasH:
          canvasRect.height,
      };

      box.setPointerCapture?.(
        event.pointerId
      );
    }
  );

  box.addEventListener(
    "pointermove",
    (event) => {
      if (
        !drag ||
        !state.editor ||
        event.pointerId !==
          drag.id
      ) {
        return;
      }

      event.preventDefault();

      const dx =
        (
          event.clientX -
          drag.startX
        ) /
        Math.max(
          1,
          drag.canvasW
        );

      const dy =
        (
          event.clientY -
          drag.startY
        ) /
        Math.max(
          1,
          drag.canvasH
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
          drag.handle
            .includes(
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
          drag.handle
            .includes(
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
          drag.handle
            .includes(
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
          drag.handle
            .includes(
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

      state.editor
        .edit
        .crop = {
          x,
          y,
          w,
          h,
        };

      positionCropBox();
    }
  );

  const stop =
    (event) => {
      if (
        drag &&
        event.pointerId ===
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

async function refreshThumbnail(
  page
) {
  const canvas =
    await renderEditedCanvas(
      page,
      360,
      true
    );

  const blob =
    await canvasToJpeg(
      canvas,
      0.72
    );

  URL.revokeObjectURL(
    page.thumbUrl
  );

  page.thumbUrl =
    URL.createObjectURL(
      blob
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
    state.pages
      .findIndex(
        (p) =>
          p.id ===
          state.editor
            .pageId
      );

  if (
    index < 0
  ) {
    return;
  }

  const page =
    state.pages[
      index
    ];

  page.edit =
    JSON.parse(
      JSON.stringify(
        state.editor
          .edit
      )
    );

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

  /*
   * Small thumbnail only.
   * Heavy high-resolution work
   * waits until Generate PDF.
   */
  refreshThumbnail(
    page
  )
    .then(
      renderPages
    )
    .catch(
      console.warn
    );

  if (
    nextId
  ) {
    await nextPaint();

    await openEditor(
      nextId
    );
  }
}

/* ============================================================
   THUMBNAILS
   ============================================================ */

function renderPages() {
  $("pageCount")
    .textContent =
      `${
        state.pages
          .length
      } ${
        state.pages
          .length ===
        1
          ? "page"
          : "pages"
      }`;

  $("generateBtn")
    .disabled =
      state.busy ||
      !state.pages
        .length;

  $("thumbStrip")
    .innerHTML =
      state.pages
        .map(
          (
            page,
            index
          ) => `
            <div
              class="thumb"
              data-id="${page.id}"
            >

              <img
                src="${page.thumbUrl}"
                alt="Page ${index + 1}"
              >

              <div
                class="page-no"
              >
                ${index + 1}
              </div>

              <div
                class="thumb-actions"
              >

                <button
                  type="button"
                  data-act="edit"
                  aria-label="Edit"
                >
                  ✎
                </button>

                <button
                  type="button"
                  data-act="retake"
                  aria-label="Retake"
                >
                  ↻
                </button>

                <button
                  type="button"
                  data-act="delete"
                  aria-label="Delete"
                >
                  ✕
                </button>

              </div>

              <div
                class="drag"
                aria-label="Drag to reorder"
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
          150,

        draggable:
          ".thumb",

        handle:
          ".drag",

        ghostClass:
          "ghost",

        chosenClass:
          "chosen",

        onEnd(
          event
        ) {
          const from =
            event
              .oldDraggableIndex;

          const to =
            event
              .newDraggableIndex;

          if (
            from == null ||
            to == null ||
            from === to
          ) {
            return;
          }

          const [
            moved,
          ] =
            state.pages
              .splice(
                from,
                1
              );

          state.pages
            .splice(
              to,
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
    state.pages
      .findIndex(
        (p) =>
          p.id === id
      );

  if (
    index < 0
  ) {
    return;
  }

  const result =
    await Camera.takePhoto(
      {
        quality:
          90,

        targetWidth:
          2600,

        targetHeight:
          2600,

        correctOrientation:
          true,

        saveToGallery:
          false,

        includeMetadata:
          true,

        editable:
          "no",
      }
    );

  const blob =
    await mediaResultToBlob(
      result
    );

  const page =
    state.pages[
      index
    ];

  URL.revokeObjectURL(
    page.thumbUrl
  );

  page.originalBlob =
    blob;

  page.thumbUrl =
    URL.createObjectURL(
      blob
    );

  page.edit =
    defaultEdit();

  renderPages();

  await openEditor(
    id
  );
}

function resetComposer() {
  state.pages
    .forEach(
      (page) =>
        URL.revokeObjectURL(
          page.thumbUrl
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

/* ============================================================
   PDF GENERATION
   ============================================================ */

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
      await PDFDocument
        .create();

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
          state.pages
            .length
        ) *
        66,

        `Processing page ${
          i + 1
        } of ${
          state.pages.length
        }…`
      );

      const canvas =
        await renderEditedCanvas(
          state.pages[i],
          FINAL_MAX_EDGE,
          true
        );

      const jpg =
        await canvasToJpeg(
          canvas,
          0.72
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

      const pdfPage =
        pdf.addPage([
          pageW,
          pageH,
        ]);

      pdfPage.drawImage(
        image,
        {
          x:
            0,

          y:
            0,

          width:
            pageW,

          height:
            pageH,
        }
      );

      await nextPaint();
    }

    setProgress(
      76,
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
      92,
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

/* ============================================================
   PDF VIEW / DOWNLOAD
   ============================================================ */

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
          const value =
            String(
              reader.result ||
              ""
            );

          resolve(
            value.includes(
              ","
            )
              ? value
                  .split(",")[1]
              : value
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
    await Filesystem
      .writeFile({
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
      });

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

    try {
      await FileViewer
        .openDocumentFromLocalPath(
          {
            path:
              uri,
          }
        );

    } catch (
      viewerError
    ) {
      console.warn(
        "FileViewer fallback:",
        viewerError
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
    }

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

    await Filesystem
      .writeFile({
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
      });

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

    } catch (
      fallbackError
    ) {
      alert(
        fallbackError?.message ||
        "Could not save this PDF."
      );
    }
  }
}

/* ============================================================
   LOCAL TEST LIBRARY UI
   ============================================================ */

async function renderLibrary() {
  const rows =
    (
      await dbGetAll()
    ).sort(
      (
        a,
        b
      ) =>
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
          (
            record
          ) => `
            <article
              class="card"
              data-id="${record.id}"
            >

              <div
                class="subject"
              >
                ${record.subject}
              </div>

              <h3>
                ${record.filename}
              </h3>

              <div
                class="meta"
              >
                ${record.type}
                ·
                ${record.year}
                ·
                ${bytesLabel(
                  record.size
                )}
              </div>

              <div
                class="meta"
              >
                Uploaded by
                ${record.uploadedBy}
              </div>

              <div
                class="card-actions"
              >

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

/* ============================================================
   SOURCE SHEET
   ============================================================ */

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

/* ============================================================
   INITIALIZE
   ============================================================ */

ensureSubjectSelector();

installEditor();

/* ============================================================
   ADD PHOTOS
   ============================================================ */

$("addPhotosBtn")
  .onclick =
    showSource;

$("firstAddBtn")
  .onclick =
    showSource;

$("cancelSourceBtn")
  .onclick =
    hideSource;

/* ============================================================
   CAMERA
   ============================================================ */

$("cameraBtn")
  .onclick =
    async () => {
      hideSource();

      try {
        await capturePhoto();

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
            "Camera failed."
          );
        }
      }
    };

/* ============================================================
   GALLERY
   ============================================================ */

$("galleryBtn")
  .onclick =
    async () => {
      hideSource();

      try {
        await chooseMultiplePhotos();

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
            "Gallery selection failed."
          );
        }
      }
    };

/* ============================================================
   THUMBNAIL ACTIONS
   ============================================================ */

$("thumbStrip")
  .addEventListener(
    "click",
    async (event) => {
      const thumb =
        event.target
          .closest(
            ".thumb"
          );

      if (
        !thumb
      ) {
        return;
      }

      const id =
        thumb.dataset.id;

      /*
       * EDIT
       */

      if (
        event.target
          .closest(
            '[data-act="edit"]'
          )
      ) {
        await openEditor(
          id
        );

        return;
      }

      /*
       * DELETE
       */

      if (
        event.target
          .closest(
            '[data-act="delete"]'
          )
      ) {
        const index =
          state.pages
            .findIndex(
              (page) =>
                page.id ===
                id
            );

        if (
          index >=
          0
        ) {
          URL.revokeObjectURL(
            state.pages[
              index
            ].thumbUrl
          );

          state.pages
            .splice(
              index,
              1
            );

          renderPages();
        }

        return;
      }

      /*
       * RETAKE
       */

      if (
        event.target
          .closest(
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

/* ============================================================
   GENERATE
   ============================================================ */

$("generateBtn")
  .onclick =
    generatePdf;

/* ============================================================
   ADD ANOTHER
   ============================================================ */

$("addAnotherBtn")
  .onclick =
    resetComposer;

/* ============================================================
   VIEW LIBRARY
   ============================================================ */

$("viewLibraryBtn")
  .onclick =
    () =>
      $("libraryPanel")
        .scrollIntoView(
          {
            behavior:
              "smooth",

            block:
              "start",
          }
        );

/* ============================================================
   DOWNLOAD LATEST
   ============================================================ */

$("downloadLatestBtn")
  .onclick =
    () =>
      state.latestId &&
      downloadRecord(
        state.latestId
      );

/* ============================================================
   LIBRARY ACTIONS
   ============================================================ */

$("libraryGrid")
  .addEventListener(
    "click",
    async (event) => {
      const card =
        event.target
          .closest(
            ".card"
          );

      if (
        !card
      ) {
        return;
      }

      const id =
        card.dataset.id;

      /*
       * VIEW
       */

      if (
        event.target
          .closest(
            '[data-act="view"]'
          )
      ) {
        await viewRecord(
          id
        );

        return;
      }

      /*
       * DOWNLOAD
       */

      if (
        event.target
          .closest(
            '[data-act="download"]'
          )
      ) {
        await downloadRecord(
          id
        );

        return;
      }

      /*
       * DELETE
       */

      if (
        event.target
          .closest(
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

/* ============================================================
   CLEAR TEST LIBRARY
   ============================================================ */

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

/* ============================================================
   INITIAL LOAD
   ============================================================ */

renderPages();

renderLibrary();
