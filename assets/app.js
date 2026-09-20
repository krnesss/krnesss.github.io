/* ==========================================================================
   三角洲行动 · 改枪码展示站  交互逻辑
   数据来源：data/guns.js（由 tools/build-data.mjs 从 save/ 目录生成）
   ========================================================================== */

(function () {
  'use strict';

  var DATA = window.__GUN_DATA__ || null;
  var COLLAPSE_KEY = 'dfpin.collapsedCategories';

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
  };

  var collapsed = loadCollapsed();
  var activeId = null;

  /* ---------------------------------------------------------------- 工具 */

  function loadCollapsed() {
    try {
      var raw = localStorage.getItem(COLLAPSE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveCollapsed() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (e) { /* 忽略 */ }
  }

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
    showToast._t = setTimeout(function () { el.toast.hidden = true; }, 1800);
  }

  function showBanner(message, isError, html) {
    if (!message) { el.banner.hidden = true; return; }
    el.banner.hidden = false;
    el.banner.className = 'banner' + (isError ? ' error' : '');
    if (html) el.banner.innerHTML = html; else el.banner.textContent = message;
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // file:// 或旧浏览器兜底
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

  /* ------------------------------------------------------------ 数据索引 */

  var gunsById = {};
  var allGuns = [];

  if (DATA && Array.isArray(DATA.categories)) {
    DATA.categories.forEach(function (cat) {
      (cat.guns || []).forEach(function (gun) {
        gunsById[gun.id] = gun;
        allGuns.push(gun);
      });
    });
  }

  /* -------------------------------------------------------------- 侧边栏 */

  function renderNav(filter) {
    clear(el.nav);
    var keyword = (filter || '').trim().toLowerCase();
    var totalShown = 0;

    (DATA.categories || []).forEach(function (cat) {
      var guns = cat.guns || [];
      if (keyword) {
        guns = guns.filter(function (g) { return g.name.toLowerCase().indexOf(keyword) !== -1; });
      }
      if (!guns.length) return;
      totalShown += guns.length;

      var isOpen = keyword ? true : collapsed[cat.name] !== true;

      var group = make('div', 'nav-group');
      group.dataset.open = isOpen ? 'true' : 'false';

      var head = make('button', 'nav-group-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      head.appendChild(make('span', 'nav-caret'));
      head.appendChild(make('span', 'nav-group-name', cat.name));
      head.appendChild(make('span', 'nav-count', guns.length));
      head.addEventListener('click', function () {
        var nowOpen = group.dataset.open !== 'true';
        group.dataset.open = nowOpen ? 'true' : 'false';
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        if (nowOpen) delete collapsed[cat.name]; else collapsed[cat.name] = true;
        saveCollapsed();
      });
      group.appendChild(head);

      var list = make('ul', 'nav-list');
      guns.forEach(function (gun) {
        var li = make('li');
        var btn = make('button', 'nav-item' + (gun.id === activeId ? ' active' : ''), gun.name);
        btn.type = 'button';
        btn.title = gun.name;
        btn.addEventListener('click', function () { location.hash = '#/' + encodeURIComponent(gun.category) + '/' + encodeURIComponent(gun.name); });
        li.appendChild(btn);
        list.appendChild(li);
      });
      group.appendChild(list);
      el.nav.appendChild(group);
    });

    el.navEmpty.hidden = totalShown > 0;
    if (!totalShown && keyword) el.navEmpty.textContent = '没有匹配「' + filter + '」的枪械';
    else if (!totalShown) el.navEmpty.textContent = '还没有任何枪械数据';
  }

  /* ---------------------------------------------------------------- 详情 */

  function renderEmptyState() {
    clear(el.detail);
    var box = make('div', 'empty-state');
    box.appendChild(make('div', 'big', '还没有可展示的改枪方案'));
    box.appendChild(make('p', null, '按下面的结构把资料放进仓库的 save/ 目录，然后运行一次构建脚本即可：'));

    var pre = make('pre', 'code-text');
    pre.style.textAlign = 'left';
    pre.textContent =
      'save/\n' +
      '  突击步枪/\n' +
      '    M4A1/\n' +
      '      概览图.png      # 任意图片文件名\n' +
      '      改枪码.txt      # 第一个 txt：改枪码\n' +
      '      数据.txt        # 第二个 txt：每行「名称: 数值」';
    box.appendChild(pre);

    var code = make('pre', 'code-text');
    code.style.textAlign = 'left';
    code.textContent = 'node tools/build-data.mjs';
    box.appendChild(code);

    el.detail.appendChild(box);
  }

  function renderNoDataBanner() {
    if (!DATA) {
      showBanner('', true, '没有读到 <code>data/guns.js</code>。请先在项目根目录运行 <code>node tools/build-data.mjs</code>，然后刷新页面。');
    } else if (!allGuns.length) {
      showBanner('', false, '当前 <code>save/</code> 目录里还没有枪械数据：按 <code>save/分类/枪名/</code> 的结构放好图片和两个 txt，再运行 <code>node tools/build-data.mjs</code>。');
    }
  }

  function sectionCard(title, sub, extra) {
    var card = make('div', 'card');
    var head = make('div', 'card-head');
    head.appendChild(make('h2', 'card-title', title));
    if (sub) head.appendChild(make('span', 'card-sub', sub));
    head.appendChild(make('span', 'spacer'));
    if (extra) head.appendChild(extra);
    card.appendChild(head);
    return card;
  }

  function buildCodeCard(gun) {
    var copyBtn = make('button', 'btn');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制改枪码';
    copyBtn.addEventListener('click', function () {
      copyText(gun.code).then(function () {
        copyBtn.textContent = '已复制 ✓';
        copyBtn.classList.add('copied');
        showToast('改枪码已复制到剪贴板');
        setTimeout(function () {
          copyBtn.textContent = '复制改枪码';
          copyBtn.classList.remove('copied');
        }, 1800);
      }).catch(function () {
        // 复制被浏览器拦截时，退化为全选文本，方便手动 Ctrl+C
        selectNode(codeText);
        showToast('已选中文本，请按 Ctrl+C 复制');
      });
    });

    var card = sectionCard('改枪码', gun.codeFile ? '来源：' + gun.codeFile : '');
    var block = make('div', 'code-block');
    var codeText = make('pre', 'code-text', gun.code || '（这个文件夹里的改枪码 txt 是空的）');
    block.appendChild(codeText);
    block.appendChild(copyBtn);
    card.appendChild(block);
    return card;
  }

  function selectNode(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function buildOverviewCard(gun) {
    var card = sectionCard('方案概览', gun.imageFile ? '点击图片可放大' : '');
    if (!gun.image) {
      var miss = make('p', 'card-sub', '这个枪械文件夹里没有找到图片，放一张概览图后重新运行构建脚本即可。');
      card.appendChild(miss);
      return card;
    }
    var button = make('button', 'overview');
    button.type = 'button';
    button.title = '点击放大';
    var img = document.createElement('img');
    img.src = gun.image;
    img.alt = gun.name + ' 改枪方案概览图';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', function () {
      img.remove();
      button.remove();
      card.appendChild(make('p', 'card-sub', '图片加载失败：' + gun.image));
    });
    button.appendChild(img);
    button.addEventListener('click', function () { openLightbox(gun.image, img.alt); });
    card.appendChild(button);
    return card;
  }

  function buildChartCard(gun) {
    var card = sectionCard('属性数据', gun.statsFile ? '来源：' + gun.statsFile : '');
    if (!gun.stats || !gun.stats.length) {
      card.appendChild(make('p', 'card-sub', '这个枪械的数据 txt 里没有解析出「名称: 数值」格式的行。'));
      return card;
    }

    var chart = make('div', 'chart');
    var rows = [];

    gun.stats.forEach(function (s) {
      var row = make('div', 'chart-row' + (s.inverse ? ' inverse' : ''));
      row.appendChild(make('div', 'chart-label', s.key));

      var track = make('div', 'chart-track');
      var fill = make('div', 'chart-fill');
      fill.title = s.key + '：' + s.display;
      track.appendChild(fill);
      row.appendChild(track);

      var value = make('div', 'chart-value', s.display);
      if (s.scale === 'relative' && s.percentOfMax !== undefined) {
        value.appendChild(make('small', null, s.percentOfMax + '%'));
      }
      row.appendChild(value);

      chart.appendChild(row);
      rows.push({ fill: fill, bar: s.bar });
    });

    card.appendChild(chart);

    var legend = make('p', 'card-sub');
    legend.style.marginTop = '12px';
    legend.textContent = '横条长度：0–100 的评分项直接按百分制显示，价格 / 射程 / 时间这类绝对数值按全部方案中的最大值折算（括号内为占最大值比例）；蓝色条目表示越低越好。';
    card.appendChild(legend);

    // 入场动画：先渲染 0 宽度，下一帧再撑开
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        rows.forEach(function (r) { r.fill.style.width = r.bar + '%'; });
      });
    });

    return card;
  }

  function renderGun(gun) {
    activeId = gun.id;
    clear(el.detail);

    var head = make('div', 'detail-head');
    var row = make('div', 'detail-title-row');
    row.appendChild(make('h1', 'detail-title', gun.name));
    row.appendChild(make('span', 'badge', gun.category));
    row.appendChild(make('span', 'badge', gun.stats.length + ' 项属性'));
    head.appendChild(row);
    head.appendChild(make('p', 'detail-path', 'save/' + gun.category + '/' + gun.name + '/'));
    el.detail.appendChild(head);

    el.detail.appendChild(buildCodeCard(gun));
    el.detail.appendChild(buildOverviewCard(gun));
    el.detail.appendChild(buildChartCard(gun));

    document.title = gun.name + ' · 改枪码 · 三角洲行动';
  }

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

  /* ------------------------------------------------------------ 路由 */

  function selectFromHash() {
    var hash = location.hash.replace(/^#\/?/, '');
    if (!hash) return false;
    var parts = hash.split('/').filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    if (parts.length < 2) return false;
    var id = parts[0] + '/' + parts.slice(1).join('/');
    var gun = gunsById[id];
    if (!gun) return false;
    if (gun.id === activeId) return true; // 同一把枪不重复渲染
    renderGun(gun);
    renderNav(el.searchInput.value);
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function selectDefault() {
    if (!allGuns.length) { renderEmptyState(); return; }
    var first = allGuns[0];
    location.replace('#/' + encodeURIComponent(first.category) + '/' + encodeURIComponent(first.name));
    if (!selectFromHash()) {
      renderGun(first);
      renderNav('');
    }
  }

  window.addEventListener('hashchange', function () {
    if (!selectFromHash()) {
      if (allGuns.length) selectDefault();
    }
  });

  /* ------------------------------------------------------------ 搜索 */

  el.searchInput.addEventListener('input', function () {
    el.searchClear.hidden = !el.searchInput.value;
    renderNav(el.searchInput.value);
  });

  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var keyword = el.searchInput.value.trim().toLowerCase();
    if (!keyword) return;
    var hit = allGuns.find(function (g) { return g.name.toLowerCase().indexOf(keyword) !== -1; });
    if (hit) location.hash = '#/' + encodeURIComponent(hit.category) + '/' + encodeURIComponent(hit.name);
  });

  el.searchClear.addEventListener('click', function () {
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    renderNav('');
    el.searchInput.focus();
  });

  // 斜杠聚焦搜索框
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== el.searchInput) {
      e.preventDefault();
      el.searchInput.focus();
    }
  });

  el.collapseAll.addEventListener('click', function () {
    var cats = (DATA && DATA.categories) || [];
    var allCollapsed = cats.length > 0 && cats.every(function (c) { return collapsed[c.name] === true; });
    collapsed = {};
    if (!allCollapsed) {
      cats.forEach(function (c) { collapsed[c.name] = true; });
    }
    el.collapseAll.textContent = allCollapsed ? '全部折叠' : '全部展开';
    saveCollapsed();
    renderNav(el.searchInput.value);
  });

  /* ------------------------------------------------------------ 启动 */

  function boot() {
    if (!DATA || !allGuns.length) {
      el.brandMeta.textContent = '暂无数据';
      renderNav('');
      renderNoDataBanner();
      renderEmptyState();
      return;
    }

    var statKinds = {};
    allGuns.forEach(function (g) {
      g.stats.forEach(function (s) { statKinds[s.key] = true; });
    });

    el.brandMeta.textContent = (DATA.categories.length + ' 个分类 · ' + allGuns.length + ' 把枪械');
    el.footerMeta.textContent = '数据更新：' + formatTime(DATA.generatedAt) + ' · 属性项 ' + Object.keys(statKinds).length + ' 种';
    document.title = '三角洲行动 · 改枪码展示';

    if (!selectFromHash()) selectDefault();
  }

  boot();
})();
