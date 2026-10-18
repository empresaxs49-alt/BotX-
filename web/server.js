require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const { connectVoice, disconnectVoice, buildEmbed } = require('../src/bot');

const PORT     = process.env.PORT || 8080;
const WEB_USER = process.env.WEB_USER || '12';
const WEB_PASS = process.env.WEB_PASS || '12';
const GUILD_ID = process.env.GUILD_ID;

function startWeb(getClient) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'xs_secret_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 6 }, // 6 horas
  }));

  // ─── MIDDLEWARE AUTH ─────────────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (req.session.loggedIn) return next();
    res.redirect('/login');
  };

  // ─── LOGIN ───────────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/dashboard');
    res.render('login', { error: null });
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === WEB_USER && password === WEB_PASS) {
      req.session.loggedIn = true;
      req.session.user = username;
      return res.redirect('/dashboard');
    }
    res.render('login', { error: 'Usuario o contraseña incorrectos' });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });

  // ─── DASHBOARD ───────────────────────────────────────────────────
  app.get('/', requireAuth, (req, res) => res.redirect('/dashboard'));

  app.get('/dashboard', requireAuth, (req, res) => {
    const client  = getClient();
    const guild   = client?.guilds?.cache?.get(GUILD_ID);
    const botTag  = client?.user?.tag || 'Desconectado';
    const botPing = client?.ws?.ping   || 0;
    const botStatus = client?.ws?.status === 0 ? 'online' : 'offline';
    const memberCount = guild?.memberCount || 0;
    const guildName   = guild?.name       || 'N/A';

    // Canales de voz disponibles
    const voiceChannels = guild?.channels?.cache
      .filter(c => c.type === 2)
      .map(c => ({ id: c.id, name: c.name })) || [];

    // Canales de texto disponibles
    const textChannels = guild?.channels?.cache
      .filter(c => c.type === 0)
      .map(c => ({ id: c.id, name: c.name })) || [];

    res.render('dashboard', {
      botTag, botPing, botStatus, memberCount, guildName,
      voiceChannels, textChannels, user: req.session.user,
      flash: req.session.flash || null,
    });
    req.session.flash = null;
  });

  // ─── API: VOZ ────────────────────────────────────────────────────
  app.post('/api/voice/connect', requireAuth, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.json({ ok: false, msg: 'Canal no especificado' });
    const result = await connectVoice(channelId);
    res.json(result);
  });

  app.post('/api/voice/disconnect', requireAuth, (req, res) => {
    const result = disconnectVoice();
    res.json(result);
  });

  // ─── API: ENVIAR EMBEDS ──────────────────────────────────────────
  app.post('/api/embed/send', requireAuth, async (req, res) => {
    const { type, channelId } = req.body;
    if (!type || !channelId) return res.json({ ok: false, msg: 'Faltan parámetros' });

    const client = getClient();
    const guild  = client?.guilds?.cache?.get(GUILD_ID);
    const channel = guild?.channels?.cache?.get(channelId);
    if (!channel) return res.json({ ok: false, msg: 'Canal no encontrado' });

    const embed = buildEmbed(type);
    if (!embed) return res.json({ ok: false, msg: 'Tipo de embed inválido' });

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const components = type === 'tickets'
      ? [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('abrir_ticket').setLabel('🎫 Abrir Ticket').setStyle(ButtonStyle.Primary)
        )]
      : [];

    try {
      await channel.send({ embeds: [embed], components });
      res.json({ ok: true, msg: `Embed "${type}" enviado a #${channel.name}` });
    } catch (e) {
      res.json({ ok: false, msg: e.message });
    }
  });

  // ─── API: EMBED CUSTOM ───────────────────────────────────────
  app.post('/api/embed/custom', requireAuth, async (req, res) => {
    const { title, desc, color, footer, channelId } = req.body;
    if (!channelId) return res.json({ ok: false, msg: 'Canal no especificado' });
    const client = getClient();
    const guild  = client?.guilds?.cache?.get(GUILD_ID);
    const channel = guild?.channels?.cache?.get(channelId);
    if (!channel) return res.json({ ok: false, msg: 'Canal no encontrado' });
    const { EmbedBuilder } = require('discord.js');
    const colorInt = parseInt((color || '#00ff88').replace('#',''), 16);
    const embed = new EmbedBuilder()
      .setTitle(title || 'Embed')
      .setDescription(desc || '')
      .setColor(colorInt)
      .setFooter(footer ? { text: footer } : { text: 'X$ Panel' })
      .setTimestamp();
    try {
      await channel.send({ embeds: [embed] });
      res.json({ ok: true, msg: `Embed enviado a #${channel.name}` });
    } catch (e) {
      res.json({ ok: false, msg: e.message });
    }
  });

  // ─── API: STATUS DEL BOT ─────────────────────────────────────────
  app.get('/api/status', requireAuth, (req, res) => {
    const client = getClient();
    res.json({
      online: client?.ws?.status === 0,
      ping:   client?.ws?.ping || 0,
      tag:    client?.user?.tag || 'N/A',
      uptime: client?.uptime   || 0,
    });
  });

  // ─── START ───────────────────────────────────────────────────────
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✓] Panel web corriendo en http://0.0.0.0:${PORT}`);
  });
}

module.exports = { startWeb };
