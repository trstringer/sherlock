const azurerm = require('azure-arm-resource');
const msrest = require('ms-rest-azure');
const AuthClient = require('azure-arm-authorization');
const azureStorage = require('azure-storage');
const request = require('request');
const GraphRbacManagementClient = require('azure-graph');

function createResourceGroup(creds, name, region, subscriptionId) {
    const resClient = new azurerm.ResourceManagementClient(creds, subscriptionId);
    return resClient.resourceGroups.createOrUpdate(
        name,
        { location: region }
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

function cacheEntityMeta(resourceGroupPrefix, applicationObjectId, expirationTimeMinutes) {
    return new Promise((resolve, reject) => {
        const metaUrl = process.env['META_URL'];
        const metaKey = process.env['META_KEY'];
        const requestUrl = `${metaUrl}/?code=${metaKey}&rgprefix=${resourceGroupPrefix}&appobjid=${applicationObjectId}&expire=${expirationTimeMinutes}`;

        request(requestUrl, err => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
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

    const rgNameWithoutSeq = `${prefix}${randomNumber}`;

    const rgNames = [];
    for (let i = 0; i < rgCount; i++) {
        rgNames.push(`${rgNameWithoutSeq}-${i}-rg`);
    }

    return getServicePrincipal()
        .then(sp => {
            spCached = sp;
        })
        .then(() => msrest.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId))
        .then(creds => {
            cachedCreds = creds;
            return Promise.all(rgNames.map(rgName => createResourceGroup(creds, rgName, region, subscriptionId)));
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
        .then(() => cacheEntityMeta(rgNameWithoutSeq, spCached.appObjectId, duration))
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

function resourceGroupMetaData(rgPrefix) {
    return new Promise((resolve, reject) => {
        const metaKey = process.env['META_KEY'];
        const metaUrl = process.env['META_URL'];
        request(`${metaUrl}/?code=${metaKey}&all=true&rgprefix=${rgPrefix}`, (err, res, body) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(JSON.parse(body));
        });
    });
}

function deleteSandboxEnvironment(rgPrefix) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    const clientSecret = process.env['AZURE_CLIENT_SECRET'];
    const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    const tenantId = process.env['AZURE_TENANT_ID'];
    let resClientCached;
    let deletedResourceGroups = [];
    let deleteApplications = [];
    let rowsCached;
    let rgPrefixEntriesToDeleteCachedOperations = [];

    const credsForGraph = new msrest.ApplicationTokenCredentials(
        clientId,
        tenantId,
        clientSecret,
        { tokenAudience: 'graph' }
    );

    const graphClient = new GraphRbacManagementClient(credsForGraph, tenantId);

    return resourceGroupMetaData(rgPrefix)
        .then(rows => {
            rowsCached = rows;
            return msrest.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId);
        })
        .then(creds => {
            const resClient = new azurerm.ResourceManagementClient(creds, subscriptionId);
            resClientCached = resClient;
            return resClient.resourceGroups.list();
        })
        .then(resourceGroups => {
            let deleteResourceGroupOperations = [];
            for(let i = 0; i < resourceGroups.length; i++) {
                if (resourceGroups[i].name.substring(0, rowsCached[0].resource_group_prefix.length) === rowsCached[0].resource_group_prefix) {
                    deleteApplications.push(rowsCached[0].application_object_id);
                    logger(`Deleting ${resourceGroups[i].name}`);
                    deleteResourceGroupOperations.push(resClientCached.resourceGroups.beginDeleteMethod(resourceGroups[i].name));
                    break;
                }
            }
            logger(`deleting ${deleteResourceGroupOperations.length} resource group(s)`);
            return Promise.all(deleteResourceGroupOperations);
        })
        .then(() => {
            const applicationsToDeleteOperations = deleteApplications.map(appObjectIdToDelete => {
                logger(`deleting ${appObjectIdToDelete}`);
                return graphClient.applications.deleteMethod(appObjectIdToDelete);
            });
            return Promise.all(applicationsToDeleteOperations);
        })
        .then(() => {
            return deleteByRgPrefix(rgPrefix);
        });
}

function deleteByRgPrefix(rgPrefix) {
    return new Promise((resolve, reject) => {
        const metaUrl = process.env['META_URL'];
        const metaKey = process.env['META_KEY'];

        request.delete(`${metaUrl}/?code=${metaKey}&rgprefix=${rgPrefix}`, err => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

module.exports = function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');
    let rgCount = 1;
    let region = 'eastus';
    let duration = 30;  // minutes
    let requestPrefix = '';

    if (req.method === 'DELETE') {
        if (!req.query.rgprefix && !(req.body && req.body.rgprefix)) {
            context.res = { status: 400, body: 'To delete a resource you must pass rgprefix' };
            context.done();
            return;
        }
        deleteSandboxEnvironment(req.query.rgprefix || req.body.rgprefix)
            .then(() => context.done())
            .catch((erro) => {
                context.log(`Error deleting ${req.query.rgprefix || req.body.rgprefix}`);
                context.log(err);
                context.res = { status: 400, body: `Error delete ${req.query.rgprefix || req.body.rgprefix}` };
                context.done();
            });
        return;
    }

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

    if (req.query.prefix || (req.body && req.body.prefix)) {
        requestPrefix = req.query.prefix || req.body.prefix;
        prefix += `-${requestPrefix}-`;
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
