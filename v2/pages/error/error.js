var _ = require('lodash');
var path = require('path');
var util = require('util');

var logger = require('../../lib/logger');

module.exports = function(err, req, res, next) {
    // clear all cookies in case something was misconfigured
    _(req.cookies).each(function(value, key) {
        res.clearCookie(key);
    });

    var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    var errorId = _.times(10, function() {return _.sample(chars);}).join('');

    res.status(err.status || 500);
    logger.error('Error page', {
        msg: err.message,
        id: errorId,
        status: err.status,
        stack: err.stack,
        data: JSON.stringify(err.data),
    });

    if (req.app.get('env') == 'development') {
        // development error handler
        // will print stacktrace
        res.render(path.join(__dirname, 'error'), {
            error: err,
            id: errorId,
        });
    } else {
        // production error handler
        // no stacktraces leaked to user
        res.render(path.join(__dirname, 'error'), {
            error: {message: err.message},
            id: errorId,
        });
    }
};
