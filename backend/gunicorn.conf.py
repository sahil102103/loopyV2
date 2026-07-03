# Gunicorn configuration — auto-loaded when the server is started with
# `gunicorn app:app` from this directory (as on Render).
#
# Why this exists: heavy analyses like /optimize-parameters run a large
# parameter sweep that can take well over gunicorn's DEFAULT 30s worker
# timeout. When a worker is killed mid-request, gunicorn returns a bare 500
# page with no CORS header, which the browser surfaces as a misleading
# "blocked by CORS policy / Failed to fetch" error. Raising the timeout lets
# these requests finish and return the app's normal JSON (with CORS headers).
#
# NOTE: an explicit `--timeout` flag in the Render start command would override
# this file. If long analyses still time out after deploying, set the Render
# start command to `gunicorn app:app` (no --timeout) or `--timeout 180`.

timeout = 180            # seconds; was defaulting to 30
graceful_timeout = 180
# Keep a single worker to stay within the free tier's memory (numpy / sklearn /
# matplotlib are large); Render can override workers via its start command.
workers = 1
