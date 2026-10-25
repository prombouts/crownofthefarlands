@description('Azure regio voor resources.')
param location string = resourceGroup().location

@description('Naam van de Azure Static Web App.')
param staticWebAppName string

@description('SKU voor Static Web App.')
@allowed([
  'Free'
  'Standard'
])
param staticWebAppSku string = 'Standard'

@description('Naam van de Azure Web PubSub resource.')
param webPubSubName string

@description('SKU voor Web PubSub.')
@allowed([
  'Free_F1'
  'Standard_S1'
])
param webPubSubSku string = 'Standard_S1'

@description('Hubnaam gebruikt door de game.')
param webPubSubHub string = 'riskonline'

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {}
}

resource webPubSub 'Microsoft.SignalRService/WebPubSub@2023-02-01' = {
  name: webPubSubName
  location: location
  sku: {
    name: webPubSubSku
    capacity: 1
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

var webPubSubConnectionString = 'Endpoint=https://${webPubSub.name}.webpubsub.azure.com;AccessKey=${listKeys(webPubSub.id, webPubSub.apiVersion).primaryKey};Version=1.0;'

resource staticSiteAppSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  name: '${staticSite.name}/appsettings'
  properties: {
    WEB_PUBSUB_CONNECTION_STRING: webPubSubConnectionString
    WEB_PUBSUB_HUB: webPubSubHub
  }
}

output staticWebAppName string = staticSite.name
output staticWebAppDefaultHostname string = staticSite.properties.defaultHostname
output webPubSubName string = webPubSub.name
