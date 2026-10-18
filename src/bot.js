require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Collection,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionFlagsBits, ChannelType
} = require('discord.js');

const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

// ─── CONFIG ────────────────────────────────────────────────────────
const TOKEN     = process.env.DISCORD_TOKEN;
const GUILD_ID  = process.env.GUILD_ID;
const LOG_CH    = process.env.LOG_CHANNEL_ID   || null;
const TICKET_CH = process.env.TICKET_PANEL_CH  || null;

const BLOCKED_WORDS = ['spam', 'hack', 'scam', 'free nitro', 'discord.gift.'];
const SPAM_LIMIT    = 5;   // mensajes
const SPAM_WINDOW   = 4000; // ms
const RAID_JOIN_LIMIT  = 8;
const RAID_WINDOW      = 10000;

// ─── ESTADO ───────────────────────────────────────────────────────
const spamMap  = new Collection(); // userId -> { count, timer }
const raidMap  = { joins: [], locked: false };
let   voiceConn = null;

// ─── CLIENT ───────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── EXPORTS para web ─────────────────────────────────────────────
function getClient() { return client; }
function getVoiceConn() { return voiceConn; }
function setVoiceConn(c) { voiceConn = c; }

// ─── EMBEDS PREDEFINIDOS ──────────────────────────────────────────
function buildEmbed(type) {
  const embeds = {
    tickets: new EmbedBuilder()
      .setTitle('🎫 Sistema de Tickets')
      .setDescription('¿Necesitas ayuda o quieres hacer una compra?\n\nHaz click en el botón de abajo para abrir un ticket privado.')
      .setColor(0x00FFFF)
      .addFields(
        { name: '⏱️ Tiempo de respuesta', value: 'Menos de 10 minutos', inline: true },
        { name: '🔒 Privacidad', value: 'Canal privado solo para ti', inline: true }
      )
      .setFooter({ text: 'X$ | Soporte 24/7' })
      .setTimestamp(),

    diamantes: new EmbedBuilder()
      .setTitle('💎 Diamantes Free Fire')
      .setDescription('Recarga diamantes al instante y al mejor precio del mercado.')
      .setColor(0x00BFFF)
      .addFields(
        { name: '100 💎', value: '$X.XX USD', inline: true },
        { name: '310 💎', value: '$X.XX USD', inline: true },
        { name: '520 💎', value: '$X.XX USD', inline: true },
        { name: '1060 💎', value: '$X.XX USD', inline: true },
        { name: '2180 💎', value: '$X.XX USD', inline: true },
        { name: '5600 💎', value: '$X.XX USD', inline: true }
      )
      .setFooter({ text: 'X$ | Diamantes al instante' })
      .setTimestamp(),

    boosts: new EmbedBuilder()
      .setTitle('🚀 Boosts de Servidor')
      .setDescription('Dale a tu servidor los beneficios que merece con nuestros boosts premium.')
      .setColor(0xFF73FA)
      .addFields(
        { name: '1 Boost', value: 'Disponible', inline: true },
        { name: '7 Boosts', value: 'Disponible', inline: true },
        { name: '14 Boosts', value: 'Disponible', inline: true }
      )
      .setFooter({ text: 'X$ | Boosts garantizados' })
      .setTimestamp(),

    decoraciones: new EmbedBuilder()
      .setTitle('🎨 Decoraciones de Perfil')
      .setDescription('Personaliza tu perfil de Discord con decoraciones exclusivas.')
      .setColor(0xFFD700)
      .addFields(
        { name: '✨ Animadas', value: 'Disponibles', inline: true },
        { name: '🎭 Exclusivas', value: 'Disponibles', inline: true },
        { name: '🏆 Premium', value: 'Disponibles', inline: true }
      )
      .setFooter({ text: 'X$ | Decoraciones únicas' })
      .setTimestamp(),

    metodos: new EmbedBuilder()
      .setTitle('💳 Métodos de Pago')
      .setDescription('Aceptamos múltiples formas de pago para tu comodidad.')
      .setColor(0x00FF88)
      .addFields(
        { name: '₿ Crypto', value: 'BTC, ETH, USDT', inline: true },
        { name: '💰 PayPal', value: 'Disponible', inline: true },
        { name: '🏦 Transferencia', value: 'Disponible', inline: true },
        { name: '📱 Nequi / Binance Pay', value: 'Disponible', inline: true },
        { name: '🎮 Gift Cards', value: 'Steam, Google Play, iTunes', inline: true }
      )
      .setFooter({ text: 'X$ | Pago seguro y confiable' })
      .setTimestamp(),
  };
  return embeds[type] || null;
}

// ─── READY ────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[✓] Bot online: ${client.user.tag}`);
  client.user.setPresence({
    status: 'online',
    activities: [{ name: '⚡ X$ | Lo mejor en venta de cheats 🔥', type: 3 }],
  });
  await registerSlashCommands();
});

// ─── SLASH COMMANDS ───────────────────────────────────────────────
async function registerSlashCommands() {
  const { REST, Routes } = require('discord.js');
  const commands = [
    { name: 'tickets',      description: 'Enviar panel de tickets' },
    { name: 'diamantes',    description: 'Enviar panel de diamantes' },
    { name: 'boosts',       description: 'Enviar panel de boosts' },
    { name: 'decoraciones', description: 'Enviar panel de decoraciones' },
    { name: 'metodos',      description: 'Enviar métodos de pago' },
    { name: 'ping',         description: 'Latencia del bot' },
    { name: 'cerrarticket', description: 'Cerrar ticket actual' },
  ];
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('[✓] Slash commands registrados');
  } catch (e) {
    console.error('[✗] Error registrando comandos:', e.message);
  }
}

// ─── INTERACTION HANDLER ──────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const { commandName, channel } = interaction;

    if (['tickets','diamantes','boosts','decoraciones','metodos'].includes(commandName)) {
      const embed = buildEmbed(commandName);
      const row = commandName === 'tickets'
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('abrir_ticket').setLabel('🎫 Abrir Ticket').setStyle(ButtonStyle.Primary)
          )
        : null;
      await interaction.reply({ embeds: [embed], components: row ? [row] : [] });
    }

    if (commandName === 'ping') {
      await interaction.reply({ content: `🏓 Pong! \`${Math.round(client.ws.ping)}ms\``, ephemeral: true });
    }

    if (commandName === 'cerrarticket') {
      if (channel.name?.startsWith('ticket-')) {
        await interaction.reply({ content: '🔒 Cerrando ticket en 3 segundos...' });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
      } else {
        await interaction.reply({ content: '❌ Este no es un canal de ticket.', ephemeral: true });
      }
    }
  }

  // Botón abrir ticket
  if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
    await crearTicket(interaction);
  }
});

// ─── SISTEMA DE TICKETS ───────────────────────────────────────────
async function crearTicket(interaction) {
  const guild = interaction.guild;
  const user  = interaction.user;
  const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);

  if (existing) {
    return interaction.reply({ content: `Ya tienes un ticket abierto: ${existing}`, ephemeral: true });
  }

  const channel = await guild.channels.create({
    name: `ticket-${user.username.toLowerCase()}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ],
  });

  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket Abierto')
    .setDescription(`Hola ${user}! Un staff te atenderá pronto.\n\nDescribe tu consulta o pedido.`)
    .setColor(0x00FFFF)
    .setFooter({ text: 'X$ | Usa /cerrarticket para cerrar' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cerrar_ticket_btn').setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `${user}`, embeds: [embed], components: [row] });
  await interaction.reply({ content: `✅ Ticket creado: ${channel}`, ephemeral: true });
  logAction(guild, `🎫 Ticket creado por ${user.tag} → ${channel.name}`);
}

// Cerrar ticket via botón
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'cerrar_ticket_btn') {
    if (interaction.channel.name?.startsWith('ticket-')) {
      await interaction.reply({ content: '🔒 Cerrando en 3 segundos...' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    }
  }
});

// ─── ANTI-SPAM ────────────────────────────────────────────────────
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  // Filtro de palabras
  const content = msg.content.toLowerCase();
  if (BLOCKED_WORDS.some(w => content.includes(w))) {
    await msg.delete().catch(() => {});
    const warn = await msg.channel.send(`⚠️ ${msg.author}, mensaje eliminado por contenido no permitido.`);
    setTimeout(() => warn.delete().catch(() => {}), 5000);
    logAction(msg.guild, `🚫 Mensaje eliminado de ${msg.author.tag}: "${msg.content.slice(0,50)}"`);
    return;
  }

  // Anti-spam
  const userId = msg.author.id;
  if (!spamMap.has(userId)) {
    spamMap.set(userId, { count: 1, timer: setTimeout(() => spamMap.delete(userId), SPAM_WINDOW) });
  } else {
    const data = spamMap.get(userId);
    data.count++;
    if (data.count >= SPAM_LIMIT) {
      clearTimeout(data.timer);
      spamMap.delete(userId);
      try {
        await msg.member.timeout(60000, 'Anti-spam automático');
        const warn = await msg.channel.send(`🔇 ${msg.author} silenciado por 60s por spam.`);
        setTimeout(() => warn.delete().catch(() => {}), 7000);
        logAction(msg.guild, `🔇 ${msg.author.tag} muteado por spam`);
      } catch {}
    }
  }
});

// ─── ANTI-RAID ────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const now = Date.now();
  raidMap.joins = raidMap.joins.filter(t => now - t < RAID_WINDOW);
  raidMap.joins.push(now);

  if (raidMap.joins.length >= RAID_JOIN_LIMIT && !raidMap.locked) {
    raidMap.locked = true;
    const guild = member.guild;
    try {
      await guild.setVerificationLevel(4);
      logAction(guild, `🛡️ RAID DETECTADO — Verificación máxima activada. ${raidMap.joins.length} joins en ${RAID_WINDOW/1000}s`);
    } catch {}
    setTimeout(async () => {
      try { await guild.setVerificationLevel(1); } catch {}
      raidMap.locked = false;
      raidMap.joins  = [];
    }, 30000);
  }
});

// ─── VOZ: conectar / desconectar desde web ────────────────────────
async function connectVoice(channelId) {
  try {
    const guild   = client.guilds.cache.get(GUILD_ID);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return { ok: false, msg: 'Canal no encontrado' };

    if (voiceConn) { voiceConn.destroy(); voiceConn = null; }

    voiceConn = joinVoiceChannel({
      channelId: channel.id,
      guildId:   guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(voiceConn, VoiceConnectionStatus.Ready, 10_000);
    voiceConn.on(VoiceConnectionStatus.Disconnected, () => { voiceConn = null; });
    return { ok: true, msg: `Conectado a ${channel.name}` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

function disconnectVoice() {
  if (voiceConn) {
    voiceConn.destroy();
    voiceConn = null;
    return { ok: true, msg: 'Desconectado del canal de voz' };
  }
  return { ok: false, msg: 'No está conectado a ningún canal' };
}

// ─── RECONEXIÓN AUTOMÁTICA ────────────────────────────────────────
client.on('shardError',        e  => console.error('[Shard Error]', e.message));
client.on('shardDisconnect',   () => console.log('[!] Shard desconectado, reconectando...'));
client.on('shardReconnecting', () => console.log('[~] Reconectando...'));
client.on('shardResume',       () => console.log('[✓] Reconectado'));

// ─── LOG ──────────────────────────────────────────────────────────
function logAction(guild, msg) {
  console.log(`[LOG] ${msg}`);
  if (LOG_CH) {
    const ch = guild.channels.cache.get(LOG_CH);
    if (ch) ch.send(`\`${new Date().toLocaleTimeString()}\` ${msg}`).catch(() => {});
  }
}

// ─── START ────────────────────────────────────────────────────────
function startBot() {
  client.login(TOKEN).catch(e => {
    console.error('[✗] Login fallido:', e.message);
    setTimeout(startBot, 5000);
  });
}

module.exports = { startBot, getClient, connectVoice, disconnectVoice, buildEmbed };
