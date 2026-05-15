# Service Request Portal

A web application for **call center agents** to file service requests on behalf of customers calling about company-manufactured equipment. Each request gets a unique case number, is persisted in MongoDB, and can be discussed with internal support via a one-click Microsoft Teams chat opened from the case screen.

## Features
- **Sign-in with Microsoft Entra ID (Azure AD)** using MSAL.js — only authenticated agents can submit cases.
- **Service-request form** capturing equipment details (serial number, product model, purchase date, issue description) and customer details (name, phone, email, address).
- **Auto-generated case numbers** in the form `SR-YYYYMMDD-NNNNN`, unique even under concurrent writes.
- **"Chat with Support" button** that opens a new Microsoft Teams chat pre-titled with the case number and a starter message containing the case context.
- **MongoDB persistence** with sensible indexes, including a unique index on `caseNumber`.
- **Podman script** to bring up a configured MongoDB container with the application database, user, and indexes ready to go.
- **Test suite** covering case-number generation, input validation, auth middleware, the Teams deep-link builder, and the full HTTP API.

## Repository layout

```
service-request-app/
├── docs/
│   └── ARCHITECTURE.md          # design notes & data model
├── backend/
│   ├── src/                     # Express API
│   │   ├── server.js            # entry point
│   │   ├── app.js               # express app factory
│   │   ├── routes.cases.js      # /api/cases router
│   │   ├── auth.js              # Entra JWT verification middleware
│   │   ├── caseNumber.js        # atomic case-number generator
│   │   ├── validation.js        # input validation
│   │   ├── teamsLink.js         # Teams deep-link builder
│   │   ├── db.js                # MongoDB connection
│   │   └── config.js            # env loader
│   ├── tests/                   # Jest tests
│   ├── package.json
│   └── .env.example
├── frontend/                    # static SPA (served by the API)
│   ├── index.html
│   ├── styles.css
│   ├── auth.js                  # MSAL.js wrapper
│   └── app.js                   # UI logic
├── scripts/
│   └── mongodb-podman.sh        # Podman script to run MongoDB
└── Containerfile                # builds backend + bundles frontend
```

## Quick start

### 1. Start MongoDB with Podman

```bash
cd scripts
./mongodb-podman.sh up
```

This creates a `sr-mongo` container with:
- a root admin user (`root` / `rootpass-change-me` — override with env vars)
- an application user (`srapp` / `srapp-pass`) with `readWrite` on the `service_requests` database
- the `serviceRequests` and `counters` collections, plus required indexes

Useful commands: `./mongodb-podman.sh status | logs | shell | down | purge`.

### 2. Configure and run the backend

```bash
cd backend
cp .env.example .env
# Edit .env to set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_AUDIENCE, etc.
npm install
npm start
```

For local development without Entra, set `DISABLE_AUTH=true` in `.env`. The API will impersonate a `dev@local` user.

The backend serves the SPA from `/` and the API under `/api/*`, so a single port hosts everything.

### 3. Open the app

Visit <http://localhost:3000>. Sign in with a Microsoft account, fill in the form, and submit. After creating a case, the **Chat with Support** button opens Microsoft Teams with a new chat pre-titled with the case number.

### Entra app registrations
You need two Entra app registrations (or one with both an SPA platform and an exposed API):

1. **SPA** — used by the browser. Redirect URI: `http://localhost:3000` (or wherever you host the frontend). Add a permission for the API scope below.
2. **API** — exposes a scope such as `access_as_user`. The token's `aud` claim must match `ENTRA_AUDIENCE` on the backend (typically `api://<API_CLIENT_ID>`).

Then update:
- `frontend/auth.js` → `tenantId`, `clientId`, `apiScope`
- `backend/.env` → `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_AUDIENCE`

## Tests

```bash
cd backend
npm test
```

Test files:
- `tests/caseNumber.test.js` — atomic case-number generation, UTC date keying, padded formatting
- `tests/validation.test.js` — payload validation rules
- `tests/auth.test.js` — auth middleware with stubbed verifier
- `tests/teamsLink.test.js` — Teams deep-link construction
- `tests/cases.api.test.js` — full HTTP integration via supertest + an in-memory MongoDB

The integration suite uses [`mongodb-memory-server`](https://github.com/typegoose/mongodb-memory-server), which downloads a MongoDB binary on first run. On networks where `fastdl.mongodb.org` is blocked, set `MONGO_TEST_URI` to an externally provided MongoDB and the suite will use that instead:

```bash
MONGO_TEST_URI="mongodb://localhost:27017/srtest" npm test
```

## API summary

| Method | Path                       | Auth | Purpose                          |
|--------|----------------------------|------|----------------------------------|
| GET    | `/api/health`              | No   | Liveness                         |
| GET    | `/api/config`              | No   | Non-secret runtime config        |
| POST   | `/api/cases`               | Yes  | Create a new service request     |
| GET    | `/api/cases`               | Yes  | List cases, newest first         |
| GET    | `/api/cases/:caseNumber`   | Yes  | Fetch one case                   |
| PATCH  | `/api/cases/:caseNumber`   | Yes  | Update status                    |

Sample request:

```bash
curl -X POST http://localhost:3000/api/cases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "equipment": {
      "serialNumber": "SN-001",
      "productModel": "AX-200",
      "issueDescription": "Will not power on"
    },
    "customer": {
      "name": "Jane Doe",
      "phone": "+1-555-010-0100"
    }
  }'
```

Sample response (excerpt):

```json
{
  "caseNumber": "SR-20260514-00001",
  "status": "open",
  "teamsChatUrl": "https://teams.microsoft.com/l/chat/0/0?users=support%40contoso.com&message=..."
}
```

## Notes & next steps
- The case-number counter is per UTC day; the format gives ~99,999 cases/day. Bump the padding if you need more.
- The Teams deep link uses the public `/l/chat/0/0` format, which works for one-to-one or small group chats. For larger orchestration (Teams channels, tabs), use the Microsoft Graph API.
- For production, put the API behind HTTPS, set `CORS_ORIGIN` to the real SPA origin, and run with `DISABLE_AUTH` unset.
# service-request
