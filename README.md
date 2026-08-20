# Purchase Requisition App

A small full-stack Azure application for viewing and creating Dynamics 365
Finance & Operations purchase requisition headers and lines through OData data
entities.

Built for a handful of testers, so every choice favours low idle cost: the
container scales to zero, logging is capped, and there is no database, no cache
tier, and no gateway.

## What it does

- Lists requisition headers for a legal entity, with search and paging
- Opens a requisition to see its header fields and all of its lines
- Creates a new requisition header
- Adds lines to an existing requisition
- A Diagnostics page that verifies the D365 connection and browses the live
  `$metadata` document so you can confirm real entity and field names

## Architecture

```
Browser
  │  (Entra ID sign-in enforced by Container Apps built-in auth)
  ▼
Azure Container App  ── one container, scale-to-zero, 0.25 vCPU / 0.5 GiB
  ├─ Fastify API      /api/*
  └─ React SPA        everything else, served as static files
       │
       │  user-assigned managed identity → Entra ID token
       ▼
D365 F&O  /data/PurchaseRequisitionHeaders, /data/PurchaseRequisitionLines
```

One container serves both the API and the frontend, which halves the number of
things to deploy, monitor, and pay for. There are no secrets in the application
at all — the managed identity replaces them.

### Cost

| Resource | Tier | Rough monthly cost |
|---|---|---|
| Container App | Consumption, min 0 replicas | $0 — idle usage sits inside the monthly free grant |
| Container Registry | Basic | ~$5 |
| Log Analytics | Pay-as-you-go, capped at 0.1 GB/day | ~$0–2 |

Expect roughly **$5–7/month**, dominated by the registry. The registry is the
only always-on component; everything else costs nothing while nobody is using
the app.

## Repository layout

```
server/            Fastify API (TypeScript, ESM)
  src/config.ts        Environment parsing and validation
  src/auth/            Managed-identity token cache; EasyAuth principal parsing
  src/d365/            OData client, entity/field definitions, data access
  src/routes/          HTTP routes
web/               React + Vite single-page app
  src/lib/             API client, hooks, shared context
  src/components/      Schema-driven table and form
  src/pages/           List, detail, create, diagnostics
infra/main.bicep   All Azure resources
scripts/           Deployment and Entra ID setup
Dockerfile         Multi-stage build for the single runtime image
```

## Prerequisites

Nothing in this list is installed on a fresh Windows machine. Install with
winget, then **open a new terminal** so the updated PATH is picked up:

```powershell
winget install OpenJS.NodeJS.LTS        # Node 22+
winget install Microsoft.AzureCLI
```

Docker is optional — the deploy script builds images in Azure using ACR Tasks.
Install it only if you want to run the container locally:

```powershell
winget install Docker.DockerDesktop
```

## Running locally

```powershell
npm install
Copy-Item .env.example .env
# edit .env: set D365_BASE_URL and D365_DEFAULT_COMPANY
az login
npm run dev
```

The API listens on <http://localhost:8080> and Vite serves the UI on
<http://localhost:5173>, proxying `/api` to the API.

Locally `AUTH_MODE=none`, so there is no sign-in and requests run as a fixed
local user. Your D365 access comes from `az login`, so the account you sign in
as must be registered in D365 (see the next section).

## Deploying to Azure

### 1. Deploy the infrastructure and app

The template grants the managed identity `AcrPull` on the registry, which is a
role assignment — so the account running the deploy needs **Owner** or **User
Access Administrator** on the resource group, not just Contributor.

```powershell
az login
Copy-Item infra/main.parameters.json infra/main.parameters.local.json
# edit the copy: set d365BaseUrl and d365DefaultCompany

./scripts/deploy.ps1 `
  -ResourceGroup rg-requisitions `
  -Location eastus `
  -ParametersFile ./infra/main.parameters.local.json
```

This runs three passes — provision, build the image in ACR, redeploy pointing
at the image — and prints the app URL along with the **managed identity client
ID**. Keep that ID.

### 2. Register the identity in D365

This is the step that cannot be automated from Azure, and the one that causes
almost every "it deployed but nothing loads" problem.

In your D365 environment, go to **System administration → Setup → Microsoft
Entra ID applications** and add a row:

| Field | Value |
|---|---|
| Client Id | the managed identity client ID printed by the deploy script |
| Name | anything descriptive, e.g. `Requisition app` |
| User ID | a service account user that has purchase requisition permissions |

Every requisition the app creates will be attributed to that user, so pick one
you are willing to see in the audit trail.

### 3. Turn on user sign-in

The first deploy intentionally leaves sign-in off, because the redirect URI
depends on the hostname Azure generates. Now that it exists:

```powershell
./scripts/setup-auth.ps1 -ResourceGroup rg-requisitions -AppName reqapp-app

# then redeploy with the client ID and secret it prints
./scripts/deploy.ps1 `
  -ResourceGroup rg-requisitions `
  -ParametersFile ./infra/main.parameters.local.json `
  -AuthClientId <clientId> `
  -AuthClientSecret '<secret>'
```

By default anyone in your tenant can sign in. To limit it to named testers, set
the enterprise application to require user assignment in the Entra portal and
assign only those people.

### 4. Verify

Open `https://<your-app>/diagnostics`. The connection check tells you which of
the two common failures you have: a token that cannot be acquired (an Azure
identity problem) or a query that is rejected (a D365 registration or entity
name problem).

## Correcting entity and field names

**This is the part you should expect to adjust.** Public entity and field names
for purchase requisitions vary across F&O versions, and any extension can add
or rename fields. The names shipped here are the common out-of-the-box ones,
but they are a starting point.

Everything the app knows about requisitions lives in one file:
[`server/src/d365/entities.ts`](server/src/d365/entities.ts). The list columns,
the detail view, the create forms, and the validation are all generated from
those descriptors — correct the file and the whole app follows.

To find the real names, use the Diagnostics page, or call the API directly:

```
GET /api/metadata/entities?search=requisition
GET /api/metadata/entities/PurchaseRequisitionHeaders
```

Both read the live `$metadata` document from your environment and report actual
property names, EDM types, and which properties form the key.

If the entity *set* names differ, override them without touching code via the
`D365_HEADER_ENTITY` and `D365_LINE_ENTITY` environment variables (also exposed
as Bicep parameters).

## API reference

All routes require sign-in except `/api/health`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness. Does not touch D365. |
| GET | `/api/health/d365` | Full connectivity check: token, then a real query. |
| GET | `/api/me` | The signed-in user as seen through built-in auth. |
| GET | `/api/config` | Non-secret settings the frontend needs. |
| GET | `/api/schema` | Field descriptors for headers and lines. |
| GET | `/api/requisitions` | List headers. Query: `company`, `search`, `top`, `skip`. |
| GET | `/api/requisitions/:company/:number` | One header plus its lines. |
| GET | `/api/requisitions/:company/:number/lines` | Lines only. |
| POST | `/api/requisitions` | Create a header. |
| POST | `/api/requisitions/:company/:number/lines` | Create a line. |
| GET | `/api/metadata/entities` | Search entity sets in `$metadata`. |
| GET | `/api/metadata/entities/:name` | Properties of one entity set. |

## Notes and limitations

- **Read and create only.** There is no update or delete path. Adding one means
  a `PATCH`/`DELETE` in `server/src/d365/requisitions.ts` and a button in the
  UI; the entity descriptors already carry enough information to drive it.
- **Line numbering has a race.** New line numbers come from reading the current
  maximum and adding one, so two people adding a line to the same requisition
  at the same moment can collide. Acceptable at this scale, and noted in the
  code where it happens.
- **Workflow is not triggered.** Creating a requisition through OData leaves it
  in draft. Submitting it to workflow needs a separate F&O action.
- **Cold starts.** With `minReplicas: 0`, the first request after an idle period
  waits a few seconds for the container to start. Set `minReplicas: 1` in the
  parameters file to trade about $10/month for instant responses.
- **`$metadata` is large.** F&O returns a document listing every public entity,
  often tens of megabytes. It is fetched once and cached for an hour, so the
  first Diagnostics load is slow and later ones are not.
