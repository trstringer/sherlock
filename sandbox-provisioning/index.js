const azurerm = require('azure-arm-resource');
const msrest = require('ms-rest-azure');
const AuthClient = require('azure-arm-authorization');
const moment = require('moment');
const azureStorage = require('azure-storage');

const tags = { isCI: 'yes' };

function expirationDate(durationMin) {
    const currentDate = new Date();
    const newDate = moment(currentDate).add(durationMin, 'm');
    const newDateLocale = newDate.toLocaleString();
    return newDateLocale;
}

function createResourceGroup(creds, name, region, subscriptionId, duration, appObjectId) {
    const resClient = new azurerm.ResourceManagementClient(creds, subscriptionId);
    const resGroupTags = Object.assign({}, tags,
        {
            expiresOn: expirationDate(duration).toString(),
            appObjectId
        });
    return resClient.resourceGroups.createOrUpdate(
        name,
        { location: region, tags: resGroupTags }
    );
}

function getServicePrincipal() {
    return new Promise((resolve, reject) => {
        const identityStorageAccount = process.env['SHERLOCK_IDENTITY_STORAGE_ACCOUNT'];
        const identityStorageKey = process.env['SHERLOCK_IDENTITY_STORAGE_KEY'];
        const queueName = 'identity';
        const queueService = azureStorage.createQueueService(
            identityStorageAccount,
            identityStorageKey
        );
        queueService.createQueueIfNotExists(queueName, err => {
            if (err) {
                reject(err);
                return;
            }
            queueService.getQueueMetadata(queueName, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                else if (result.approximateMessageCount === 0) {
                    reject(Error('No available service principals in the queue'));
                    return;
                }
                queueService.getMessage(queueName, (err, message) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const identity_match = /(.*) (.*) (.*) (.*)/.exec(message.messageText);
                    queueService.deleteMessage(queueName, message.messageId, message.popReceipt, err => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve({
                            objectId: identity_match[1],
                            appId: identity_match[2],
                            appObjectId: identity_match[3],
                            password: identity_match[4]
                        });
                    });
                });
            });
        });
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

function createSandboxEntities(rgCount, region, duration, prefix) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    const clientSecret = process.env['AZURE_CLIENT_SECRET'];
    const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    const tenantId = process.env['AZURE_TENANT_ID'];
    const randomNumber = Math.floor(Math.random() * 100000);
    const contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c';
    let cachedCreds;
    let spCached;

    const rgNames = [];
    for (let i = 0; i < rgCount; i++) {
        rgNames.push(`${prefix}${randomNumber}-${i}-rg`);
    }

    return getServicePrincipal()
        .then(sp => {
            spCached = sp;
        })
        .then(() => msrest.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId))
        .then(creds => {
            cachedCreds = creds;
            return Promise.all(rgNames.map(rgName => createResourceGroup(creds, rgName, region, subscriptionId, duration, spCached.appObjectId)));
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
                clientId: spCached.appId,
                clientSecret: spCached.password,
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
    let requestPrefix = '';

    let prefix = process.env['RES_PREFIX'] || 'sherlock';

    if (req.query.rgcount || (req.body && req.body.rgcount)) {
        rgCount = req.query.rgcount || req.body.rgcount;
    }

    if (req.query.region || (req.body && req.body.region)) {
        region = req.query.region || req.body.region;
    }

    if (req.query.duration || (req.body && req.body.duration)) {
        duration = req.query.duration || req.body.duration;
    }

    if (req.query.requestPrefix || (req.body && req.body.requestPrefix)) {
        requestPrefix = req.query.requestPrefix || req.body.requestPrefix;
        prefix += `-${requestPrefix}`;
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
