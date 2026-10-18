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
    }, 5_000);
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

  function updateOverview(overview) {
    state.overview = overview;
    const ready = Boolean(overview.ready);

    document.body.classList.toggle('bot-is-offline', !ready);
    text('[data-bot-state]', ready ? 'En línea' : 'Desconectado');
    text('[data-bot-tag]', overview.botTag || 'Conectando…');
    text('[data-ping]', overview.ping ? `${overview.ping} ms` : '—');
    text('[data-member-count]', String(overview.guild?.memberCount || 0));
    text('[data-ticket-count]', String(overview.ticketCount || 0));
    text('[data-voice-name]', overview.voice?.channelName || (overview.voice?.connected ? 'Conectado' : 'Desconectado'));
    text('[data-last-refresh]', `Actualizado ${new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`);

    $$('[data-presence-dot]').forEach((dot) => dot.classList.toggle('is-offline', !ready));
    $$('[data-protection]').forEach((badge) => {
      const enabled = Boolean(overview.protection?.[badge.dataset.protection]);
      badge.textContent = enabled ? 'Activo' : 'Pausado';
      badge.classList.toggle('is-paused', !enabled);
    });
    $$('[data-security]').forEach((toggle) => {
      const value = overview.protection?.[toggle.dataset.security];
      if (typeof value === 'boolean') toggle.checked = value;
    });

    // Voz: estado real + último error (por ejemplo, el motivo por el que Discord lo sacó).
    const voice = overview.voice || {};
    const voiceState = $('[data-voice-state]');
    if (voiceState) {
      voiceState.classList.toggle('is-connected', Boolean(voice.connected));
      const label = voice.connected ? 'Conectado' : (voice.status && voice.status !== 'disconnected' ? 'Conectando…' : 'Desconectado');
      $('span', voiceState).textContent = label;
    }
    const voiceError = $('[data-voice-error]');
    if (voiceError) {
      voiceError.hidden = !voice.error;
      voiceError.textContent = voice.error ? `⚠ ${voice.error}` : '';
    }
  }

  function showSection(section) {
    state.activeSection = section;
    $$('[data-section]').forEach((pane) => pane.classList.toggle('is-visible', pane.dataset.section === section));
    $$('[data-section-target]').forEach((link) => link.classList.toggle('is-active', link.dataset.sectionTarget === section));
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
    document.dispatchEvent(new CustomEvent('xpanel:section', { detail: { section } }));
  }

  function openMobileMenu() {
    $('[data-sidebar]')?.classList.add('is-open');
    $('[data-sidebar-backdrop]')?.classList.add('is-visible');
    $('[data-menu-toggle]')?.setAttribute('aria-expanded', 'true');
  }

  function closeMobileMenu() {
    $('[data-sidebar]')?.classList.remove('is-open');
    $('[data-sidebar-backdrop]')?.classList.remove('is-visible');
    $('[data-menu-toggle]')?.setAttribute('aria-expanded', 'false');
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
      renderTickets((await api('/api/tickets')).tickets || []);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function refreshLogs() {
    try {
      renderLogs((await api('/api/logs')).logs || []);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    $$('[data-section-target]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.sectionTarget)));
    $$('[data-go]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.go)));

    $('[data-menu-toggle]')?.addEventListener('click', () => {
      if ($('[data-sidebar]')?.classList.contains('is-open')) closeMobileMenu(); else openMobileMenu();
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

    $('[data-voice-connect]')?.addEventListener('click', async (event) => {
      const channelId = $('[data-voice-channel]')?.value;
      if (!channelId) return toast('Selecciona un canal de voz.', 'error');
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Conectando…';
      try {
        const response = await api('/api/voice/connect', { method: 'POST', body: JSON.stringify({ channelId }) });
        toast(response.message);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Conectar';
        await refreshOverview();
        await refreshLogs();
      }
    });

    $('[data-voice-disconnect]')?.addEventListener('click', async () => {
      try {
        const response = await api('/api/voice/disconnect', { method: 'POST' });
        toast(response.message);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        await refreshOverview();
        await refreshLogs();
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

  // Lo que necesita el editor de embeds (otro archivo).
  window.XPanel = { api, toast, refreshLogs, showSection };

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await Promise.all([refreshOverview(), refreshTickets(), refreshLogs()]);
    window.setInterval(() => refreshOverview(), 15_000);
    window.setInterval(() => {
      if (state.activeSection === 'tickets') refreshTickets();
      if (state.activeSection === 'activity') refreshLogs();
    }, 30_000);
  });
})();
