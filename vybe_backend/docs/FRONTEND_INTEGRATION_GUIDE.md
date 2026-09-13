# Vybe Backend — Frontend Integration Guide (React)

Audience: the React.js client team building against the Vybe backend. This document reflects the **actual current implementation** (verified against source, not a design spec) — every path, field name, status code, and error code below exists in the code today.

Base API path for everything in this document: `http://<host>/api/v1` (e.g. `http://localhost:4000/api/v1` in local dev — see `PORT` in the backend's `.env`). Socket.IO connects to the plain origin, no `/api/v1` prefix (e.g. `http://localhost:4000`).

---

## Table of contents

1. [Environment setup](#1-environment-setup)
2. [Response envelope & error handling](#2-response-envelope--error-handling)
3. [Authentication](#3-authentication)
4. [Calling authenticated endpoints (the API client)](#4-calling-authenticated-endpoints-the-api-client)
5. [Rate limiting](#5-rate-limiting)
6. [Users](#6-users)
7. [Follow](#7-follow)
8. [Posts](#8-posts)
9. [Chat — REST](#9-chat--rest)
10. [Chat — Realtime (Socket.IO)](#10-chat--realtime-socketio)
11. [Pagination cursors — three different formats, do not mix them](#11-pagination-cursors--three-different-formats-do-not-mix-them)
12. [Idempotency keys — client responsibilities](#12-idempotency-keys--client-responsibilities)
13. [File uploads](#13-file-uploads)
14. [Checklist before shipping](#14-checklist-before-shipping)

---

## 1. Environment setup

Use Vite (or your chosen bundler) env vars — do not hardcode URLs:

```env
# .env.local
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
VITE_GOOGLE_CLIENT_ID=<same GOOGLE_CLIENT_ID the backend uses>
```

The backend's CORS allow-list (`CLIENT_ORIGINS` in its `.env`) must include your frontend's exact origin (scheme + host + port), or every request will be blocked by the browser before it reaches the API. Ask backend to add `http://localhost:5173` (Vite's default) or whatever you actually run on — comma-separated, multiple origins are supported.

No cookies are used anywhere in this API — CORS is configured without `credentials: true` on purpose. Do not set `credentials: 'include'` on your fetch/axios calls or add `withCredentials: true`; it isn't needed and doesn't do anything here.

---

## 2. Response envelope & error handling

**Every** successful response has this exact shape:

```json
{
  "success": true,
  "message": "Human-readable message or null",
  "data": { "...": "endpoint-specific payload" },
  "timestamp": "2026-09-13T08:59:21.221Z"
}
```

**Every** error response — regardless of which module raised it — has this exact shape:

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message, safe to show the user",
    "details": null
  },
  "timestamp": "2026-09-13T08:59:21.221Z"
}
```

`details` is `null` for most errors. It's populated in exactly two cases:
- **Validation errors** (`code: "VALIDATION_ERROR"`, `400`): `details` is an array of `{ field, message }`, one per failed field — e.g. `[{ "field": "email", "message": "\"email\" must be a valid email" }]`. Use this to highlight the specific form field(s).
- **Account lockout** (`code: "ACCOUNT_LOCKED"`, `423`): `details` is `{ "lockedUntil": "2026-09-13T09:10:00.000Z" }` — use this to show a countdown.

**Build error handling around `error.code`, never around `error.message` or the HTTP status alone** — messages may be reworded over time, but codes are stable. Full code reference:

| HTTP | Code | Module | Meaning |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | any (generic) | Request body/query/params failed schema validation — see `details` |
| 400 | `CANNOT_FOLLOW_SELF` | follow | Tried to follow your own username |
| 400 | `CANNOT_MESSAGE_SELF` | chat | Tried to start a conversation with yourself |
| 400 | `INVALID_PROFILE_PHOTO` | users | Bad/unrecognized image (also thrown if no file was attached) |
| 401 | `INVALID_CREDENTIALS` | auth | Wrong email or password (deliberately the same message for both, to prevent user enumeration) |
| 401 | `INVALID_REFRESH_TOKEN` | auth | Refresh token missing, expired, unknown, or already used (reuse-detected) — **treat as "session ended," force a full re-login** |
| 401 | `MISSING_ACCESS_TOKEN` | auth | No/blank `Authorization` header |
| 401 | `INVALID_ACCESS_TOKEN` | auth | Access token expired or malformed — **this is the one to auto-refresh on**, see §4 |
| 401 | `GOOGLE_AUTH_FAILED` | auth | Bad/unverifiable Google ID token, unverified email, or the email already belongs to a local (non-Google) account |
| 403 | `NOT_FOLLOWING` | chat | You don't currently follow the user you're trying to message |
| 404 | `USER_NOT_FOUND` | users/follow/chat | Username doesn't exist or the account is deactivated |
| 404 | `POST_NOT_FOUND` | posts | Post doesn't exist, **or** it exists but isn't yours (deliberately ambiguous on mutation routes — never assume 404 means "doesn't exist" when editing/deleting) |
| 404 | `CONVERSATION_NOT_FOUND` | chat | Conversation doesn't exist, **or** you're not a participant (same deliberate ambiguity) |
| 404 | `MESSAGE_NOT_FOUND` | chat | Message id doesn't belong to that conversation |
| 404 | `ROUTE_NOT_FOUND` | generic | Wrong path/method entirely |
| 409 | `EMAIL_ALREADY_EXISTS` | auth | Registration: email taken |
| 409 | `USERNAME_ALREADY_EXISTS` | auth | Registration: username taken |
| 400 | `POST_VALIDATION_ERROR` | posts | Edit submitted with neither text nor media |
| 400 | `UNSUPPORTED_POST_MEDIA` | posts | File content doesn't match any supported image/video signature (checked by real byte-sniffing, not the filename/claimed MIME type) |
| 400 | `POST_MEDIA_TOO_LARGE` | posts | Image/video exceeds its size limit |
| 400 | `PROFILE_PHOTO_TOO_LARGE` | users | Photo exceeds the image size limit |
| 423 | `ACCOUNT_LOCKED` | auth | Too many failed logins — see `details.lockedUntil` |
| 429 | `TOO_MANY_REQUESTS` | generic | Rate limited — see §5 |
| 500 | `INTERNAL_ERROR` / `USERNAME_ALLOCATION_FAILED` | generic/auth | Unexpected server error — show a generic "something went wrong, try again" |

---

## 3. Authentication

### 3.1 Register

```
POST /auth/register
{ "name": "Ada Lovelace", "username": "ada", "email": "ada@example.com", "password": "at-least-8-chars", "country": "US" }
```
`country` is optional (ISO 3166-1 alpha-2, e.g. `"US"`). `username` must match `/^[a-z0-9_.]{3,30}$/` (lowercased automatically). Password: 8–128 characters, no forced complexity rules (this backend follows current NIST guidance — don't invent client-side complexity rules like "must contain a symbol," they're not enforced server-side and just annoy users).

Response `201`:
```json
{ "data": {
  "user": { "id": "...", "name": "...", "username": "...", "email": "...", "authProvider": "local", "profilePhotoUrl": "" },
  "accessToken": "eyJ...", "refreshToken": "9f1a...c02" } }
```

### 3.2 Login

```
POST /auth/login
{ "email": "ada@example.com", "password": "..." }
```
Same response shape as register, `200`. After 5 consecutive failed attempts (`LOGIN_MAX_FAILED_ATTEMPTS`, configurable), the account locks for 15 minutes (`LOGIN_LOCK_DURATION_MS`) — you'll get `423 ACCOUNT_LOCKED` with `details.lockedUntil`.

### 3.3 Google Sign-In

This backend uses **ID-token verification**, not the OAuth2 authorization-code flow — there is no client secret involved and no redirect dance. On the frontend:

1. Load Google Identity Services (`https://accounts.google.com/gsi/client`) and render the official "Sign in with Google" button, configured with `VITE_GOOGLE_CLIENT_ID`.
2. Google's callback hands you a **credential** (a JWT ID token) — send it straight to the backend, don't decode/inspect it yourself:
```
POST /auth/google
{ "idToken": "<the credential string from Google>" }
```
3. Response is identical in shape to register/login (`200`), plus `user.googleId` is present (only for Google-linked accounts — check for its existence, don't assume it's always there).

Important behavior to design around: **this backend does NOT auto-link a Google sign-in to an existing local-password account that happens to share the same email.** If someone registered locally with `ada@example.com` and later hits "Sign in with Google" using that same email, they get `401 GOOGLE_AUTH_FAILED` — show a message like "This email is already registered with a password — log in that way instead," don't imply it's a generic failure.

### 3.4 Token model — read this before writing any storage code

- **Access token**: JWT, 15 minutes by default (`JWT_ACCESS_EXPIRES_IN`). Sent as `Authorization: Bearer <token>` on every authenticated request. Stateless — the server never looks it up in a database, it just verifies the signature.
- **Refresh token**: an opaque random string (**not** a JWT — don't try to decode it), 30 days by default (`JWT_REFRESH_EXPIRES_IN`). The server stores only its SHA-256 hash. **Every refresh call rotates it** — the response gives you a brand-new refresh token, and the old one is immediately invalid. **You must overwrite your stored refresh token on every single refresh response** — reusing an old one (e.g. a stale copy in another tab) is treated as token theft and revokes the *entire* session, logging out every device.
- **Both tokens are returned in the JSON response body only — there is no cookie involved anywhere.** This means your frontend is fully responsible for storage. Recommended approach, in order of preference:
  1. **Access token: in-memory only** (a module-level variable or a React context/store, never `localStorage`). It's short-lived and re-issued via refresh, so losing it on a hard page reload is cheap and expected.
  2. **Refresh token**: this is the one real trade-off. `localStorage`/`sessionStorage` is readable by any script on the page (XSS risk), but this API has no other mechanism to persist a session across a page reload. If you go this route, treat it as an accepted risk mitigated by your app's overall XSS hygiene (React's default JSX escaping, a strict CSP, no `dangerouslySetInnerHTML` with unsanitized content, no third-party scripts you don't control). Do not put it in a place readable cross-site (it already isn't sent automatically anywhere, unlike a cookie, so this is strictly better than a non-`httpOnly` cookie would be).
  3. On app load, if a stored refresh token exists, call `/auth/refresh` immediately to get a fresh access token before rendering anything that needs auth — treat a failure here (`INVALID_REFRESH_TOKEN`) as "not logged in," clear storage, and route to login.

### 3.5 Refresh

```
POST /auth/refresh
{ "refreshToken": "<current refresh token>" }
```
`200` → `{ accessToken, refreshToken }` (both new). `401 INVALID_REFRESH_TOKEN` → the session is over, clear all stored tokens and redirect to login. No `Authorization` header needed on this call — the refresh token itself is the credential.

### 3.6 Logout

```
POST /auth/logout
{ "refreshToken": "<current refresh token>" }
```
Idempotent — calling it with no body, or with an already-invalid token, still returns `200`. Always call this on explicit user logout (it revokes the token server-side; simply deleting it client-side leaves it valid until it naturally expires in up to 30 days).

---

## 4. Calling authenticated endpoints (the API client)

Centralize this in one place — every authenticated request needs the header, and every 401 needs the same refresh-and-retry behavior. The tricky part is avoiding a **stampede of concurrent refresh calls** when several requests fail with an expired token at the same moment (e.g. a page that fires 4 requests in parallel on mount) — the pattern below shares a single in-flight refresh across all of them.

```js
// api/client.js
const BASE_URL = import.meta.env.VITE_API_BASE_URL;

let accessToken = null;      // in-memory only
let refreshPromise = null;   // de-dupes concurrent refresh attempts

export function setAccessToken(token) { accessToken = token; }
export function getRefreshToken() { return localStorage.getItem('vybe_refresh_token'); }
export function setRefreshToken(token) {
  if (token) localStorage.setItem('vybe_refresh_token', token);
  else localStorage.removeItem('vybe_refresh_token');
}

async function rawRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function refreshTokens() {
  if (!refreshPromise) {
    refreshPromise = rawRequest('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: getRefreshToken() }),
    }).finally(() => { refreshPromise = null; });
  }
  const { status, json } = await refreshPromise;
  if (status !== 200) {
    setAccessToken(null);
    setRefreshToken(null);
    throw new SessionExpiredError();
  }
  setAccessToken(json.data.accessToken);
  setRefreshToken(json.data.refreshToken); // MUST persist the rotated token
  return json.data.accessToken;
}

export class SessionExpiredError extends Error {}

export async function apiRequest(path, options = {}) {
  let { status, json } = await rawRequest(path, options);

  if (status === 401 && json?.error?.code === 'INVALID_ACCESS_TOKEN') {
    await refreshTokens();                       // shared across concurrent callers
    ({ status, json } = await rawRequest(path, options)); // retry once
  }

  if (!json || !json.success) {
    const err = new Error(json?.error?.message || 'Request failed');
    err.code = json?.error?.code;
    err.status = status;
    err.details = json?.error?.details;
    throw err;
  }
  return json.data;
}
```

Notes on why it's built this way:
- Retries **only** on `INVALID_ACCESS_TOKEN`, never on `MISSING_ACCESS_TOKEN` (that means your code forgot to attach a token — a bug, not an expiry) or `INVALID_REFRESH_TOKEN` (already the result of a refresh attempt — retrying would loop).
- Retries **exactly once** per request — if the retried call still 401s, something else is wrong; don't loop.
- On `SessionExpiredError` anywhere in your app, clear all app state and route to `/login` — don't just show a toast and let the user keep clicking.

---

## 5. Rate limiting

Every response carries standard rate-limit headers (`RateLimit`, `RateLimit-Policy`, per the IETF draft-8 format), so you can proactively back off instead of waiting for a 429. Current default budgets (server-configurable, confirm with backend for the deployed values):

| Route group | Window | Default max |
|---|---|---|
| `/auth/register`, `/auth/login`, `/auth/google`, `/auth/refresh` | 15 min | 10 requests |
| Everything else (general) | 1 min | 120 requests |
| Endpoints that accept a file upload (post media, profile photo) | 15 min | 30 requests |
| `POST /chat/conversations/:id/messages` | 1 min | 60 requests |

**A global "general" limiter runs on every request first, before any route-specific one** — so a route with its own limiter (auth, upload, chat-send) is actually covered by *two* limiters at once, and both show up in the header as **separate, comma-separated entries** (verified directly: `express-rate-limit` appends rather than overwrites for the draft-8 format). A real captured example from `POST /auth/register`:
```
RateLimit: "120-in-1min"; r=119; t=60, "10-in-15min"; r=9; t=900
```
Don't `.split(',')` naively assuming one entry — parse each `"name"; r=remaining; t=resetSeconds` segment and take whichever has the smallest `r` (remaining) if you want a single "how close to limited am I" number.

On `429 TOO_MANY_REQUESTS`: show "You're doing that too fast, please wait a moment" — don't auto-retry in a tight loop; if you retry at all, back off using the window the header implies.

---

## 6. Users

All routes require `Authorization: Bearer <accessToken>` unless noted.

| Method & path | Body / query | Notes |
|---|---|---|
| `GET /users/me` | — | Full profile incl. `email`, `authProvider`, and counts |
| `PATCH /users/me` | `{ name?, bio?, country?, isPrivate? }` (at least one) | Partial update — omit fields you're not changing |
| `POST /users/me/profile-photo` | multipart, field name **`photo`** | See §13 |
| `GET /users/search?q=<term>&cursor=&limit=` | `q` required (1–50 chars) | Matches username-prefix OR name-substring; cursor is a **plain username string**, not an id — see §11 |
| `GET /users/:username` | — | Public profile (no `email`) |

`toProfileDTO`/`toMeDTO` shape (fields returned by `getMe`/`getByUsername`/`updateMe`/`search`):
```json
{
  "id": "...", "name": "...", "username": "...", "bio": "...",
  "profilePhotoUrl": "", "country": "US", "isPrivate": false,
  "followersCount": 0, "followingCount": 0, "postsCount": 0,
  "createdAt": "...",
  "email": "only present on /users/me", "authProvider": "only present on /users/me"
}
```

`isPrivate: true` gates that user's **posts** from anyone who doesn't follow them (see §8) — it does not hide their profile card, username search result, or followers/following lists.

---

## 7. Follow

| Method & path | Notes |
|---|---|
| `POST /follow/:username` | Idempotent — following someone you already follow just returns the current state, no error |
| `DELETE /follow/:username` | Idempotent — unfollowing someone you don't follow returns `200`, not an error |
| `GET /follow/:username/status` | `{ "following": true/false }` — **directional**: does *the current user* follow `:username` |
| `GET /follow/:username/followers?cursor=&limit=` | `{ users: [...], nextCursor }` |
| `GET /follow/:username/following?cursor=&limit=` | Same shape |

Both follow/unfollow return `{ "following": true|false }`. Update your local follow-state/cache optimistically on click, but reconcile with the response — don't assume the request always succeeds before the response arrives.

---

## 8. Posts

Post create/edit are **always `multipart/form-data`**, even for text-only posts — media is optional but the transport is fixed either way.

| Method & path | Fields | Notes |
|---|---|---|
| `POST /posts` | `text` (1–500 chars, required), `clientRequestId` (optional), `media` (optional file) | See §12 for `clientRequestId` |
| `PATCH /posts/:postId` | `text` and/or `media` — **at least one** | Owner only |
| `DELETE /posts/:postId` | — | Owner only, soft-delete |
| `GET /posts/id/:postId` | — | Respects private-account gating |
| `GET /posts/user/:username?cursor=&limit=` | — | See private-account response shape below |
| `PUT /posts/:postId/like` | `{ "liked": true \| false }` | Idempotent — see §8.1 |

Media field name is **`media`** (not `file`/`image`). Allowed: PNG/JPEG/WebP images, MP4/WebM/QuickTime(.mov) videos — validated by real byte-content sniffing server-side, not by filename or the `Content-Type` you send, so don't bother spoofing it and don't rely on client-side extension checks as the actual gate (they're just UX, the server is the real check).

Post object shape:
```json
{
  "id": "...", "author": { "id": "...", "username": "...", "name": "...", "profilePhotoUrl": "" },
  "text": "...", "mediaUrl": null, "mediaType": null,
  "likesCount": 0, "isLiked": false, "isEdited": false, "createdAt": "...", "updatedAt": "..."
}
```
`isLiked` reflects **the requesting user's own** like state on that post — present on every post object returned anywhere (create, edit, get-by-id, list), computed server-side, never something you derive client-side.

### 8.1 Like / unlike

```
PUT /posts/:postId/like
{ "liked": true }
```

One endpoint, one method, for both liking and unliking — send the **target state**, not an action. This is deliberately not a toggle: a toggle endpoint isn't safely retryable (a client retry after a dropped response would flip the state back, silently reversing the user's actual intent), whereas sending `{ liked: true }` twice is always a safe no-op.

Response — `200` either way:
```json
{
  "success": true,
  "message": "Post liked",
  "data": { "liked": true, "likesCount": 43 },
  "timestamp": "2026-09-13T09:00:00.000Z"
}
```
`likesCount` in this response is the **authoritative, just-updated count** — use it to update the UI directly instead of re-fetching the post. Liking your own post is allowed (no restriction). Liking a post behind a private account you don't follow returns `404 POST_NOT_FOUND` — same ambiguous convention as everywhere else (never reveals whether the post exists).

No dedicated rate limit on this route — it rides the general limiter (§5), same as Follow.

**Private-account response** for `GET /posts/user/:username` when the viewer doesn't own the account and isn't allowed to see it:
```json
{ "data": { "isPrivate": true, "isFollowing": false, "posts": [], "nextCursor": null } }
```
This is a `200`, not a `403`/`404` — check `data.isPrivate` explicitly and render a "This account is private" state, don't treat an empty `posts` array as "no posts yet."

Editing/deleting a post you don't own returns `404 POST_NOT_FOUND` (not `403`) — deliberately indistinguishable from "the post doesn't exist," so don't build UI copy that says "you don't have permission" based on this code; just say "post not found."

---

## 9. Chat — REST

All chat actions require you to **currently follow the other participant** — this is enforced fresh on **every** send, not just at conversation creation. If you unfollow someone mid-conversation, your next send attempt gets `403 NOT_FOLLOWING` even though the conversation and its history still exist and remain readable.

| Method & path | Body / query | Notes |
|---|---|---|
| `POST /chat/conversations` | `{ "username": "bob" }` | Idempotent (`201` new / `200` existing) — `403 NOT_FOLLOWING` if you don't follow them |
| `GET /chat/conversations?cursor=&limit=` | — | Most-recently-active conversation first; cursor is an opaque blob — see §11 |
| `GET /chat/conversations/:conversationId/messages?cursor=&limit=` | — | Newest-first; cursor is the message's `id` |
| `POST /chat/conversations/:conversationId/messages` | `{ "content": "...", "clientMessageId": "..." }` | See §12 |
| `POST /chat/conversations/:conversationId/read` | `{ "lastReadMessageId": "<message id>" }` | Marks that message **and every earlier one** as read in one call — don't call this per-message |

Conversation object:
```json
{ "id": "...", "peer": { "id": "...", "username": "...", "name": "...", "profilePhotoUrl": "" },
  "lastMessageText": "...", "lastMessageAt": "...", "lastMessageBy": "<userId>",
  "myLastReadAt": "...", "createdAt": "..." }
```

Message object:
```json
{ "id": "...", "conversation": "...", "sender": "<userId>", "content": "...",
  "clientMessageId": null, "status": "sent" | "delivered" | "read", "createdAt": "..." }
```

`status` is only meaningful for messages **you sent** — render single/double/blue ticks from it directly, no client-side computation needed:
- `"sent"` — persisted, recipient hasn't received it live yet (they were offline).
- `"delivered"` (double tick) — the recipient's app had an active connection when it arrived, or came back online and caught up.
- `"read"` (blue double tick) — the recipient explicitly opened the conversation past this point.

For messages the other person sent (in your own inbox view), you can ignore `status` — it describes delivery *to the recipient*, not to you as the reader.

**When to call `POST /read`**: on the conversation screen mounting *and* whenever a new message arrives while it's open (e.g. from the `message:new` socket event) — send the newest visible message's id. This is what flips the *other* person's ticks to blue in real time (see §10).

---

## 10. Chat — Realtime (Socket.IO)

Install `socket.io-client` matching the backend's major version (currently v4). Connect to `VITE_SOCKET_URL` (the plain origin, no `/api/v1`).

### 10.1 Connecting

Auth is passed via the handshake `auth` payload, **not** a header — and it must be a **function**, not a static object, because your access token rotates every 15 minutes and the client needs to send the *current* one on every reconnect attempt (not whatever it was when the socket was first created):

```js
import { io } from 'socket.io-client';
import { getAccessToken } from '../api/client';

const socket = io(import.meta.env.VITE_SOCKET_URL, {
  auth: (cb) => cb({ token: getAccessToken() }),
  autoConnect: false,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
});
```

Connect it once you have a valid access token (after login/refresh), and disconnect on logout. A handshake with a missing or expired token is rejected with a structured error on `connect_error`:

```js
socket.on('connect_error', (err) => {
  // err.message is human-readable; err.data = { code: 'MISSING_ACCESS_TOKEN' | 'INVALID_ACCESS_TOKEN', message }
  if (err.data?.code === 'INVALID_ACCESS_TOKEN') {
    // your access token expired between connect attempts — refresh then socket.connect() again
  }
});
```

### 10.2 Event catalog

**You emit → server:**

| Event | Payload | Purpose |
|---|---|---|
| `conversation:join` | `{ conversationId }`, supports an ack callback | Call when a chat screen opens. Server re-validates you're a participant **and still follow the peer** — use the ack to know if it was rejected |
| `conversation:leave` | `{ conversationId }` | Call on unmount/navigating away |
| `typing:start` / `typing:stop` | `{ conversationId }` | Debounce these client-side (e.g. on keypress, with a trailing `typing:stop` after ~2s of inactivity) — don't fire on every keystroke |

```js
socket.emit('conversation:join', { conversationId }, (ack) => {
  if (!ack.success) {
    // ack.error = { code: 'CONVERSATION_NOT_FOUND', message: '...' }
  }
});
```

**Server emits → you:**

| Event | Payload | When |
|---|---|---|
| `message:new` | `{ message: {...same shape as REST message object, minus `status`} }` | New message in a conversation room you've joined |
| `message:status` | `{ conversationId, userId, lastDeliveredAt?, lastReadAt? }` | A participant's delivery/read watermark advanced — re-fetch or recompute affected messages' ticks |
| `conversation:new` | `{ conversationId }` | Someone started a new conversation with you — refresh your conversation list |
| `conversation:updated` | `{ conversationId, lastMessageText, lastMessageAt, lastMessageBy }` | A message arrived in a conversation you're *not* currently viewing — update the list preview without needing to have joined that room |
| `typing` | `{ conversationId, userId, isTyping }` | The other participant's typing state changed |
| `error` | `{ code, message }` | **Only** fires if you call `conversation:join` *without* an ack callback and it's rejected (e.g. not a participant). `conversation:leave`/`typing:start`/`typing:stop` never throw or emit `error` at all — a bad payload to those is silently ignored, not surfaced. **Always pass an ack callback to `conversation:join`** (as shown in §10.2) so you get the failure synchronously instead of relying on this fallback. |

### 10.3 Why both REST and sockets

**Sending a message always goes through REST** (`POST /chat/conversations/:id/messages`), never a socket emit — the socket is purely for receiving live updates. This also means: on `message:new`, don't assume it's the full picture — a client that was offline or reconnecting should always reconcile via `GET /messages` (cursor-paginated) rather than trusting the socket alone caught everything.

**Connection-state recovery is enabled server-side** (verified directly against the running config), and it genuinely works — confirmed by forcing a raw transport kill mid-test and watching a message sent during the gap get replayed on reconnect with `socket.recovered === true`. One precise limitation worth knowing, also verified directly against Socket.IO's own server code: **recovery requires the socket to have already received at least one room-broadcast event before the disconnect** — the server only attempts to restore a session when the reconnect handshake carries both a `pid` *and* a string `offset`, and the offset only exists once something has actually been broadcast to a room that socket was in. Practically: if you `conversation:join` and your connection drops before *anything* (a message, a status update) has ever come through that room, the very first gap isn't recoverable — there's nothing to resume from, and you get a normal fresh connection instead. Every gap after that first received event *is* recoverable. Either way, always re-fetch via `GET /messages` on reconnect as the correctness guarantee — treat recovery purely as a latency/UX optimization for the common case, never as the mechanism you depend on for correctness.

### 10.4 Minimal React hook

```jsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useConversationSocket(conversationId, { getToken, onMessage, onStatus, onTyping }) {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL, {
      auth: (cb) => cb({ token: getToken() }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('conversation:join', { conversationId });
    });
    socket.on('message:new', ({ message }) => onMessage(message));
    socket.on('message:status', (payload) => onStatus(payload));
    socket.on('typing', (payload) => onTyping(payload));

    return () => {
      socket.emit('conversation:leave', { conversationId });
      socket.disconnect();
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const emitTypingStart = useCallback(() => socketRef.current?.emit('typing:start', { conversationId }), [conversationId]);
  const emitTypingStop = useCallback(() => socketRef.current?.emit('typing:stop', { conversationId }), [conversationId]);

  return { emitTypingStart, emitTypingStop };
}
```

One socket connection per app (not per conversation) is the more scalable pattern for a real inbox — join/leave rooms as the user navigates, rather than opening a new socket per screen. The example above is simplified for clarity; a production version should hoist the socket into a top-level context/provider created once at login and reused across the whole app.

---

## 11. Pagination cursors — three different formats, do not mix them

| Endpoint family | Cursor is... | Example |
|---|---|---|
| `GET /posts/user/:username`, `GET /chat/conversations/:id/messages` | A raw Mongo ObjectId (the last item's `id`) | `"6aa665e9eb7755514e140ac9"` |
| `GET /users/search` | The last result's plain `username` string | `"zara"` |
| `GET /chat/conversations` | An **opaque base64url blob** returned as `nextCursor` — do not decode, parse, or construct it yourself, just echo it back verbatim | `"eyJhIjoxNzM..."` |

In all three cases: pass whatever `nextCursor` the previous page returned, as-is, in the next request's `cursor` query param. `nextCursor: null` means you've reached the end. Never persist a cursor across unrelated queries (e.g. don't reuse a `posts` cursor for a different username's post list).

---

## 12. Idempotency keys — client responsibilities

Two endpoints accept a client-generated idempotency key so that a retried request (timeout, flaky connection, double-tap) never creates a duplicate:

- `POST /posts` → `clientRequestId`
- `POST /chat/conversations/:id/messages` → `clientMessageId`

Both: optional, 1–100 chars, must match `^[a-zA-Z0-9_-]+$`. **Generate one per logical action** (e.g. `crypto.randomUUID()` when the user hits "send"), and **reuse the exact same value if you retry that same send** — a fresh UUID on retry defeats the purpose entirely. A successful replay returns `200` (not `201`) with the *original* item, so check the status code if you need to know whether this was a new creation.

```js
const clientMessageId = crypto.randomUUID();
try {
  await sendMessage(conversationId, { content, clientMessageId });
} catch (err) {
  // safe to retry with the SAME clientMessageId — it will not create a duplicate
  await sendMessage(conversationId, { content, clientMessageId });
}
```

---

## 13. File uploads

Both upload endpoints use `multipart/form-data`, `FormData` in the browser — **do not set a `Content-Type` header yourself**, let the browser set the multipart boundary:

```js
const form = new FormData();
form.append('text', text);          // posts only
if (clientRequestId) form.append('clientRequestId', clientRequestId);
if (file) form.append('media', file);        // posts: field name "media"
// profile photo: form.append('photo', file) — field name "photo", no other fields

await fetch(`${BASE_URL}/posts`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
```

Size limits are enforced server-side (defaults: images 8 MB, videos 50 MB, both configurable) — validate client-side too for UX, but treat the server's `413`-equivalent (`400 POST_MEDIA_TOO_LARGE` / `400 PROFILE_PHOTO_TOO_LARGE`) as the real gate, not your own check.

---

## 14. Checklist before shipping

- [ ] Access token kept in memory only, never `localStorage`.
- [ ] Refresh token overwritten on **every** successful `/auth/refresh` and every login/register response — never reused after rotation.
- [ ] A single shared in-flight refresh (no stampede) feeding a 401-triggered retry-once policy, keyed on `error.code === 'INVALID_ACCESS_TOKEN'` specifically.
- [ ] `INVALID_REFRESH_TOKEN` anywhere → full logout + redirect, not a silent retry.
- [ ] Error UI keyed off `error.code`, not `error.message` or raw HTTP status.
- [ ] Socket `auth` is a function (re-evaluated per connection attempt), not a static object captured once.
- [ ] Conversation screens call `conversation:join` on mount and `conversation:leave` on unmount.
- [ ] `POST /read` is called on conversation open and on every new incoming message while it's open — not on a timer, not skipped.
- [ ] Typing events are debounced, not fired per keystroke.
- [ ] `clientRequestId`/`clientMessageId` reused across retries of the *same* action, freshly generated per *new* action.
- [ ] Cursors are echoed back verbatim per §11, never parsed or mixed across endpoints.
