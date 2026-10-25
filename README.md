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

## Azure deployment

De Bicep-template maakt een **Free** Azure Static Web App en een **Free_F1**
Azure Web PubSub-resource. Het gratis Web PubSub-plan heeft lagere limieten dan
het Standard-plan. De Static Web App bevat de API in `api/`; de infrastructuur
stelt `WEB_PUBSUB_CONNECTION_STRING` en `WEB_PUBSUB_HUB` automatisch in.

### Eenmalige GitHub-configuratie

1. Maak de resource group en een Azure app registration/service principal.
   Koppel een federated credential aan
   `repo:prombouts/riskonline:ref:refs/heads/main` en geef de service principal
   **Contributor**-rechten op alleen die resource group. Bijvoorbeeld met Azure
   CLI (voer dit uit in Bash en vervang `<resource-group>`):

   ```bash
   RG="<resource-group>"
   SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
   TENANT_ID="$(az account show --query tenantId -o tsv)"
   az group create --name "$RG" --location westeurope
   CLIENT_ID="$(az ad app create --display-name riskonline-github-actions --query appId -o tsv)"
   SP_OBJECT_ID="$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)"
   az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
     \"name\":\"github-main\",
     \"issuer\":\"https://token.actions.githubusercontent.com\",
     \"subject\":\"repo:prombouts/riskonline:ref:refs/heads/main\",
     \"description\":\"GitHub Actions deployment from main\",
     \"audiences\":[\"api://AzureADTokenExchange\"]
   }"
   az role assignment create \
     --assignee-object-id "$SP_OBJECT_ID" \
     --assignee-principal-type ServicePrincipal \
     --role Contributor \
     --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG"
   ```

2. Voeg de volgende repository variables toe onder **Settings → Secrets and
   variables → Actions → Variables**:
   - `AZURE_CLIENT_ID` – de application (client) ID
   - `AZURE_TENANT_ID` – de Azure tenant ID
   - `AZURE_SUBSCRIPTION_ID` – de Azure subscription ID
   - `AZURE_RG` – resource group naam
   - `AZURE_LOCATION` – regio, bijvoorbeeld `westeurope`
   - `STATIC_WEB_APP_NAME` – wereldwijd unieke naam voor de Static Web App
   - `WEB_PUBSUB_NAME` – wereldwijd unieke naam voor Web PubSub
   Use the `CLIENT_ID`, `TENANT_ID`, and `SUBSCRIPTION_ID` values from the
   commands above.
3. Voeg `AZURE_STATIC_WEB_APPS_API_TOKEN` als repository secret toe. Haal de
   token op nadat de infrastructuur-workflow voor het eerst is uitgevoerd:

   ```bash
   az staticwebapp secrets list --name <static-web-app-name> --resource-group <resource-group> --query properties.apiKey -o tsv
   ```

### Deployen

- **Infra:** voer `Deploy Azure infrastructure` handmatig uit via
  **Actions → Deploy Azure infrastructure → Run workflow**. Dit maakt de
  resource group aan indien nodig en deployt de Free-tier resources.
- **Site en API:** `Deploy site and API` maakt een preview aan voor pull requests
  naar `main` (en verwijdert de preview wanneer de PR sluit) en publiceert
  automatisch naar productie bij pushes naar `main`.

Pull requests vanuit forks worden overgeslagen omdat repository secrets niet
beschikbaar zijn voor die builds.

## Multiplayer gebruik

1. Open de site op meerdere apparaten.
2. Vul voor iedere speler een naam in.
3. De host vult een kamercode in en klikt op **Verbinden**.
4. De host deelt de **uitnodigingslink** vanuit de lobby. Deze link vult de kamercode automatisch in.
5. Andere spelers openen de uitnodigingslink en klikken op **Verbinden**.
6. De host (eerste speler) klikt **Spel starten**.

## Notities

- Spelstatus blijft alleen in het geheugen van de actieve host/clientgroep.
- Bij volledig verlaten van een kamer gaat de sessie verloren.

## Infra as Code (Bicep)

Bestand: `infra/main.bicep`

Deze template maakt:
- Azure Static Web App op de Free-tier
- Azure Web PubSub op de Free_F1-tier
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

Workflows staan in `.github/workflows/`. Azure login gebruikt OIDC zodat geen
Azure client secret in GitHub hoeft te worden opgeslagen.