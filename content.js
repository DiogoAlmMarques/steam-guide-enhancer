// Steam Guide Enhancer - checkboxes, notes, drawing and resume for Steam guides.
(() => {
  const guideId = new URLSearchParams(location.search).get('id');
  if (!guideId) return;

  const KEY = 'guide:' + guideId;   // checkmarks, notes, reading position
  const DKEY = 'draw:' + guideId;   // drawings (kept separate, can be larger)

  // Each guide section on Steam is a .subSection with a .subSectionTitle
  const sections = [...document.querySelectorAll('.subSection')]
    .map((el, i) => {
      const titleEl = el.querySelector('.subSectionTitle');
      const title = (titleEl ? titleEl.textContent : '').trim();
      const id = el.id || (title ? 't:' + title : 'i:' + i);
      return { el, titleEl, id, title };
    })
    .filter(s => s.titleEl);

  if (!sections.length) return; // not a guide page

  const byId = new Map(sections.map(s => [s.id, s]));
  let state = { checked: {}, notes: {}, scrollY: 0 };
  const boxes = new Map(); // section id -> [checkbox inputs]

  // ---------- storage ----------
  const save = () => {
    try {
      state.updated = Date.now();
      chrome.storage.local.set({ [KEY]: state });
    } catch (e) { /* extension reloaded; ignore */ }
  };

  // ---------- checkboxes ----------
  const makeBox = (id, extraClass) => {
    const wrap = document.createElement('label');
    wrap.className = 'sgp-check ' + (extraClass || '');
    wrap.title = 'Mark this section as done';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', () => setChecked(id, input.checked));
    wrap.addEventListener('click', e => e.stopPropagation());
    wrap.appendChild(input);
    if (!boxes.has(id)) boxes.set(id, []);
    boxes.get(id).push(input);
    return wrap;
  };

  const setChecked = (id, value) => {
    if (value) state.checked[id] = true;
    else delete state.checked[id];
    refresh();
    save();
  };

  const refresh = () => {
    for (const s of sections) {
      const done = !!state.checked[s.id];
      (boxes.get(s.id) || []).forEach(b => { b.checked = done; });
      s.el.classList.toggle('sgp-done', done);
    }
    const done = sections.filter(s => state.checked[s.id]).length;
    countEl.textContent = `${done} / ${sections.length} sections done`;
    barEl.style.width = (done / sections.length * 100) + '%';
    resumeBtn.disabled = !(resumePos || state.scrollY > 200);
    resumeBtn.textContent = resumePos && byId.has(resumePos.id)
      ? 'Resume: ' + (byId.get(resumePos.id).title || 'last spot')
      : 'Resume where I left off';
    const n = Object.keys(state.notes || {}).length;
    notesBtn.textContent = '📝 All notes' + (n ? ` (${n})` : '');
  };

  // Checkbox on each section title
  for (const s of sections) {
    s.titleEl.prepend(makeBox(s.id, 'sgp-title'));
  }

  // Checkbox on each Guide Index (table of contents) entry
  document.querySelectorAll('a[href*="#"]').forEach(a => {
    const hash = decodeURIComponent((a.hash || '').slice(1));
    if (!hash || !byId.has(hash)) return;
    if (a.closest('.subSection')) return; // skip links inside guide content
    a.parentNode.insertBefore(makeBox(hash, 'sgp-toc'), a);
  });

  // ---------- floating panel ----------
  const panel = document.createElement('div');
  panel.className = 'sgp-panel';
  panel.innerHTML = `
    <div class="sgp-head">
      <span class="sgp-name">Guide progress</span>
      <button class="sgp-min" title="Minimise">–</button>
    </div>
    <div class="sgp-body">
      <div class="sgp-count"></div>
      <div class="sgp-track"><div class="sgp-bar"></div></div>
      <div class="sgp-btns">
        <button class="sgp-resume" title="Scroll back to where you were last time">Resume where I left off</button>
        <button class="sgp-next" title="Jump to the first section you haven't ticked">Next unchecked</button>
        <button class="sgp-draw-toggle" title="Draw and highlight on the guide">✏️ Draw on page</button>
        <button class="sgp-allnotes" title="See all your notes for this guide">📝 All notes</button>
        <button class="sgp-reset" title="Clear all ticks for this guide">Reset checkmarks</button>
      </div>
    </div>`;
  document.body.appendChild(panel);

  const countEl = panel.querySelector('.sgp-count');
  const barEl = panel.querySelector('.sgp-bar');
  const resumeBtn = panel.querySelector('.sgp-resume');
  const notesBtn = panel.querySelector('.sgp-allnotes');
  const drawToggleBtn = panel.querySelector('.sgp-draw-toggle');

  panel.querySelector('.sgp-min').addEventListener('click', () => {
    const nowOpen = panel.classList.toggle('sgp-open');
    state.minimised = !nowOpen;
    save();
  });

  resumeBtn.addEventListener('click', () => {
    if (resumePos && goTo(resumePos)) return;
    if (state.scrollY) window.scrollTo(0, state.scrollY); // old-style save
  });

  panel.querySelector('.sgp-next').addEventListener('click', () => {
    const next = sections.find(s => !state.checked[s.id]);
    if (next) next.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else alert('All sections are ticked. Nice work!');
  });

  panel.querySelector('.sgp-reset').addEventListener('click', () => {
    if (!confirm('Clear all checkmarks for this guide? (Notes and drawings are kept.)')) return;
    state.checked = {};
    refresh();
    save();
  });

  // ---------- remember reading position ----------
  // Saved as "which section + how far into it" rather than a pixel number,
  // because images load in gradually and change the page height.
  let resumePos = null;   // where you were LAST time (frozen for this visit)
  let loaded = false;

  const isScrollable = el => {
    const oy = getComputedStyle(el).overflowY;
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 5;
  };
  const getScroller = () => {
    let el = sections[0].el.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    return null; // the window itself scrolls
  };

  const currentPosition = () => {
    let cur = sections[0];
    for (const s of sections) {
      if (s.el.getBoundingClientRect().top <= 1) cur = s; else break;
    }
    const offset = -cur.el.getBoundingClientRect().top; // px scrolled into the section
    return { id: cur.id, offset: Math.round(offset) };
  };

  let jumpTimers = [];
  const cancelJumps = () => { jumpTimers.forEach(clearTimeout); jumpTimers = []; };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev =>
    window.addEventListener(ev, cancelJumps, { passive: true }));

  const goTo = pos => {
    const s = byId.get(pos.id);
    if (!s) return false;
    cancelJumps();
    const jump = () => {
      s.el.scrollIntoView({ block: 'start' });
      const sc = getScroller();
      (sc || window).scrollBy(0, pos.offset || 0);
    };
    jump();
    // repeat a couple of times while images above finish loading
    jumpTimers = [setTimeout(jump, 600), setTimeout(jump, 1500)];
    return true;
  };

  const record = () => {
    if (!loaded) return;
    state.pos = currentPosition();
    save();
  };

  let scrollTimer = null;
  // capture:true also catches scrolling inside a page container, not just the window
  document.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(record, 600);
  }, { passive: true, capture: true });

  // ---------- notes (one per section) ----------
  const noteUI = new Map(); // section id -> { btn, box, ta, autosize }
  let noteTimer = null;

  for (const s of sections) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sgp-note-btn';
    btn.title = 'Add / show your note for this section';
    btn.textContent = '📝';

    const box = document.createElement('div');
    box.className = 'sgp-note';
    box.innerHTML = `
      <div class="sgp-note-head">
        <span>My note</span>
        <button type="button" class="sgp-note-del" title="Delete this note">Delete</button>
      </div>
      <textarea placeholder="Write a note for this section…"></textarea>`;
    const ta = box.querySelector('textarea');
    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.max(60, ta.scrollHeight + 2) + 'px';
    };

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const open = !box.classList.contains('sgp-show');
      box.classList.toggle('sgp-show', open);
      if (open) { autosize(); ta.focus(); }
    });

    ta.addEventListener('keydown', e => e.stopPropagation()); // don't trigger page shortcuts
    ta.addEventListener('input', () => {
      autosize();
      if (ta.value.trim()) state.notes[s.id] = ta.value;
      else delete state.notes[s.id];
      btn.classList.toggle('sgp-has-note', !!ta.value.trim());
      refresh();
      clearTimeout(noteTimer);
      noteTimer = setTimeout(save, 400);
    });

    box.querySelector('.sgp-note-del').addEventListener('click', () => {
      if (ta.value.trim() && !confirm('Delete this note?')) return;
      ta.value = '';
      delete state.notes[s.id];
      btn.classList.remove('sgp-has-note');
      box.classList.remove('sgp-show');
      refresh();
      save();
    });

    s.titleEl.appendChild(btn);
    s.titleEl.insertAdjacentElement('afterend', box);
    noteUI.set(s.id, { btn, box, ta, autosize });
  }

  const applyNotes = () => {
    for (const [id, u] of noteUI) {
      const v = (state.notes && state.notes[id]) || '';
      u.ta.value = v;
      u.btn.classList.toggle('sgp-has-note', !!v.trim());
      u.box.classList.toggle('sgp-show', !!v.trim());
      if (v) requestAnimationFrame(u.autosize);
    }
  };

  const showAllNotes = () => {
    const ov = document.createElement('div');
    ov.className = 'sgp-modal';
    ov.innerHTML = `
      <div class="sgp-modal-box">
        <div class="sgp-modal-head"><span>My notes</span><button type="button" class="sgp-x" title="Close">✕</button></div>
        <div class="sgp-modal-list"></div>
      </div>`;
    const list = ov.querySelector('.sgp-modal-list');
    const withNotes = sections.filter(s => ((state.notes || {})[s.id] || '').trim());
    if (!withNotes.length) {
      list.textContent = 'No notes yet. Click 📝 next to any section title to add one.';
    }
    for (const s of withNotes) {
      const item = document.createElement('div');
      item.className = 'sgp-modal-item';
      const t = document.createElement('b');
      t.textContent = s.title || 'Section';
      const body = document.createElement('div');
      body.textContent = state.notes[s.id];
      item.append(t, body);
      item.title = 'Jump to this section';
      item.addEventListener('click', () => {
        ov.remove();
        noteUI.get(s.id).box.classList.add('sgp-show');
        goTo({ id: s.id, offset: -20 });
      });
      list.appendChild(item);
    }
    const close = () => ov.remove();
    ov.querySelector('.sgp-x').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  };
  notesBtn.addEventListener('click', showAllNotes);

  // ---------- drawing ----------
  // One transparent layer covers the whole screen, so you can draw anywhere
  // (margins, guide index, etc.). Each stroke is pinned to the nearest section's
  // content, so it scrolls with the page and stays put if other parts change size.
  let drawings = {};          // section id -> [stroke]; stroke = { c, w, a, p:[x,y,...] } relative to that section
  let drawMode = false;
  const tool = { color: '#ff4d4d', size: 4, kind: 'pen' }; // kind: pen | hl | eraser
  const history = [];
  let drawTimer = null;

  const hosts = new Map(sections.map(s => [s.id, s.el.querySelector('.subSectionDesc') || s.el]));

  const saveDrawings = () => {
    try { chrome.storage.local.set({ [DKEY]: drawings }); } catch (e) { /* ignore */ }
  };
  const saveDrawingsSoon = () => { clearTimeout(drawTimer); drawTimer = setTimeout(saveDrawings, 500); };

  const cv = document.createElement('canvas');
  cv.className = 'sgp-overlay';
  document.body.appendChild(cv);
  const ctx = cv.getContext ? cv.getContext('2d') : null;

  const drawStroke = (st, ox, oy) => {
    const p = st.p;
    if (!ctx || !p || p.length < 2) return;
    ctx.save();
    ctx.globalAlpha = st.a || 1;
    ctx.strokeStyle = st.c;
    ctx.fillStyle = st.c;
    ctx.lineWidth = st.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (p.length === 2) {
      ctx.arc(p[0] + ox, p[1] + oy, st.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(p[0] + ox, p[1] + oy);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] + ox, p[i + 1] + oy);
      ctx.stroke();
    }
    ctx.restore();
  };

  let live = null; // stroke being drawn right now: { id, st }

  const sizeCanvas = () => {
    const r = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
      cv.width = Math.round(w * r);
      cv.height = Math.round(h * r);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }
  };

  const redraw = () => {
    if (!ctx) return;
    sizeCanvas();
    const r = window.devicePixelRatio || 1;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const H = window.innerHeight;
    for (const [id, host] of hosts) {
      const list = drawings[id];
      const hasLive = live && live.id === id;
      if ((!list || !list.length) && !hasLive) continue;
      const rect = host.getBoundingClientRect();
      // skip sections far off-screen (strokes can stick out a bit, so keep a margin)
      if (rect.bottom < -3000 || rect.top > H + 3000) continue;
      (list || []).forEach(st => drawStroke(st, rect.left, rect.top));
      if (hasLive) drawStroke(live.st, rect.left, rect.top);
    }
  };

  let rafPending = false;
  const redrawSoon = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; redraw(); });
  };
  const redrawAll = redrawSoon;

  // keep drawings glued to the page while scrolling / resizing / images loading
  document.addEventListener('scroll', redrawSoon, { passive: true, capture: true });
  window.addEventListener('resize', redrawSoon);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(redrawSoon).observe(document.body);
  }

  // Which section should a point on screen be pinned to? The one it's level with,
  // otherwise the closest one above/below.
  const anchorFor = y => {
    let best = null, bestDist = Infinity;
    for (const [id, host] of hosts) {
      const r = host.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestDist) { bestDist = d; best = { id, rect: r }; if (d === 0) break; }
    }
    return best;
  };

  let erasing = null; // { removed: Map(id -> [strokes]) }
  const eraseAt = (x, y) => {
    const rad = Math.max(10, tool.size * 3);
    let changed = false;
    for (const [id, host] of hosts) {
      const list = drawings[id];
      if (!list || !list.length) continue;
      const rect = host.getBoundingClientRect();
      const lx = x - rect.left, ly = y - rect.top;
      const keep = [];
      for (const st of list) {
        let hit = false;
        for (let i = 0; i < st.p.length; i += 2) {
          const dx = st.p[i] - lx, dy = st.p[i + 1] - ly;
          if (dx * dx + dy * dy <= (rad + st.w / 2) ** 2) { hit = true; break; }
        }
        if (hit) {
          if (!erasing.removed.has(id)) erasing.removed.set(id, []);
          erasing.removed.get(id).push(st);
        } else keep.push(st);
      }
      if (keep.length !== list.length) { drawings[id] = keep; changed = true; }
    }
    if (changed) redrawSoon();
  };

  cv.addEventListener('pointerdown', e => {
    if (!drawMode || e.button !== 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (tool.kind === 'eraser') {
      erasing = { removed: new Map() };
      eraseAt(e.clientX, e.clientY);
      return;
    }
    const a = anchorFor(e.clientY);
    if (!a) return;
    const hl = tool.kind === 'hl';
    live = {
      id: a.id,
      st: {
        c: tool.color,
        w: hl ? Math.max(12, tool.size * 4) : tool.size,
        a: hl ? 0.35 : 1,
        p: [Math.round(e.clientX - a.rect.left), Math.round(e.clientY - a.rect.top)]
      }
    };
    redrawSoon();
  });

  cv.addEventListener('pointermove', e => {
    if (!drawMode) return;
    if (erasing) { eraseAt(e.clientX, e.clientY); return; }
    if (!live) return;
    const rect = hosts.get(live.id).getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left), y = Math.round(e.clientY - rect.top);
    const p = live.st.p;
    const dx = x - p[p.length - 2], dy = y - p[p.length - 1];
    if (dx * dx + dy * dy < 4) return; // skip tiny moves (keeps saves small)
    p.push(x, y);
    redrawSoon();
  });

  const finish = () => {
    if (erasing) {
      if (erasing.removed.size) {
        history.push({ t: 'erase', removed: erasing.removed });
        saveDrawingsSoon();
      }
      erasing = null;
    }
    if (live) {
      (drawings[live.id] = drawings[live.id] || []).push(live.st);
      history.push({ t: 'add', id: live.id, st: live.st });
      live = null;
      redrawSoon();
      saveDrawingsSoon();
    }
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  const undo = () => {
    const h = history.pop();
    if (!h) return;
    if (h.t === 'add') {
      const list = drawings[h.id] || [];
      const i = list.indexOf(h.st);
      if (i >= 0) list.splice(i, 1);
    } else if (h.t === 'erase') {
      for (const [id, strokes] of h.removed) (drawings[id] = drawings[id] || []).push(...strokes);
    } else if (h.t === 'clear') {
      drawings = h.data;
    }
    redrawSoon();
    saveDrawingsSoon();
  };

  // Drawing toolbar (shown only in draw mode)
  const COLORS = ['#ff4d4d', '#ffd23f', '#5bd16b', '#4da3ff', '#c77dff', '#ffffff'];
  const bar = document.createElement('div');
  bar.className = 'sgp-toolbar';
  bar.innerHTML = `
    <div class="sgp-tb-group">${COLORS.map(c =>
      `<button type="button" class="sgp-color" data-color="${c}" style="background:${c}" title="Colour"></button>`).join('')}</div>
    <div class="sgp-tb-group">
      <button type="button" data-kind="pen" title="Pen">✏️ Pen</button>
      <button type="button" data-kind="hl" title="Highlighter">🖍️ Highlight</button>
      <button type="button" data-kind="eraser" title="Eraser – drag over a line to remove it">🧽 Eraser</button>
    </div>
    <div class="sgp-tb-group">
      <button type="button" data-size="2" title="Thin">S</button>
      <button type="button" data-size="4" title="Medium">M</button>
      <button type="button" data-size="8" title="Thick">L</button>
    </div>
    <div class="sgp-tb-group">
      <button type="button" class="sgp-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
      <button type="button" class="sgp-clear" title="Erase every drawing on this guide">Clear all</button>
      <button type="button" class="sgp-done-draw" title="Stop drawing (Esc)">Done</button>
    </div>`;
  document.body.appendChild(bar);

  const syncToolbar = () => {
    bar.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('sgp-on', b.dataset.color === tool.color));
    bar.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('sgp-on', b.dataset.kind === tool.kind));
    bar.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('sgp-on', +b.dataset.size === tool.size));
    document.body.classList.toggle('sgp-erasing', tool.kind === 'eraser');
  };
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.color) { tool.color = b.dataset.color; if (tool.kind === 'eraser') tool.kind = 'pen'; }
    if (b.dataset.kind) tool.kind = b.dataset.kind;
    if (b.dataset.size) tool.size = +b.dataset.size;
    if (b.classList.contains('sgp-undo')) undo();
    if (b.classList.contains('sgp-clear')) {
      if (confirm('Erase ALL drawings on this guide? (You can still Undo.)')) {
        history.push({ t: 'clear', data: drawings });
        drawings = {};
        redrawAll();
        saveDrawingsSoon();
      }
    }
    if (b.classList.contains('sgp-done-draw')) setDrawMode(false);
    syncToolbar();
  });

  const setDrawMode = on => {
    drawMode = on;
    document.body.classList.toggle('sgp-drawing', on);
    drawToggleBtn.textContent = on ? '✅ Stop drawing' : '✏️ Draw on page';
    if (on) redrawAll();
    syncToolbar();
  };
  drawToggleBtn.addEventListener('click', () => setDrawMode(!drawMode));

  window.addEventListener('keydown', e => {
    if (!drawMode) return;
    if (e.key === 'Escape') setDrawMode(false);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  // ---------- save when leaving the page ----------
  const flush = () => {
    record();
    if (loaded) saveDrawings();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // ---------- load saved state ----------
  const start = data => {
    if (data && data[KEY]) state = Object.assign(state, data[KEY]);
    if (!state.checked) state.checked = {};
    if (!state.notes) state.notes = {};
    drawings = (data && data[DKEY]) || {};
    resumePos = state.pos || null;
    panel.classList.toggle('sgp-open', !state.minimised);
    loaded = true;
    applyNotes();
    redrawAll();
    refresh();
  };
  try {
    chrome.storage.local.get([KEY, DKEY], start);
  } catch (e) {
    start(null);
  }
})();
