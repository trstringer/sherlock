const pg = require('pg');
const moment = require('moment');

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

function expirationDate(durationMin) {
    const currentDate = new Date();
    const newDate = moment(currentDate).add(durationMin, 'm');
    return newDate.utc().toString();
}

function pgErrorHandler(err) {
    if (err.code !== 'ECONNRESET') {
        throw err;
    }
}

function getMetaInfo() {
    const pgClient = new pg.Client(pgConfig());
    const query = `
        select
            resource_group_prefix,
            application_object_id,
            expiration_datetime
        from sandbox
        where expiration_datetime < now();
    `;

    pgClient.on('error', pgErrorHandler);

    return pgClient.connect()
        .then(() => pgClient.query(query))
        .then(res => res.rows);
}

function deleteRgPrefix(rgPrefix) {
    const pgClient = new pg.Client(pgConfig());
    const query = `
        delete from sandbox
        where resource_group_prefix = '${rgPrefix}';
    `;

    pgClient.on('error', pgErrorHandler);

    return pgClient.connect()
        .then(() => pgClient.query(query))
        .then(() => pgClient.end());
}

function addMetaInfo(resourceGroupPrefix, applicationObjectId, expiresOn) {
    const pgClient = new pg.Client(pgConfig());
    const query = `
        insert into public.sandbox (resource_group_prefix, application_object_id, expiration_datetime)
        values ('${resourceGroupPrefix}', '${applicationObjectId}', '${expiresOn}');
    `;

    pgClient.on('error', pgErrorHandler);

    return pgClient.connect()
        .then(() => pgClient.query(query))
        .then(() => pgClient.end());
}

module.exports = function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');
    context.log(`Request method: ${req.method}`);

    if (!req.query.rgprefix && !(req.body && req.body.rgprefix)) {
        // in this case just retrieve the data
        getMetaInfo()
            .then(data => {
                context.res = { body: data };
                context.done();
            });
        return;
    }
    else if (!req.query.appobjid && !(req.body && req.body.appobjid)) {
        context.log('Application object id not passed');
        context.res = { status: 400, body: 'Application object id not passed' };
        context.done();
        return;
    }
    else if (!req.query.expire && !(req.body && req.body.expire)) {
        context.log('Expiration date not passed');
        context.res = { status: 400, body: 'Expiration date not passed' };
        context.done();
        return;
    }

    const rgprefix = req.query.rgprefix || req.body.rgprefix;
    const appobjid = req.query.appobjid || req.body.appobjid;
    const expire = req.query.expire || req.body.expire;

    addMetaInfo(rgprefix, appobjid, expirationDate(expire))
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
