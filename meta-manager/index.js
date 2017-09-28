const pg = require('pg');

function pgConfig() {
    return {
        host: process.env['PG_HOST'],
        user: process.env['PG_USER'],
        password: process.env['PG_PASSWORD'],
        database: process.env['PG_DATABASE'],
        port: 5432,
        ssl: true
    };
}

function addMetaInfo(resourceGroupPrefix, applicationObjectId, expiresOn) {
    const pgClient = new pg.Client(pgConfig());

    return pgClient.connect()
        .then(() => 'connected')
        .then(() => pgClient.end());
}

module.exports = function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');

    let rgprefix;

    if (!req.query.rgprefix && !(req.body && req.body.rgprefix)) {
        context.log('Resource group prefix not passed');
        context.res = { status: 400, body: 'Resource group prefix not passed' };
        context.done();
        return;
    }

    rgprefix = req.query.rgprefix || req.body.rgprefix;

    context.log('Calling add meta info');

    addMetaInfo(rgprefix, 'blah', Date())
        .then(() => {
            context.log('completed successfully');
            context.res = { body: 'completely successfully' };
            context.done();
        })
        .catch(err => {
            context.log('whoops there was an error');
            context.log(err);
            context.res = { status: 400, body: 'error!' };
            context.done();
        });
};
