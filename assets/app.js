/* ==========================================================================
   三角洲行动 · 改枪码展示站  交互逻辑
   数据来源：data/guns.js（由 tools/build-data.mjs 从 save/ 目录生成）

   页面结构：分类 → 枪械 → 方案（数字编号），支持：
   · 侧边栏展开枪名查看该枪的全部方案
   · 方案切换标签、改枪码复制、价格醒目展示、概览图放大
   · 多套方案横向对比（属性 + 价格），对比栏固定在页面底部
   ========================================================================== */

(function () {
  'use strict';

  var DATA = window.__GUN_DATA__ || null;
  var LS_COLLAPSE = 'dfpin.collapsedCategories';
  var LS_COMPARE = 'dfpin.compare';
  var MAX_COMPARE = 6;

  var el = {
    brandMeta: document.getElementById('brandMeta'),
    footerMeta: document.getElementById('footerMeta'),
    banner: document.getElementById('banner'),
    nav: document.getElementById('gunNav'),
    navEmpty: document.getElementById('navEmpty'),
    collapseAll: document.getElementById('collapseAll'),
    detail: document.getElementById('detail'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightboxImg'),
    toast: document.getElementById('toast'),
    tray: document.getElementById('compareTray'),
    trayChips: document.getElementById('trayChips'),
    trayCount: document.getElementById('trayCount'),
    trayCompare: document.getElementById('trayCompare'),
    trayClear: document.getElementById('trayClear'),
  };

  var LS = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略 */ }
    },
  };

  var state = {
    activeId: null,
    collapsedCats: LS.get(LS_COLLAPSE, {}),
    expandedGuns: {},
    compare: LS.get(LS_COMPARE, []),
    keyword: '',
  };

  /** 详情页上「加入对比」按钮的引用，用于原地更新文案 */
  var compareBtn = null;

  /* ------------------------------------------------------------ 数据索引 */

  var buildsById = {};   // 方案 id -> { build, gun, category }
  var gunsById = {};
  var allBuilds = [];

  if (DATA && Array.isArray(DATA.categories)) {
    DATA.categories.forEach(function (cat) {
      (cat.guns || []).forEach(function (gun) {
        gunsById[gun.id] = { gun: gun, category: cat };
        (gun.schemes || []).forEach(function (build) {
          buildsById[build.id] = { build: build, gun: gun, category: cat };
          allBuilds.push(build);
        });
      });
    });
  }

  /* ---------------------------------------------------------------- 工具 */

  var STAT_ORDER = (DATA && DATA.statOrder) || [];

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.toast.hidden = true; }, 1900);
  }

  function showBanner(message) {
    if (!message) { el.banner.hidden = true; return; }
    el.banner.hidden = false;
    el.banner.textContent = message;
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function hashForBuild(id) {
    return '#/' + id.split('/').map(encodeURIComponent).join('/');
  }

  function hashForCompare(ids) {
    return '#/compare/' + ids.map(encodeURIComponent).join('|');
  }

  /** 价格显示：数值加千分位，区间原样显示 */
  function priceParts(price) {
    if (!price) return null;
    var text;
    if (price.value !== undefined && price.value !== null && !/[-~～]/.test(String(price.display))) {
      text = Number(price.value).toLocaleString('en-US');
    } else {
      text = String(price.display || '').replace(/\s*\S+$/, '');
    }
    return { text: text, unit: price.unit || '' };
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand failed'));
      } catch (err) {
        document.body.removeChild(ta);
        reject(err);
      }
    });
  }

  function selectNode(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* -------------------------------------------------------- 对比选择状态 */

  function saveCompare() {
    LS.set(LS_COMPARE, state.compare);
  }

  function inCompare(id) {
    return state.compare.indexOf(id) !== -1;
  }

  function addCompare(id) {
    if (inCompare(id)) return false;
    if (state.compare.length >= MAX_COMPARE) {
      showToast('最多同时对比 ' + MAX_COMPARE + ' 套方案');
      return false;
    }
    state.compare.push(id);
    saveCompare();
    return true;
  }

  function removeCompare(id) {
    var i = state.compare.indexOf(id);
    if (i >= 0) state.compare.splice(i, 1);
    saveCompare();
  }

  function toggleCompare(id) {
    if (inCompare(id)) {
      removeCompare(id);
      showToast('已从对比栏移除');
    } else if (addCompare(id)) {
      showToast('已加入对比栏');
    }
    renderTray();
    renderNav();
    updateCompareButton();
    if (isCompareRoute()) renderCompareView();
  }

  /** 只更新详情页上那个「加入对比」按钮，避免整页重绘导致图片闪一下 */
  function updateCompareButton() {
    var btn = compareBtn;
    if (!btn) return;
    var on = !!state.activeId && inCompare(state.activeId);
    btn.textContent = on ? '✓ 已在对比栏' : '+ 加入对比';
    btn.className = 'btn' + (on ? ' on' : '');
  }

  function isCompareRoute() {
    return location.hash.replace(/^#\/?/, '').split('/')[0] === 'compare';
  }

  /* ------------------------------------------------------------ 侧边栏 */

  function schemeMatch(build, keyword) {
    if (!keyword) return true;
    return (build.feat || '').toLowerCase().indexOf(keyword) !== -1 ||
           build.label.toLowerCase().indexOf(keyword) !== -1;
  }

  function renderNav() {
    clear(el.nav);
    var keyword = state.keyword.trim().toLowerCase();
    var shownGuns = 0;

    (DATA.categories || []).forEach(function (cat) {
      // 搜索命中分类名时，该分类下所有枪都显示；否则按枪名 / 方案简介过滤
      var catNameMatch = !!keyword && cat.name.toLowerCase().indexOf(keyword) !== -1;

      var guns = (cat.guns || []).filter(function (gun) {
        if (!keyword || catNameMatch) return true;
        if (gun.name.toLowerCase().indexOf(keyword) !== -1) return true;
        return gun.schemes.some(function (s) { return schemeMatch(s, keyword); });
      });
      if (!guns.length) return;

      var catOpen = keyword ? true : state.collapsedCats[cat.name] !== true;

      var group = make('div', 'nav-group');
      group.dataset.open = catOpen ? 'true' : 'false';

      var head = make('button', 'nav-group-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', catOpen ? 'true' : 'false');
      head.appendChild(make('span', 'nav-caret'));
      head.appendChild(make('span', 'nav-group-name', cat.name));
      head.appendChild(make('span', 'nav-count', guns.length));
      head.addEventListener('click', function () {
        var nowOpen = group.dataset.open !== 'true';
        group.dataset.open = nowOpen ? 'true' : 'false';
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        if (nowOpen) delete state.collapsedCats[cat.name]; else state.collapsedCats[cat.name] = true;
        LS.set(LS_COLLAPSE, state.collapsedCats);
      });
      group.appendChild(head);

      var gunList = make('ul', 'nav-list');

      guns.forEach(function (gun) {
        shownGuns += 1;
        var gunOpen = keyword ? true : state.expandedGuns[gun.id] === true;

        var li = make('li', 'nav-gun-item');
        var gunRow = make('button', 'nav-gun');
        gunRow.type = 'button';
        gunRow.dataset.open = gunOpen ? 'true' : 'false';
        gunRow.setAttribute('aria-expanded', gunOpen ? 'true' : 'false');
        gunRow.appendChild(make('span', 'nav-caret'));
        gunRow.appendChild(make('span', 'nav-gun-name', gun.name));
        gunRow.appendChild(make('span', 'nav-count', gun.schemes.length));
        gunRow.addEventListener('click', function () {
          var nowOpen = gunRow.dataset.open !== 'true';
          gunRow.dataset.open = nowOpen ? 'true' : 'false';
          gunRow.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
          if (nowOpen) state.expandedGuns[gun.id] = true; else delete state.expandedGuns[gun.id];
        });
        li.appendChild(gunRow);

        var schemes = gun.schemes.filter(function (s) { return schemeMatch(s, keyword) || gun.name.toLowerCase().indexOf(keyword) !== -1; });
        if (!schemes.length) schemes = gun.schemes;

        var schemeList = make('ul', 'nav-schemes');

        schemes.forEach(function (build) {
          var sli = make('li', 'nav-scheme');
          var item = make('button', 'nav-item' + (build.id === state.activeId ? ' active' : ''));
          item.type = 'button';
          item.title = build.label + (build.feat ? ' · ' + build.feat : '');
          item.appendChild(make('span', 'nav-item-label', build.label));
          if (build.featShort) item.appendChild(make('span', 'nav-item-feat', build.featShort));
          item.addEventListener('click', function () { location.hash = hashForBuild(build.id); });
          sli.appendChild(item);

          var add = make('button', 'nav-add' + (inCompare(build.id) ? ' on' : ''), inCompare(build.id) ? '✓' : '+');
          add.type = 'button';
          add.title = inCompare(build.id) ? '从对比栏移除' : '加入对比';
          add.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleCompare(build.id);
          });
          sli.appendChild(add);

          schemeList.appendChild(sli);
        });

        li.appendChild(schemeList);
        gunList.appendChild(li);
      });

      group.appendChild(gunList);
      el.nav.appendChild(group);
    });

    el.navEmpty.hidden = shownGuns > 0;
    if (!shownGuns) {
      el.navEmpty.textContent = keyword ? '没有匹配「' + state.keyword + '」的枪械' : '还没有任何枪械数据';
    }
  }

  /* -------------------------------------------------------------- 详情 */

  function renderEmptyState() {
    clear(el.detail);
    compareBtn = null;
    var box = make('div', 'empty-state');
    box.appendChild(make('div', 'big', '还没有可展示的改枪方案'));
    box.appendChild(make('p', null, '数据整理好之后，这里会按分类列出枪械和对应的改枪码方案。'));
    el.detail.appendChild(box);
  }

  function sectionCard(title, extra) {
    var card = make('div', 'card');
    var head = make('div', 'card-head');
    head.appendChild(make('h2', 'card-title', title));
    head.appendChild(make('span', 'spacer'));
    if (extra) head.appendChild(extra);
    card.appendChild(head);
    return card;
  }

  function renderDetail() {
    var entry = buildsById[state.activeId];
    if (!entry) { renderEmptyState(); return; }

    var build = entry.build;
    var gun = entry.gun;
    clear(el.detail);

    /* ---- 头部：枪名 / 分类 / 简介 / 方案切换 ---- */
    var head = make('div', 'detail-head');

    var row = make('div', 'detail-title-row');
    row.appendChild(make('h1', 'detail-title', gun.name));
    row.appendChild(make('span', 'badge', entry.category.name));
    row.appendChild(make('span', 'spacer'));

    var cmpBtn = make('button', 'btn' + (inCompare(build.id) ? ' on' : ''),
      inCompare(build.id) ? '✓ 已在对比栏' : '+ 加入对比');
    cmpBtn.type = 'button';
    cmpBtn.addEventListener('click', function () { toggleCompare(build.id); });
    compareBtn = cmpBtn;
    row.appendChild(cmpBtn);

    if (gun.schemes.length > 1) {
      var allBtn = make('button', 'btn', '对比本枪全部方案');
      allBtn.type = 'button';
      allBtn.addEventListener('click', function () {
        var added = 0;
        gun.schemes.slice(0, MAX_COMPARE).forEach(function (s) {
          if (addCompare(s.id)) added += 1;
        });
        if (gun.schemes.length > MAX_COMPARE) showToast('最多同时对比 ' + MAX_COMPARE + ' 套方案');
        else if (added) showToast('已把 ' + gun.schemes.length + ' 套方案加入对比');
        saveCompare();
        state.compare = state.compare.filter(function (id) { return !!buildsById[id]; });
        location.hash = hashForCompare(state.compare);
      });
      row.appendChild(allBtn);
    }
    head.appendChild(row);

    if (build.feat) head.appendChild(make('p', 'detail-feat', build.feat));

    if (gun.schemes.length > 1) {
      var tabs = make('div', 'scheme-tabs');
      gun.schemes.forEach(function (s) {
        var tab = make('button', 'scheme-tab' + (s.id === build.id ? ' active' : ''), s.label);
        tab.type = 'button';
        if (s.featShort) tab.title = s.featShort;
        tab.addEventListener('click', function () { location.hash = hashForBuild(s.id); });
        tabs.appendChild(tab);
      });
      head.appendChild(tabs);
    }

    el.detail.appendChild(head);

    /* ---- 改枪码 + 价格 ---- */
    var copyBtn = make('button', 'btn', '复制改枪码');
    copyBtn.type = 'button';

    var card = sectionCard('改枪码', copyBtn);
    var block = make('div', 'code-block');
    var codeText = make('pre', 'code-text', build.code || '这套方案还没有填写改枪码');
    block.appendChild(codeText);
    card.appendChild(block);

    copyBtn.addEventListener('click', function () {
      if (!build.code) { showToast('这套方案还没有改枪码'); return; }
      copyText(build.code).then(function () {
        copyBtn.textContent = '已复制 ✓';
        copyBtn.classList.add('copied');
        showToast('改枪码已复制到剪贴板');
        setTimeout(function () {
          copyBtn.textContent = '复制改枪码';
          copyBtn.classList.remove('copied');
        }, 1800);
      }).catch(function () {
        selectNode(codeText);
        showToast('已选中文本，请按 Ctrl+C 复制');
      });
    });

    // 价格：跟在改枪码下方，单独醒目展示
    var price = priceParts(build.price);
    var strip = make('div', 'price-strip' + (price ? '' : ' empty'));
    var label = make('span', 'price-label');
    label.appendChild(make('span', 'price-label-main', '改枪总价'));
    label.appendChild(make('span', 'price-label-sub', '这套方案的全部配件花费'));
    strip.appendChild(label);

    var valueBox = make('div', 'price-value');
    if (price) {
      valueBox.appendChild(make('span', 'price-number', price.text));
      if (price.unit) valueBox.appendChild(make('span', 'price-unit', price.unit));
    } else {
      valueBox.appendChild(make('span', 'price-number price-missing', '未填写'));
      valueBox.appendChild(make('span', 'price-unit', '在 stats.txt 里加一行「价格: 245000 币」'));
    }
    strip.appendChild(valueBox);
    card.appendChild(strip);
    el.detail.appendChild(card);

    /* ---- 概览图 ---- */
    var imgCard = sectionCard('方案概览', null);
    if (build.image) {
      var zoom = make('button', 'overview');
      zoom.type = 'button';
      zoom.title = '点击放大';
      var img = document.createElement('img');
      img.src = build.image;
      img.alt = gun.name + ' ' + build.label + ' 概览图';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        zoom.remove();
        imgCard.appendChild(make('p', 'card-sub', '概览图加载失败'));
      });
      zoom.appendChild(img);
      zoom.addEventListener('click', function () { openLightbox(build.image, img.alt); });
      imgCard.appendChild(zoom);
    } else {
      imgCard.appendChild(make('p', 'card-sub', '这套方案还没有概览图'));
    }
    el.detail.appendChild(imgCard);

    /* ---- 属性柱状图（价格已单独展示，不在这里）---- */
    var chartCard = sectionCard('属性数据', null);
    if (!build.stats.length) {
      chartCard.appendChild(make('p', 'card-sub', '这套方案还没有填写属性数据'));
    } else {
      var chart = make('div', 'chart');
      var rows = [];
      build.stats.forEach(function (s) {
        var r = make('div', 'chart-row' + (s.inverse ? ' inverse' : ''));
        r.appendChild(make('div', 'chart-label', s.key));
        var track = make('div', 'chart-track');
        var fill = make('div', 'chart-fill');
        fill.title = s.key + '：' + s.display;
        track.appendChild(fill);
        r.appendChild(track);
        var value = make('div', 'chart-value', s.display);
        if (s.scale === 'relative' && s.percentOfMax !== undefined) {
          value.appendChild(make('small', null, s.percentOfMax + '%'));
        }
        r.appendChild(value);
        chart.appendChild(r);
        rows.push({ fill: fill, bar: s.bar });
      });
      chartCard.appendChild(chart);

      var legend = make('p', 'card-sub legend-note');
      legend.textContent = '横条长度：0–100 的评分项按百分制显示，伤害 / 射程 / 枪口初速按全部方案中的最大值折算（括号内为占比）；蓝色条目表示越低越好。';
      chartCard.appendChild(legend);

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          rows.forEach(function (r) { r.fill.style.width = r.bar + '%'; });
        });
      });
    }
    el.detail.appendChild(chartCard);

    document.title = gun.name + ' ' + build.label + ' 改枪码';
  }

  /* -------------------------------------------------------------- 对比 */

  function statKeysOf(entries) {
    var keys = [];
    entries.forEach(function (e) {
      e.build.stats.forEach(function (s) {
        if (keys.indexOf(s.key) === -1) keys.push(s.key);
      });
    });
    var orderIndex = function (k) {
      var i = STAT_ORDER.indexOf(k);
      return i === -1 ? STAT_ORDER.length : i;
    };
    return keys.sort(function (a, b) {
      return orderIndex(a) - orderIndex(b) || keys.indexOf(a) - keys.indexOf(b);
    });
  }

  function isInverse(key, entries) {
    for (var i = 0; i < entries.length; i += 1) {
      var found = entries[i].build.stats.filter(function (s) { return s.key === key; })[0];
      if (found) return !!found.inverse;
    }
    return false;
  }

  /** 找出这一行里更优的值（越低越好的属性取最小值，其余取最大值） */
  function bestValue(values, inverse) {
    var nums = values.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (nums.length < 2) return null;
    var best = inverse ? Math.min.apply(null, nums) : Math.max.apply(null, nums);
    var allSame = nums.every(function (v) { return v === nums[0]; });
    return allSame ? null : best;
  }

  function compareCell(valueEls, bar) {
    var cell = make('td', 'cmp-cell');
    if (valueEls === null) {
      cell.classList.add('cmp-empty');
      cell.textContent = '—';
      return cell;
    }
    cell.appendChild(valueEls);
    if (bar !== undefined && bar !== null) {
      var track = make('div', 'cmp-bar');
      var fill = make('i');
      fill.style.width = bar + '%';
      track.appendChild(fill);
      cell.appendChild(track);
    }
    return cell;
  }

  function renderCompareView() {
    var entries = state.compare.map(function (id) { return buildsById[id]; }).filter(Boolean);
    clear(el.detail);
    compareBtn = null;

    if (!entries.length) {
      var box = make('div', 'empty-state');
      box.appendChild(make('div', 'big', '对比栏还是空的'));
      box.appendChild(make('p', null, '在左侧方案右侧点「+」，或进入某个方案后点「加入对比」，最多可以同时对比 ' + MAX_COMPARE + ' 套方案。'));
      el.detail.appendChild(box);
      document.title = '方案对比';
      return;
    }

    var head = make('div', 'compare-head');
    head.appendChild(make('h1', 'detail-title', '方案对比'));
    head.appendChild(make('span', 'badge', entries.length + ' 套方案'));
    head.appendChild(make('span', 'spacer'));
    var clearBtn = make('button', 'btn', '清空对比栏');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () {
      state.compare = [];
      saveCompare();
      if (isCompareRoute()) location.hash = allBuilds.length ? hashForBuild(allBuilds[0].id) : '';
      else { renderTray(); renderNav(); renderCompareView(); }
    });
    head.appendChild(clearBtn);
    el.detail.appendChild(head);

    var scroll = make('div', 'compare-scroll');
    var table = make('table', 'compare-table');

    /* 表头：每套方案一列 */
    var thead = make('thead');
    var headRow = make('tr');
    headRow.appendChild(make('th', 'cmp-rowhead cmp-corner', '属性'));

    entries.forEach(function (e) {
      var th = make('th', 'cmp-col');
      var top = make('div', 'cmp-col-top');
      top.appendChild(make('span', 'cmp-gun', e.gun.name));
      top.appendChild(make('span', 'cmp-scheme', e.build.label));
      var del = make('button', 'cmp-remove', '×');
      del.type = 'button';
      del.title = '从对比栏移除';
      del.addEventListener('click', function () {
        removeCompare(e.build.id);
        state.compare = state.compare.filter(function (id) { return !!buildsById[id]; });
        location.hash = hashForCompare(state.compare);
        renderTray();
        if (!state.compare.length) renderCompareView();
      });
      top.appendChild(del);
      th.appendChild(top);
      if (e.build.featShort) th.appendChild(make('div', 'cmp-feat', e.build.featShort));
      var open = make('button', 'cmp-open', '查看方案');
      open.type = 'button';
      open.addEventListener('click', function () { location.hash = hashForBuild(e.build.id); });
      th.appendChild(open);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = make('tbody');

    /* 价格行 */
    var priceRow = make('tr', 'cmp-price-row');
    priceRow.appendChild(make('th', 'cmp-rowhead', '价格'));
    var prices = entries.map(function (e) { return e.build.price ? e.build.price.value : null; });
    var bestPrice = bestValue(prices, true);
    entries.forEach(function (e, i) {
      var p = priceParts(e.build.price);
      var td;
      if (!p) {
        td = compareCell(null, null);
      } else {
        var val = make('span', 'cmp-val');
        val.appendChild(make('span', 'cmp-price-number', p.text));
        if (p.unit) val.appendChild(make('small', null, p.unit));
        td = compareCell(val, null);
        if (bestPrice !== null && prices[i] === bestPrice) {
          td.classList.add('best');
          td.appendChild(make('span', 'cmp-tag', '最低'));
        }
      }
      priceRow.appendChild(td);
    });
    tbody.appendChild(priceRow);

    /* 属性行 */
    statKeysOf(entries).forEach(function (key) {
      var inverse = isInverse(key, entries);
      var row = make('tr');
      var rowHead = make('th', 'cmp-rowhead');
      rowHead.appendChild(make('span', null, key));
      if (inverse) rowHead.appendChild(make('span', 'cmp-down', '↓'));
      row.appendChild(rowHead);

      var values = entries.map(function (e) {
        var found = e.build.stats.filter(function (s) { return s.key === key; })[0];
        return found || null;
      });
      var best = bestValue(values.map(function (s) { return s ? s.value : null; }), inverse);

      values.forEach(function (s) {
        if (!s) { row.appendChild(compareCell(null, null)); return; }
        var val = make('span', 'cmp-val', s.display);
        var td = compareCell(val, s.bar);
        if (best !== null && s.value === best) td.classList.add('best');
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    scroll.appendChild(table);
    el.detail.appendChild(scroll);

    var note = make('p', 'card-sub legend-note');
    note.textContent = '绿色高亮为该行更优的一方（举镜时间、重量等标 ↓ 的属性越低越好，其余属性越高越好）；价格行的「最低」标记的是花费最少的一套。';
    el.detail.appendChild(note);

    document.title = '方案对比 · ' + entries.length + ' 套';
  }

  /* ------------------------------------------------------------ 对比栏 */

  function renderTray() {
    var entries = state.compare.map(function (id) { return buildsById[id]; }).filter(Boolean);
    if (!entries.length) {
      el.tray.hidden = true;
      document.body.classList.remove('has-tray');
      return;
    }

    el.tray.hidden = false;
    document.body.classList.add('has-tray');
    el.trayCount.textContent = entries.length;
    clear(el.trayChips);

    entries.forEach(function (e) {
      var chip = make('span', 'chip');
      chip.appendChild(make('span', 'chip-text', e.gun.name + ' · ' + e.build.label));
      var x = make('button', 'chip-x', '×');
      x.type = 'button';
      x.title = '移除';
      x.addEventListener('click', function () {
        removeCompare(e.build.id);
        renderTray();
        renderNav();
        updateCompareButton();
        if (isCompareRoute()) {
          if (state.compare.length) location.hash = hashForCompare(state.compare);
          else renderCompareView();
        }
      });
      chip.appendChild(x);
      el.trayChips.appendChild(chip);
    });

    el.trayCompare.textContent = '开始对比 (' + entries.length + ')';
    var disabled = entries.length < 2;
    el.trayCompare.disabled = disabled;
    el.trayCompare.title = disabled ? '至少选择 2 套方案' : '';
  }

  el.trayCompare.addEventListener('click', function () {
    state.compare = state.compare.filter(function (id) { return !!buildsById[id]; });
    if (state.compare.length < 2) { showToast('至少选择 2 套方案才能对比'); return; }
    location.hash = hashForCompare(state.compare);
  });

  el.trayClear.addEventListener('click', function () {
    state.compare = [];
    saveCompare();
    renderTray();
    renderNav();
    updateCompareButton();
    if (isCompareRoute()) location.hash = allBuilds.length ? hashForBuild(allBuilds[0].id) : '';
    showToast('对比栏已清空');
  });

  /* -------------------------------------------------------------- 灯箱 */

  function openLightbox(src, alt) {
    el.lightboxImg.src = src;
    el.lightboxImg.alt = alt || '';
    el.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    el.lightbox.hidden = true;
    el.lightboxImg.removeAttribute('src');
    document.body.style.overflow = '';
  }

  el.lightbox.addEventListener('click', closeLightbox);
  el.lightboxImg.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.lightbox.hidden) closeLightbox();
  });

  /* -------------------------------------------------------------- 路由 */

  function readRoute() {
    var raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { type: 'none' };
    var segs = raw.split('/').filter(Boolean);
    if (segs[0] === 'compare') {
      var ids = (segs[1] || '').split('|').filter(Boolean).map(dec);
      return { type: 'compare', ids: ids };
    }
    return { type: 'build', id: segs.map(dec).join('/') };
  }

  function applyRoute() {
    var route = readRoute();
    if (route.type === 'compare') {
      state.compare = route.ids.filter(function (id) { return !!buildsById[id]; });
      saveCompare();
      renderTray();
      renderNav();
      renderCompareView();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return true;
    }
    if (route.type === 'build' && buildsById[route.id]) {
      if (route.id === state.activeId && !isCompareRoute()) return true;
      state.activeId = route.id;
      state.expandedGuns[buildsById[route.id].gun.id] = true;
      renderDetail();
      renderNav();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return true;
    }
    return false;
  }

  function goDefault() {
    if (!allBuilds.length) { renderEmptyState(); return; }
    location.replace(hashForBuild(allBuilds[0].id));
    if (!applyRoute()) {
      state.activeId = allBuilds[0].id;
      renderDetail();
      renderNav();
    }
  }

  window.addEventListener('hashchange', function () {
    if (!applyRoute()) goDefault();
  });

  /* -------------------------------------------------------------- 搜索 */

  el.searchInput.addEventListener('input', function () {
    state.keyword = el.searchInput.value;
    el.searchClear.hidden = !state.keyword;
    renderNav();
  });

  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var keyword = state.keyword.trim().toLowerCase();
    if (!keyword) return;
    var hit = allBuilds.filter(function (b) {
      return b.gunName.toLowerCase().indexOf(keyword) !== -1 ||
             (b.feat || '').toLowerCase().indexOf(keyword) !== -1;
    })[0];
    if (hit) location.hash = hashForBuild(hit.id);
  });

  el.searchClear.addEventListener('click', function () {
    el.searchInput.value = '';
    state.keyword = '';
    el.searchClear.hidden = true;
    renderNav();
    el.searchInput.focus();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== el.searchInput) {
      e.preventDefault();
      el.searchInput.focus();
    }
  });

  el.collapseAll.addEventListener('click', function () {
    var cats = (DATA && DATA.categories) || [];
    var allCollapsed = cats.length > 0 && cats.every(function (c) { return state.collapsedCats[c.name] === true; });
    state.collapsedCats = {};
    if (!allCollapsed) cats.forEach(function (c) { state.collapsedCats[c.name] = true; });
    el.collapseAll.textContent = allCollapsed ? '全部折叠' : '全部展开';
    LS.set(LS_COLLAPSE, state.collapsedCats);
    renderNav();
  });

  /* -------------------------------------------------------------- 启动 */

  function boot() {
    if (!DATA || !allBuilds.length) {
      el.brandMeta.textContent = '暂无数据';
      renderNav();
      showBanner('暂时还没有可展示的改枪方案，请稍后再来看看。');
      renderEmptyState();
      return;
    }

    state.compare = state.compare.filter(function (id) { return !!buildsById[id]; });
    saveCompare();

    el.brandMeta.textContent = DATA.gunCount + ' 把枪械 · ' + DATA.schemeCount + ' 套方案';
    el.footerMeta.textContent = '最后更新：' + formatTime(DATA.generatedAt);

    renderTray();

    if (!applyRoute()) goDefault();
  }

  boot();
})();
