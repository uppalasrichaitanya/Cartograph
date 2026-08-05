# Cartograph

Cartograph turns a JavaScript, TypeScript, or Python project zip into a shareable, interactive dependency map. Graph structure comes only from static analysis: no model creates, removes, or reroutes nodes or edges.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `BLOB_READ_WRITE_TOKEN` to a token for a **public** Vercel Blob store. The app uses Vercel Blob's current client-upload token exchange at `/api/upload-url`, so the raw zip is uploaded directly from the browser instead of passing through a Vercel Function.
The uploaded zip is deleted after the analysis attempt; only the shareable result JSON remains in Blob.

## Deploy to Vercel

1. Create a public Vercel Blob store for the project and ensure `BLOB_READ_WRITE_TOKEN` is configured for the deployment environment.
2. Deploy the Next.js app. The analysis routes request a 300-second duration, which requires Vercel Fluid Compute (the current Hobby Fluid Compute maximum is 300 seconds).
3. Upload a zip. The app enforces a 25 MB compressed upload limit, a 250 MB extracted-size limit, and an 800 source-file limit.

## Verification

```powershell
npm run test
npm run build
```

The tests cover alias/re-export extraction, cycle and orphan detection, and the extraction-size safety check.
