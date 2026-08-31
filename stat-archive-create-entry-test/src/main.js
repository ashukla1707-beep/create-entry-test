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
const THUMB_MAX_EDGE = 360;

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

/* =========================
   LOCAL TEST LIBRARY
   ========================= */

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

      fn(
        tx.objectStore(STORE),
        resolve,
        reject,
        tx
      );

      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function dbPut(record) {
  return withStore(
    "readwrite",
    (store, resolve, reject, tx) => {
      store.put(record);

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    }
  );
}

async function dbGetAll() {
  return withStore(
    "readonly",
    (store, resolve, reject) => {
      const req = store.getAll();

      req.onsuccess = () =>
        resolve(req.result || []);

      req.onerror = () =>
        reject(req.error);
    }
  );
}

async function dbGet(id) {
  return withStore(
    "readonly",
    (store, resolve, reject) => {
      const req = store.get(id);

      req.onsuccess = () =>
        resolve(req.result || null);

      req.onerror = () =>
        reject(req.error);
    }
  );
}

async function dbDelete(id) {
  return withStore(
    "readwrite",
    (store, resolve, reject, tx) => {
      store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    }
  );
}

async function dbClear() {
  return withStore(
    "readwrite",
    (store, resolve, reject, tx) => {
      store.clear();

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    }
  );
}

/* =========================
   HELPERS
   ========================= */

function setError(message = "") {
  const box = $("errorBox");

  if (!box) {
    return;
  }

  box.textContent = message;
  box.hidden = !message;
}

function setProgress(percent, message) {
  $("progressWrap").hidden = false;

  $("progressBar").style.width =
    `${Math.max(
      0,
      Math.min(
        100,
        percent
      )
    )}%`;

  $("progressText").textContent =
    message;
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(resolve)
    );
  });
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function clampByte(value) {
  return Math.max(
    0,
    Math.min(
      255,
      value
    )
  );
}

function slug(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function filenameFor(
  subject,
  type,
  year
) {
  return [
    slug(subject) || "Document",
    slug(type) || "Paper",
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

  if (n < 1024 * 1024) {
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
    String(
      $("subjectInput")?.value || ""
    ).trim();

  const type =
    String(
      $("typeInput")?.value || ""
    ).trim();

  const year =
    String(
      $("yearInput")?.value || ""
    ).trim();

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
    !/^(19|20)\d{2}$/.test(year)
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

/* =========================
   SUBJECT SELECTOR
   ========================= */

function ensureSubjectSelector() {
  const current =
    $("subjectInput");

  if (!current) {
    return;
  }

  const liveNames =
    Array.isArray(
      window.statArchiveSubjects
    )
      ? window.statArchiveSubjects
          .map((subject) =>
            String(
              subject?.name || ""
            ).trim()
          )
          .filter(Boolean)
      : DEMO_SUBJECTS;

  if (
    current.tagName === "SELECT" &&
    current.dataset.scannerReady ===
      "true"
  ) {
    return;
  }

  const select =
    document.createElement("select");

  select.id =
    "subjectInput";

  select.dataset.scannerReady =
    "true";

  const names =
    [
      ...new Set(liveNames),
    ].sort((a, b) =>
      a.localeCompare(b)
    );

  for (
    const name
    of names
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value = name;
    option.textContent = name;

    select.appendChild(option);
  }

  const custom =
    document.createElement(
      "option"
    );

  custom.value =
    "__custom__";

  custom.textContent =
    "Other / custom subject…";

  select.appendChild(custom);

  const oldValue =
    String(
      current.value || ""
    ).trim();

  current.replaceWith(select);

  if (
    oldValue &&
    names.includes(oldValue)
  ) {
    select.value = oldValue;
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

      if (!name?.trim()) {
        select.selectedIndex = 0;
        return;
      }

      const clean =
        name.trim();

      const option =
        document.createElement(
          "option"
        );

      option.value = clean;
      option.textContent = clean;

      select.insertBefore(
        option,
        custom
      );

      select.value = clean;
    }
  );
}

/* =========================
   PAGE MODEL
   ========================= */

function defaultEdit() {
  return {
    rotation: 0,

    filter: "magic",

    /*
     * 0 = original
     * 100 = strongest Magic
     */
    magicStrength: 65,

    crop: {
      x: 0.02,
      y: 0.02,
      w: 0.96,
      h: 0.96,
    },
  };
}

function makePage(blob) {
  return {
    id: newId(),

    originalBlob:
      blob,

    thumbUrl:
      URL.createObjectURL(blob),

    edit:
      defaultEdit(),
  };
}

/* =========================
   CAMERA / GALLERY
   ========================= */

async function mediaResultToBlob(
  result
) {
  if (!result?.webPath) {
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

async function capturePhoto() {
  setError("");

  const result =
    await Camera.takePhoto({
      quality: 95,

      targetWidth: 2600,
      targetHeight: 2600,

      correctOrientation: true,

      saveToGallery: false,

      includeMetadata: true,

      editable: "no",
    });

  const page =
    makePage(
      await mediaResultToBlob(
        result
      )
    );

  state.pages.push(page);

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
    await Camera.chooseFromGallery({
      mediaType:
        MediaTypeSelection.Photo,

      allowMultipleSelection:
        true,

      limit: 30,

      quality: 95,

      targetWidth: 2600,
      targetHeight: 2600,

      correctOrientation: true,

      includeMetadata: true,

      editable: "no",
    });

  if (!results?.length) {
    return;
  }

  const added = [];

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

    state.pages.push(page);

    added.push(
      page.id
    );
  }

  renderPages();

  if (added.length) {
    await openEditor(
      added[0]
    );
  }
}

/* =========================
   ROTATION
   ========================= */

function drawRotated(
  ctx,
  bitmap,
  rotation,
  width,
  height
) {
  ctx.save();

  if (rotation === 90) {
    ctx.translate(
      width,
      0
    );

    ctx.rotate(
      Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      height,
      width
    );

  } else if (
    rotation === 180
  ) {
    ctx.translate(
      width,
      height
    );

    ctx.rotate(
      Math.PI
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      width,
      height
    );

  } else if (
    rotation === 270
  ) {
    ctx.translate(
      0,
      height
    );

    ctx.rotate(
      -Math.PI / 2
    );

    ctx.drawImage(
      bitmap,
      0,
      0,
      height,
      width
    );

  } else {
    ctx.drawImage(
      bitmap,
      0,
      0,
      width,
      height
    );
  }

  ctx.restore();
}

/* =========================
   MAGIC FILTER
   ========================= */

function applyMagicFilter(
  canvas,
  edit
) {
  const strength =
    Math.max(
      0,
      Math.min(
        100,
        Number(
          edit.magicStrength ??
          65
        )
      )
    ) / 100;

  if (
    strength <= 0
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

  const width =
    canvas.width;

  const height =
    canvas.height;

  const image =
    ctx.getImageData(
      0,
      0,
      width,
      height
    );

  const data =
    image.data;

  const original =
    new Uint8ClampedArray(
      data
    );

  const pixels =
    width *
    height;

  /*
   * Luminance map
   */

  const luminance =
    new Uint8Array(
      pixels
    );

  for (
    let p = 0,
      i = 0;

    p < pixels;

    p++,
      i += 4
  ) {
    luminance[p] =
      clampByte(
        Math.round(
          0.299 *
            data[i] +

          0.587 *
            data[
              i + 1
            ] +

          0.114 *
            data[
              i + 2
            ]
        )
      );
  }

  /*
   * Integral image for fast
   * local background estimation
   */

  const integralWidth =
    width + 1;

  const integral =
    new Float64Array(
      (
        width + 1
      ) *
      (
        height + 1
      )
    );

  for (
    let y = 1;
    y <= height;
    y++
  ) {
    let rowSum = 0;

    const sourceRow =
      (
        y - 1
      ) *
      width;

    const integralRow =
      y *
      integralWidth;

    const previousRow =
      (
        y - 1
      ) *
      integralWidth;

    for (
      let x = 1;
      x <= width;
      x++
    ) {
      rowSum +=
        luminance[
          sourceRow +
          x -
          1
        ];

      integral[
        integralRow +
        x
      ] =
        integral[
          previousRow +
          x
        ] +
        rowSum;
    }
  }

  const radius =
    Math.max(
      16,
      Math.round(
        Math.min(
          width,
          height
        ) *
        0.032
      )
    );

  /*
   * Pixel processing
   */

  for (
    let y = 0;
    y < height;
    y++
  ) {
    const y1 =
      Math.max(
        0,
        y - radius
      );

    const y2 =
      Math.min(
        height - 1,
        y + radius
      );

    for (
      let x = 0;
      x < width;
      x++
    ) {
      const x1 =
        Math.max(
          0,
          x - radius
        );

      const x2 =
        Math.min(
          width - 1,
          x + radius
        );

      const ia =
        y1 *
        integralWidth +
        x1;

      const ib =
        y1 *
        integralWidth +
        (
          x2 + 1
        );

      const ic =
        (
          y2 + 1
        ) *
        integralWidth +
        x1;

      const id =
        (
          y2 + 1
        ) *
        integralWidth +
        (
          x2 + 1
        );

      const area =
        (
          x2 -
          x1 +
          1
        ) *
        (
          y2 -
          y1 +
          1
        );

      const localMean =
        (
          integral[id] -
          integral[ib] -
          integral[ic] +
          integral[ia]
        ) /
        Math.max(
          1,
          area
        );

      const pixel =
        y *
        width +
        x;

      const i =
        pixel *
        4;

      const originalR =
        original[i];

      const originalG =
        original[
          i + 1
        ];

      const originalB =
        original[
          i + 2
        ];

      const lum =
        luminance[pixel];

      const maxRGB =
        Math.max(
          originalR,
          originalG,
          originalB
        );

      const minRGB =
        Math.min(
          originalR,
          originalG,
          originalB
        );

      const chroma =
        maxRGB -
        minRGB;

      const detail =
        localMean -
        lum;

      /*
       * Correct uneven lighting.
       * Softer than the previous
       * version so faint writing
       * stays readable.
       */

      let normalized =
        lum +
        (
          244 -
          localMean
        ) *
        0.78;

      /*
       * Suppress faint show-through
       */

      if (
        chroma < 26 &&
        lum > 105
      ) {
        if (
          detail < 8
        ) {
          normalized =
            255;

        } else if (
          detail < 16
        ) {
          normalized +=
            (
              16 -
              detail
            ) *
            2.2;

        } else if (
          detail < 24
        ) {
          normalized +=
            (
              24 -
              detail
            ) *
            0.8;
        }
      }

      /*
       * Clean paper
       */

      if (
        normalized > 210
      ) {
        normalized +=
          (
            255 -
            normalized
          ) *
          0.72;

      } else if (
        normalized > 180
      ) {
        normalized +=
          (
            normalized -
            180
          ) *
          0.16;
      }

      /*
       * Strengthen true text,
       * but less aggressively
       * than before.
       */

      if (
        detail > 22 ||
        lum < 120
      ) {
        const strokeStrength =
          Math.min(
            1,
            Math.max(
              0,
              (
                detail -
                14
              ) /
              60
            )
          );

        normalized *=
          1 -
          0.18 *
          strokeStrength;

        if (
          lum < 80
        ) {
          normalized *=
            0.92;
        }
      }

      normalized =
        clampByte(
          normalized
        );

      /*
       * Preserve pen/highlighter
       * color
       */

      const scale =
        normalized /
        Math.max(
          1,
          lum
        );

      let r =
        originalR *
        scale;

      let g =
        originalG *
        scale;

      let b =
        originalB *
        scale;

      const gray =
        (
          r +
          g +
          b
        ) /
        3;

      let saturationKeep;

      if (
        chroma >= 55
      ) {
        saturationKeep =
          0.96;

      } else if (
        chroma >= 30
      ) {
        saturationKeep =
          0.82;

      } else if (
        chroma >= 18
      ) {
        saturationKeep =
          0.60;

      } else {
        saturationKeep =
          0.22;
      }

      r =
        gray +
        (
          r -
          gray
        ) *
        saturationKeep;

      g =
        gray +
        (
          g -
          gray
        ) *
        saturationKeep;

      b =
        gray +
        (
          b -
          gray
        ) *
        saturationKeep;

      /*
       * MAGIC STRENGTH CONTROL
       *
       * 0% = original
       * 100% = full Magic
       */

      data[i] =
        clampByte(
          originalR +
          (
            r -
            originalR
          ) *
          strength
        );

      data[
        i + 1
      ] =
        clampByte(
          originalG +
          (
            g -
            originalG
          ) *
          strength
        );

      data[
        i + 2
      ] =
        clampByte(
          originalB +
          (
            b -
            originalB
          ) *
          strength
        );

      data[
        i + 3
      ] =
        255;
    }
  }

  ctx.putImageData(
    image,
    0,
    0
  );

  /*
   * Mild sharpening
   */

  if (
    strength > 0.05
  ) {
    const source =
      ctx.getImageData(
        0,
        0,
        width,
        height
      );

    const src =
      source.data;

    const sharpened =
      ctx.createImageData(
        width,
        height
      );

    const dst =
      sharpened.data;

    dst.set(src);

    const sharpenAmount =
      0.10 +
      0.10 *
      strength;

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
              sharpenAmount
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
}

function applyAdjustments(
  canvas,
  edit
) {
  if (
    (
      edit.filter ||
      "magic"
    ) ===
    "magic"
  ) {
    applyMagicFilter(
      canvas,
      edit
    );
  }
}

/* =========================
   RENDER EDITED IMAGE
   ========================= */

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

    const naturalWidth =
      rotated
        ? bitmap.height
        : bitmap.width;

    const naturalHeight =
      rotated
        ? bitmap.width
        : bitmap.height;

    const scale =
      Math.min(
        1,
        maxEdge /
        Math.max(
          naturalWidth,
          naturalHeight
        )
      );

    const width =
      Math.max(
        1,
        Math.round(
          naturalWidth *
          scale
        )
      );

    const height =
      Math.max(
        1,
        Math.round(
          naturalHeight *
          scale
        )
      );

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width;

    canvas.height =
      height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha: false,

          willReadFrequently:
            true,
        }
      );

    ctx.fillStyle =
      "#fff";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    drawRotated(
      ctx,
      bitmap,
      rotation,
      width,
      height
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

    const crop =
      page.edit.crop ||
      {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      };

    const sx =
      Math.max(
        0,
        Math.round(
          crop.x *
          width
        )
      );

    const sy =
      Math.max(
        0,
        Math.round(
          crop.y *
          height
        )
      );

    const sw =
      Math.max(
        1,
        Math.min(
          width -
          sx,

          Math.round(
            crop.w *
            width
          )
        )
      );

    const sh =
      Math.max(
        1,
        Math.min(
          height -
          sy,

          Math.round(
            crop.h *
            height
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
          alpha: false,
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
  quality = 0.84
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
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

/* =========================
   AUTO CROP
   ========================= */

function smoothScores(
  values,
  radius = 4
) {
  const output =
    new Float64Array(
      values.length
    );

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    let sum = 0;
    let count = 0;

    for (
      let j =
        Math.max(
          0,
          i - radius
        );

      j <=
      Math.min(
        values.length - 1,
        i + radius
      );

      j++
    ) {
      sum +=
        values[j];

      count++;
    }

    output[i] =
      sum /
      Math.max(
        1,
        count
      );
  }

  return output;
}

function strongestIndex(
  scores,
  startFraction,
  endFraction
) {
  const start =
    Math.max(
      1,
      Math.floor(
        scores.length *
        startFraction
      )
    );

  const end =
    Math.min(
      scores.length -
      2,

      Math.ceil(
        scores.length *
        endFraction
      )
    );

  let bestIndex =
    start;

  let bestScore =
    -Infinity;

  for (
    let i = start;
    i <= end;
    i++
  ) {
    if (
      scores[i] >
      bestScore
    ) {
      bestScore =
        scores[i];

      bestIndex =
        i;
    }
  }

  return {
    index: bestIndex,
    score: bestScore,
  };
}

function detectAutoCropFromCanvas(
  canvas
) {
  const maxEdge =
    420;

  const scale =
    Math.min(
      1,
      maxEdge /
      Math.max(
        canvas.width,
        canvas.height
      )
    );

  const width =
    Math.max(
      40,
      Math.round(
        canvas.width *
        scale
      )
    );

  const height =
    Math.max(
      40,
      Math.round(
        canvas.height *
        scale
      )
    );

  const small =
    document.createElement(
      "canvas"
    );

  small.width =
    width;

  small.height =
    height;

  const ctx =
    small.getContext(
      "2d",
      {
        willReadFrequently:
          true,
      }
    );

  ctx.drawImage(
    canvas,
    0,
    0,
    width,
    height
  );

  const image =
    ctx.getImageData(
      0,
      0,
      width,
      height
    ).data;

  const gray =
    new Uint8Array(
      width *
      height
    );

  for (
    let p = 0,
      i = 0;

    p <
    gray.length;

    p++,
      i += 4
  ) {
    gray[p] =
      clampByte(
        Math.round(
          0.299 *
          image[i] +

          0.587 *
          image[
            i + 1
          ] +

          0.114 *
          image[
            i + 2
          ]
        )
      );
  }

  const colScores =
    new Float64Array(
      width
    );

  const rowScores =
    new Float64Array(
      height
    );

  for (
    let y = 1;
    y <
    height - 1;
    y++
  ) {
    for (
      let x = 1;
      x <
      width - 1;
      x++
    ) {
      const p =
        y *
        width +
        x;

      const gx =
        Math.abs(
          gray[
            p + 1
          ] -
          gray[
            p - 1
          ]
        );

      const gy =
        Math.abs(
          gray[
            p +
            width
          ] -
          gray[
            p -
            width
          ]
        );

      const gradient =
        gx + gy;

      colScores[x] +=
        gradient;

      rowScores[y] +=
        gradient;
    }
  }

  const columns =
    smoothScores(
      colScores,
      3
    );

  const rows =
    smoothScores(
      rowScores,
      3
    );

  const left =
    strongestIndex(
      columns,
      0.01,
      0.34
    );

  const right =
    strongestIndex(
      columns,
      0.66,
      0.99
    );

  const top =
    strongestIndex(
      rows,
      0.01,
      0.34
    );

  const bottom =
    strongestIndex(
      rows,
      0.66,
      0.99
    );

  const detectedWidth =
    right.index -
    left.index;

  const detectedHeight =
    bottom.index -
    top.index;

  if (
    detectedWidth <
      width * 0.48 ||

    detectedHeight <
      height * 0.48
  ) {
    return {
      x: 0.02,
      y: 0.02,
      w: 0.96,
      h: 0.96,
    };
  }

  const x1 =
    Math.max(
      0,
      Math.min(
        width - 2,
        left.index
      )
    );

  const y1 =
    Math.max(
      0,
      Math.min(
        height - 2,
        top.index
      )
    );

  const x2 =
    Math.max(
      x1 + 1,
      Math.min(
        width - 1,
        right.index
      )
    );

  const y2 =
    Math.max(
      y1 + 1,
      Math.min(
        height - 1,
        bottom.index
      )
    );

  return {
    x:
      x1 / width,

    y:
      y1 / height,

    w:
      (
        x2 - x1
      ) / width,

    h:
      (
        y2 - y1
      ) / height,
  };
}

async function autoCropEditor() {
  if (!state.editor) {
    return;
  }

  const page =
    state.pages.find(
      (page) =>
        page.id ===
        state.editor.pageId
    );

  if (!page) {
    return;
  }

  const button =
    $("peAutoCrop");

  const oldText =
    button.textContent;

  button.disabled =
    true;

  button.textContent =
    "Detecting…";

  try {
    const temp = {
      ...page,

      edit: {
        ...state.editor.edit,

        filter: "original",

        magicStrength: 0,

        crop: {
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      },
    };

    const canvas =
      await renderEditedCanvas(
        temp,
        900,
        false
      );

    state.editor.edit.crop =
      detectAutoCropFromCanvas(
        canvas
      );

    positionCropBox();

  } catch (error) {
    console.warn(
      "Auto crop failed:",
      error
    );

    setError(
      "Auto crop could not detect the page. Adjust the corners manually."
    );

  } finally {
    button.disabled =
      false;

    button.textContent =
      oldText;
  }
}

/* =========================
   EDITOR UI
   ========================= */

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
      border-bottom:1px solid #263343
    }

    .pe-title-row,
    .pe-nav-row,
    .pe-row{
      display:flex;
      align-items:center;
      gap:8px
    }

    .pe-title-row,
    .pe-nav-row{
      justify-content:space-between
    }

    .pe-nav-row{
      margin-top:8px
    }

    .pe-nav-row button{
      min-width:96px
    }

    #pePagePosition{
      color:#aebdca;
      font-size:12px;
      font-weight:700
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
      image-rendering:auto;
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
      max-height:47dvh;
      overflow:auto
    }

    .pe-row{
      overflow-x:auto;
      margin-bottom:8px
    }

    .pe-row:last-child{
      margin-bottom:0
    }

    .pe-row button{
      white-space:nowrap;
      padding:9px 11px
    }

    .pe-filter.active,
    .pe-primary{
      background:#7de3f5!important;
      color:#041015!important;
      border-color:transparent!important;
      font-weight:800
    }

    .pe-slider{
      display:grid;
      grid-template-columns:78px 1fr 46px;
      gap:8px;
      align-items:center;
      margin:10px 0;
      font-size:12px;
      color:#aebdca
    }

    .pe-slider input{
      width:100%;
      padding:0
    }

    .pe-slider output{
      text-align:right;
      color:#edf4fb
    }

    .pe-all{
      width:100%;
      justify-content:center
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

      <div
        class="pe-head"
      >

        <div
          class="pe-title-row"
        >

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
              Crop · rotate · Magic
            </div>
          </div>

          <button
            id="peCancel"
            type="button"
          >
            Done
          </button>

        </div>

        <div
          class="pe-nav-row"
        >

          <button
            id="pePrev"
            type="button"
          >
            ← Previous
          </button>

          <span
            id="pePagePosition"
          >
            Page 1 / 1
          </span>

          <button
            id="peNext"
            type="button"
          >
            Next →
          </button>

        </div>

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
            id="peAutoCrop"
            type="button"
          >
            ✨ Auto crop
          </button>

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

        </div>

        <label
          class="pe-slider"
          id="magicStrengthRow"
        >

          <span>
            Magic
          </span>

          <input
            id="magicStrengthSlider"
            type="range"
            min="0"
            max="100"
            step="1"
            value="65"
          >

          <output
            id="magicStrengthOut"
          >
            65%
          </output>

        </label>

        <div
          class="pe-row"
        >

          <button
            id="peApplyAll"
            class="pe-primary pe-all"
            type="button"
          >
            Apply filter + crop to all pages
          </button>

        </div>

        <div
          class="pe-row"
        >

          <button
            class="pe-primary"
            id="peApply"
            type="button"
          >
            Apply
          </button>

          <button
            class="pe-primary"
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

  $("peCancel").onclick =
    async () => {
      await saveCurrentEditorPage(
        false
      );

      closeEditor();
    };

  $("pePrev").onclick =
    () =>
      navigateEditor(-1);

  $("peNext").onclick =
    () =>
      navigateEditor(1);

  $("peAutoCrop").onclick =
    autoCropEditor;

  $("rotL").onclick =
    () =>
      rotateEditor(-90);

  $("rotR").onclick =
    () =>
      rotateEditor(90);

  $("peResetCrop").onclick =
    () =>
      resetCrop(true);

  $("peReset").onclick =
    resetEditor;

  $("peApply").onclick =
    () =>
      applyEditor(false);

  $("peApplyNext").onclick =
    () =>
      applyEditor(true);

  $("peApplyAll").onclick =
    applyEditorToAll;

  $("filterRow")
    .addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-filter]"
          );

        if (
          !button ||
          !state.editor
        ) {
          return;
        }

        state.editor.edit.filter =
          button.dataset.filter ||
          "magic";

        syncEditorControls();

        scheduleEditorRedraw();
      }
    );

  $("magicStrengthSlider")
    .addEventListener(
      "input",
      () => {
        if (
          !state.editor
        ) {
          return;
        }

        state.editor.edit.magicStrength =
          Number(
            $("magicStrengthSlider")
              .value
          );

        syncEditorControls(
          false
        );

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
      70
    );
}

async function openEditor(
  pageId
) {
  installEditor();

  const page =
    state.pages.find(
      (page) =>
        page.id ===
        pageId
    );

  if (!page) {
    return;
  }

  state.editor = {
    pageId,

    edit:
      clone(
        page.edit ||
        defaultEdit()
      ),
  };

  $("pageEditorOverlay")
    .hidden =
      false;

  document.body.style.overflow =
    "hidden";

  updateEditorNavigation();

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

  document.body.style.overflow =
    "";
}

function currentEditorIndex() {
  if (!state.editor) {
    return -1;
  }

  return state.pages
    .findIndex(
      (page) =>
        page.id ===
        state.editor.pageId
    );
}

function updateEditorNavigation() {
  if (!state.editor) {
    return;
  }

  const index =
    currentEditorIndex();

  const total =
    state.pages.length;

  $("peTitle").textContent =
    `Edit page ${
      index + 1
    }`;

  $("pePagePosition")
    .textContent =
      `Page ${
        index + 1
      } / ${total}`;

  $("pePrev").disabled =
    index <= 0;

  $("peNext").disabled =
    index < 0 ||
    index >=
      total - 1;

  $("peApplyNext")
    .style.display =
      index >= 0 &&
      index <
        total - 1
        ? "inline-flex"
        : "none";
}

function syncEditorControls(
  updateInputs = true
) {
  if (!state.editor) {
    return;
  }

  const edit =
    state.editor.edit;

  document
    .querySelectorAll(
      ".pe-filter"
    )
    .forEach(
      (button) => {
        button.classList.toggle(
          "active",
          button.dataset.filter ===
            edit.filter
        );
      }
    );

  $("magicStrengthRow")
    .style.display =
      edit.filter ===
      "magic"
        ? "grid"
        : "none";

  const strength =
    Number(
      edit.magicStrength ??
      65
    );

  if (
    updateInputs
  ) {
    $("magicStrengthSlider")
      .value =
        String(
          strength
        );
  }

  $("magicStrengthOut")
    .textContent =
      `${strength}%`;
}

function rotateEditor(
  delta
) {
  if (!state.editor) {
    return;
  }

  state.editor.edit.rotation =
    (
      Number(
        state.editor.edit.rotation ||
        0
      ) +
      delta +
      360
    ) %
    360;

  resetCrop(false);

  redrawEditor();
}

function resetCrop(
  redraw = true
) {
  if (!state.editor) {
    return;
  }

  state.editor.edit.crop = {
    x: 0.02,
    y: 0.02,
    w: 0.96,
    h: 0.96,
  };

  if (redraw) {
    positionCropBox();
  }
}

function resetEditor() {
  if (!state.editor) {
    return;
  }

  state.editor.edit =
    defaultEdit();

  syncEditorControls();

  redrawEditor();
}

async function redrawEditor() {
  if (!state.editor) {
    return;
  }

  const editorPageId =
    state.editor.pageId;

  const page =
    state.pages.find(
      (page) =>
        page.id ===
        editorPageId
    );

  if (!page) {
    return;
  }

  const temp = {
    ...page,

    edit:
      clone(
        state.editor.edit
      ),
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
      editorPageId
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
        alpha: false,
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
  if (!state.editor) {
    return;
  }

  const stageRect =
    $("peStage")
      .getBoundingClientRect();

  const canvasRect =
    $("peCanvas")
      .getBoundingClientRect();

  const crop =
    state.editor.edit.crop;

  const box =
    $("cropBox");

  box.style.left =
    `${
      canvasRect.left -
      stageRect.left +
      crop.x *
      canvasRect.width
    }px`;

  box.style.top =
    `${
      canvasRect.top -
      stageRect.top +
      crop.y *
      canvasRect.height
    }px`;

  box.style.width =
    `${
      crop.w *
      canvasRect.width
    }px`;

  box.style.height =
    `${
      crop.h *
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
      if (!state.editor) {
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
          ...state.editor.edit.crop,
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

      const start =
        drag.crop;

      const min =
        0.08;

      let {
        x,
        y,
        w,
        h,
      } =
        start;

      if (
        drag.handle ===
        "move"
      ) {
        x =
          Math.max(
            0,
            Math.min(
              1 - w,
              start.x +
              dx
            )
          );

        y =
          Math.max(
            0,
            Math.min(
              1 - h,
              start.y +
              dy
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
                start.x +
                start.w -
                min,

                start.x +
                dx
              )
            );

          w =
            start.x +
            start.w -
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
                start.x,

                start.w +
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
                start.y +
                start.h -
                min,

                start.y +
                dy
              )
            );

          h =
            start.y +
            start.h -
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
                start.y,

                start.h +
                dy
              )
            );
        }
      }

      state.editor.edit.crop = {
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
        drag = null;
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

/* =========================
   SAVE / NAVIGATE / APPLY
   ========================= */

async function refreshThumbnail(
  page
) {
  const canvas =
    await renderEditedCanvas(
      page,
      THUMB_MAX_EDGE,
      true
    );

  const blob =
    await canvasToJpeg(
      canvas,
      0.78
    );

  URL.revokeObjectURL(
    page.thumbUrl
  );

  page.thumbUrl =
    URL.createObjectURL(
      blob
    );
}

async function saveCurrentEditorPage(
  refresh = true
) {
  if (!state.editor) {
    return null;
  }

  const index =
    currentEditorIndex();

  if (
    index < 0
  ) {
    return null;
  }

  const page =
    state.pages[index];

  page.edit =
    clone(
      state.editor.edit
    );

  if (refresh) {
    refreshThumbnail(
      page
    )
      .then(
        renderPages
      )
      .catch(
        console.warn
      );
  }

  return page;
}

async function navigateEditor(
  delta
) {
  if (!state.editor) {
    return;
  }

  const index =
    currentEditorIndex();

  const target =
    index +
    delta;

  if (
    index < 0 ||
    target < 0 ||
    target >=
      state.pages.length
  ) {
    return;
  }

  await saveCurrentEditorPage(
    true
  );

  const targetId =
    state.pages[
      target
    ].id;

  await nextPaint();

  await openEditor(
    targetId
  );
}

async function applyEditor(
  openNext
) {
  if (!state.editor) {
    return;
  }

  const index =
    currentEditorIndex();

  if (
    index < 0
  ) {
    return;
  }

  const nextId =
    openNext &&
    index <
      state.pages.length -
      1
      ? state.pages[
          index + 1
        ].id
      : null;

  await saveCurrentEditorPage(
    true
  );

  if (nextId) {
    await nextPaint();

    await openEditor(
      nextId
    );

  } else {
    closeEditor();

    renderPages();
  }
}

async function applyEditorToAll() {
  if (
    !state.editor ||
    !state.pages.length
  ) {
    return;
  }

  const confirmed =
    confirm(
      "Apply this page's filter, Magic strength, rotation and crop to ALL pages?"
    );

  if (!confirmed) {
    return;
  }

  const template =
    clone(
      state.editor.edit
    );

  for (
    const page
    of state.pages
  ) {
    page.edit =
      clone(
        template
      );
  }

  const button =
    $("peApplyAll");

  const originalText =
    button.textContent;

  button.disabled =
    true;

  button.textContent =
    "Applying to all…";

  try {
    for (
      let i = 0;
      i <
      state.pages.length;
      i++
    ) {
      await refreshThumbnail(
        state.pages[i]
      );

      if (
        i % 2 === 1
      ) {
        await nextPaint();
      }
    }

    renderPages();

    button.textContent =
      "Applied to all ✓";

    setTimeout(
      () => {
        if (
          $("peApplyAll")
        ) {
          $("peApplyAll")
            .textContent =
              originalText;
        }
      },
      1300
    );

  } catch (error) {
    console.warn(
      "Apply to all failed:",
      error
    );

    setError(
      "Some thumbnails could not be refreshed, but the settings were saved."
    );

    button.textContent =
      originalText;

  } finally {
    button.disabled =
      false;
  }
}

/* =========================
   THUMBNAILS
   ========================= */

function renderPages() {
  $("pageCount").textContent =
    `${state.pages.length} ${
      state.pages.length === 1
        ? "page"
        : "pages"
    }`;

  $("generateBtn").disabled =
    state.busy ||
    !state.pages.length;

  $("thumbStrip").innerHTML =
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

  $("addMoreBtn").onclick =
    showSource;

  state.sortable?.destroy();

  state.sortable =
    new Sortable(
      $("thumbStrip"),
      {
        animation: 150,

        draggable:
          ".thumb",

        handle:
          ".drag",

        ghostClass:
          "ghost",

        chosenClass:
          "chosen",

        onEnd(event) {
          const from =
            event.oldDraggableIndex;

          const to =
            event.newDraggableIndex;

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
            state.pages.splice(
              from,
              1
            );

          state.pages.splice(
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
    state.pages.findIndex(
      (page) =>
        page.id === id
    );

  if (
    index < 0
  ) {
    return;
  }

  const result =
    await Camera.takePhoto({
      quality: 95,

      targetWidth: 2600,

      targetHeight: 2600,

      correctOrientation: true,

      saveToGallery: false,

      includeMetadata: true,

      editable: "no",
    });

  const blob =
    await mediaResultToBlob(
      result
    );

  const page =
    state.pages[index];

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
  state.pages.forEach(
    (page) =>
      URL.revokeObjectURL(
        page.thumbUrl
      )
  );

  state.pages = [];

  $("progressWrap").hidden =
    true;

  $("progressBar").style.width =
    "0%";

  setError("");

  $("createPanel").hidden =
    false;

  $("successPanel").hidden =
    true;

  renderPages();
}

/* =========================
   PDF GENERATION
   ========================= */

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

    $("generateBtn").disabled =
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
          0.82
        );

      const image =
        await pdf.embedJpg(
          await jpg.arrayBuffer()
        );

      const pageWidth =
        595;

      const pageHeight =
        pageWidth *
        image.height /
        image.width;

      const pdfPage =
        pdf.addPage([
          pageWidth,
          pageHeight,
        ]);

      pdfPage.drawImage(
        image,
        {
          x: 0,

          y: 0,

          width:
            pageWidth,

          height:
            pageHeight,
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

    $("createPanel").hidden =
      true;

    $("successPanel").hidden =
      false;

    $("successText").textContent =
      `${filename} · ${
        bytesLabel(
          blob.size
        )
      } · ${
        state.pages.length
      } pages`;

    await renderLibrary();

  } catch (error) {
    console.error(error);

    setError(
      error?.message ||
      "Could not generate PDF."
    );

  } finally {
    state.busy =
      false;

    $("generateBtn").disabled =
      !state.pages.length;
  }
}

/* =========================
   PDF VIEW / DOWNLOAD
   ========================= */

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
              reader.result || ""
            );

          resolve(
            value.includes(",")
              ? value.split(",")[1]
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
    await Filesystem.writeFile({
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

    if (!record) {
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
        .openDocumentFromLocalPath({
          path:
            uri,
        });

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

  } catch (error) {
    alert(
      error?.message ||
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

    if (!record) {
      throw new Error(
        "PDF not found."
      );
    }

    await Filesystem.writeFile({
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

  } catch (error) {
    try {
      const record =
        await dbGet(id);

      if (!record) {
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

/* =========================
   LOCAL LIBRARY
   ========================= */

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

  if (!rows.length) {
    $("libraryGrid").innerHTML =
      `
        <div
          class="empty-library"
        >
          No test PDFs yet.
        </div>
      `;

    return;
  }

  $("libraryGrid").innerHTML =
    rows
      .map(
        (record) => `
          <article
            class="card"
            data-id="${record.id}"
          >

            <div class="subject">
              ${record.subject}
            </div>

            <h3>
              ${record.filename}
            </h3>

            <div class="meta">
              ${record.type}
              ·
              ${record.year}
              ·
              ${bytesLabel(
                record.size
              )}
            </div>

            <div class="meta">
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

/* =========================
   SOURCE SHEET + EVENTS
   ========================= */

function showSource() {
  $("sourceSheet").hidden =
    false;
}

function hideSource() {
  $("sourceSheet").hidden =
    true;
}

ensureSubjectSelector();

installEditor();

$("addPhotosBtn").onclick =
  showSource;

$("firstAddBtn").onclick =
  showSource;

$("cancelSourceBtn").onclick =
  hideSource;

$("cameraBtn").onclick =
  async () => {
    hideSource();

    try {
      await capturePhoto();

    } catch (error) {
      if (
        !String(
          error?.message || ""
        )
          .toLowerCase()
          .includes("cancel")
      ) {
        setError(
          error?.message ||
          "Camera failed."
        );
      }
    }
  };

$("galleryBtn").onclick =
  async () => {
    hideSource();

    try {
      await chooseMultiplePhotos();

    } catch (error) {
      if (
        !String(
          error?.message || ""
        )
          .toLowerCase()
          .includes("cancel")
      ) {
        setError(
          error?.message ||
          "Gallery selection failed."
        );
      }
    }
  };

$("thumbStrip")
  .addEventListener(
    "click",
    async (event) => {
      const thumb =
        event.target.closest(
          ".thumb"
        );

      if (!thumb) {
        return;
      }

      const id =
        thumb.dataset.id;

      if (
        event.target.closest(
          '[data-act="edit"]'
        )
      ) {
        await openEditor(id);
        return;
      }

      if (
        event.target.closest(
          '[data-act="delete"]'
        )
      ) {
        const index =
          state.pages.findIndex(
            (page) =>
              page.id === id
          );

        if (
          index >= 0
        ) {
          URL.revokeObjectURL(
            state.pages[
              index
            ].thumbUrl
          );

          state.pages.splice(
            index,
            1
          );

          renderPages();
        }

        return;
      }

      if (
        event.target.closest(
          '[data-act="retake"]'
        )
      ) {
        try {
          await retake(id);

        } catch (error) {
          if (
            !String(
              error?.message || ""
            )
              .toLowerCase()
              .includes("cancel")
          ) {
            setError(
              error?.message ||
              "Retake failed."
            );
          }
        }
      }
    }
  );

$("generateBtn").onclick =
  generatePdf;

$("addAnotherBtn").onclick =
  resetComposer;

$("viewLibraryBtn").onclick =
  () => {
    $("libraryPanel")
      .scrollIntoView({
        behavior:
          "smooth",

        block:
          "start",
      });
  };

$("downloadLatestBtn").onclick =
  () => {
    if (
      state.latestId
    ) {
      downloadRecord(
        state.latestId
      );
    }
  };

$("libraryGrid")
  .addEventListener(
    "click",
    async (event) => {
      const card =
        event.target.closest(
          ".card"
        );

      if (!card) {
        return;
      }

      const id =
        card.dataset.id;

      if (
        event.target.closest(
          '[data-act="view"]'
        )
      ) {
        await viewRecord(id);
        return;
      }

      if (
        event.target.closest(
          '[data-act="download"]'
        )
      ) {
        await downloadRecord(id);
        return;
      }

      if (
        event.target.closest(
          '[data-act="delete"]'
        )
      ) {
        await dbDelete(id);

        await renderLibrary();
      }
    }
  );

$("clearLibraryBtn").onclick =
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

renderPages();

renderLibrary();
