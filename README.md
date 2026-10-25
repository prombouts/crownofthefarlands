# Risk Online (Nederlands)

Een eenvoudige online versie van **Risk** voor browser, mobiel en iPad, zonder persistente opslag.
De multiplayer-sessie is tijdelijk en draait via **Azure Web PubSub** + **Azure Static Web Apps API**.

## Features

- Nederlandstalige UI
- Multiplayer met kamers (room code)
- Werkt op desktop, mobiel en iPad (responsive)
- Geen database of savegame nodig
- Eenvoudige Risk-regels:
  - Versterken
  - Aanvallen met dobbelstenen
  - Verplaatsen (fortificeren)
  - Winst bij volledige map-controle

## Projectstructuur

- `index.html` – UI
- `styles.css` – responsive styling
- `app.js` – game logica + realtime sync
- `api/negotiate` – Azure Function die Web PubSub toegangstoken uitgeeft

## Lokaal draaien

Je kunt de frontend lokaal openen met elke static server.
Voor echte multiplayer is een werkende `/api/negotiate` endpoint nodig.

## Azure setup (Static Web Apps + Web PubSub)

1. Maak een **Azure Web PubSub** resource.
2. Kopieer de **connection string**.
3. Maak een **Azure Static Web App** voor deze repository.
4. Stel in de Static Web App configuratie de volgende Application Settings in:
   - `WEB_PUBSUB_CONNECTION_STRING` = jouw Web PubSub connection string
   - (optioneel) `WEB_PUBSUB_HUB` = `riskonline` (of je eigen hubnaam)
5. Deploy.

De function `api/negotiate` levert daarna een client URL voor realtime verbinding.

## Multiplayer gebruik

1. Open de site op meerdere apparaten.
2. Vul voor iedere speler een naam in.
3. Gebruik dezelfde kamercode.
4. Klik op **Verbinden**.
5. De host (eerste speler) klikt **Spel starten**.

## Notities

- Spelstatus blijft alleen in het geheugen van de actieve host/clientgroep.
- Bij volledig verlaten van een kamer gaat de sessie verloren.

## Infra as Code (Bicep)

Bestand: `infra/main.bicep`

Deze template maakt:
- Azure Static Web App
- Azure Web PubSub
- App settings op de Static Web App:
  - `WEB_PUBSUB_CONNECTION_STRING`
  - `WEB_PUBSUB_HUB`

Voorbeeld lokaal deployen:

```bash
az group create -n <resource-group> -l westeurope
az deployment group create \
  -g <resource-group> \
  -f infra/main.bicep \
  -p staticWebAppName=<jouw-swa-naam> \
  -p webPubSubName=<jouw-webpubsub-naam> \
  -p webPubSubHub=riskonline
```

## GitHub Actions

### 1) Infra deploy workflow

Bestand: `.github/workflows/deploy-infra.yml`

Trigger: **workflow_dispatch** (handmatig)  
Doel: Bicep-template uitrollen.

Benodigd:
- Repository variable: `AZURE_RG`
- Repository secrets:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_SUBSCRIPTION_ID`

### 2) Site + API deploy workflow

Bestand: `.github/workflows/deploy-app.yml`

Triggers:
- Push naar `main`
- `workflow_dispatch`

Doel: frontend + `/api` deployen naar Azure Static Web Apps.

Benodigd:
- Zelfde Azure OIDC secrets als hierboven
- Repository variables:
  - `AZURE_RG`
  - `STATIC_WEB_APP_NAME`

De workflow haalt dynamisch de deployment token van de Static Web App op via Azure CLI.