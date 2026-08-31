# Stat Archive — Create Entry Test

This is an isolated Android/Capacitor test app. It does not connect to Supabase, Cloudflare Worker, Firebase, S3, or the live Stat Archive library.

What it tests:
- Native camera capture using `CameraSource.Camera`
- Gallery selection using `CameraSource.Photos`
- Reorderable thumbnails with SortableJS
- Retake and delete
- JPEG compression to about 1600px max width at ~0.70 quality
- One image per PDF page using pdf-lib
- Auto filename and PDF metadata title
- Progress UI
- Local persistence in IndexedDB
- Mock library card
- View/download generated PDF

## Build

```bash
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Then build/run from Android Studio on your phone.

If the Android platform already exists, skip `npx cap add android` and use:

```bash
npm run build
npx cap sync android
npx cap open android
```

Important: native camera behavior must be tested in the Android app, not only with `npm run dev` in a desktop browser.

No backend credentials are included.
