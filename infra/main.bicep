metadata description = 'Container Apps hosting for the D365 purchase requisition app, sized for a small test user base.'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short prefix for resource names. Lowercase letters and digits only.')
@minLength(3)
@maxLength(11)
param namePrefix string = 'reqapp'

@description('Root URL of the D365 F&O environment, with no trailing slash. Example: https://contoso-dev.sandbox.operations.dynamics.com')
param d365BaseUrl string

@description('Default legal entity (dataAreaId) the app reads when none is specified.')
param d365DefaultCompany string = 'usmf'

@description('Public collection name of the requisition header entity.')
param d365HeaderEntity string = 'PurchaseRequisitionHeaders'

@description('Public collection name of the requisition line entity.')
param d365LineEntity string = 'PurchaseRequisitionLines'

@description('Container image to deploy. Leave at the default for the first run; the deploy script replaces it with the built image.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Application (client) ID of the Entra ID app registration used for user sign-in. Leave empty to deploy without built-in authentication.')
param authClientId string = ''

@description('Client secret for the sign-in app registration. Required when authClientId is set.')
@secure()
param authClientSecret string = ''

@description('Entra ID tenant users sign in from.')
param tenantId string = subscription().tenantId

@description('Scale-to-zero keeps idle cost at nothing. Raise to 1 only if cold starts become a problem.')
@minValue(0)
@maxValue(5)
param minReplicas int = 0

@minValue(1)
@maxValue(10)
param maxReplicas int = 2

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

var suffix = uniqueString(resourceGroup().id)
var registryName = toLower('${namePrefix}acr${suffix}')
var identityName = '${namePrefix}-identity'
var environmentName = '${namePrefix}-env'
var appName = '${namePrefix}-app'
var workspaceName = '${namePrefix}-logs'
var authEnabled = !empty(authClientId)

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// A user-assigned identity is used rather than system-assigned so its client ID
// stays stable if the container app is ever recreated. That matters because the
// client ID is what gets registered inside D365, and re-registering there is a
// manual step.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// ---------------------------------------------------------------------------
// Container registry
// ---------------------------------------------------------------------------

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: registryName
  location: location
  sku: {
    // Basic is the cheapest tier that supports the ACR Tasks build used by the
    // deploy script, which is what lets you deploy without Docker locally.
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    // A short retention keeps the Log Analytics bill near zero; this is the
    // dominant cost of an idle Container Apps deployment if left unbounded.
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.1')
    }
  }
}

// ---------------------------------------------------------------------------
// Container Apps
// ---------------------------------------------------------------------------

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  dependsOn: [
    acrPull
  ]
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: authEnabled ? [
        {
          name: 'auth-client-secret'
          value: authClientSecret
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: {
            // The smallest supported allocation. A test-scale requisition app
            // is bound by D365 response times, not local CPU.
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '8080' }
            { name: 'D365_BASE_URL', value: d365BaseUrl }
            { name: 'D365_DEFAULT_COMPANY', value: d365DefaultCompany }
            { name: 'D365_HEADER_ENTITY', value: d365HeaderEntity }
            { name: 'D365_LINE_ENTITY', value: d365LineEntity }
            { name: 'AZURE_MANAGED_IDENTITY_CLIENT_ID', value: identity.properties.clientId }
            { name: 'AUTH_MODE', value: authEnabled ? 'easyauth' : 'none' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 8080
              }
              initialDelaySeconds: 3
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: {
              // One replica handles far more than this user base will produce;
              // the rule exists so a burst does not queue behind a single pod.
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

// Built-in authentication. Only deployed when an app registration is supplied,
// so the first bootstrap deploy can succeed before the registration exists.
resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (authEnabled) {
  name: 'current'
  parent: app
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      // Every route requires sign-in, including the API. The app itself has no
      // anonymous surface worth exposing.
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          clientSecretSettingName: 'auth-client-secret'
          openIdIssuer: 'https://login.microsoftonline.com/${tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            'api://${authClientId}'
          ]
        }
      }
    }
    login: {
      preserveUrlFragmentsForLogins: true
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output appName string = app.name
output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name

@description('Register this client ID in D365 under System administration > Setup > Microsoft Entra ID applications.')
output managedIdentityClientId string = identity.properties.clientId
output managedIdentityPrincipalId string = identity.properties.principalId
