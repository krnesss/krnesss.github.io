#!/usr/bin/env node
/**
 * 冒烟测试：用最小 DOM 桩在 Node 里真实跑一遍 assets/app.js，
 * 检查首屏渲染、路由、搜索、图表行数、复制按钮、折叠按钮是否正常。
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
  'brandMeta', 'footerMeta', 'banner', 'gunNav', 'navEmpty', 'collapseAll', 'detail',
  'searchInput', 'searchClear', 'lightbox', 'lightboxImg', 'toast',
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
sandbox.window.addEventListener = (type, fn) => {
  (sandbox._listeners = sandbox._listeners || {});
  (sandbox._listeners[type] = sandbox._listeners[type] || []).push(fn);
};
sandbox.window.scrollTo = () => {};
sandbox.window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
sandbox.window._listeners = {};
sandbox.window.isSecureContext = true;

/* ------------------------------------------------------------ 断言 ---- */

let passed = 0;
const failures = [];

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

function flushRaf() {
  const queued = rafQueue.splice(0, rafQueue.length);
  queued.forEach((fn) => fn());
  if (rafQueue.length) flushRaf();
}
function flushHashChange() {
  while (pendingHash > 0) {
    pendingHash -= 1;
    (sandbox.window._listeners.hashchange || []).forEach((fn) => fn({ type: 'hashchange' }));
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* -------------------------------------------------------------- 运行 ---- */

const context = vm.createContext(sandbox);

for (const file of ['data/guns.js', 'assets/app.js']) {
  const full = path.join(ROOT, file);
  const code = fs.readFileSync(full, 'utf8');
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

console.log('\n【首屏渲染】');
check('没有抛异常，页面完成初始化', detail.children.length > 0);
check('顶栏显示分类与枪械数量', /分类/.test(el('brandMeta').textContent), el('brandMeta').textContent);
check('默认选中第一把枪（AK-12）', one(detail, 'detail-title').textContent === 'AK-12', one(detail, 'detail-title').textContent);
check('分类显示为缩写（AR，而不是目录名）', collect(detail, 'badge')[0].textContent === 'AR', collect(detail, 'badge')[0].textContent);
check('详情页路径显示真实目录 save/AR/AK-12/', one(detail, 'detail-path').textContent === 'save/AR/AK-12/',
  one(detail, 'detail-path').textContent);
check('详情页写入 URL 锚点', /^#\//.test(location.hash), location.hash);

console.log('\n【侧边栏】');
check('渲染出 2 个分类分组', collect(el('gunNav'), 'nav-group').length === 2);
check('渲染出 3 个枪械按钮', collect(el('gunNav'), 'nav-item').length === 3);
check('分类计数显示正确', collect(el('gunNav'), 'nav-count').map((n) => n.textContent).join(',') === '2,1',
  collect(el('gunNav'), 'nav-count').map((n) => n.textContent).join(','));
check('当前枪械被标记为 active', collect(el('gunNav'), 'nav-item').some((b) => b.classList.contains('active')));

console.log('\n【改枪码】');
check('改枪码内容正确', one(detail, 'code-text').textContent === 'AK-12-近战型-3C7D-51E9-A20B-88F6',
  one(detail, 'code-text').textContent);
check('存在复制按钮', !!one(detail, 'btn'));

console.log('\n【概览图】');
const img = one(detail, 'overview').children[0];
check('图片指向 save/ 下的概览图', /^save\/.*%E6%A6%82%E8%A7%88%E5%9B%BE\.svg$/.test(img.src), img.src);

console.log('\n【属性柱状图】');
const fills = collect(detail, 'chart-fill');
check('txt 里的 11 项属性各有一根柱子', fills.length === 11, '实际 ' + fills.length);
check('柱子带 data 提示', fills.every((f) => f.title && f.title.includes('：')));
flushRaf();
check('柱状图按数值撑开宽度', fills.every((f) => /%$/.test(f.style.width)), JSON.stringify(fills.map((f) => f.style.width)));
const inverseRows = collect(detail, 'chart-row').filter((r) => r.classList.contains('inverse'));
check('越低越好的属性被标成蓝色（举镜时间/换弹时间）', inverseRows.length === 2, '实际 ' + inverseRows.length);
check('区间值取中值并原样显示（伤害 38-42）',
  collect(detail, 'chart-value').some((v) => v.textContent.startsWith('38-42')),
  collect(detail, 'chart-value').map((v) => v.textContent).join(' | '));

console.log('\n【复制按钮】');
one(detail, 'btn').dispatch('click');
await tick();
check('点击后提示已复制', el('toast').hidden === false && one(detail, 'btn').textContent.includes('已复制'));

console.log('\n【路由切换】');
location.hash = '#/' + encodeURIComponent('SMG') + '/' + encodeURIComponent('Vector');
flushHashChange();
check('切换到 Vector 后重新渲染', one(detail, 'detail-title').textContent === 'Vector', one(detail, 'detail-title').textContent);
check('Vector 的 11 项属性渲染完成', collect(detail, 'chart-fill').length === 11);
check('Vector 的改枪码正确', one(detail, 'code-text').textContent === 'Vector-冲锋型-91B4-6D0F-2E77-C53A');
check('分类徽章随枪械变化（显示为分类缩写 SMG）', collect(detail, 'badge')[0].textContent === 'SMG',
  collect(detail, 'badge')[0].textContent);

location.hash = '#/不存在的分类/不存在的枪';
flushHashChange();
check('非法锚点回退到默认枪械而不是白屏', ['AK-12', 'Vector'].includes(one(detail, 'detail-title').textContent));

console.log('\n【搜索】');
el('searchInput').value = 'vector';
el('searchInput').dispatch('input');
check('搜索后只剩 1 个结果', collect(el('gunNav'), 'nav-item').length === 1);
check('搜索框出现清空按钮', el('searchClear').hidden === false);
el('searchClear').dispatch('click');
check('清空搜索后恢复 3 个结果', collect(el('gunNav'), 'nav-item').length === 3);

console.log('\n【折叠按钮】');
el('collapseAll').dispatch('click');
check('第一次点击全部折叠', collect(el('gunNav'), 'nav-group').every((g) => g.dataset.open === 'false'));
check('按钮变成「全部展开」', el('collapseAll').textContent === '全部展开', el('collapseAll').textContent);
el('collapseAll').dispatch('click');
check('第二次点击全部展开', collect(el('gunNav'), 'nav-group').every((g) => g.dataset.open === 'true'));
check('按钮变回「全部折叠」', el('collapseAll').textContent === '全部折叠', el('collapseAll').textContent);

console.log('\n【图片放大】');
one(detail, 'overview').dispatch('click');
check('点击概览图打开灯箱', el('lightbox').hidden === false && el('lightboxImg').src === img.src);
document.dispatch('keydown', { key: 'Escape' });
check('Esc 关闭灯箱', el('lightbox').hidden === true);

/* ------------------------------------------------------------ 结论 ---- */

console.log('\n' + '─'.repeat(52));
if (failures.length) {
  console.error(`✘ 冒烟测试失败：${passed} 项通过，${failures.length} 项未通过`);
  failures.forEach((f) => console.error('  · ' + f));
  process.exit(1);
}
console.log(`✔ 冒烟测试全部通过（${passed} 项）`);
