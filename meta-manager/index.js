const pg = require('pg');

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

    context.log(`You passed in ${rgprefix}`);
    context.res = { body: `You passed ${rgprefix}` };
    context.done();
};
