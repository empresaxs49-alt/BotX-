'use strict';

require('dotenv').config();

const { createBot } = require('./src/bot');
const { createWebApp } = require('./web/server');

const port = Number.parseInt(process.env.PORT, 10) || 8080;
const bot = createBot();
const app = createWebApp(bot);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[WEB] Panel disponible en 0.0.0.0:${port}`);
});

bot.start().catch((error) => {
  console.error(`[BOT] Error de inicio: ${error.message}`);
});

async function shutdown(signal) {
  console.log(`[SYSTEM] ${signal} recibido; cerrando de forma segura…`);
  server.close(async () => {
    await bot.stop().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => console.error('[SYSTEM] Promesa no controlada:', error));
process.on('uncaughtException', (error) => console.error('[SYSTEM] Excepción no controlada:', error));
