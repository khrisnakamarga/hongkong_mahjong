targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param environmentName string

@minLength(1)
param location string = 'westus3'

@minLength(1)
@maxLength(40)
param appName string = 'hongkong-mahjong'

@allowed([
  'dev'
  'test'
  'prod'
])
param environmentType string = 'prod'

param containerImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param minReplicas int = 1
param maxReplicas int = 5
param containerCpu string = '0.5'
param containerMemory string = '1Gi'
param tags object = {}

var resourceToken = uniqueString(subscription().id, environmentName, location)
var safeEnvironmentName = toLower(replace(environmentName, '_', '-'))
var safeAppName = toLower(replace(appName, '_', '-'))
var alphanumericAppName = replace(safeAppName, '-', '')
var alphanumericEnvironmentName = replace(safeEnvironmentName, '-', '')
var baseTags = union(tags, {
  application: appName
  environment: environmentName
  environmentType: environmentType
  'azd-env-name': environmentName
})

var resourceGroupName = 'rg-${safeAppName}-${safeEnvironmentName}'
var managedIdentityName = take('id-${safeAppName}-${safeEnvironmentName}', 128)
var logAnalyticsName = take('log-${safeAppName}-${safeEnvironmentName}-${resourceToken}', 63)
var appInsightsName = take('appi-${safeAppName}-${safeEnvironmentName}-${resourceToken}', 255)
var containerEnvironmentName = take('cae-${safeAppName}-${safeEnvironmentName}-${resourceToken}', 60)
var containerAppName = take('ca-${safeAppName}-${safeEnvironmentName}', 32)
var acrName = take('${alphanumericAppName}${alphanumericEnvironmentName}${resourceToken}', 50)
var keyVaultName = take('kv-${safeAppName}-${resourceToken}', 24)
var cosmosAccountName = take('cosmos-${safeAppName}-${safeEnvironmentName}-${resourceToken}', 44)
var cosmosDatabaseName = 'mahjong'
var roomsContainerName = 'rooms'
var gameEventsContainerName = 'gameEvents'
var redisName = take('redis-${safeAppName}-${safeEnvironmentName}-${resourceToken}', 63)

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: baseTags
}

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  scope: resourceGroup
  name: managedIdentityName
  location: location
  tags: baseTags
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  scope: resourceGroup
  name: logAnalyticsName
  location: location
  tags: baseTags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  scope: resourceGroup
  name: appInsightsName
  location: location
  tags: baseTags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  scope: resourceGroup
  name: acrName
  location: location
  tags: baseTags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      trustPolicy: {
        type: 'Notary'
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'enabled'
      }
    }
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  scope: resourceGroup
  name: keyVaultName
  location: location
  tags: baseTags
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  scope: resourceGroup
  name: cosmosAccountName
  location: location
  tags: baseTags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-04-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource roomsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-04-15' = {
  parent: cosmosDatabase
  name: roomsContainerName
  properties: {
    resource: {
      id: roomsContainerName
      partitionKey: {
        paths: [
          '/roomId'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource gameEventsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-04-15' = {
  parent: cosmosDatabase
  name: gameEventsContainerName
  properties: {
    resource: {
      id: gameEventsContainerName
      partitionKey: {
        paths: [
          '/roomId'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-04-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, managedIdentity.properties.principalId, 'cosmos-data-contributor')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: managedIdentity.properties.principalId
    scope: cosmosAccount.id
  }
}

resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  scope: resourceGroup
  name: redisName
  location: location
  tags: baseTags
  properties: {
    sku: {
      name: 'Standard'
      family: 'C'
      capacity: 1
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'aad-enabled': 'true'
    }
  }
}

resource redisAccessPolicyAssignment 'Microsoft.Cache/redis/accessPolicyAssignments@2023-08-01' = {
  parent: redis
  name: take('apa-${managedIdentity.name}', 63)
  properties: {
    accessPolicyName: 'Data Contributor'
    objectId: managedIdentity.properties.principalId
    objectIdAlias: managedIdentity.name
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.properties.principalId, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource redisAccessKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'redis-access-key'
  properties: {
    value: redis.listKeys().primaryKey
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  scope: resourceGroup
  name: containerEnvironmentName
  location: location
  tags: baseTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  scope: resourceGroup
  name: containerAppName
  location: location
  tags: union(baseTags, {
    'azd-service-name': 'web'
  })
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'redis-access-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${redisAccessKeySecret.name}'
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImageName
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'HOST'
              value: '0.0.0.0'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentity.properties.clientId
            }
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmosAccount.properties.documentEndpoint
            }
            {
              name: 'COSMOS_DATABASE_NAME'
              value: cosmosDatabaseName
            }
            {
              name: 'COSMOS_ROOMS_CONTAINER_NAME'
              value: roomsContainerName
            }
            {
              name: 'COSMOS_GAME_EVENTS_CONTAINER_NAME'
              value: gameEventsContainerName
            }
            {
              name: 'REDIS_HOST'
              value: redis.properties.hostName
            }
            {
              name: 'REDIS_PORT'
              value: '6380'
            }
            {
              name: 'REDIS_TLS'
              value: 'true'
            }
            {
              name: 'REDIS_PASSWORD'
              secretRef: 'redis-access-key'
            }
          ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 30
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
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
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    keyVaultSecretsUser
    redisAccessKeySecret
  ]
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, containerApp.identity.principalId, 'acrpull')
  scope: containerRegistry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output resourceGroupName string = resourceGroup.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output AZURE_CONTAINER_APP_NAME string = containerApp.name
output AZURE_CONTAINER_APP_ENVIRONMENT_NAME string = containerAppsEnvironment.name
output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.properties.ConnectionString
output SERVICE_WEB_URI string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output COSMOS_ENDPOINT string = cosmosAccount.properties.documentEndpoint
output COSMOS_DATABASE_NAME string = cosmosDatabaseName
output REDIS_HOST string = redis.properties.hostName
