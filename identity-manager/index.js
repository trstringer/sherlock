const GraphRbacManagementClient = require('azure-graph');
const msrest = require('ms-rest-azure');
const azureStorage = require('azure-storage');

function populateServicePrincipalsQueue(logger) {
    return new Promise((resolve, reject) => {
        const clientId = process.env['AZURE_CLIENT_ID'];
        const clientSecret = process.env['AZURE_CLIENT_SECRET'];
        const tenantId = process.env['AZURE_TENANT_ID'];
        const identityStorageAccount = process.env['SHERLOCK_IDENTITY_STORAGE_ACCOUNT'];
        const identityStorageKey = process.env['SHERLOCK_IDENTITY_STORAGE_KEY'];
        const queueName = 'identity';
        const desiredSpCount = process.env['SHERLOCK_DESIRED_SP_COUNT'] || 10;

        logger(`Populating ${queueName} with a desired count of ${desiredSpCount} service principals(s)`);

        const credsForGraph = new msrest.ApplicationTokenCredentials(
            clientId,
            tenantId,
            clientSecret,
            { tokenAudience: 'graph' }
        );

        const graphClient = new GraphRbacManagementClient(
            credsForGraph,
            tenantId
        );

        const queueService = azureStorage.createQueueService(
            identityStorageAccount,
            identityStorageKey
        );
        queueService.createQueueIfNotExists(queueName, err => {
            logger('Called createQueueIfNotExists()');
            if (err) {
                logger('Error calling createQueueIfNotExists()');
                logger(err);
                reject(err);
                return;
            }

            queueService.getQueueMetadata(queueName, (err, results) => {
                if (err) {
                    logger('Error calling getQueueMetadata()');
                    logger(err);
                    reject(err);
                    return;
                }
                logger(`Queue length: ${results.approximateMessageCount}`);
                if (results.approximateMessageCount < desiredSpCount) {
                    createIdentities(graphClient, desiredSpCount - results.approximateMessageCount, logger)
                        .then((identities) => {
                            logger('Created identities');
                            logger(identities);
                            identities.forEach(identity => {
                                queueService.createMessage(
                                    queueName,
                                    `${identity.spObjectId} ${identity.appId} ${identity.appObjectId} ${identity.password}`,
                                    err => {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }
                                        logger(`Successfully inserted ${identity.spObjectId} in queue`);
                                    }
                                );
                            });
                        })
                        .catch(err => {
                            logger('Error creating identites');
                            logger(err);
                            reject(err);
                        });
                }
            });
        });
    });
}

function strongPassword() {
    let password = '';

    for (let i = 0; i < 8; i++) {
        password += Math.random().toString(36).slice(-8);
    }

    return password;
}

function createServicePrincipal(graphClient, applicationId) {
    return graphClient.servicePrincipals.create({
        appId: applicationId,
        accountEnabled: true
    });
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

function randomName() {
    return `sherlock${Math.random().toString(36).slice(-8)}`;
}

function createIdentities(graphClient, count, logger) {
    logger(`Entering createIdentities() to provision ${count} new identity(ies)`);
    let newIdentities = [];
    for (let i = 0; i < count; i++) {
        newIdentities.push({
            name: randomName(),
            password: strongPassword()
        });
    }

    return Promise.all(
        newIdentities.map((identity, idx) => {
            return createApplication(graphClient, identity.name, identity.password)
                .then(app => {
                    logger(`Application ${app.appId} created`);
                    return createServicePrincipal(graphClient, app.appId)
                        .then(sp => {
                            logger(`Service principal ${sp.objectId} created`);
                            newIdentities[idx].spObjectId = sp.objectId;
                            newIdentities[idx].appId = app.appId;
                            newIdentities[idx].appObjectId = app.objectId;
                        });
                });
        })
    ).then(() => {
        logger('Sleeping for 60 seconds');
        return new Promise(resolve => {
            setTimeout(resolve, 60000);
        });
    }).then(() => {
        logger(`Created ${newIdentities.length} new identity(ies)`);
        return newIdentities;
    });
}

module.exports = function (context, identityTimer) {
    context.log('Entering function execution');
    if (identityTimer.isPastDue)
    {
        context.log('Past due condition met');
        context.done();
        return;
    }

    populateServicePrincipalsQueue(context.log)
        .then(() => {
            context.log('Service principal queue population ran successfully');
            context.done();
        })
        .catch(err => {
            context.log('Service principal queue population failed');
            context.log(err);
            context.done();
        });
};
