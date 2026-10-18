'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} = require('discord.js');
const {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const DEFAULT_BLOCKED_WORDS = ['discord.gift/', 'free nitro', 'scam'];
const MAX_AUDIT_ENTRIES = 150;

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeChannelName(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 38) || 'usuario';
}

function createBot() {
  const config = {
    token: process.env.DISCORD_TOKEN || '',
    guildId: process.env.GUILD_ID || '',
    supportRoleId: process.env.SUPPORT_ROLE_ID || '',
    logChannelId: process.env.LOG_CHANNEL_ID || '',
    blockedWords: (process.env.BLOCKED_WORDS || DEFAULT_BLOCKED_WORDS.join(','))
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean),
    spamLimit: asPositiveInt(process.env.SPAM_LIMIT, 5),
    spamWindowMs: asPositiveInt(process.env.SPAM_WINDOW_MS, 4_000),
    spamTimeoutMs: asPositiveInt(process.env.SPAM_TIMEOUT_MS, 60_000),
    raidJoinLimit: asPositiveInt(process.env.RAID_JOIN_LIMIT, 8),
    raidWindowMs: asPositiveInt(process.env.RAID_WINDOW_MS, 10_000),
    raidLockMs: asPositiveInt(process.env.RAID_LOCK_MS, 30_000),
  };

  const protection = {
    antiSpam: true,
    antiRaid: true,
    wordFilter: true,
    moderationLogs: true,
  };
  const auditLog = [];
  const ticketOwners = new Map();
  const spamBuckets = new Map();
  const raidWindows = new Map();
  const previousVerificationLevels = new Map();

  let voiceConnection = null;
  let loginRetry = null;
  let lastError = null;
  let isStarting = false;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  function writeAudit(level, message, details = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: new Date().toISOString(),
      level,
      message,
      details,
    };
    auditLog.unshift(entry);
    auditLog.splice(MAX_AUDIT_ENTRIES);
    console.log(`[${level.toUpperCase()}] ${message}`);

    if (protection.moderationLogs && config.logChannelId && client.isReady()) {
      const channel = client.channels.cache.get(config.logChannelId);
      if (channel?.isTextBased() && typeof channel.send === 'function') {
        channel.send({ content: `\`${new Date().toLocaleTimeString('es-CO')}\` ${message}` }).catch(() => {});
      }
    }
    return entry;
  }

  function getGuild() {
    return config.guildId ? client.guilds.cache.get(config.guildId) || null : null;
  }

  function isReady() {
    return client.isReady();
  }

  function getVoiceSummary() {
    if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Destroyed) {
      return { connected: false, channelId: null, channelName: null };
    }
    const guild = getGuild();
    const channel = guild?.channels.cache.get(voiceConnection.joinConfig.channelId);
    return {
      connected: voiceConnection.state.status === VoiceConnectionStatus.Ready,
      channelId: channel?.id || null,
      channelName: channel?.name || null,
    };
  }

  function getOverview() {
    const guild = getGuild();
    const textChannels = guild
      ? guild.channels.cache
          .filter((channel) => channel.isTextBased() && typeof channel.send === 'function')
          .map((channel) => ({ id: channel.id, name: channel.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const voiceChannels = guild
      ? guild.channels.cache
          .filter((channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
          .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type === ChannelType.GuildStageVoice ? 'stage' : 'voice' }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    return {
      ready: isReady(),
      botTag: client.user?.tag || 'Conectando…',
      botId: client.user?.id || null,
      ping: client.ws.ping > 0 ? Math.round(client.ws.ping) : 0,
      uptime: client.uptime || 0,
      guild: guild
        ? { id: guild.id, name: guild.name, memberCount: guild.memberCount }
        : null,
      tickets: getTickets(),
      ticketCount: getTickets().length,
      textChannels,
      voiceChannels,
      voice: getVoiceSummary(),
      protection: { ...protection },
      lastError,
    };
  }

  function getLogs(limit = 80) {
    return auditLog.slice(0, Math.max(1, Math.min(limit, MAX_AUDIT_ENTRIES)));
  }

  function clearLogs() {
    auditLog.length = 0;
    writeAudit('info', 'Registro de actividad limpiado desde el panel.');
  }

  function getTicketOwnerFromChannel(channel) {
    if (ticketOwners.has(channel.id)) return ticketOwners.get(channel.id);
    const match = typeof channel.topic === 'string' ? channel.topic.match(/^ticket-owner:(\d+)/) : null;
    return match?.[1] || null;
  }

  function getTickets() {
    const guild = getGuild();
    if (!guild) return [];

    return guild.channels.cache
      .filter((channel) => channel.type === ChannelType.GuildText && channel.name.startsWith('ticket-'))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        ownerId: getTicketOwnerFromChannel(channel),
        createdAt: channel.createdAt?.toISOString() || null,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function isStaff(member) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    return Boolean(config.supportRoleId && member.roles?.cache?.has(config.supportRoleId));
  }

  // ─── Embeds predefinidos editables ────────────────────────────
  // Se almacenan como datos planos para poder editarlos desde el panel.
  const LOGO_URL = 'https://cdn.discordapp.com/attachments/1477078368837964111/1356633862196473938/gif_1.gif';
  const BANNER_URL = 'https://cdn.discordapp.com/attachments/1477078368837964111/1356633861827108864/DKTl8K1.gif';

  const embedTemplates = {
    tickets: {
      color: 0x2b2d31,
      author: { name: 'Bienvenido a x$', iconURL: LOGO_URL },
      title: '**¡Bienvenido al sistema de atencion de tickets!**',
      description:
        '¿Tienes dudas, problemas o quieres obtener uno de nuestros productos?\n' +
        'Abre un ticket y recibe atención personalizada por parte de nuestro equipo\n' +
        '¡Estamos listos para ayudarte y brindarte la mejor experiencia!',
      thumbnail: LOGO_URL,
      image: BANNER_URL,
      footer: { text: 'Copyright © 2026 | x$', iconURL: LOGO_URL },
      buttons: [
        { id: 'ticket:buy', label: 'Comprar', emoji: '💰', style: 'Success' },
        { id: 'ticket:support', label: 'Soporte', emoji: '🛠️', style: 'Danger' },
        { id: 'ticket:question', label: 'Consulta', emoji: '📋', style: 'Primary' },
      ],
    },
    boosts: {
      color: 0x2b2d31,
      title: '**x$ Beneficios**',
      description:
        '<a:goldsssa:1559619455406055434> ¿Qué gano si doy mejoras al servidor?\n\n' +
        'Ten en cuenta que al realizar un número de boosteos en el servidor, podrás recibir nuestros productos ¡COMPLETAMENTE GRATIS!\n\n' +
        '**2 Boost = Panel Boost x7 días.**\n' +
        '**4 Boost = Panel Boost x12 días.**\n' +
        '**6 Boost = Panel Boost x40 días.**\n\n' +
        'Recuerda reclamar tu premio abriendo un ticket\n' +
        '<a:goldsssa:1559619455406055434> # 🔗 · tickets',
      image: BANNER_URL,
      footer: { text: 'Copyright © 2026 | x$', iconURL: LOGO_URL },
    },
    panelpremium: {
      color: 0x2b2d31,
      title: '<a:goldsssa:1559619455406055434>  **PANEL PREMIUM x$**',
      description:
        '» **Fake Lag V1**\t\t\t» **Sniper Scope**\n' +
        '» **Fake Lag V2**\t\t\t» **No Reload**\n' +
        '» **Fake Lag V2.1**\t\t» **Movement 360**\n' +
        '» **Ghost Mode**\t\t\t» **Modo Noche**\n' +
        '» **ESP – Chams**\t\t» **Vision Hack**\n' +
        '» **Bug Cámara**\t\t\t» **Fake Damage**\n' +
        '» **No Recoil**\t\t\t\t» **Mira Bonito**\n' +
        '» **Cambio rápido**\t\t» **Fly P64 – x86**\n' +
        '» **Rapid Fire**\t\t\t\t» **WallHack P64 – x86**\n' +
        '» **Fly N32**\t\t\t\t\t» **WallHack N32**\n' +
        '» **High Jump**\t\t\t\t» **Fly TP**\n' +
        '» **Aimbot Neck**\t\t\t» **Aimbot IA**\n' +
        '» **Aimbot Rage**\t\t\t» **Aimbot Pro**\n\n' +
        'Abre un ticket y recibe atención personalizada por parte de nuestro equipo\n\n' +
        '# 🔗 · tickets',
      image: BANNER_URL,
      footer: { text: 'Copyright © 2026 | x$', iconURL: LOGO_URL },
    },
    panelbasico: {
      color: 0x2b2d31,
      title: '<a:goldsssa:1559619455406055434>  **PANEL BASICO x$**',
      description:
        '» **Fake Lag V1**\t\t\t» **ESP Health**\n' +
        '» **Fake Lag V2**\t\t\t» **ESP Bones**\n' +
        '» **Fake Lag V2.1**\t\t» **SP Distance**\n' +
        '» **Ghost Mode**\t\t\t» **Line of Approach**\n' +
        '» **ESP Line**\t\t\t\t» **Stream Mode**\n' +
        '» **ESP Box**\t\t\t\t\t» **Aimbot Neck**\n' +
        '» **ESP Racha**\t\t\t\t» **Scope x2 – x4**\n' +
        '» **ESP Estrellas / Pts**\t» **Sniper Scope**\n' +
        '» **ESP Name**\n\n' +
        'Abre un ticket y recibe atención personalizada por parte de nuestro equipo\n\n' +
        '# 🔗 · tickets',
      image: BANNER_URL,
      footer: { text: 'Copyright © 2026 | x$', iconURL: LOGO_URL },
    },
    dripclient: {
      color: 0x7b00ff,
      title: '<:xslogo:1559619455406055434>  **DRIP CLIENT x$**',
      description:
        '» **Ghost Hack**\t\t\t» **ESP Health**\n' +
        '» **Speed Hack**\t\t\t» **ESP Bones**\n' +
        '» **Wall Hack**\t\t\t\t» **ESP MGE**\n' +
        '» **Teleport (8m)**\t\t» **Aimbot Legit**\n' +
        '» **ESP Line**\t\t\t\t» **Aimbot Rage**\n' +
        '» **ESP Box**\t\t\t\t\t» **Aimbot Neck**\n' +
        '» **ESP RGB**\n' +
        '» **ESP Weapons**\n' +
        '» **ESP Name**\n\n' +
        'Abre un ticket y recibe atención personalizada por parte de nuestro equipo\n\n' +
        '# 🔗 · tickets',
      image: BANNER_URL,
      footer: { text: 'Copyright © 2026 | x$', iconURL: LOGO_URL },
    },
  };

  function getEmbedTemplates() {
    return JSON.parse(JSON.stringify(embedTemplates));
  }

  function updateEmbedTemplate(type, data) {
    if (!embedTemplates[type]) return { ok: false, message: 'Tipo de embed no encontrado.' };
    if (data.title !== undefined) embedTemplates[type].title = String(data.title).slice(0, 256);
    if (data.description !== undefined) embedTemplates[type].description = String(data.description).slice(0, 4096);
    if (data.color !== undefined) embedTemplates[type].color = data.color;
    if (data.image !== undefined) embedTemplates[type].image = data.image || null;
    if (data.thumbnail !== undefined) embedTemplates[type].thumbnail = data.thumbnail || null;
    if (data.footer !== undefined) {
      embedTemplates[type].footer = {
        text: String(data.footer.text || '').slice(0, 2048),
        iconURL: data.footer.iconURL || null,
      };
    }
    if (data.author !== undefined) {
      embedTemplates[type].author = data.author
        ? { name: String(data.author.name || '').slice(0, 256), iconURL: data.author.iconURL || null }
        : null;
    }
    writeAudit('success', `Embed «${type}» actualizado desde el panel.`);
    return { ok: true, message: `Embed «${type}» actualizado.`, template: JSON.parse(JSON.stringify(embedTemplates[type])) };
  }

  function buildEmbed(type) {
    const tpl = embedTemplates[type];
    if (!tpl) return null;
    const embed = new EmbedBuilder().setColor(tpl.color).setTimestamp();
    if (tpl.author) embed.setAuthor({ name: tpl.author.name, iconURL: tpl.author.iconURL || undefined });
    if (tpl.title) embed.setTitle(tpl.title);
    if (tpl.description) embed.setDescription(tpl.description);
    if (tpl.thumbnail) embed.setThumbnail(tpl.thumbnail);
    if (tpl.image) embed.setImage(tpl.image);
    if (tpl.footer) embed.setFooter({ text: tpl.footer.text, iconURL: tpl.footer.iconURL || undefined });
    return embed;
  }

  function ticketComponents(type) {
    const tpl = embedTemplates[type || 'tickets'];
    if (!tpl?.buttons?.length) {
      // Default: un solo botón verde
      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket:create')
            .setLabel('Abrir ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Success),
        ),
      ];
    }
    const styleMap = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
    const row = new ActionRowBuilder();
    for (const btn of tpl.buttons.slice(0, 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(btn.id || 'ticket:create')
          .setLabel(btn.label || 'Ticket')
          .setEmoji(btn.emoji || '🎫')
          .setStyle(styleMap[btn.style] || ButtonStyle.Primary),
      );
    }
    return [row];
  }

  async function sendPredefinedEmbed(type, channelId) {
    const guild = getGuild();
    if (!guild) return { ok: false, message: 'El bot aún no está conectado al servidor configurado.' };
    const channel = guild.channels.cache.get(channelId);
    const embed = buildEmbed(type);

    if (!embed) return { ok: false, message: 'El tipo de embed no es válido.' };
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      return { ok: false, message: 'Selecciona un canal de texto válido.' };
    }

    const hasButtons = embedTemplates[type]?.buttons?.length > 0 || type === 'tickets';
    await channel.send({ embeds: [embed], components: hasButtons ? ticketComponents(type) : [] });
    writeAudit('success', `Embed «${type}» enviado a #${channel.name}.`);
    return { ok: true, message: `Embed enviado a #${channel.name}.` };
  }

  async function sendCustomEmbed({ channelId, title, description, color, footer, footerIcon, image, thumbnail }) {
    const guild = getGuild();
    if (!guild) return { ok: false, message: 'El bot aún no está conectado al servidor configurado.' };
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      return { ok: false, message: 'Selecciona un canal de texto válido.' };
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (footer) {
      const footerObj = { text: footer };
      if (footerIcon) footerObj.iconURL = footerIcon;
      embed.setFooter(footerObj);
    }
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);

    await channel.send({ embeds: [embed] });
    writeAudit('success', `Embed personalizado enviado a #${channel.name}.`);
    return { ok: true, message: `Embed enviado a #${channel.name}.` };
  }

  async function createTicket(interaction) {
    const guild = interaction.guild;
    const user = interaction.user;
    if (!guild) return interaction.reply({ content: 'Este botón solo funciona dentro de un servidor.', ephemeral: true });

    const existing = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name.startsWith('ticket-') &&
      getTicketOwnerFromChannel(channel) === user.id,
    );
    if (existing) {
      return interaction.reply({ content: `Ya tienes un ticket abierto: ${existing}.`, ephemeral: true });
    }

    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ];
    if (config.supportRoleId) {
      permissionOverwrites.push({
        id: config.supportRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${safeChannelName(user.username)}-${user.id.slice(-4)}`,
      type: ChannelType.GuildText,
      topic: `ticket-owner:${user.id}`,
      permissionOverwrites,
      reason: `Ticket creado por ${user.tag}`,
    });
    ticketOwners.set(channel.id, user.id);

    const intro = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle('🎫 Ticket abierto')
      .setDescription(`Hola ${user}. Describe tu solicitud y el equipo te atenderá pronto.`)
      .setFooter({ text: 'Usa el botón para cerrar cuando termines.' })
      .setTimestamp();
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:close')
        .setLabel('Cerrar ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
    );
    await channel.send({ content: `${user}`, embeds: [intro], components: [controls] });
    await interaction.reply({ content: `✅ Ticket creado: ${channel}.`, ephemeral: true });
    writeAudit('success', `Ticket ${channel.name} creado por ${user.tag}.`);
  }

  async function closeTicket(channelId, actor = 'Panel web') {
    const guild = getGuild();
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText || !channel.name.startsWith('ticket-')) {
      return { ok: false, message: 'El ticket ya no existe o no es válido.' };
    }
    const name = channel.name;
    await channel.delete(`Ticket cerrado por ${actor}`);
    ticketOwners.delete(channelId);
    writeAudit('info', `Ticket ${name} cerrado por ${actor}.`);
    return { ok: true, message: `Ticket ${name} cerrado.` };
  }

  async function connectVoice(channelId) {
    const guild = getGuild();
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
      return { ok: false, message: 'Selecciona un canal de voz válido.' };
    }

    try {
      if (voiceConnection) {
        voiceConnection.destroy();
        voiceConnection = null;
      }
      voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 15_000);
      voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
        writeAudit('warning', 'La conexión de voz se desconectó.');
        try {
          await Promise.race([
            entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          voiceConnection?.destroy();
          voiceConnection = null;
        }
      });
      writeAudit('success', `Bot conectado al canal de voz «${channel.name}».`);
      return { ok: true, message: `Conectado a «${channel.name}».`, voice: getVoiceSummary() };
    } catch (error) {
      voiceConnection?.destroy();
      voiceConnection = null;
      writeAudit('error', `No se pudo conectar a voz: ${error.message}`);
      return { ok: false, message: 'No fue posible conectar a ese canal de voz.' };
    }
  }

  function disconnectVoice() {
    if (!voiceConnection) return { ok: false, message: 'El bot no está conectado a voz.' };
    voiceConnection.destroy();
    voiceConnection = null;
    writeAudit('info', 'Bot desconectado del canal de voz desde el panel.');
    return { ok: true, message: 'Bot desconectado del canal de voz.', voice: getVoiceSummary() };
  }

  function updateSecurity(module, enabled) {
    if (!Object.hasOwn(protection, module) || typeof enabled !== 'boolean') {
      return { ok: false, message: 'Módulo de seguridad inválido.' };
    }
    protection[module] = enabled;
    writeAudit('info', `${module} ${enabled ? 'activado' : 'desactivado'} desde el panel.`);
    return { ok: true, message: `${module} ${enabled ? 'activado' : 'desactivado'}.`, protection: { ...protection } };
  }

  function updatePresence({ status, activity }) {
    if (!isReady()) return { ok: false, message: 'El bot aún no está conectado.' };
    const allowedStatuses = new Set(['online', 'idle', 'dnd', 'invisible']);
    const cleanActivity = String(activity || '').trim().slice(0, 128);
    const safeStatus = allowedStatuses.has(status) ? status : 'online';
    client.user.setPresence({
      status: safeStatus,
      activities: cleanActivity ? [{ name: cleanActivity, type: 3 }] : [],
    });
    writeAudit('success', 'Presencia del bot actualizada desde el panel.');
    return { ok: true, message: 'Presencia actualizada.' };
  }

  function exportSettings() {
    return {
      exportedAt: new Date().toISOString(),
      protection: { ...protection },
      limits: {
        spamLimit: config.spamLimit,
        spamWindowMs: config.spamWindowMs,
        raidJoinLimit: config.raidJoinLimit,
        raidWindowMs: config.raidWindowMs,
      },
      blockedWords: [...config.blockedWords],
    };
  }

  async function registerCommands() {
    if (!config.token || !config.guildId || !client.user) return;
    const commands = [
      { name: 'tickets', description: 'Enviar el panel de tickets' },
      { name: 'boosts', description: 'Enviar el embed de beneficios por boosts' },
      { name: 'panelpremium', description: 'Enviar el embed del Panel Premium' },
      { name: 'panelbasico', description: 'Enviar el embed del Panel Básico' },
      { name: 'dripclient', description: 'Enviar el embed de Drip Client' },
      { name: 'ping', description: 'Mostrar la latencia del bot' },
      { name: 'cerrarticket', description: 'Cerrar el ticket actual' },
    ];
    try {
      const rest = new REST({ version: '10' }).setToken(config.token);
      await rest.put(Routes.applicationGuildCommands(client.user.id, config.guildId), { body: commands });
      writeAudit('success', 'Comandos slash sincronizados.');
    } catch (error) {
      writeAudit('warning', `No se pudieron sincronizar comandos: ${error.message}`);
    }
  }

  client.once('ready', async () => {
    lastError = null;
    isStarting = false;
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'X$ • Panel y soporte', type: 3 }],
    });
    writeAudit('success', `Bot conectado como ${client.user.tag}.`);
    await registerCommands();
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId === 'ticket:create' || interaction.customId === 'ticket:buy' || interaction.customId === 'ticket:support' || interaction.customId === 'ticket:question') return createTicket(interaction);
        if (interaction.customId === 'ticket:close') {
          const ownerId = getTicketOwnerFromChannel(interaction.channel);
          if (interaction.user.id !== ownerId && !isStaff(interaction.member)) {
            return interaction.reply({ content: 'No tienes permiso para cerrar este ticket.', ephemeral: true });
          }
          await interaction.reply({ content: '🔒 Cerrando ticket…', ephemeral: true });
          setTimeout(() => closeTicket(interaction.channel.id, interaction.user.tag).catch(() => {}), 1_500);
          return;
        }
      }

      if (!interaction.isChatInputCommand()) return;
      const command = interaction.commandName;
      if (['tickets', 'boosts', 'panelpremium', 'panelbasico', 'dripclient'].includes(command)) {
        const embed = buildEmbed(command);
        const hasButtons = embedTemplates[command]?.buttons?.length > 0 || command === 'tickets';
        return interaction.reply({ embeds: [embed], components: hasButtons ? ticketComponents(command) : [] });
      }
      if (command === 'ping') {
        return interaction.reply({ content: `🏓 Pong: \`${Math.round(client.ws.ping)}ms\``, ephemeral: true });
      }
      if (command === 'cerrarticket') {
        if (!interaction.channel?.name?.startsWith('ticket-')) {
          return interaction.reply({ content: 'Este comando solo funciona dentro de un ticket.', ephemeral: true });
        }
        const ownerId = getTicketOwnerFromChannel(interaction.channel);
        if (interaction.user.id !== ownerId && !isStaff(interaction.member)) {
          return interaction.reply({ content: 'No tienes permiso para cerrar este ticket.', ephemeral: true });
        }
        await interaction.reply({ content: '🔒 Cerrando ticket…', ephemeral: true });
        setTimeout(() => closeTicket(interaction.channel.id, interaction.user.tag).catch(() => {}), 1_500);
      }
    } catch (error) {
      writeAudit('error', `Error procesando interacción: ${error.message}`);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        interaction.reply({ content: 'Ocurrió un error al procesar la acción.', ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const key = `${message.guild.id}:${message.author.id}`;
    const content = message.content.toLowerCase();

    if (protection.wordFilter && config.blockedWords.some((word) => content.includes(word))) {
      await message.delete().catch(() => {});
      const notice = await message.channel.send({ content: `⚠️ ${message.author}, ese contenido no está permitido.` }).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 5_000);
      writeAudit('warning', `Filtro de palabras eliminó un mensaje de ${message.author.tag}.`);
      return;
    }

    if (!protection.antiSpam) return;
    const bucket = spamBuckets.get(key);
    if (!bucket) {
      spamBuckets.set(key, { count: 1, timeout: setTimeout(() => spamBuckets.delete(key), config.spamWindowMs) });
      return;
    }
    bucket.count += 1;
    if (bucket.count < config.spamLimit) return;

    clearTimeout(bucket.timeout);
    spamBuckets.delete(key);
    try {
      await message.member.timeout(config.spamTimeoutMs, 'Anti-spam automático');
      writeAudit('warning', `${message.author.tag} fue silenciado por anti-spam.`);
    } catch (error) {
      writeAudit('warning', `No se pudo aplicar anti-spam a ${message.author.tag}: faltan permisos.`);
    }
  });

  client.on('guildMemberAdd', async (member) => {
    if (!protection.antiRaid) return;
    const guildId = member.guild.id;
    const now = Date.now();
    const state = raidWindows.get(guildId) || { joins: [], locked: false };
    state.joins = state.joins.filter((timestamp) => now - timestamp < config.raidWindowMs);
    state.joins.push(now);
    raidWindows.set(guildId, state);

    if (state.locked || state.joins.length < config.raidJoinLimit) return;
    state.locked = true;
    try {
      previousVerificationLevels.set(guildId, member.guild.verificationLevel);
      await member.guild.setVerificationLevel(4, 'Anti-raid automático');
      writeAudit('warning', `Anti-raid activado: ${state.joins.length} entradas rápidas detectadas.`);
      setTimeout(async () => {
        try {
          const previous = previousVerificationLevels.get(guildId);
          if (previous !== undefined) await member.guild.setVerificationLevel(previous, 'Restauración anti-raid');
          writeAudit('info', 'Nivel de verificación restaurado después de anti-raid.');
        } catch (error) {
          writeAudit('warning', `No se pudo restaurar la verificación: ${error.message}`);
        } finally {
          previousVerificationLevels.delete(guildId);
          raidWindows.set(guildId, { joins: [], locked: false });
        }
      }, config.raidLockMs);
    } catch (error) {
      state.locked = false;
      writeAudit('warning', `No se pudo activar anti-raid: faltan permisos de Gestionar servidor.`);
    }
  });

  client.on('error', (error) => {
    lastError = error.message;
    writeAudit('error', `Discord reportó un error: ${error.message}`);
  });
  client.on('shardReconnecting', () => writeAudit('warning', 'Discord está reconectando…'));
  client.on('shardResume', () => writeAudit('success', 'Conexión con Discord restaurada.'));

  async function start() {
    if (isStarting || client.isReady()) return;
    if (!config.token) {
      lastError = 'Falta DISCORD_TOKEN en las variables de Railway.';
      writeAudit('error', lastError);
      return;
    }
    isStarting = true;
    try {
      await client.login(config.token);
    } catch (error) {
      isStarting = false;
      lastError = error.message;
      writeAudit('error', `No se pudo iniciar sesión en Discord: ${error.message}`);
      clearTimeout(loginRetry);
      loginRetry = setTimeout(() => start().catch(() => {}), 15_000);
    }
  }

  async function stop() {
    clearTimeout(loginRetry);
    if (voiceConnection) voiceConnection.destroy();
    voiceConnection = null;
    client.destroy();
  }

  return {
    start,
    stop,
    getOverview,
    getLogs,
    clearLogs,
    getTickets,
    getEmbedTemplates,
    updateEmbedTemplate,
    sendPredefinedEmbed,
    sendCustomEmbed,
    closeTicket,
    connectVoice,
    disconnectVoice,
    updateSecurity,
    updatePresence,
    exportSettings,
  };
}

module.exports = { createBot };
