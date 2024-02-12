const log4js = require('log4js');
const logLevel = process.env.LOG_LEVEL || 'info';

log4js.configure({
  appenders: { console: { type: 'console' } },
  categories: { default: { appenders: ['console'], level: logLevel } }
});

let logger = null;

const getLogger = () => {
    if(!logger) {
        logger = log4js.getLogger();
    }
    return logger;
};

module.exports = {
    getLogger
};

