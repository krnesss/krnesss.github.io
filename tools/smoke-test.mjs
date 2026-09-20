#!/usr/bin/env node
/**
 * 冒烟测试：用最小 DOM 桩在 Node 里真实跑一遍 assets/app.js，
 * 检查首屏渲染、三级侧边栏展开、方案切换、价格展示、复制、对比功能、
 * 搜索、折叠、灯箱，以及「页面不暴露内部信息」「路径全 ASCII」等约束。
 *
 * 用法： node tools/smoke-test.mjs   （不依赖任何第三方库，也不开浏览器）
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------------------------------- 极简 DOM 桩 ---- */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    const self = this;
    this.classList = {
      add(c) { if (!self.classes().includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove(c) { self.className = self.classes().filter((x) => x !== c).join(' '); },
      contains(c) { return self.classes().includes(c); },
    };
  }
  classes() { return String(this.className).split(/\s+/).filter(Boolean); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() { this.focused = true; }
  blur() { this.focused = false; }
  select() { this.selected = true; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, ev) {
    const event = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, ev);
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
}

const IDS = [
  'brandMeta', 'footerMeta', 'banner', 'gunNav', 'navEmpty', 'collapseAll',
  'content', 'detail', 'searchInput', 'searchClear', 'lightbox', 'lightboxImg', 'toast',
  'compareTray', 'trayChips', 'trayCount', 'trayCompare', 'trayClear',
];

const document = {
  title: '',
  activeElement: null,
  listeners: {},
  _byId: {},
  getElementById(id) { return (this._byId[id] = this._byId[id] || new El('div')); },
  createElement(tag) { return new El(tag); },
  createRange() { return { selectNodeContents() {} }; },
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  dispatch(type, ev) {
    const event = Object.assign({ type, preventDefault() {} }, ev);
    (this.listeners[type] || []).forEach((fn) => fn(event));
  },
  execCommand() { return false; },
};
for (const id of IDS) document._byId[id] = new El('div');
document.body = new El('body');

let pendingHash = 0;
let hashValue = '';
const location = {
  get hash() { return hashValue; },
  set hash(v) { hashValue = String(v); pendingHash += 1; },
  replace(u) { location.hash = u; },
};

const rafQueue = [];
const sandbox = {
  console,
  document,
  location,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  isSecureContext: true,
};
sandbox.window = sandbox;
sandbox.window._listeners = {};
sandbox.window.addEventListener = (type, fn) => {
  (sandbox._listeners[type] = sandbox._listeners[type] || []).push(fn);
};
sandbox.window.scrollTo = () => {};
sandbox.window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });

/* ------------------------------------------------------------ 断言 ---- */

let passed = 0;
const failures = [];

function section(title) { console.log('\n【' + title + '】'); }

function check(name, cond, extra) {
  if (cond) { passed += 1; console.log('  ✔ ' + name); }
  else { failures.push(name + (extra ? '  →  ' + extra : '')); console.log('  ✘ ' + name + (extra ? '  →  ' + extra : '')); }
}

function walk(node, fn) {
  fn(node);
  (node.children || []).forEach((c) => walk(c, fn));
}
function collect(root, cls) {
  const out = [];
  walk(root, (n) => { if (String(n.className || '').split(/\s+/).includes(cls)) out.push(n); });
  return out;
}
function one(root, cls) { return collect(root, cls)[0]; }
function textOf(root) { return root.textContent; }

function flushRaf() {
  const queued = rafQueue.splice(0, rafQueue.length);
  queued.forEach((fn) => fn());
  if (rafQueue.length) flushRaf();
}
function flushHashChange() {
  while (pendingHash > 0) {
    pendingHash -= 1;
    (sandbox._listeners.hashchange || []).forEach((fn) => fn({ type: 'hashchange' }));
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* -------------------------------------------------------------- 运行 ---- */

const context = vm.createContext(sandbox);

for (const file of ['data/guns.js', 'assets/app.js']) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  try {
    vm.runInContext(code, context, { filename: file });
  } catch (err) {
    console.error(`\n加载 ${file} 时抛异常：`);
    console.error(err);
    process.exit(1);
  }
}

const el = (id) => document._byId[id];
const detail = el('detail');
const nav = el('gunNav');
const DATA = sandbox.__GUN_DATA__;
const GUNS = DATA.categories.flatMap((c) => c.guns);
const SCHEMES = GUNS.flatMap((g) => g.schemes);

/* ---------------------------------------------------------- 首屏渲染 ---- */

section('首屏渲染');
check('没有抛异常，页面完成初始化', detail.children.length > 0);
check('默认打开第一套方案（AK-12 方案 1）',
  one(detail, 'detail-title').textContent === 'AK-12', one(detail, 'detail-title').textContent);
check('分类显示中文全称（不是 AR 缩写）',
  collect(detail, 'badge')[0].textContent === '突击步枪', collect(detail, 'badge')[0].textContent);
check('顶栏统计枪械数与方案数', /3 把枪械/.test(el('brandMeta').textContent) && /4 套方案/.test(el('brandMeta').textContent),
  el('brandMeta').textContent);
check('写入 URL 锚点', /^#\//.test(location.hash), location.hash);

/* ------------------------------------------------------------ 改枪码 ---- */

section('改枪码与价格');
check('改枪码内容正确（注释行被忽略）',
  one(detail, 'code-text').textContent === 'AK-12-3C7D-51E9-A20B-88F6', one(detail, 'code-text').textContent);
check('价格在改枪码下方单独展示', !!one(detail, 'price-strip'));
check('价格数值带千分位', one(detail, 'price-number').textContent === '198,000', one(detail, 'price-number').textContent);
check('价格单位显示', one(detail, 'price-unit').textContent === '币', one(detail, 'price-unit').textContent);
check('价格没有被画进柱状图',
  collect(detail, 'chart-label').every((n) => n.textContent !== '价格'),
  collect(detail, 'chart-label').map((n) => n.textContent).join(','));
check('柱状图行数 = 属性数（10 项，不含价格）',
  collect(detail, 'chart-fill').length === 10, '实际 ' + collect(detail, 'chart-fill').length);
flushRaf();
check('柱状图按数值撑开宽度',
  collect(detail, 'chart-fill').every((f) => /%$/.test(f.style.width)));

section('方案简介');
check('枪名下方显示 feat.txt 的简介',
  one(detail, 'detail-feat').textContent.includes('高性价比稳压流'), one(detail, 'detail-feat').textContent);

section('不暴露内部信息');
const detailText = textOf(detail);
check('详情页不出现「来源：xxx.txt」', !/来源[:：]/.test(detailText));
check('详情页不出现 txt 文件名', !/\.txt/.test(detailText), detailText.match(/\S*\.txt\S*/) || '');
check('详情页不出现 save/ 目录路径', !/save\//.test(detailText), detailText.match(/\S*save\/\S*/) || '');
check('页脚不出现构建脚本/目录说明', !/tools\/|save\//.test(el('footerMeta').textContent), el('footerMeta').textContent);
check('页脚只有最后更新时间', /^最后更新：/.test(el('footerMeta').textContent), el('footerMeta').textContent);

/* ------------------------------------------------------------ 侧边栏 ---- */

section('侧边栏三级结构');
check('渲染出 2 个分类分组', collect(nav, 'nav-group').length === 2);
check('渲染出 3 个枪械行', collect(nav, 'nav-gun').length === 3);
check('渲染出 4 个方案项', collect(nav, 'nav-item').length === 4, '实际 ' + collect(nav, 'nav-item').length);
check('每个方案都有「加入对比」按钮', collect(nav, 'nav-add').length === 4);
check('当前枪械（AK-12）的方案列表是展开的',
  collect(nav, 'nav-gun').filter((b) => b.textContent.includes('AK-12') && b.dataset.open !== 'true').length === 0);
check('方案项显示简介', collect(nav, 'nav-item-feat').length === 4);

// 展开 M4A1
const m4Row = collect(nav, 'nav-gun').find((b) => b.textContent.includes('M4A1'));
m4Row.dispatch('click');
check('点击枪名可以展开该枪的方案', m4Row.dataset.open === 'true', m4Row.dataset.open);
check('展开后仍能定位到方案项', collect(m4Row.parentNode, 'nav-item').length === 2,
  '实际 ' + collect(m4Row.parentNode, 'nav-item').length);

/* -------------------------------------------------------- 方案切换 ---- */

section('同一把枪的多套方案');
check('AK-12 只有 1 套方案时不显示切换标签', !one(detail, 'scheme-tabs'));
location.hash = '#/' + ['突击步枪', 'M4A1', '1'].map(encodeURIComponent).join('/');
flushHashChange();
check('切到 M4A1 方案 1', one(detail, 'detail-title').textContent === 'M4A1', one(detail, 'detail-title').textContent);
check('M4A1 显示 2 个方案标签', collect(detail, 'scheme-tab').length === 2);
check('方案 1 标签处于选中态', collect(detail, 'scheme-tab')[0].classList.contains('active'));
check('方案 1 价格正确', one(detail, 'price-number').textContent === '245,000', one(detail, 'price-number').textContent);
check('方案 1 显示自己的简介', one(detail, 'detail-feat').textContent.includes('近战突击流'));
check('方案 1 的图片路径正确',
  one(detail, 'overview').children[0].src === 'save/AR/M4A1/1/overview.svg',
  one(detail, 'overview').children[0].src);

collect(detail, 'scheme-tab')[1].dispatch('click');
flushHashChange();
check('点标签切到方案 2', one(detail, 'detail-title').textContent === 'M4A1' && /\/2$/.test(location.hash), location.hash);
check('方案 2 的改枪码正确',
  one(detail, 'code-text').textContent === 'M4A1-2-9D4E-71AC-B3F8-60D1', one(detail, 'code-text').textContent);
check('方案 2 的价格正确', one(detail, 'price-number').textContent === '312,000', one(detail, 'price-number').textContent);
check('方案 2 的简介正确', one(detail, 'detail-feat').textContent.includes('中远距离控枪流'));

/* ------------------------------------------------------------ 对比 ---- */

section('对比功能');
check('对比栏初始是隐藏的', el('compareTray').hidden === true);

/** 按「枪名 + 方案标签」找到侧边栏里那颗「加入对比」按钮（每次 renderNav 后 DOM 会重建） */
function findAddButton(gunName, label) {
  const gunItem = collect(nav, 'nav-gun-item').find((li) => {
    const n = one(li, 'nav-gun-name');
    return n && n.textContent === gunName;
  });
  if (!gunItem) return null;
  const schemeItem = collect(gunItem, 'nav-scheme').find((li) => {
    const l = one(li, 'nav-item-label');
    return l && l.textContent === label;
  });
  return schemeItem ? collect(schemeItem, 'nav-add')[0] : null;
}

check('能定位到 M4A1 方案 1 的 + 按钮', !!findAddButton('M4A1', '方案 1'));
findAddButton('M4A1', '方案 1').dispatch('click');
findAddButton('M4A1', '方案 2').dispatch('click');
const m4Adds = collect(nav, 'nav-add').filter((b) => b.classList.contains('on'));
check('加入后对比栏出现', el('compareTray').hidden === false);
check('对比栏计数为 2', el('trayCount').textContent === '2', el('trayCount').textContent);
check('对比栏生成 2 个 chip', collect(el('trayChips'), 'chip').length === 2);
check('已加入的方案按钮变成勾选态', m4Adds.length === 2, '实际 ' + m4Adds.length);
check('「开始对比」按钮可用', el('trayCompare').disabled === false);

el('trayCompare').dispatch('click');
flushHashChange();
check('跳转到对比路由', /^#\/compare\//.test(location.hash), location.hash);
check('渲染出对比表格', !!one(detail, 'compare-table'));
check('表格有 2 列方案', collect(detail, 'cmp-col').length === 2, '实际 ' + collect(detail, 'cmp-col').length);
check('对比表头显示枪名与方案', collect(detail, 'cmp-gun').map((n) => n.textContent).join(',') === 'M4A1,M4A1',
  collect(detail, 'cmp-gun').map((n) => n.textContent).join(','));
check('对比表头显示方案简介', collect(detail, 'cmp-feat').length === 2);
check('表格含价格行', collect(detail, 'cmp-price-row').length === 1);

const priceCells = collect(one(detail, 'cmp-price-row'), 'cmp-cell');
check('价格行把更便宜的一套标成「最低」',
  priceCells[0].classList.contains('best') && !priceCells[1].classList.contains('best'),
  priceCells.map((c) => c.className + ':' + c.textContent).join(' | '));
check('价格行显示千分位价格', priceCells[0].textContent.includes('245,000'), priceCells[0].textContent);

const rows = collect(detail, 'cmp-price-row')[0].parentNode.children;
const rowByLabel = (label) => rows.find((tr) => tr.children[0] && tr.children[0].textContent.startsWith(label));
const recoil = rowByLabel('后坐力控制');
check('后坐力控制行标出更高的一方（方案 2：88）',
  recoil && !recoil.children[1].classList.contains('best') && recoil.children[2].classList.contains('best'),
  recoil ? recoil.children[1].className + ' | ' + recoil.children[2].className : '没找到该行');

const ads = rowByLabel('举镜时间');
check('举镜时间行标出更低的一方（方案 1：320ms，越低越好）',
  ads && ads.children[1].classList.contains('best') && !ads.children[2].classList.contains('best'),
  ads ? ads.children[1].className + ' | ' + ads.children[2].className : '没找到该行');
check('对比页标注了 ↓ 反向属性（举镜时间）', collect(detail, 'cmp-down').length >= 1, '实际 ' + collect(detail, 'cmp-down').length);
check('射速是正向属性，不标 ↓',
  (() => {
    const r = rowByLabel('射速');
    return !!r && !collect(r.children[0], 'cmp-down').length;
  })(),
  '没找到射速行或它被错误地标成反向');
check('对比页也能看到每套方案的价格', textOf(detail).includes('245,000') && textOf(detail).includes('312,000'));

// 移除一个 chip
collect(el('trayChips'), 'chip-x')[0].dispatch('click');
flushHashChange();
check('移除后对比栏只剩 1 套', el('trayCount').textContent === '1', el('trayCount').textContent);
check('只剩 1 套时「开始对比」被禁用', el('trayCompare').disabled === true);

el('trayClear').dispatch('click');
check('清空后对比栏隐藏', el('compareTray').hidden === true);

/* ------------------------------------------------------------ 搜索 ---- */

section('搜索');
el('searchInput').value = 'vector';
el('searchInput').dispatch('input');
check('搜索 vector 只剩 1 个枪械行', collect(nav, 'nav-gun').length === 1, '实际 ' + collect(nav, 'nav-gun').length);
check('搜索时自动展开方案', collect(nav, 'nav-item').length === 1);
el('searchInput').value = '控枪';
el('searchInput').dispatch('input');
check('按 feat 简介也能搜到方案', collect(nav, 'nav-item').length === 1, '实际 ' + collect(nav, 'nav-item').length);
el('searchClear').dispatch('click');
check('清空搜索后恢复 3 把枪', collect(nav, 'nav-gun').length === 3);

/* ------------------------------------------------------------ 折叠 ---- */

section('折叠与灯箱');
el('collapseAll').dispatch('click');
check('第一次点击全部折叠', collect(nav, 'nav-group').every((g) => g.dataset.open === 'false'));
check('按钮变成「全部展开」', el('collapseAll').textContent === '全部展开', el('collapseAll').textContent);
el('collapseAll').dispatch('click');
check('第二次点击全部展开', collect(nav, 'nav-group').every((g) => g.dataset.open === 'true'));

location.hash = '#/' + ['突击步枪', 'AK-12', '1'].map(encodeURIComponent).join('/');
flushHashChange();
one(detail, 'overview').dispatch('click');
check('点击概览图打开灯箱', el('lightbox').hidden === false);
document.dispatch('keydown', { key: 'Escape' });
check('Esc 关闭灯箱', el('lightbox').hidden === true);

/* ------------------------------------------------------- 数据约束 ---- */

section('数据与路径约束');
const ASCII = /^[\x20-\x7E]*$/;
const paths = [];
DATA.categories.forEach((c) => {
  if (c.dirName) paths.push(c.dirName);
  c.guns.forEach((g) => {
    paths.push(g.dir, g.categoryDir);
    g.schemes.forEach((s) => {
      paths.push(s.dir, s.image, s.imageFile, s.codeFile, s.statsFile, s.featFile);
    });
  });
});
check('所有文件系统路径都是 ASCII',
  paths.filter(Boolean).every((p) => ASCII.test(p)),
  paths.filter((p) => p && !ASCII.test(p)).join(' , '));
check('图片 URL 不含百分号编码',
  SCHEMES.every((s) => !s.image || !s.image.includes('%')));
check('枪械名是 ASCII',
  GUNS.every((g) => ASCII.test(g.name)), GUNS.map((g) => g.name).join(','));
check('分类显示名为中文全称',
  DATA.categories.map((c) => c.name).join(',') === '突击步枪,冲锋枪',
  DATA.categories.map((c) => c.name).join(','));
check('每套方案都有价格字段位（可为 null）',
  SCHEMES.every((s) => s.price === null || typeof s.price.value === 'number'));
check('价格字段确实来自 stats.txt 的「价格」行',
  SCHEMES.filter((s) => s.price).every((s) => /价格|总价|造价/.test(s.price.key)));
check('每个方案都有 feat 简介', SCHEMES.every((s) => s.feat && s.feat.length > 0));
check('方案编号从 1 开始且唯一',
  GUNS.every((g) => g.schemes.map((s) => s.index).join(',') === g.schemes.map((_, i) => i + 1).join(',')));

/* ------------------------------------------------------------ 结论 ---- */

console.log('\n' + '─'.repeat(56));
if (failures.length) {
  console.error(`✘ 冒烟测试失败：${passed} 项通过，${failures.length} 项未通过`);
  failures.forEach((f) => console.error('  · ' + f));
  process.exit(1);
}
console.log(`✔ 冒烟测试全部通过（${passed} 项）`);
