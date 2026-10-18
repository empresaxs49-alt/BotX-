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
    // Now handled by the tabbed editor syncEditorPreview
  }

  // ═══ Tabbed Embed Editor ═════════════════════════════════════
  const edFields = [];

  function val(sel) { return $(sel)?.value?.trim() || ''; }
  function setVal(sel, v) { const el = $(sel); if (el) el.value = v || ''; }

  function syncEditorPreview() {
    const title = val('[data-ed-title]');
    const desc = val('[data-ed-description]');
    const color = val('[data-ed-color]') || '#00ff88';
    const authorName = val('[data-ed-author-name]');
    const authorIcon = val('[data-ed-author-icon]');
    const footer = val('[data-ed-footer]');
    const footerIcon = val('[data-ed-footer-icon]');
    const thumb = val('[data-ed-thumbnail]');
    const image = val('[data-ed-image]');

    // Color bar
    const bar = $('[data-ed-pv-color]');
    if (bar && /^#?[0-9a-fA-F]{6}$/.test(color)) bar.style.backgroundColor = color.startsWith('#') ? color : '#' + color;
    // Color preview box
    const cpb = $('[data-ed-color-preview]');
    if (cpb && /^#?[0-9a-fA-F]{6}$/.test(color)) cpb.style.backgroundColor = color.startsWith('#') ? color : '#' + color;

    // Author
    const authorEl = $('[data-ed-pv-author]');
    if (authorEl) {
      authorEl.style.display = authorName ? '' : 'none';
      $('[data-ed-pv-author-name]').textContent = authorName;
      const ai = $('[data-ed-pv-author-icon]');
      if (ai) { ai.src = authorIcon; ai.style.display = authorIcon ? '' : 'none'; }
    }

    // Title & desc
    const pt = $('[data-ed-pv-title]'); if (pt) pt.textContent = title;
    const pd = $('[data-ed-pv-desc]'); if (pd) pd.textContent = desc || 'El contenido aparecerá aquí…';

    // Thumbnail
    const pth = $('[data-ed-pv-thumb]'); if (pth) { pth.src = thumb; pth.style.display = thumb ? '' : 'none'; }
    // Image
    const pim = $('[data-ed-pv-image]'); if (pim) { pim.src = image; pim.style.display = image ? '' : 'none'; }

    // Footer
    const fr = $('[data-ed-pv-footer-row]');
    if (fr) {
      fr.style.display = footer ? '' : 'none';
      $('[data-ed-pv-footer]').textContent = footer;
      const fi = $('[data-ed-pv-footer-icon]');
      if (fi) { fi.src = footerIcon; fi.style.display = footerIcon ? '' : 'none'; }
    }

    // Fields
    const fieldsEl = $('[data-ed-pv-fields]');
    if (fieldsEl) {
      fieldsEl.replaceChildren();
      edFields.forEach((f) => {
        const div = document.createElement('div');
        div.className = 'discord-embed__field' + (f.inline ? '' : ' full');
        div.innerHTML = `<div class="discord-embed__field-name">${esc(f.name || 'Campo')}</div><div class="discord-embed__field-value">${esc(f.value || '…')}</div>`;
        fieldsEl.append(div);
      });
    }

    // Buttons preview
    const btnsEl = $('[data-ed-pv-buttons]');
    if (btnsEl) {
      btnsEl.replaceChildren();
      const btnType = val('[data-ed-btn-type]');
      if (btnType) {
        const styleMap = { Primary: 'primary', Success: 'success', Danger: 'danger', Secondary: 'secondary' };
        const style = styleMap[val('[data-ed-btn-style]')] || 'primary';
        const label = val('[data-ed-btn-label]') || 'Botón';
        const emoji = val('[data-ed-btn-emoji]');
        const btn = document.createElement('div');
        btn.className = `discord-btn discord-btn--${style}`;
        btn.textContent = (emoji ? emoji + ' ' : '') + label;
        btnsEl.append(btn);
      }
    }

    // Char counter
    const total = (title.length) + (desc.length) + (footer.length) + (authorName.length) + edFields.reduce((s, f) => s + (f.name?.length || 0) + (f.value?.length || 0), 0);
    const cc = $('[data-ed-chars]');
    if (cc) cc.textContent = `Caracteres: ${total} / 6000`;

    // Input counters
    $$('[data-count-for]').forEach((el) => {
      const input = $(`[data-${el.dataset.countFor}]`);
      if (input) el.textContent = `${input.value.length}/${input.maxLength}`;
    });
  }

  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function renderFieldsList() {
    const list = $('[data-ed-fields]');
    if (!list) return;
    list.replaceChildren();
    edFields.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'ed-field-item';
      item.innerHTML = `
        <label class="field"><span>Nombre</span><input data-field-name="${i}" value="${esc(f.name)}" maxlength="256" placeholder="Nombre del campo"></label>
        <label class="field"><span>Valor</span><input data-field-value="${i}" value="${esc(f.value)}" maxlength="1024" placeholder="Valor del campo"></label>
        <div style="display:flex;flex-direction:column;gap:6px;padding-top:22px">
          <label class="ed-field-inline"><input type="checkbox" data-field-inline="${i}" ${f.inline ? 'checked' : ''}> Inline</label>
          <button class="button button--danger button--small" type="button" data-field-remove="${i}">✕</button>
        </div>`;
      list.append(item);
    });
    const count = $('[data-ed-field-count]');
    if (count) count.textContent = String(edFields.length);

    // Bind field inputs
    $$('[data-field-name]').forEach((el) => el.addEventListener('input', () => { edFields[+el.dataset.fieldName].name = el.value; syncEditorPreview(); }));
    $$('[data-field-value]').forEach((el) => el.addEventListener('input', () => { edFields[+el.dataset.fieldValue].value = el.value; syncEditorPreview(); }));
    $$('[data-field-inline]').forEach((el) => el.addEventListener('change', () => { edFields[+el.dataset.fieldInline].inline = el.checked; syncEditorPreview(); }));
    $$('[data-field-remove]').forEach((el) => el.addEventListener('click', () => { edFields.splice(+el.dataset.fieldRemove, 1); renderFieldsList(); syncEditorPreview(); }));
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

    // ─── Tabbed editor: tabs ────────────────────────────────
    $$('[data-ed-tab]').forEach((tab) => tab.addEventListener('click', () => {
      $$('[data-ed-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('[data-ed-pane]').forEach((p) => p.classList.toggle('is-visible', p.dataset.edPane === tab.dataset.edTab));
    }));

    // Editor inputs → live preview
    const edInputs = '[data-ed-title],[data-ed-description],[data-ed-color],[data-ed-author-name],[data-ed-author-icon],[data-ed-author-emoji],[data-ed-footer],[data-ed-footer-icon],[data-ed-thumbnail],[data-ed-image],[data-ed-btn-type],[data-ed-btn-style],[data-ed-btn-label],[data-ed-btn-emoji]';
    $$(edInputs).forEach((el) => el.addEventListener('input', syncEditorPreview));
    $$('[data-ed-btn-type],[data-ed-btn-style]').forEach((el) => el.addEventListener('change', () => {
      const urlWrap = $('[data-ed-btn-url-wrap]');
      if (urlWrap) urlWrap.style.display = val('[data-ed-btn-type]') === 'link' ? '' : 'none';
      syncEditorPreview();
    }));

    // Color swatches
    $$('[data-swatch]').forEach((s) => s.addEventListener('click', () => {
      setVal('[data-ed-color]', s.dataset.swatch);
      $$('[data-swatch]').forEach((x) => x.classList.toggle('is-active', x === s));
      syncEditorPreview();
    }));
    $('[data-ed-color]')?.addEventListener('input', syncEditorPreview);

    // Add field
    $('[data-ed-add-field]')?.addEventListener('click', () => {
      if (edFields.length >= 25) return toast('Máximo 25 campos.', 'error');
      edFields.push({ name: '', value: '', inline: true });
      renderFieldsList();
      syncEditorPreview();
    });

    // Load template into editor
    $('[data-ed-base]')?.addEventListener('change', async () => {
      const type = val('[data-ed-base]');
      if (!type) { setVal('[data-ed-title]',''); setVal('[data-ed-description]',''); setVal('[data-ed-color]','#00ff88'); setVal('[data-ed-footer]',''); setVal('[data-ed-footer-icon]',''); setVal('[data-ed-thumbnail]',''); setVal('[data-ed-image]',''); setVal('[data-ed-author-name]',''); setVal('[data-ed-author-icon]',''); edFields.length = 0; renderFieldsList(); syncEditorPreview(); return; }
      try {
        const res = await api('/api/embed/templates');
        const tpl = res.templates?.[type];
        if (!tpl) return;
        setVal('[data-ed-title]', tpl.title || '');
        setVal('[data-ed-description]', tpl.description || '');
        setVal('[data-ed-color]', '#' + (tpl.color || 0x00ff88).toString(16).padStart(6, '0'));
        setVal('[data-ed-footer]', tpl.footer?.text || '');
        setVal('[data-ed-footer-icon]', tpl.footer?.iconURL || '');
        setVal('[data-ed-thumbnail]', tpl.thumbnail || '');
        setVal('[data-ed-image]', tpl.image || '');
        setVal('[data-ed-author-name]', tpl.author?.name || '');
        setVal('[data-ed-author-icon]', tpl.author?.iconURL || '');
        edFields.length = 0;
        renderFieldsList();
        syncEditorPreview();
        toast(`Plantilla «${type}» cargada en el editor.`);
      } catch (e) { toast(e.message, 'error'); }
    });

    // Send from tabbed editor
    $('[data-ed-send]')?.addEventListener('click', async () => {
      const channelId = $('[data-composer-channel]')?.value;
      if (!channelId) return toast('Selecciona un canal de destino.', 'error');
      const title = val('[data-ed-title]');
      const description = val('[data-ed-description]');
      if (!title && !description) return toast('Agrega al menos un título o descripción.', 'error');

      const btn = $('[data-ed-send]');
      btn.disabled = true;
      try {
        const body = {
          channelId,
          title,
          description,
          color: val('[data-ed-color]'),
          footer: val('[data-ed-footer]'),
          footerIcon: val('[data-ed-footer-icon]'),
          image: val('[data-ed-image]'),
          thumbnail: val('[data-ed-thumbnail]'),
          authorName: val('[data-ed-author-name]'),
          authorIcon: val('[data-ed-author-icon]'),
          fields: edFields.filter((f) => f.name || f.value),
          button: val('[data-ed-btn-type]') ? {
            type: val('[data-ed-btn-type]'),
            style: val('[data-ed-btn-style]'),
            label: val('[data-ed-btn-label]'),
            emoji: val('[data-ed-btn-emoji]'),
            url: val('[data-ed-btn-url]'),
          } : null,
        };
        const res = await api('/api/embed/custom', { method: 'POST', body: JSON.stringify(body) });
        toast(res.message);
        await refreshLogs();
      } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
    });

    // Remove old composer form handler (replaced by tabbed editor)
    // $('[data-composer-form]') is no longer in the DOM

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
    syncEditorPreview();
    await Promise.all([refreshOverview(), refreshTickets(), refreshLogs()]);
    window.setInterval(() => refreshOverview(), 20_000);
    window.setInterval(() => {
      if (state.activeSection === 'tickets') refreshTickets();
      if (state.activeSection === 'activity') refreshLogs();
    }, 30_000);
  });
})();
