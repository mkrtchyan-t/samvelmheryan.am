(function () {
  'use strict';

  var API = 'api.php';
  var LANGS = [['hy', 'Հայերեն (պարտադիր)'], ['en', 'English'], ['ru', 'Русский']];
  var TABS = [
    ['bio', 'Կենսագրություն'],
    ['banners', 'Բաններ'],
    ['books', 'Գրքեր'],
    ['films', 'Ֆիլմեր'],
    ['gallery', 'Պատկերասրահ'],
    ['contact', 'Կապ']
  ];
  // Longest side (px) per kind of image, so uploads stay light.
  var MAX_SIDE = { banners: 1920, books: 900, films: 1200, gallery: 1600, detail: 1600 };
  var SECTION_LABELS = {
    books: { hy: 'Հատված գրքից', en: 'Excerpt from the Book', ru: 'Отрывок из книги' },
    films: { hy: 'Միջոցառումներ', en: 'Events', ru: 'Мероприятия' }
  };

  var app = document.getElementById('app');
  var state = { csrf: null, content: null, tab: 'bio', dirty: false, busy: 0 };
  // image URL -> { path, sha, preview } for photos uploaded this session
  var uploads = {};
  var dragFrom = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(children) {
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(c);
        else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }

  function toast(msg, kind) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'error' ? 8000 : 6000);
  }

  var ERRORS = {
    401: 'Սխալ օգտանուն կամ գաղտնաբառ։',
    403: 'Սեսիան ավարտվել է։ Թարմացրեք էջը և կրկին մուտք գործեք։',
    429: 'Չափազանց շատ փորձեր։ Սպասեք մի քանի րոպե։'
  };

  function api(action, opts) {
    opts = opts || {};
    var headers = {};
    if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
    var init = { method: opts.body !== undefined ? 'POST' : 'GET', headers: headers, credentials: 'same-origin' };
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + '?action=' + action, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ERRORS[res.status] || 'Սխալ։ Փորձեք կրկին։');
          err.status = res.status;
          err.serverMessage = data.error;
          throw err;
        }
        return data;
      });
    });
  }

  function markDirty() {
    state.dirty = true;
    var s = document.getElementById('status');
    if (s) { s.textContent = 'Չպահպանված փոփոխություններ կան'; s.className = 'status dirty'; }
  }

  function move(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    markDirty();
    render();
  }

  function remove(list, i, what) {
    if (!window.confirm('Ջնջե՞լ ' + what + '։')) return;
    list.splice(i, 1);
    markDirty();
    render();
  }

  function previewOf(url) {
    return uploads[url] ? uploads[url].preview : url;
  }

  // ── image conversion (browser-side → WebP) ───────────────────────────────

  function toWebp(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var hgt = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hgt;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
        URL.revokeObjectURL(src);
        canvas.toBlob(function (blob) {
          if (blob && blob.type === 'image/webp') resolve(blob);
          else reject(new Error('Այս դիտարկիչը չի կարող նկարը վերածել WebP-ի։ Օգտագործեք Chrome կամ Firefox։'));
        }, 'image/webp', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(src);
        reject(new Error('Նկարը չհաջողվեց բացել։ Ընտրեք JPG, PNG կամ WebP ֆայլ։'));
      };
      img.src = src;
    });
  }

  /** Converts and uploads one photo. Resolves with the site image URL. */
  function uploadImage(file, kind) {
    state.busy++;
    return toWebp(file, MAX_SIDE[kind] || 1600).then(function (blob) {
      var fd = new FormData();
      fd.append('file', blob, 'image.webp');
      return api('upload', { body: fd }).then(function (res) {
        uploads[res.image] = { path: res.path, sha: res.sha, preview: URL.createObjectURL(blob) };
        return res.image;
      });
    }).then(function (url) {
      state.busy--;
      return url;
    }, function (err) {
      state.busy--;
      throw err;
    });
  }

  function pickFiles(multiple, onFiles) {
    var input = h('input', { type: 'file', accept: 'image/*', multiple: multiple, style: 'display:none' });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files);
      input.remove();
      if (files.length) onFiles(files);
    });
    document.body.appendChild(input);
    input.click();
  }

  function addPhotos(list, kind, makeItem) {
    pickFiles(true, function (files) {
      toast('Նկարները բեռնվում են… (' + files.length + ')');
      // sequential keeps the server happy and the order predictable
      files.reduce(function (p, file) {
        return p.then(function () {
          return uploadImage(file, kind).then(function (url) {
            list.push(makeItem(url));
            markDirty();
            render();
          });
        });
      }, Promise.resolve()).then(function () {
        toast('Նկարները ավելացվեցին։ Չմոռանաք սեղմել «Պահպանել և հրապարակել»։', 'ok');
      }, function (err) { toast(err.message, 'error'); });
    });
  }

  function replacePhoto(obj, key, kind, thumb) {
    pickFiles(false, function (files) {
      thumb.classList.add('busy');
      uploadImage(files[0], kind).then(function (url) {
        obj[key] = url;
        markDirty();
        render();
      }, function (err) {
        thumb.classList.remove('busy');
        toast(err.message, 'error');
      });
    });
  }

  // ── drag & drop reordering ───────────────────────────────────────────────

  function makeDraggable(el, list, i) {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', function (e) {
      dragFrom = { list: list, i: i };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* old browsers */ }
    });
    el.addEventListener('dragend', function () { el.classList.remove('dragging'); dragFrom = null; });
    el.addEventListener('dragover', function (e) {
      if (dragFrom && dragFrom.list === list) { e.preventDefault(); el.classList.add('over'); }
    });
    el.addEventListener('dragleave', function () { el.classList.remove('over'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.classList.remove('over');
      if (dragFrom && dragFrom.list === list) move(list, dragFrom.i, i);
    });
  }

  // ── views ────────────────────────────────────────────────────────────────

  function renderLogin(message) {
    app.textContent = '';
    var user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    var err = h('p', { style: 'color:var(--danger);min-height:1.4em;margin:0 0 10px' }, message || '');
    var btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Մուտք');
    var form = h('form', { class: 'login' },
      h('h1', {}, 'Սամվել Մհերյան — կառավարում'),
      h('label', { class: 'field' }, h('span', {}, 'Օգտանուն'), user),
      h('label', { class: 'field' }, h('span', {}, 'Գաղտնաբառ'), pass),
      err, btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      api('login', { body: { username: user.value, password: pass.value } }).then(function (res) {
        state.csrf = res.csrf;
        return loadContent();
      }).catch(function (e2) {
        btn.disabled = false;
        err.textContent = e2.message;
      });
    });
    app.appendChild(form);
  }

  function renderTopbar() {
    var save = h('button', { class: 'btn primary', id: 'save', onclick: save_ }, 'Պահպանել և հրապարակել');
    return h('div', { class: 'topbar' },
      h('h1', {}, 'Կայքի կառավարում'),
      h('span', { id: 'status', class: 'status' + (state.dirty ? ' dirty' : '') },
        state.dirty ? 'Չպահպանված փոփոխություններ կան' : ''),
      save,
      h('button', { class: 'btn', onclick: logout }, 'Դուրս գալ'));
  }

  function renderTabs() {
    return h('div', { class: 'tabs', role: 'tablist' }, TABS.map(function (t) {
      return h('button', {
        class: 'tab' + (state.tab === t[0] ? ' active' : ''),
        role: 'tab',
        onclick: function () { state.tab = t[0]; render(); }
      }, t[1]);
    }));
  }

  function moveButtons(list, i) {
    return [
      h('button', { class: 'btn small', title: 'Վերև', disabled: i === 0, onclick: function () { move(list, i, i - 1); } }, '▲'),
      h('button', { class: 'btn small', title: 'Ներքև', disabled: i === list.length - 1, onclick: function () { move(list, i, i + 1); } }, '▼')
    ];
  }

  function thumbFor(obj, key, kind, wide) {
    var btn = h('button', { class: 'thumb' + (wide ? ' wide' : ''), type: 'button', title: 'Փոխել նկարը' },
      h('img', { src: previewOf(obj[key]), alt: '' }),
      h('span', { class: 'change' }, 'Փոխել նկարը'));
    btn.addEventListener('click', function () { replacePhoto(obj, key, kind, btn); });
    return btn;
  }

  /** A single optional image: shows a thumbnail with change/remove, or an "add" button. */
  function optionalImage(obj, key, kind, label, hint) {
    var body;
    if (obj[key]) {
      body = h('div', { class: 'opt-image' },
        thumbFor(obj, key, kind, false),
        h('button', { class: 'btn small danger', onclick: function () { obj[key] = ''; markDirty(); render(); } }, 'Հեռացնել'));
    } else {
      var add = h('button', { class: 'btn', type: 'button' }, '+ Ընտրել նկար');
      add.addEventListener('click', function () { replacePhoto(obj, key, kind, add); });
      body = add;
    }
    return h('div', { class: 'field' }, h('span', {}, label), hint ? h('small', { class: 'hint' }, hint) : null, body);
  }

  /** Three language boxes. Only Armenian is mandatory (when `required`). */
  function langFields(obj, opts) {
    opts = opts || {};
    return h('div', { class: 'fields' }, LANGS.map(function (l) {
      var req = l[0] === 'hy' && opts.required !== false;
      var attrs = { value: obj[l[0]] || '', 'data-required': req ? '1' : null };
      var input;
      if (opts.multiline) { input = h('textarea', { rows: 5, maxlength: 5000, class: 'ta', 'data-required': req ? '1' : null }, obj[l[0]] || ''); }
      else { attrs.type = 'text'; attrs.maxlength = 300; input = h('input', attrs); }
      input.addEventListener('input', function () {
        obj[l[0]] = input.value;
        input.classList.remove('invalid');
        markDirty();
      });
      var label = l[1].replace(' (պարտադիր)', req ? ' (պարտադիր)' : '');
      if (l[0] === 'hy' && !req) label = 'Հայերեն';
      return h('label', { class: 'field' }, h('span', {}, label), input);
    }));
  }

  function blankTri() { return { hy: '', en: '', ru: '' }; }

  /** Editable list of paragraphs (3 languages each). */
  function paragraphsEditor(list, opts) {
    opts = opts || {};
    var wrap = h('div', { class: 'list' });
    list.forEach(function (p, i) {
      var el = h('div', { class: 'item para' },
        h('div', { class: 'fields' }, h('strong', {}, 'Պարբերություն ' + (i + 1)), langFields(p, { multiline: true })),
        h('div', { class: 'row-actions' },
          moveButtons(list, i),
          h('button', { class: 'btn small danger', disabled: opts.keepOne && list.length <= 1, onclick: function () { remove(list, i, 'այս պարբերությունը'); } }, 'Ջնջել')));
      makeDraggable(el, list, i);
      wrap.appendChild(el);
    });
    return h('div', {}, wrap,
      h('div', { class: 'add-bar' },
        h('button', { class: 'btn', onclick: function () { list.push(blankTri()); markDirty(); render(); } }, '+ Ավելացնել պարբերություն')));
  }

  /** Grid of photos with reorder / delete / add. */
  function tilesEditor(list, kind, opts) {
    opts = opts || {};
    var grid = h('div', { class: 'grid' });
    list.forEach(function (item, i) {
      var tile = h('div', { class: 'tile' },
        h('img', { src: previewOf(item.image), alt: '', loading: 'lazy' }),
        h('span', { class: 'num' }, String(i + 1)),
        opts.homeCount && i < opts.homeCount ? h('span', { class: 'badge home' }, 'Գլխավոր') : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', title: 'Առաջ', disabled: i === 0, onclick: function () { move(list, i, i - 1); } }, '◀'),
          h('button', { class: 'btn small', title: 'Սկզբում դնել', disabled: i === 0, onclick: function () { move(list, i, 0); } }, '⤒'),
          h('button', { class: 'btn small', title: 'Հետ', disabled: i === list.length - 1, onclick: function () { move(list, i, i + 1); } }, '▶'),
          h('button', { class: 'btn small danger', title: 'Ջնջել', onclick: function () { remove(list, i, 'այս նկարը'); } }, '✕')));
      makeDraggable(tile, list, i);
      grid.appendChild(tile);
    });
    return h('div', {}, grid,
      h('div', { class: 'add-bar' },
        h('button', { class: 'btn primary', onclick: function () { addPhotos(list, kind, function (url) { return { image: url }; }); } }, '+ Ավելացնել նկարներ')));
  }

  function moveButtons(list, i) {
    return [
      h('button', { class: 'btn small', title: 'Վերև', disabled: i === 0, onclick: function () { move(list, i, i - 1); } }, '▲'),
      h('button', { class: 'btn small', title: 'Ներքև', disabled: i === list.length - 1, onclick: function () { move(list, i, i + 1); } }, '▼')
    ];
  }

  function youtubeField(detail) {
    var input = h('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…', value: detail.video ? 'https://youtu.be/' + detail.video : '' });
    input.addEventListener('input', function () { detail.video = input.value.trim(); markDirty(); });
    return h('label', { class: 'field' }, h('span', {}, 'YouTube տեսանյութ (հղումը կպցրեք այստեղ, կամ թողեք դատարկ)'), input);
  }

  function detailEditor(item, kind) {
    var d = item.detail;
    var isFilm = kind === 'films';
    var sections = h('div', { class: 'list' });
    d.sections.forEach(function (sec, i) {
      var box = h('div', { class: 'section-box' },
        h('div', { class: 'section-head' },
          h('strong', {}, 'Նկարների բաժին ' + (i + 1)),
          h('span', { class: 'row-actions inline' }, moveButtons(d.sections, i),
            h('button', { class: 'btn small danger', onclick: function () { remove(d.sections, i, 'այս բաժինը'); } }, 'Ջնջել բաժինը'))),
        h('p', { class: 'hint' }, 'Բաժնի վերնագիր (երևում է նկարների վերևում)՝'),
        langFields(sec.label),
        tilesEditor(sec.images, 'detail'));
      sections.appendChild(box);
    });
    return h('div', { class: 'detail-editor' },
      h('p', { class: 'hint' }, 'Այս էջը բացվում է, երբ այցելուն սեղմում է քարտի վրա։ Էջի հասցեն՝ samvelmheryan.am/' + item.slug),
      h('h4', {}, 'Ենթավերնագիր (օր.՝ «պատմավեպ»)'), langFields(d.genre, { required: false }),
      h('h4', {}, 'Տեղեկատու տող (օր.՝ հրատարակչություն և տարեթվեր)'), langFields(d.meta, { required: false }),
      h('h4', {}, 'Նկարագրություն'), paragraphsEditor(d.paragraphs),
      isFilm ? youtubeField(d) : null,
      isFilm ? optionalImage(d, 'poster', 'books', 'Նկար էջի վերևում (օր.՝ DVD-ի շապիկ)') : null,
      isFilm ? optionalImage(d, 'hero', 'detail', 'Մեծ լայն նկար էջում') : null,
      h('h4', {}, 'Նկարներ'), sections,
      h('div', { class: 'add-bar' },
        h('button', { class: 'btn', onclick: function () {
          d.sections.push({ label: Object.assign({}, SECTION_LABELS[kind]), images: [] });
          markDirty(); render();
        } }, '+ Ավելացնել նկարների բաժին')));
  }

  function newSlug(kind) {
    return (kind === 'books' ? 'book-' : 'film-') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function renderCards(list, kind, addLabel, what) {
    var wrap = h('div', {});
    var listEl = h('div', { class: 'list' });
    list.forEach(function (item, i) {
      var open = !!item._open;
      var pageBox = h('input', { type: 'checkbox', checked: item.page });
      pageBox.addEventListener('change', function () {
        item.page = pageBox.checked;
        item._open = item.page;
        markDirty();
        render();
      });
      var el = h('div', { class: 'item card' },
        h('div', { class: 'card-main' },
          thumbFor(item, 'image', kind, false),
          h('div', { class: 'fields' },
            langFields(item.title),
            h('label', { class: 'check' }, pageBox, h('span', {}, ' Ունի առանձին էջ (բացվում է սեղմելիս)')),
            item.page ? h('button', { class: 'btn small', onclick: function () { item._open = !open; render(); } },
              open ? '▲ Փակել էջի խմբագրումը' : '✎ Խմբագրել էջի բովանդակությունը') : null),
          h('div', { class: 'row-actions' },
            moveButtons(list, i),
            h('button', { class: 'btn small danger', onclick: function () { remove(list, i, what); } }, 'Ջնջել'))),
        item.page && open ? detailEditor(item, kind) : null);
      makeDraggable(el, list, i);
      listEl.appendChild(el);
    });
    wrap.appendChild(h('p', { class: 'hint' }, 'Քարտերը կարելի է տեղափոխել ▲ ▼ կոճակներով կամ քաշելով։ Նկարը փոխելու համար սեղմեք նրա վրա։'));
    wrap.appendChild(listEl);
    wrap.appendChild(h('div', { class: 'add-bar' },
      h('button', { class: 'btn primary', onclick: function () {
        addPhotos(list, kind, function (url) {
          return { image: url, title: blankTri(), slug: newSlug(kind), page: false,
            detail: { bg: kind === 'books' ? '/images/books-bg.webp' : '/images/films-bg.webp', genre: blankTri(), meta: blankTri(), paragraphs: [], video: '', poster: '', hero: '', sections: [] } };
        });
      } }, addLabel)));
    return wrap;
  }

  function renderBanners() {
    var list = state.content.banners;
    var wrap = h('div', {});
    var listEl = h('div', { class: 'list' });
    list.forEach(function (item, i) {
      var el = h('div', { class: 'item banner' },
        thumbFor(item, 'image', 'banners', true),
        h('div', {}, h('strong', {}, 'Բաններ ' + (i + 1))),
        h('div', { class: 'row-actions' },
          moveButtons(list, i),
          h('button', { class: 'btn small danger', disabled: list.length <= 1, onclick: function () { remove(list, i, 'այս բանները'); } }, 'Ջնջել')));
      makeDraggable(el, list, i);
      listEl.appendChild(el);
    });
    wrap.appendChild(h('p', { class: 'hint' }, 'Գլխավոր էջի սլայդերի նկարները։ Լավագույնն է լայն (հորիզոնական) նկար օգտագործել։'));
    wrap.appendChild(listEl);
    wrap.appendChild(h('div', { class: 'add-bar' },
      h('button', { class: 'btn primary', onclick: function () { addPhotos(list, 'banners', function (url) { return { image: url }; }); } }, '+ Ավելացնել բաններ')));
    return wrap;
  }

  function renderGallery() {
    return h('div', {},
      h('p', { class: 'hint' }, 'Առաջին 6 նկարները երևում են գլխավոր էջում («Գլխավոր» նշումով)։ Մնացածը՝ «Տեսնել ավելին» էջում։ Նկարները կարելի է քաշել կամ տեղափոխել կոճակներով (⤒ = դնել սկզբում)։'),
      tilesEditor(state.content.gallery, 'gallery', { homeCount: 6 }));
  }

  function renderBio() {
    return h('div', {},
      h('p', { class: 'hint' }, 'Գլխավոր էջի վերևի տեքստը (հեղինակի մասին)։ Յուրաքանչյուր պարբերություն առանձին է։'),
      paragraphsEditor(state.content.bio.paragraphs, { keepOne: true }));
  }

  function contactGroup(title, obj, withName, urlLabel) {
    var url = h('input', { type: 'url', value: obj.url || '', placeholder: 'https://…', 'data-required': '1' });
    url.addEventListener('input', function () { obj.url = url.value; url.classList.remove('invalid'); markDirty(); });
    return h('div', { class: 'contact-group' },
      h('h3', {}, title),
      h('label', { class: 'field' }, h('span', {}, urlLabel), url),
      withName ? h('div', { class: 'langs' }, LANGS.map(function (l) {
        var input = h('input', { type: 'text', value: obj.name[l[0]] || '', 'data-required': l[0] === 'hy' ? '1' : null });
        input.addEventListener('input', function () { obj.name[l[0]] = input.value; input.classList.remove('invalid'); markDirty(); });
        return h('label', { class: 'field' }, h('span', {}, 'Ցուցադրվող անուն — ' + l[1]), input);
      })) : null);
  }

  function renderContact() {
    var c = state.content.contact;
    var email = h('input', { type: 'email', value: c.email.address || '', 'data-required': '1' });
    email.addEventListener('input', function () { c.email.address = email.value; email.classList.remove('invalid'); markDirty(); });
    return h('div', {},
      h('p', { class: 'hint' }, 'Այս տվյալները երևում են գլխավոր էջի «Կապ» բաժնում։'),
      contactGroup('Facebook', c.facebook, true, 'Էջի հղում'),
      h('div', { class: 'contact-group' }, h('h3', {}, 'Էլ. փոստ'), h('label', { class: 'field' }, h('span', {}, 'Էլ. փոստի հասցե'), email)),
      contactGroup('LinkedIn', c.linkedin, true, 'Էջի հղում'));
  }

  function render() {
    if (!state.content) return;
    var scroll = window.scrollY;
    app.textContent = '';
    var body;
    switch (state.tab) {
      case 'bio': body = renderBio(); break;
      case 'banners': body = renderBanners(); break;
      case 'books': body = renderCards(state.content.books, 'books', '+ Ավելացնել գիրք', 'այս գիրքը'); break;
      case 'films': body = renderCards(state.content.films, 'films', '+ Ավելացնել ֆիլմ', 'այս ֆիլմը'); break;
      case 'gallery': body = renderGallery(); break;
      default: body = renderContact();
    }
    app.appendChild(renderTopbar());
    app.appendChild(renderTabs());
    app.appendChild(h('div', { class: 'panel', role: 'tabpanel' }, body));
    window.scrollTo(0, scroll);
  }

  // ── actions ──────────────────────────────────────────────────────────────

  function blank(t) { return !(t && t.hy && t.hy.trim()); }
  function halfFilled(t) { return blank(t) && ((t.en || '').trim() || (t.ru || '').trim()); }

  /** Returns { tab, where, open? } for the first problem, or null. Checks the data, not the DOM. */
  function findProblem() {
    var c = state.content, found = null;
    function bad(tab, where, open) { if (!found) found = { tab: tab, where: where, open: open }; }

    c.bio.paragraphs.forEach(function (p, i) {
      if (blank(p)) bad('bio', 'Կենսագրություն, պարբերություն ' + (i + 1));
    });
    [['books', 'Գիրք'], ['films', 'Ֆիլմ']].forEach(function (k) {
      c[k[0]].forEach(function (item, i) {
        var name = k[1] + ' №' + (i + 1);
        if (blank(item.title)) bad(k[0], name + ' — անվանում');
        if (!item.page) return;
        var d = item.detail;
        if (halfFilled(d.genre)) bad(k[0], name + ' — ենթավերնագիր', item);
        if (halfFilled(d.meta)) bad(k[0], name + ' — տեղեկատու տող', item);
        d.paragraphs.forEach(function (p, pi) { if (blank(p)) bad(k[0], name + ' — պարբերություն ' + (pi + 1), item); });
        d.sections.forEach(function (sec, si) { if (blank(sec.label)) bad(k[0], name + ' — նկարների բաժնի վերնագիր ' + (si + 1), item); });
      });
    });
    if (blank(c.contact.facebook.name) || blank(c.contact.linkedin.name) ||
        !c.contact.facebook.url.trim() || !c.contact.linkedin.url.trim() || !c.contact.email.address.trim()) {
      bad('contact', 'Կապ');
    }
    return found;
  }

  function validate() {
    var p = findProblem();
    if (!p) return true;
    state.tab = p.tab;
    if (p.open) p.open._open = true;
    render();
    document.querySelectorAll('[data-required]').forEach(function (el) {
      if (!el.value.trim()) el.classList.add('invalid');
    });
    toast('Լրացրեք հայերեն տեքստը՝ ' + p.where, 'error');
    var first = document.querySelector('.invalid');
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
    return false;
  }

  function usedImages(content) {
    var used = {};
    function add(u) { if (u) used[u] = true; }
    content.banners.concat(content.gallery).forEach(function (it) { add(it.image); });
    content.books.concat(content.films).forEach(function (it) {
      add(it.image); add(it.detail.bg); add(it.detail.poster); add(it.detail.hero);
      it.detail.sections.forEach(function (sec) { sec.images.forEach(function (im) { add(im.image); }); });
    });
    return used;
  }

  function save_() {
    if (state.busy) { toast('Սպասեք, նկարները դեռ բեռնվում են…'); return; }
    if (!validate()) return;
    var btn = document.getElementById('save');
    btn.disabled = true;
    btn.textContent = 'Պահպանվում է…';

    var used = usedImages(state.content);
    var ups = Object.keys(uploads).filter(function (u) { return used[u]; }).map(function (u) {
      return { path: uploads[u].path, sha: uploads[u].sha };
    });

    api('save', { body: { content: state.content, uploads: ups } }).then(function (res) {
      state.dirty = false;
      toast(res.unchanged ? 'Փոփոխություններ չկան. ամեն ինչ արդեն պահպանված է։' : 'Պահպանվեց։ Կայքը կթարմացվի մոտ 2–3 րոպեից։', 'ok');
      render();
    }, function (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Պահպանել և հրապարակել';
    });
  }

  function logout() {
    if (state.dirty && !window.confirm('Չպահպանված փոփոխություններ կան։ Դուրս գա՞լ առանց պահպանելու։')) return;
    state.dirty = false;
    api('logout', { body: {} }).then(function () { location.reload(); }, function () { location.reload(); });
  }

  function loadContent() {
    return api('load').then(function (res) {
      state.content = res.content;
      state.dirty = false;
      render();
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  api('session').then(function (s) {
    if (s.loggedIn) {
      state.csrf = s.csrf;
      return loadContent();
    }
    renderLogin();
  }).catch(function (err) {
    renderLogin(err.message);
  });
})();
