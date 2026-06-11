# Service Request Portal — Architecture

## Purpose
A web application for call center agents to log service requests on behalf of customers calling about company-manufactured equipment. Each request gets a unique case number, is stored in MongoDB, and can be discussed via a Microsoft Teams chat opened directly from the case screen.

## Components

```
+----------------------+        +-----------------------+        +----------------+
|  Browser (Frontend)  |  --->  |  Express API Server   |  --->  |    MongoDB     |
|  - MSAL.js login     |  JWT   |  - JWT validation     |        |  - cases coll. |
|  - Request form      |        |  - Case # generator   |        |  - counters    |
|  - Teams deep link   |        |  - CRUD endpoints     |        |                |
+----------------------+        +-----------------------+        +----------------+
         |
         |  teams.microsoft.com/l/chat/0/0?...
         v
   Microsoft Teams (deep link)
```

## Authentication Flow
1. Agent opens the SPA and clicks **Sign in**.
2. MSAL.js redirects to Entra ID (Azure AD) and returns an ID token + access token.
3. The frontend sends the access token in `Authorization: Bearer <token>` on every API call.
4. The backend validates the token signature against Entra's JWKS, checks `aud`, `iss`, and `tid`, and extracts the agent identity (`preferred_username`, `oid`).
5. The agent's identity is stored on every case as `createdBy`.

## Case Number Generation
Format: `SR-YYYYMMDD-NNNNN`
- `YYYYMMDD` is today's UTC date.
- `NNNNN` is a zero-padded counter that resets each UTC day.
- A separate `counters` collection holds the per-day sequence, incremented atomically with `findOneAndUpdate({_id: 'SR-YYYYMMDD'}, {$inc:{seq:1}}, {upsert:true, returnDocument:'after'})`. This guarantees uniqueness even under concurrent writes.

## Data Model — `serviceRequests`
```js
{
  _id: ObjectId,
  caseNumber: "SR-20260514-00001",   // unique, indexed
  status: "open",                     // open|in_progress|resolved|closed
  equipment: {
    serialNumber: "SN-12345",
    productModel: "AX-200",
    purchaseDate: "2024-03-12",       // optional ISO date
    issueDescription: "Will not power on"
  },
  customer: {
    name: "Jane Doe",
    phone: "+1-555-0100",
    email: "jane@example.com",        // optional
    address: "123 Main St"            // optional
  },
  createdBy: {
    oid: "entra-object-id",
    username: "agent@contoso.com",
    name: "Agent Smith"
  },
  createdAt: ISODate,
  updatedAt: ISODate
}
```

Indexes:
- `caseNumber` — unique
- `createdAt` — descending, for recent-cases queries
- `customer.phone` — for lookup by caller

## API Surface
| Method | Path                       | Purpose                              |
|--------|----------------------------|--------------------------------------|
| GET    | `/api/health`              | Liveness probe (no auth)            |
| POST   | `/api/cases`               | Create a new service request         |
| GET    | `/api/cases`               | List recent cases (pagination)       |
| GET    | `/api/cases/:caseNumber`   | Fetch one case                       |
| PATCH  | `/api/cases/:caseNumber`   | Update status / fields               |

All `/api/cases*` endpoints require a valid Entra access token.

## Teams Deep Link
Format used by the "Chat with Support" button:
```
https://serviceapi-uat.glory-global.com/api/teamsapi/chats
  ?upn=agent@contoso.com
  &chatName=SR-20260514-00001
  &subscription-key=***
```
The recipient UPN is taken from the authenticated user identity (`req.user.username`) instead of an environment variable.

## Configuration (env)
| Variable                  | Description                                  |
|---------------------------|----------------------------------------------|
| `MONGO_URI`              | e.g. `mongodb://localhost:27017/service_requests` |
| `PORT`                   | API port, default `3000`                    |
| `ENTRA_TENANT_ID`        | Azure tenant GUID                            |
| `ENTRA_CLIENT_ID`        | App registration (API) client ID             |
| `ENTRA_AUDIENCE`         | Expected `aud` claim (usually `api://<clientId>`) |
| `DISABLE_AUTH`           | `true` for local dev only                    |

## Testing Strategy
- **Unit tests**: case-number generator (mocked counter), input validation, Teams deep-link builder.
- **Integration tests**: API endpoints with `mongodb-memory-server` (no real DB needed), auth middleware with a stubbed verifier.
- **Frontend smoke test**: render the form and assert key elements exist (jsdom).

Run with `npm test`.
