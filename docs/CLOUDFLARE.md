# Cloudflare Worker setup for Google-backed plan sync

This project now supports an optional Cloudflare Worker backend for storing one saved JSON plan per Google-authenticated user.

## 1. Create a Worker

1. Open the Cloudflare dashboard and create a new Worker.
2. Replace the default worker code with the contents of [workers/plan-worker.js](../workers/plan-worker.js).
3. Add a KV namespace binding named `PLANS`.
4. Add a secret or variable named `GOOGLE_CLIENT_ID` with your Google OAuth client ID.

## 2. Configure Google OAuth

1. Create a Google Cloud OAuth client ID for a web application.
2. Add your Worker origin and your frontend origin to the Authorized JavaScript origins.
3. Keep the client ID ready for the planner UI.

## 3. Point the app at the Worker

In the planner UI, open the Save / Load page and fill in:

- Cloudflare Worker URL: `https://your-worker.your-subdomain.workers.dev`
- Google OAuth Client ID: your Google client ID

Then click Sign in with Google, and use the cloud buttons to load/save your plan.

## 4. Notes

- The worker verifies the Google ID token using Google's tokeninfo endpoint.
- Each signed-in user can read/write only their own stored plan JSON.
- The normal local file-based workflow still works even if you do not configure cloud sync.
