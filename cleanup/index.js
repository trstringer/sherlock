const azurerm = require('azure-arm-resource');
const GraphRbacManagementClient = require('azure-graph');
const msrest = require('ms-rest-azure');

function cleanup(logger) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    const clientSecret = process.env['AZURE_CLIENT_SECRET'];
    const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    const tenantId = process.env['AZURE_TENANT_ID'];
    let resClientCached;
    let deletedResourceGroups = [];
    let deleteApplications = [];

    const credsForGraph = new msrest.ApplicationTokenCredentials(
        clientId,
        tenantId,
        clientSecret,
        { tokenAudience: 'graph' }
    );

    const graphClient = new GraphRbacManagementClient(credsForGraph, tenantId);

    return msrest.loginWithServicePrincipalSecret(clientId, clientSecret, tenantId)
        .then(creds => {
            const resClient = new azurerm.ResourceManagementClient(creds, subscriptionId);
            resClientCached = resClient;
            return resClient.resourceGroups.list();
        })
        .then(resourceGroups => {
            let deleteResourceGroupOperations = [];
            for(let i = 0; i < resourceGroups.length; i++) {
                if (resourceGroups[i].tags && resourceGroups[i].tags.isCI === 'yes' && isExpired(resourceGroups[i].tags.expiresOn)) {
                    deleteApplications.push(resourceGroups[i].tags.appObjectId);
                    logger(`Deleting ${resourceGroups[i].name} with expiration of ${resourceGroups[i].tags.expiresOn}`);
                    deleteResourceGroupOperations.push(resClientCached.resourceGroups.beginDeleteMethod(resourceGroups[i].name));
                    deletedResourceGroups.push(resourceGroups[i].name);
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
        });
}

function isExpired(expirationDateString) {
    return new Date(expirationDateString) < new Date();
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
