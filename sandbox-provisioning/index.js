const azurerm = require('azure-arm-resource');
const GraphRbacManagementClient = require('azure-graph');
const msrest = require('ms-rest-azure');
const AuthClient = require('azure-arm-authorization');
const moment = require('moment');

const tags = { isCI: 'yes' };

function expirationDate(durationMin) {
    const currentDate = new Date();
    const newDate = moment(currentDate).add(durationMin, 'm');
    const newDateLocale = newDate.toLocaleString();
    return newDateLocale;
}

function createResourceGroup(creds, name, region, subscriptionId, duration) {
    const resClient = new azurerm.ResourceManagementClient(creds, subscriptionId);
    const resGroupTags = Object.assign({}, tags, { expiresOn: expirationDate(duration).toString() });
    return resClient.resourceGroups.createOrUpdate(
        name,
        { location: region, tags: resGroupTags }
    );
}

function createApplication(graphClient, appName, password) {
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);
    return graphClient.applications.create({
        availableToOtherTenants: false,
        displayName: appName,
        identifierUris: [ `http://${appName}` ],
        passwordCredentials: [{
            keyId: msrest.generateUuid(),
            value: password,
            endDate
        }]
    });
}

function assignRolesToServicePrincipal(creds, servicePrincipal, subscriptionId, rgName, contributorRoleId) {
    const authClient = new AuthClient(creds, subscriptionId, null);
    const scope = `subscriptions/${subscriptionId}/resourceGroups/${rgName}`;
    const roleDefinitionId = `${scope}/providers/Microsoft.Authorization/roleDefinitions/${contributorRoleId}`;
    return authClient.roleAssignments.create(
        scope,
        msrest.generateUuid(),
        {
            properties: {
                principalId: servicePrincipal.objectId,
                roleDefinitionId: roleDefinitionId,
                scope: scope
            }
        }
    );
}

function strongPassword() {
    let password = '';

    for (let i = 0; i < 8; i++) {
        password += Math.random().toString(36).slice(-8);
    }

    return password;
}

function createSandboxEntities(rgCount, region, duration, prefix) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    const clientSecret = process.env['AZURE_CLIENT_SECRET'];
    const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    const tenantId = process.env['AZURE_TENANT_ID'];
    const randomNumber = Math.floor(Math.random() * 100000);
    const contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c';
    const appName = `${prefix}${randomNumber}`;
    const password = strongPassword();
    let cachedCreds;
    let spCached;
    let appIdCached;

    const rgNames = [];
    for (let i = 0; i < rgCount; i++) {
        rgNames.push(`${prefix}${randomNumber}-${i}-rg`);
    }

    const credsForGraph = new msrest.ApplicationTokenCredentials(
        clientId,
        tenantId,
        clientSecret,
        { tokenAudience: 'graph' }
    );

    const graphClient = new GraphRbacManagementClient(credsForGraph, tenantId);

    return msrest.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId)
        .then(creds => {
            cachedCreds = creds;
            return Promise.all(rgNames.map(rgName => createResourceGroup(creds, rgName, region, subscriptionId, duration)));
        })
        .then(() => createApplication(graphClient, appName, password))
        .then(application => {
            appIdCached = application.appId;

            return graphClient.servicePrincipals.create({
                appId: application.appId,
                accountEnabled: true
            });
        })
        .then(sp => {
            spCached = sp;
            const sleepTime = 60000;
            return new Promise((resolve) => {
                setTimeout(resolve, sleepTime);
            });
        })
        .then(() => {
            return Promise.all(rgNames.map(rgName => assignRolesToServicePrincipal(
                cachedCreds,
                spCached,
                subscriptionId,
                rgName,
                contributorRoleId
            )));
        })
        .then(() => {
            return {
                resourceGroupNames: rgNames,
                clientId: appIdCached,
                clientSecret: password,
                subscriptionId,
                tenantId
            };
        });
}

module.exports = function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');
    let rgCount = 1;
    let region = 'eastus';
    let duration = 30;  // minutes

    const prefix = process.env['RES_PREFIX'] || 'sandbox';

    if (req.query.rgcount || (req.body && req.body.rgcount)) {
        rgCount = req.query.rgcount || req.body.rgcount;
    }

    if (req.query.region || (req.body && req.body.region)) {
        region = req.query.region || req.body.region;
    }

    if (req.query.duration || (req.body && req.body.duration)) {
        duration = req.query.duration || req.body.duration;
    }

    createSandboxEntities(rgCount, region, duration, prefix)
        .then(sandboxResult => {
            context.log(sandboxResult);
            context.res = { body: sandboxResult };
            context.done();
        })
        .catch(err => {
            context.log(`Error ${err.message}`);
            context.log(err);
            context.res = {
                status: 400,
                body: err
            };
            context.done();
        });
};
