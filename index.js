require('dotenv').config();
const { startBot, getClient } = require('./src/bot');
const { startWeb } = require('./web/server');

// Iniciar bot y web simultáneamente
startBot();
startWeb(getClient);
