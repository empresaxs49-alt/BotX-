'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Lo comparte dashboard.js (se carga antes: ambos son "defer" y van en orden).
  const panel = () => window.XPanel;
  const toast = (message, kind) => panel()?.toast(message, kind);

  const MAX_TOTAL_CHARS = 6000;
  const MAX_FIELDS = 25;
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const SHORTCODE = /(?<![<\w:]):([A-Za-z0-9_]{2,32}):(?!\d+>)/g;

  const COMMON_EMOJIS = [
    ['🔥', 'fuego fire'], ['⚡', 'rayo zap'], ['💎', 'diamante gem'], ['👑', 'corona crown'], ['⭐', 'estrella star'],
    ['✨', 'brillo sparkles'], ['🚀', 'cohete rocket'], ['🎫', 'ticket'], ['💰', 'dinero money'], ['💳', 'tarjeta card'],
    ['🛒', 'carrito cart'], ['🎁', 'regalo gift'], ['🏆', 'trofeo trophy'], ['✅', 'check ok'], ['❌', 'x error'],
    ['⚠️', 'alerta warning'], ['📌', 'pin'], ['📢', 'anuncio megaphone'], ['🔔', 'campana bell'], ['🔒', 'candado lock'],
    ['🔓', 'abierto unlock'], ['🛠️', 'herramientas tools'], ['⚙️', 'engranaje gear'], ['📋', 'lista clipboard'], ['📦', 'paquete box'],
    ['🎮', 'juego game'], ['🎯', 'objetivo target'], ['👁️', 'ojo eye'], ['🔗', 'enlace link'], ['💬', 'chat'],
    ['❤️', 'corazon heart'], ['💜', 'morado purple'], ['💚', 'verde green'], ['💙', 'azul blue'], ['🖤', 'negro black'],
    ['😀', 'sonrisa smile'], ['😎', 'cool'], ['🤝', 'trato handshake'], ['👍', 'like pulgar'], ['🙌', 'manos hands'],
    ['⏱️', 'tiempo timer'], ['📅', 'fecha calendar'], ['🌐', 'web globe'], ['💻', 'pc laptop'], ['📱', 'celular phone'],
    ['»', 'flecha arrow'], ['•', 'punto dot'], ['→', 'derecha right'], ['★', 'estrella star'], ['✔', 'check'],
  ];

  const state = {
    fields: [],
    emojis: [],
    emojiByName: new Map(),
    emojiLoaded: false,
    emojiTab: 'server',
    lastField: null,
    templates: null,
  };

  // ── Utilidades ──────────────────────────────────────────────
  const val = (selector) => $(selector)?.value?.trim() || '';
  const setVal = (selector, value) => { const el = $(selector); if (el) el.value = value ?? ''; };

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function emojiUrl(id, animated) {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=48`;
  }

  // Convierte texto de Discord a HTML seguro para la vista previa:
  // :nombre: -> emoji real, <a:nombre:id> -> imagen, y markdown básico.
  function renderRich(raw) {
    let text = String(raw ?? '').replace(SHORTCODE, (match, name) => {
      const emoji = state.emojiByName.get(name.toLowerCase());
      return emoji ? emoji.tag : match;
    });
    text = escapeHtml(text);

    // Los emojis se sacan antes del markdown para que sus nombres (con "_") no se interpreten.
    const images = [];
    text = text.replace(/&lt;(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})&gt;/g, (match, animated, name, id) => {
      images.push(`<img class="emoji" src="${emojiUrl(id, animated === 'a')}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" draggable="false">`);
      return `\uE000${images.length - 1}\uE001`;
    });

    text = text
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      .replace(/(?<!\*)\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Encabezados de Markdown (# ## ###) al inicio de línea.
    const lines = text.split('\n');
    text = lines.map((line, index) => {
      const heading = line.match(/^(#{1,3}) (.+)$/);
      if (heading) return `<div class="md-h md-h${heading[1].length}">${heading[2]}</div>`;
      return index < lines.length - 1 && !/^<div class="md-h/.test(lines[index + 1] || '') ? `${line}\n` : line;
    }).join('');

    return text.replace(/\uE000(\d+)\uE001/g, (match, index) => images[Number(index)] || '');
  }

  function setImage(element, url) {
    if (!element) return;
    if (!url) {
      element.hidden = true;
      element.removeAttribute('src');
      element.dataset.src = '';
      return;
    }
    if (element.dataset.src !== url) {
      element.dataset.src = url;
      element.onerror = () => { element.hidden = true; };
      element.onload = () => { element.hidden = false; };
      element.src = url;
    }
    element.hidden = false;
  }

  // ── Lectura del formulario ─────────────────────────────────
  function currentColor() {
    const color = val('[data-ed-color]');
    return HEX.test(color) ? color : '#00ff88';
  }

  function collectEmbed() {
    const emoji = val('[data-ed-author-emoji]');
    const name = val('[data-ed-author-name]');
    return {
      title: val('[data-ed-title]'),
      titleUrl: val('[data-ed-title-url]'),
      description: val('[data-ed-description]'),
      color: currentColor(),
      authorName: [emoji, name].filter(Boolean).join(' '),
      authorUrl: val('[data-ed-author-url]'),
      authorIcon: val('[data-ed-author-icon]'),
      image: val('[data-ed-image]'),
      thumbnail: val('[data-ed-thumbnail]'),
      footer: val('[data-ed-footer]'),
      footerIcon: val('[data-ed-footer-icon]'),
      fields: state.fields.filter((field) => field.name.trim() || field.value.trim()),
      button: val('[data-ed-btn-type]') ? {
        type: val('[data-ed-btn-type]'),
        style: val('[data-ed-btn-style]') || 'Primary',
        label: val('[data-ed-btn-label]'),
        emoji: val('[data-ed-btn-emoji]'),
        url: val('[data-ed-btn-url]'),
      } : null,
    };
  }

  function totalChars(embed) {
    return embed.title.length + embed.description.length + embed.footer.length + embed.authorName.length
      + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  }

  // ── Vista previa ───────────────────────────────────────────
  function renderPreview() {
    const embed = collectEmbed();

    const bar = $('[data-ed-pv-color]');
    if (bar) bar.style.backgroundColor = embed.color;
    const swatchBox = $('[data-ed-color-picker]');
    if (swatchBox && swatchBox.value !== embed.color) swatchBox.value = embed.color;
    $$('[data-swatch]').forEach((swatch) => swatch.classList.toggle('is-active', swatch.dataset.swatch.toLowerCase() === embed.color.toLowerCase()));

    const author = $('[data-ed-pv-author]');
    if (author) {
      author.hidden = !embed.authorName;
      $('[data-ed-pv-author-name]').textContent = embed.authorName;
      setImage($('[data-ed-pv-author-icon]'), embed.authorIcon);
    }

    const title = $('[data-ed-pv-title]');
    if (title) {
      title.hidden = !embed.title;
      title.innerHTML = renderRich(embed.title);
      title.classList.toggle('is-link', Boolean(embed.titleUrl));
    }

    const desc = $('[data-ed-pv-desc]');
    if (desc) {
      desc.hidden = !embed.description;
      desc.innerHTML = renderRich(embed.description);
    }

    const fieldsBox = $('[data-ed-pv-fields]');
    if (fieldsBox) {
      fieldsBox.replaceChildren();
      embed.fields.forEach((field) => {
        const item = document.createElement('div');
        item.className = `discord-embed__field${field.inline ? '' : ' is-block'}`;
        const name = document.createElement('div');
        name.className = 'discord-embed__field-name';
        name.innerHTML = renderRich(field.name);
        const value = document.createElement('div');
        value.className = 'discord-embed__field-value';
        value.innerHTML = renderRich(field.value);
        item.append(name, value);
        fieldsBox.append(item);
      });
    }

    setImage($('[data-ed-pv-thumb]'), embed.thumbnail);
    setImage($('[data-ed-pv-image]'), embed.image);

    const footerRow = $('[data-ed-pv-footer-row]');
    if (footerRow) {
      footerRow.hidden = !embed.footer;
      $('[data-ed-pv-footer]').textContent = embed.footer;
      setImage($('[data-ed-pv-footer-icon]'), embed.footerIcon);
    }

    const buttons = $('[data-ed-pv-buttons]');
    if (buttons) {
      buttons.replaceChildren();
      if (embed.button) {
        const styleClass = embed.button.type === 'link' ? 'secondary' : embed.button.style.toLowerCase();
        const button = document.createElement('div');
        button.className = `discord-btn discord-btn--${styleClass}`;
        if (embed.button.emoji) {
          const emoji = document.createElement('span');
          emoji.className = 'discord-btn__emoji';
          emoji.innerHTML = renderRich(embed.button.emoji);
          button.append(emoji);
        }
        const label = document.createElement('span');
        label.textContent = embed.button.label || (embed.button.type === 'link' ? 'Enlace' : 'Abrir ticket');
        button.append(label);
        if (embed.button.type === 'link') button.append(Object.assign(document.createElement('span'), { textContent: '↗' }));
        buttons.append(button);
      }
    }

    const total = totalChars(embed);
    const counter = $('[data-ed-chars]');
    if (counter) {
      counter.textContent = `${total} / ${MAX_TOTAL_CHARS}`;
      counter.classList.toggle('is-over', total > MAX_TOTAL_CHARS);
    }
    $$('[data-count]').forEach((el) => {
      const input = $(`[data-${el.dataset.count}]`);
      if (input) el.textContent = `${input.value.length}/${input.maxLength}`;
    });
    const fieldCount = $('[data-ed-field-count]');
    if (fieldCount) fieldCount.textContent = String(state.fields.length);
  }

  // ── Campos dinámicos ───────────────────────────────────────
  function renderFieldsList() {
    const list = $('[data-ed-fields]');
    if (!list) return;
    list.replaceChildren();

    if (!state.fields.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state empty-state--compact';
      empty.textContent = 'Aún no hay campos.';
      list.append(empty);
    }

    state.fields.forEach((field, index) => {
      const row = document.createElement('div');
      row.className = 'ed-field-item';

      const makeInput = (labelText, key, max, placeholder) => {
        const label = document.createElement('label');
        label.className = 'field';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.value = field[key];
        input.maxLength = max;
        input.placeholder = placeholder;
        input.setAttribute(key === 'name' ? 'data-field-name' : 'data-field-value', String(index));
        input.addEventListener('input', () => { field[key] = input.value; renderPreview(); });
        label.append(caption, input);
        return label;
      };

      const controls = document.createElement('div');
      controls.className = 'ed-field-controls';
      const inlineLabel = document.createElement('label');
      inlineLabel.className = 'ed-field-inline';
      const inline = document.createElement('input');
      inline.type = 'checkbox';
      inline.checked = field.inline;
      inline.addEventListener('change', () => { field.inline = inline.checked; renderPreview(); });
      inlineLabel.append(inline, document.createTextNode(' Inline'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button--danger button--small';
      remove.textContent = 'Quitar';
      remove.addEventListener('click', () => { state.fields.splice(index, 1); renderFieldsList(); renderPreview(); });
      controls.append(inlineLabel, remove);

      row.append(makeInput('Nombre', 'name', 256, 'Nombre del campo'), makeInput('Valor', 'value', 1024, 'Valor del campo'), controls);
      list.append(row);
    });
    renderPreview();
  }

  // ── Emojis ─────────────────────────────────────────────────
  async function loadEmojis() {
    try {
      const response = await panel().api('/api/emojis');
      state.emojis = response.emojis || [];
      state.emojiByName = new Map(state.emojis.map((emoji) => [emoji.name.toLowerCase(), emoji]));
      state.emojiLoaded = true;
    } catch (error) {
      state.emojiLoaded = false;
      toast(`No se pudieron cargar los emojis del servidor: ${error.message}`, 'error');
    }
    const count = $('[data-emoji-count]');
    if (count) count.textContent = String(state.emojis.length);
    renderEmojiGrid();
    renderPreview();
  }

  function renderEmojiGrid() {
    const grid = $('[data-emoji-grid]');
    if (!grid) return;
    const query = ($('[data-emoji-search]')?.value || '').trim().toLowerCase();
    grid.replaceChildren();

    if (state.emojiTab === 'server') {
      const list = state.emojis.filter((emoji) => !query || emoji.name.toLowerCase().includes(query));
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state empty-state--compact';
        empty.textContent = state.emojis.length ? 'Sin resultados.' : 'Este servidor no tiene emojis personalizados (o el bot aún no cargó).';
        grid.append(empty);
        return;
      }
      list.forEach((emoji) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-btn';
        button.title = `:${emoji.name}:${emoji.animated ? ' (animado)' : ''}`;
        button.dataset.insert = emoji.tag;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = emoji.name;
        img.src = emojiUrl(emoji.id, emoji.animated);
        button.append(img);
        grid.append(button);
      });
      return;
    }

    COMMON_EMOJIS
      .filter(([, keywords]) => !query || keywords.includes(query))
      .forEach(([char, keywords]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-btn emoji-btn--text';
        button.title = keywords;
        button.dataset.insert = char;
        button.textContent = char;
        grid.append(button);
      });
  }

  const EMOJI_TARGETS = '[data-ed-title],[data-ed-description],[data-ed-author-emoji],[data-ed-author-name],[data-ed-footer],[data-ed-btn-emoji],[data-field-name],[data-field-value]';

  function insertAtCursor(text) {
    const target = state.lastField && document.contains(state.lastField) ? state.lastField : $('[data-ed-description]');
    if (!target) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    if (target.maxLength > 0 && next.length > target.maxLength) {
      toast('No cabe: ese campo llegó a su límite de caracteres.', 'error');
      return;
    }
    target.value = next;
    const caret = start + text.length;
    target.focus();
    target.setSelectionRange(caret, caret);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Plantillas ─────────────────────────────────────────────
  async function getTemplates(force = false) {
    if (!state.templates || force) state.templates = (await panel().api('/api/embed/templates')).templates || {};
    return state.templates;
  }

  function clearEditor() {
    ['[data-ed-title]', '[data-ed-title-url]', '[data-ed-description]', '[data-ed-author-emoji]', '[data-ed-author-name]',
      '[data-ed-author-url]', '[data-ed-author-icon]', '[data-ed-image]', '[data-ed-thumbnail]', '[data-ed-footer]', '[data-ed-footer-icon]',
      '[data-ed-btn-label]', '[data-ed-btn-emoji]', '[data-ed-btn-url]'].forEach((selector) => setVal(selector, ''));
    setVal('[data-ed-color]', '#00ff88');
    setVal('[data-ed-btn-type]', '');
    setVal('[data-ed-btn-style]', 'Primary');
    state.fields = [];
    syncButtonUrlVisibility();
    renderFieldsList();
  }

  async function loadTemplateIntoEditor(type) {
    const saveButton = $('[data-ed-save]');
    if (saveButton) saveButton.disabled = !type;
    if (!type) {
      clearEditor();
      return;
    }
    try {
      const template = (await getTemplates(true))[type];
      if (!template) return;
      clearEditor();
      setVal('[data-ed-title]', template.title || '');
      setVal('[data-ed-description]', template.description || '');
      setVal('[data-ed-color]', `#${Number(template.color ?? 0x00ff88).toString(16).padStart(6, '0')}`);
      setVal('[data-ed-author-name]', template.author?.name || '');
      setVal('[data-ed-author-icon]', template.author?.iconURL || '');
      setVal('[data-ed-thumbnail]', template.thumbnail || '');
      setVal('[data-ed-image]', template.image || '');
      setVal('[data-ed-footer]', template.footer?.text || '');
      setVal('[data-ed-footer-icon]', template.footer?.iconURL || '');
      renderPreview();
      toast(template.buttons?.length > 1
        ? `Plantilla cargada. Tiene ${template.buttons.length} botones: se envían completos desde «Enviar embeds».`
        : 'Plantilla cargada en el editor.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function saveTemplate() {
    const type = val('[data-ed-base]');
    if (!type) return toast('Elige una plantilla base para guardar los cambios en ella.', 'error');
    const embed = collectEmbed();
    const button = $('[data-ed-save]');
    button.disabled = true;
    try {
      const response = await panel().api(`/api/embed/templates/${encodeURIComponent(type)}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: embed.title,
          description: embed.description,
          color: embed.color,
          thumbnail: embed.thumbnail || null,
          image: embed.image || null,
          footer: { text: embed.footer, iconURL: embed.footerIcon || null },
          author: embed.authorName ? { name: embed.authorName, iconURL: embed.authorIcon || null } : null,
        }),
      });
      state.templates = null;
      toast(embed.fields.length
        ? `${response.message} Los campos no se guardan en plantillas.`
        : response.message);
      await panel().refreshLogs();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = !val('[data-ed-base]');
    }
  }

  async function sendEmbed() {
    const channelId = val('[data-composer-channel]');
    if (!channelId) return toast('Selecciona un canal de destino.', 'error');
    const embed = collectEmbed();
    if (!embed.title && !embed.description && !embed.fields.length) return toast('Agrega un título, una descripción o algún campo.', 'error');
    if (totalChars(embed) > MAX_TOTAL_CHARS) return toast(`El embed supera ${MAX_TOTAL_CHARS} caracteres en total.`, 'error');

    const button = $('[data-ed-send]');
    button.disabled = true;
    try {
      const response = await panel().api('/api/embed/custom', { method: 'POST', body: JSON.stringify({ channelId, ...embed }) });
      toast(response.message);
      await panel().refreshLogs();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function syncButtonUrlVisibility() {
    const wrap = $('[data-ed-btn-url-wrap]');
    if (wrap) wrap.hidden = val('[data-ed-btn-type]') !== 'link';
  }

  // ── Eventos ────────────────────────────────────────────────
  function bind() {
    $$('[data-ed-tab]').forEach((tab) => tab.addEventListener('click', () => {
      $$('[data-ed-tab]').forEach((other) => other.classList.toggle('is-active', other === tab));
      $$('[data-ed-pane]').forEach((pane) => pane.classList.toggle('is-visible', pane.dataset.edPane === tab.dataset.edTab));
    }));

    // Todo cambio en el editor refresca la vista previa.
    const editor = $('.editor-card');
    editor?.addEventListener('input', renderPreview);
    editor?.addEventListener('change', () => { syncButtonUrlVisibility(); renderPreview(); });
    // Recuerda el último campo de texto enfocado, para insertar emojis ahí.
    editor?.addEventListener('focusin', (event) => {
      if (event.target.matches?.(EMOJI_TARGETS)) state.lastField = event.target;
    });

    // Colores (el fondo se pinta por JS: el CSP del panel no permite style="" en el HTML)
    $$('[data-swatch]').forEach((swatch) => {
      swatch.style.backgroundColor = swatch.dataset.swatch;
      swatch.addEventListener('click', () => { setVal('[data-ed-color]', swatch.dataset.swatch); renderPreview(); });
    });
    $('[data-ed-color-picker]')?.addEventListener('input', (event) => { setVal('[data-ed-color]', event.target.value); renderPreview(); });

    $('[data-ed-add-field]')?.addEventListener('click', () => {
      if (state.fields.length >= MAX_FIELDS) return toast(`Máximo ${MAX_FIELDS} campos.`, 'error');
      state.fields.push({ name: '', value: '', inline: true });
      renderFieldsList();
      $$('[data-field-name]').at(-1)?.focus();
    });

    $('[data-ed-base]')?.addEventListener('change', (event) => loadTemplateIntoEditor(event.target.value));
    $('[data-ed-save]')?.addEventListener('click', saveTemplate);
    $('[data-ed-send]')?.addEventListener('click', sendEmbed);

    // Selector de emojis. mousedown evita que el clic le quite el foco al campo de texto.
    $('[data-emoji-grid]')?.addEventListener('mousedown', (event) => event.preventDefault());
    $('[data-emoji-grid]')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-insert]');
      if (button) insertAtCursor(button.dataset.insert);
    });
    $$('[data-emoji-tab]').forEach((tab) => tab.addEventListener('click', () => {
      state.emojiTab = tab.dataset.emojiTab;
      $$('[data-emoji-tab]').forEach((other) => other.classList.toggle('is-active', other === tab));
      renderEmojiGrid();
    }));
    $('[data-emoji-search]')?.addEventListener('input', renderEmojiGrid);

    // Si la primera carga de emojis falló (bot aún conectando), reintenta al abrir el editor.
    document.addEventListener('xpanel:section', (event) => {
      if (event.detail.section === 'composer' && !state.emojiLoaded) loadEmojis();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#composer')) return;
    bind();
    state.lastField = $('[data-ed-description]');
    renderFieldsList();
    renderEmojiGrid();
    loadEmojis();
  });
})();
