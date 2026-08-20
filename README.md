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

You need **Node 22+** and the **Azure CLI**. Docker is not required — the deploy
script builds images in Azure using ACR Tasks.

With administrator rights, both install from winget. Open a new terminal
afterwards so the updated PATH is picked up:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Microsoft.AzureCLI
```

### Without administrator rights

Both installers need elevation, so on a locked-down machine use these instead.
Nothing below touches Program Files or the registry.

**Node** — extract the official zip into your user profile and add it to PATH:

```powershell
$ver  = 'v22.23.2'
$dest = "$env:LOCALAPPDATA\Programs\nodejs"
Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile "$env:TEMP\node.zip"
Expand-Archive "$env:TEMP\node.zip" "$env:LOCALAPPDATA\Programs"
Rename-Item "$env:LOCALAPPDATA\Programs\node-$ver-win-x64" $dest
[Environment]::SetEnvironmentVariable('Path',
  ([Environment]::GetEnvironmentVariable('Path','User').TrimEnd(';') + ";$dest"), 'User')
```

**Azure CLI** — install into a project-local virtual environment. It lives in
`.venv/`, which is gitignored, and uninstalls by deleting that folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --use-feature=truststore azure-cli
```

The deploy scripts find this automatically — they prefer a system-wide `az` and
fall back to `.venv` when there isn't one.

### If your network intercepts TLS

On a corporate network that inspects HTTPS, tools that carry their own
certificate list fail with `CERTIFICATE_VERIFY_FAILED` or hang indefinitely,
because they don't consult the Windows trust store where the intercepting root
actually lives. Three separate fixes, one per tool:

| Tool | Symptom | Fix |
|---|---|---|
| npm | `npm install` hangs forever with no output | `[Environment]::SetEnvironmentVariable('NODE_OPTIONS','--use-system-ca','User')` |
| pip | `SSLError` on install | pass `--use-feature=truststore` |
| Azure CLI | `CERTIFICATE_VERIFY_FAILED` on any command | point `REQUESTS_CA_BUNDLE` at a combined bundle |

For the last one, `scripts/common.ps1` handles it. `Update-AzCaBundle` builds
`.venv/ca-bundle.pem` by combining certifi's public roots with every root in
your Windows store, and `Set-AzCaBundle` — called automatically by both deploy
scripts — points the CLI at it. Re-run `Update-AzCaBundle` if the corporate
certificate rotates:

```powershell
. ./scripts/common.ps1
Update-AzCaBundle
```

This keeps certificate verification **on**. Never reach for
`AZURE_CLI_DISABLE_CONNECTION_VERIFICATION` — that turns it off entirely.

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

`infra/main.parameters.json` already carries the D365 environment URL and legal
entity, so there is nothing to edit before a first deploy.

```powershell
# Sign in. If az is only in the venv, call it by path:
./.venv/Scripts/az.bat login

./scripts/deploy.ps1 `
  -ResourceGroup rg-requisitions `
  -Location eastus `
  -SubscriptionId <your-subscription-id>
```

`-SubscriptionId` is optional but worth passing when your account can see more
than one subscription — it pins the deployment rather than trusting whichever
one the CLI happens to have selected.

This runs three passes — provision, build the image in ACR, redeploy pointing
at the image — and prints the app URL along with the **managed identity client
ID**. Keep that ID.

### 1a. When ACR Tasks is blocked

If the deploy fails at pass 2 with `TasksOperationsNotAllowed`, Microsoft has
disabled server-side image builds on your subscription. This is common on
trial, Visual Studio benefit, and abuse-flagged subscriptions, and **no
permission change will fix it** — being Owner makes no difference. Filing a
support request can lift it, but building on GitHub Actions is faster and
better anyway.

Nothing about the architecture changes; only the build moves.

```powershell
# Provision without attempting the blocked build
./scripts/deploy.ps1 -ResourceGroup rg-d365-fsc-app -SkipImageBuild

# Let GitHub deploy, with no stored secret
./scripts/setup-github-oidc.ps1 `
  -ResourceGroup rg-d365-fsc-app `
  -GitHubRepo <owner>/<repo>
```

The second script prints three repository **secrets** and three repository
**variables** to add under *Settings → Secrets and variables → Actions*. All six
are identifiers rather than credentials — they grant nothing on their own,
because Azure only issues access to a workflow run on the trusted branch of the
trusted repository.

Then push to `main`, and [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
builds the image, pushes it to your registry, and updates the container app.
Every later deploy is just a push.

The workflow identity holds exactly two role assignments, both scoped to single
resources rather than the resource group:

| Role | Scope | Why |
|---|---|---|
| `AcrPush` | the registry | push images |
| `Contributor` | the container app | point it at a new image |

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
