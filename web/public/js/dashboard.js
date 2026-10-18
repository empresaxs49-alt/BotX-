'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { overview: null, activeSection: 'overview' };

  function text(selector, value) {
    $$(selector).forEach((element) => { element.textContent = value; });
  }

  function toast(message, kind = 'success') {
    const stack = $('[data-toast-stack]');
    if (!stack) return;
    const item = document.createElement('div');
    item.className = `toast toast--${kind}`;
    const icon = document.createElement('span');
    icon.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i';
    const content = document.createElement('span');
    content.textContent = message;
    item.append(icon, content);
    stack.append(item);
    setTimeout(() => {
      item.classList.add('is-leaving');
      item.addEventListener('transitionend', () => item.remove(), { once: true });
    }, 4_000);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('X-Requested-With', 'XMLHttpRequest');
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({ ok: false, message: 'Respuesta no válida del servidor.' }));
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error('Tu sesión expiró.');
    }
    if (!response.ok || payload.ok === false) throw new Error(payload.message || 'No fue posible completar la acción.');
    return payload;
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('es-CO', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function formatUptime(milliseconds) {
    const total = Math.max(0, Math.floor((milliseconds || 0) / 1000));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function updateOverview(overview) {
    state.overview = overview;
    const ready = Boolean(overview.ready);
    const stateLabel = ready ? 'En línea' : 'Desconectado';
    const ping = overview.ping ? `${overview.ping} ms` : '—';

    document.body.classList.toggle('bot-is-offline', !ready);
    text('[data-bot-state]', stateLabel);
    text('[data-bot-tag]', overview.botTag || 'Conectando…');
    text('[data-ping]', ping);
    text('[data-member-count]', String(overview.guild?.memberCount || 0));
    text('[data-ticket-count]', String(overview.ticketCount || 0));
    text('[data-voice-name]', overview.voice?.channelName || 'Desconectado');
    text('[data-last-refresh]', `Actualizado ${new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`);

    $$('[data-presence-dot]').forEach((dot) => dot.classList.toggle('is-offline', !ready));
    $$('[data-protection]').forEach((badge) => {
      const module = badge.dataset.protection;
      const enabled = Boolean(overview.protection?.[module]);
      badge.textContent = enabled ? 'Activo' : 'Pausado';
      badge.classList.toggle('is-paused', !enabled);
    });
    $$('[data-security]').forEach((toggle) => {
      const value = overview.protection?.[toggle.dataset.security];
      if (typeof value === 'boolean') toggle.checked = value;
    });

    const voiceState = $('[data-voice-state]');
    if (voiceState) {
      voiceState.classList.toggle('is-connected', Boolean(overview.voice?.connected));
      $('span', voiceState).textContent = overview.voice?.connected ? 'Conectado' : 'Desconectado';
    }

    if (overview.lastError) {
      const errorCard = $('[data-config-error]');
      if (errorCard) {
        errorCard.hidden = false;
        errorCard.textContent = `Aviso del bot: ${overview.lastError}`;
      }
    }
  }

  function showSection(section) {
    state.activeSection = section;
    $$('[data-section]').forEach((pane) => pane.classList.toggle('is-visible', pane.dataset.section === section));
    $$('[data-section-target]').forEach((link) => link.classList.toggle('is-active', link.dataset.sectionTarget === section));
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
  }

  function openMobileMenu() {
    $('[data-sidebar]')?.classList.add('is-open');
    $('[data-sidebar-backdrop]')?.classList.add('is-visible');
    const button = $('[data-menu-toggle]');
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  function closeMobileMenu() {
    $('[data-sidebar]')?.classList.remove('is-open');
    $('[data-sidebar-backdrop]')?.classList.remove('is-visible');
    const button = $('[data-menu-toggle]');
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function renderTickets(tickets) {
    const body = $('[data-tickets-body]');
    if (!body) return;
    body.replaceChildren();
    if (!tickets.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty-row';
      cell.textContent = 'No hay tickets activos.';
      row.append(cell);
      body.append(row);
      return;
    }

    tickets.forEach((ticket) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'channel-tag';
      tag.textContent = `# ${ticket.name}`;
      name.append(tag);
      const owner = document.createElement('td');
      owner.textContent = ticket.ownerId ? `ID ${ticket.ownerId}` : 'Sin identificar';
      const created = document.createElement('td');
      created.textContent = formatDate(ticket.createdAt);
      const actions = document.createElement('td');
      const close = document.createElement('button');
      close.className = 'button button--danger button--small';
      close.type = 'button';
      close.textContent = 'Cerrar';
      close.addEventListener('click', async () => {
        if (!window.confirm(`¿Cerrar ${ticket.name}? Esta acción elimina el canal.`)) return;
        try {
          const response = await api(`/api/tickets/${encodeURIComponent(ticket.id)}/close`, { method: 'POST' });
          toast(response.message);
          await refreshOverview();
          await refreshTickets();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
      actions.append(close);
      row.append(name, owner, created, actions);
      body.append(row);
    });
  }

  function renderLogs(logs) {
    const list = $('[data-activity-list]');
    if (!list) return;
    list.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No hay eventos registrados todavía.';
      list.append(empty);
      return;
    }

    logs.forEach((log) => {
      const entry = document.createElement('article');
      entry.className = `activity-item activity-item--${log.level || 'info'}`;
      const dot = document.createElement('i');
      dot.className = 'activity-item__dot';
      const body = document.createElement('div');
      const message = document.createElement('p');
      message.textContent = log.message;
      const time = document.createElement('small');
      time.textContent = formatDate(log.time);
      body.append(message, time);
      entry.append(dot, body);
      list.append(entry);
    });
  }

  async function refreshOverview() {
    try {
      const overview = await api('/api/overview');
      updateOverview(overview);
      return overview;
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  async function refreshTickets() {
    try {
      const response = await api('/api/tickets');
      renderTickets(response.tickets || []);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function refreshLogs() {
    try {
      const response = await api('/api/logs');
      renderLogs(response.logs || []);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function syncPreview() {
    const title = $('[data-composer-title]')?.value.trim() || 'Título del anuncio';
    const description = $('[data-composer-description]')?.value.trim() || 'La descripción aparecerá aquí cuando escribas tu mensaje.';
    const footer = $('[data-composer-footer]')?.value.trim() || 'X$ · Panel';
    const footerIcon = $('[data-composer-footer-icon]')?.value.trim() || '';
    const thumbnail = $('[data-composer-thumbnail]')?.value.trim() || '';
    const image = $('[data-composer-image]')?.value.trim() || '';
    const color = $('[data-composer-color]')?.value.trim();

    const ptitle = $('[data-preview-title]');
    const pdesc = $('[data-preview-description]');
    const pfooter = $('[data-preview-footer]');
    if (ptitle) ptitle.textContent = title;
    if (pdesc) pdesc.textContent = description;
    if (pfooter) pfooter.textContent = footer;

    if (/^#?[0-9a-fA-F]{6}$/.test(color || '')) {
      const bar = $('[data-preview-color]');
      if (bar) bar.style.backgroundColor = color.startsWith('#') ? color : `#${color}`;
    }

    // Footer icon
    const pfi = $('[data-preview-footer-icon]');
    if (pfi) { pfi.src = footerIcon; pfi.style.display = footerIcon ? '' : 'none'; }
    // Thumbnail
    const pthumb = $('[data-preview-thumbnail]');
    if (pthumb) { pthumb.src = thumbnail; pthumb.style.display = thumbnail ? '' : 'none'; }
    // Image
    const pimg = $('[data-preview-image]');
    if (pimg) { pimg.src = image; pimg.style.display = image ? '' : 'none'; }
  }

  function bindEvents() {
    $$('[data-section-target]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.sectionTarget)));
    $$('[data-go]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.go)));

    $('[data-menu-toggle]')?.addEventListener('click', () => {
      const isOpen = $('[data-sidebar]')?.classList.contains('is-open');
      if (isOpen) closeMobileMenu(); else openMobileMenu();
    });
    $('[data-sidebar-backdrop]')?.addEventListener('click', closeMobileMenu);

    $$('[data-send-template]').forEach((button) => button.addEventListener('click', async () => {
      const channelId = $('[data-embed-channel]')?.value;
      if (!channelId) return toast('Selecciona primero un canal de destino.', 'error');
      button.disabled = true;
      try {
        const response = await api('/api/embed/predefined', {
          method: 'POST', body: JSON.stringify({ type: button.dataset.sendTemplate, channelId }),
        });
        toast(response.message);
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    }));

    $('[data-composer-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const channelId = $('[data-composer-channel]').value;
      if (!channelId) return toast('Selecciona un canal de destino.', 'error');
      const submit = $('button[type="submit"]', event.currentTarget);
      submit.disabled = true;
      try {
        const response = await api('/api/embed/custom', {
          method: 'POST',
          body: JSON.stringify({
            channelId,
            title: $('[data-composer-title]').value,
            description: $('[data-composer-description]').value,
            color: $('[data-composer-color]').value,
            footer: $('[data-composer-footer]').value,
            footerIcon: $('[data-composer-footer-icon]')?.value || '',
            image: $('[data-composer-image]')?.value || '',
            thumbnail: $('[data-composer-thumbnail]')?.value || '',
          }),
        });
        toast(response.message);
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
    $$('[data-composer-title], [data-composer-description], [data-composer-footer], [data-composer-color], [data-composer-footer-icon], [data-composer-thumbnail], [data-composer-image]').forEach((input) => input.addEventListener('input', syncPreview));

    $$('[data-security]').forEach((toggle) => toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      try {
        const response = await api('/api/security', { method: 'PUT', body: JSON.stringify({ module: toggle.dataset.security, enabled: toggle.checked }) });
        updateOverview({ ...(state.overview || {}), protection: response.protection });
        toast(response.message);
        await refreshLogs();
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(error.message, 'error');
      } finally {
        toggle.disabled = false;
      }
    }));

    $('[data-voice-connect]')?.addEventListener('click', async () => {
      const channelId = $('[data-voice-channel]')?.value;
      if (!channelId) return toast('Selecciona un canal de voz.', 'error');
      try {
        const response = await api('/api/voice/connect', { method: 'POST', body: JSON.stringify({ channelId }) });
        toast(response.message);
        await refreshOverview();
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    $('[data-voice-disconnect]')?.addEventListener('click', async () => {
      try {
        const response = await api('/api/voice/disconnect', { method: 'POST' });
        toast(response.message);
        await refreshOverview();
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    $('[data-presence-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('button[type="submit"]', event.currentTarget);
      submit.disabled = true;
      try {
        const response = await api('/api/presence', {
          method: 'POST', body: JSON.stringify({ status: $('[data-presence-status]').value, activity: $('[data-presence-activity]').value }),
        });
        toast(response.message);
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });

    $('[data-refresh-tickets]')?.addEventListener('click', refreshTickets);
    $('[data-refresh-logs]')?.addEventListener('click', refreshLogs);

    // ─── Template editor ─────────────────────────────────────
    let tplCache = {};

    async function loadTemplates() {
      try {
        const res = await api('/api/embed/templates');
        tplCache = res.templates || {};
      } catch { /* ignore */ }
    }

    function fillTplEditor(type) {
      const tpl = tplCache[type];
      if (!tpl) return;
      const v = (sel) => $(sel);
      v('[data-tpl-title]').value = tpl.title || '';
      v('[data-tpl-desc]').value = tpl.description || '';
      v('[data-tpl-color]').value = '#' + (tpl.color || 0x2b2d31).toString(16).padStart(6, '0');
      v('[data-tpl-footer]').value = tpl.footer?.text || '';
      v('[data-tpl-footer-icon]').value = tpl.footer?.iconURL || '';
      v('[data-tpl-thumbnail]').value = tpl.thumbnail || '';
      v('[data-tpl-image]').value = tpl.image || '';
    }

    $('[data-tpl-select]')?.addEventListener('change', (e) => {
      if (e.target.value) fillTplEditor(e.target.value);
    });

    $('[data-tpl-save]')?.addEventListener('click', async () => {
      const type = $('[data-tpl-select]')?.value;
      if (!type) return toast('Selecciona un embed primero.', 'error');
      try {
        const body = {
          title: $('[data-tpl-title]').value,
          description: $('[data-tpl-desc]').value,
          color: $('[data-tpl-color]').value,
          thumbnail: $('[data-tpl-thumbnail]').value || null,
          image: $('[data-tpl-image]').value || null,
          footer: {
            text: $('[data-tpl-footer]').value,
            iconURL: $('[data-tpl-footer-icon]').value || null,
          },
        };
        const res = await api(`/api/embed/templates/${encodeURIComponent(type)}`, {
          method: 'PUT', body: JSON.stringify(body),
        });
        toast(res.message);
        if (res.template) tplCache[type] = res.template;
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    $('[data-tpl-reset]')?.addEventListener('click', async () => {
      await loadTemplates();
      const type = $('[data-tpl-select]')?.value;
      if (type) fillTplEditor(type);
      toast('Datos recargados del servidor.');
    });

    // Load templates on init
    loadTemplates().then(() => {
      const sel = $('[data-tpl-select]');
      if (sel?.value) fillTplEditor(sel.value);
    });

    $('[data-clear-logs]')?.addEventListener('click', async () => {
      if (!window.confirm('¿Limpiar el registro de actividad de esta sesión?')) return;
      try {
        const response = await api('/api/logs', { method: 'DELETE' });
        toast(response.message);
        await refreshLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    syncPreview();
    await Promise.all([refreshOverview(), refreshTickets(), refreshLogs()]);
    window.setInterval(() => refreshOverview(), 20_000);
    window.setInterval(() => {
      if (state.activeSection === 'tickets') refreshTickets();
      if (state.activeSection === 'activity') refreshLogs();
    }, 30_000);
  });
})();
