const azurerm = require('azure-arm-resource');
const GraphRbacManagementClient = require('azure-graph');
const msrest = require('ms-rest-azure');
const request = require('request');

function resourceGroupPrefixesToDelete() {
    return new Promise((resolve, reject) => {
        const metaKey = process.env['META_KEY'];
        const metaUrl = process.env['META_URL'];
        request(`${metaUrl}/?code=${metaKey}`, (err, res, body) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(JSON.parse(body));
        });
    });
}

function deleteRgPrefixEntry(rgPrefix) {
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

function cleanup(logger) {
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

    return resourceGroupPrefixesToDelete()
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
                const output = rowsCached.filter(row => {
                    return resourceGroups[i].name.substring(0, row.resource_group_prefix.length) === row.resource_group_prefix;
                });
                if (output.length > 0) {
                    rgPrefixEntriesToDeleteCachedOperations.push(deleteRgPrefixEntry(output[0].resource_group_prefix));
                    deleteApplications.push(output[0].application_object_id);
                    logger(`Deleting ${resourceGroups[i].name} with expiration of ${output[0].expiration_datetime}`);
                    deleteResourceGroupOperations.push(resClientCached.resourceGroups.beginDeleteMethod(resourceGroups[i].name));
                    deletedResourceGroups.push(resourceGroups[i].name);
                }
            }
            logger(`deleting ${deleteResourceGroupOperations.length} resource group(s)`);
            return Promise.all(deleteResourceGroupOperations);
        })
        .then(() => Promise.all(rgPrefixEntriesToDeleteCachedOperations))
        .then(() => {
            const applicationsToDeleteOperations = deleteApplications.map(appObjectIdToDelete => {
                logger(`deleting ${appObjectIdToDelete}`);
                return graphClient.applications.deleteMethod(appObjectIdToDelete);
            });
            return Promise.all(applicationsToDeleteOperations);
        });
}

module.exports = function (context, cleanupTimer) {
    if(cleanupTimer.isPastDue)
    {
        context.log('Past due condition met');
    }

    cleanup(context.log)
        .then(() => {
            context.log('Cleanup iteration ran successfully');
            context.done();
        })
        .catch(err => {
            context.log('Cleanup iteration failed');
            context.log(err);
            context.done();
        });
};
