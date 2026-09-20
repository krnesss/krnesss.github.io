#!/usr/bin/env node
/**
 * 三角洲行动 · 改枪码展示站 —— 数据构建脚本
 * ------------------------------------------------------------------
 * 作用：扫描 save/ 目录，把「分类 / 枪械 / 方案编号」三层结构里的
 *       概览图 + 改枪码 + 各项数据 + 方案简介 解析成前端直接读取的数据：
 *         data/guns.js    -> window.__GUN_DATA__ = {...}   （页面用 <script> 引入，file:// 也能用）
 *         data/guns.json  -> 同样的内容，纯 JSON，方便别的工具用
 *
 * 目录约定（同一把枪可以有多套方案，用数字文件夹编号）：
 *   save/
 *     AR/                         ← 一级目录 = 分类（缩写，页面上显示中文全称）
 *       M4A1/                     ← 二级目录 = 枪名（页面上显示文件夹名）
 *         1/                      ← 三级目录 = 第几套方案（数字，可随意增加）
 *           overview.png          ← 概览图（png/jpg/webp/gif/svg 都行，文件名随便取）
 *           code.txt              ← 改枪码
 *           stats.txt             ← 各项数据，每行「名称: 数值」，其中「价格」会单独展示
 *           feat.txt              ← 方案简介（简短一句话，显示在枪名下面和方案标签上）
 *         2/
 *           ...
 *     SMG/
 *       Vector/1/...
 *
 * 兼容性：
 *   1. 老结构（图片和 txt 直接放在枪名文件夹下，没有数字子目录）依然可用，会被当成「方案 1」。
 *   2. txt 的角色优先看文件名（含「码/code」→ 改枪码；含「数据/属性/数值/stats/data」→ 数据；
 *      含「feat/介绍/说明/备注/desc/note」→ 简介）；文件名看不出时按内容判断
 *      （≥60% 的行符合「名称: 数值」就当作数据文件）；仍无法判断时按文件名的自然顺序
 *      取第一个为改枪码、第二个为数据。
 *   3. 数据行支持：`后坐力控制: 78`、`射程：45 m`、`伤害: 35-40`、`价格 = 250000 币`；
 *      行首是 `/` `;` `,` `*` `·` 的行会被当作注释忽略。
 *   4. 路径全部使用 ASCII 字符，脚本会在最后检查并提示。
 *
 * 用法： node tools/build-data.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAVE_DIR = path.join(ROOT, 'save');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_JS = path.join(DATA_DIR, 'guns.js');
const OUT_JSON = path.join(DATA_DIR, 'guns.json');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.bmp']);
const TXT_EXT = new Set(['.txt']);

/**
 * 分类显示名：一级目录名写缩写 / 中文 / 英文全称都行，页面上一律显示成中文全称。
 * 想加分类，在这里加一条映射即可；没登记的目录名会原样显示。
 */
const CATEGORY_LABELS = {
  AR: '突击步枪',
  'Assault Rifle': '突击步枪',
  突击步枪: '突击步枪',
  步枪: '突击步枪',

  SG: '霰弹枪',
  Shotgun: '霰弹枪',
  霰弹枪: '霰弹枪',

  SMG: '冲锋枪',
  'Submachine Gun': '冲锋枪',
  冲锋枪: '冲锋枪',

  DMR: '精确射手步枪',
  'Designated Marksman Rifle': '精确射手步枪',
  精确射手步枪: '精确射手步枪',
  射手步枪: '精确射手步枪',

  SR: '狙击步枪',
  'Sniper Rifle': '狙击步枪',
  狙击步枪: '狙击步枪',

  LMG: '轻机枪',
  'Light Machine Gun': '轻机枪',
  轻机枪: '轻机枪',

  HG: '手枪',
  Handgun: '手枪',
  手枪: '手枪',

  SP: '特殊',
  Special: '特殊',
  特殊: '特殊',
};

/** 分类在页面上的展示顺序（按显示名），没列到的分类排在后面 */
const CATEGORY_ORDER = [
  '突击步枪', '霰弹枪', '冲锋枪', '精确射手步枪', '狙击步枪', '轻机枪', '手枪', '特殊', '未分类',
];

/** 枪械文件夹直接放在 save/ 下（没有分类目录）时，归到这一类 */
const UNCATEGORIZED_RAW = '__uncategorized__';
const UNCATEGORIZED_LABEL = '未分类';

/** 「价格」不参与柱状图，会被单独抽取出来在改枪码下方醒目展示 */
const PRICE_KEY_RE = /^\s*(价格|总价|造价|花费)\s*$/;

/** 属性在图表里的展示顺序，txt 里没出现的会自动跳过，没列到的会排在后面 */
const STAT_ORDER = [
  '后坐力控制', '操控速度', '精准度', '稳定性', '腰射精度',
  '伤害', '射程', '枪口初速',
  '射速', '弹匣容量', '举镜时间', '重量',
];

/** 这些属性「越低越好」，图表里会换一种颜色，对比时会标出更优的一方（其余属性越高越好） */
const INVERSE_STATS = new Set([
  '举镜时间', '开镜时间', '重量', '跑射延迟', '换弹时间',
]);

const IMAGE_HINTS = /overview|preview|show|view|概览|全貌|总览|预览/i;
const CODE_NAME_RE = /改枪码|枪码|代码|code/i;
const STATS_NAME_RE = /数据|属性|数值|参数|stats?|data|attrs?/i;
const FEAT_NAME_RE = /feat|feature|介绍|简介|说明|描述|备注|desc|note/i;

// 「名称: 数值」「名称：数值 [单位]」「名称 = 数值」「名称: 35-40」「名称: 45 m」
const STAT_SEP_RE =
  /^\s*([^:：=]{1,24}?)\s*[:：=]\s*([-+]?\d+(?:\.\d+)?)\s*(?:[-~～—–－至到]\s*([-+]?\d+(?:\.\d+)?))?\s*([^\d\s]{0,6})?\s*$/;
// 退路：「名称 数值 [单位]」
const STAT_SPACE_RE =
  /^\s*([^\d:：=]{1,24}?)\s+([-+]?\d+(?:\.\d+)?)\s*(?:[-~～—–－至到]\s*([-+]?\d+(?:\.\d+)?))?\s*([^\d\s]{0,6})?\s*$/;

const warnings = [];

function warn(msg) {
  warnings.push(msg);
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function naturalCompare(a, b) {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/** 把磁盘相对路径转成可直接放进 src / href 的 URL（逐段编码，稳妥起见仍然保留） */
function toUrl(...segments) {
  return segments
    .map((seg) => String(seg).split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/'))
    .filter(Boolean)
    .join('/');
}

function isComment(line) {
  return /^[#/;,*·]/.test(line);
}

/** 去掉 BOM、去掉注释行、去掉首尾空白 */
function cleanLines(text) {
  return String(text)
    .replace(/\uFEFF/g, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !isComment(s));
}

/** 解析一行数据，失败返回 null */
function parseStatLine(raw) {
  const line = String(raw).replace(/\uFEFF/g, '').trim();
  if (!line || isComment(line)) return null;

  const m = line.match(STAT_SEP_RE) || line.match(STAT_SPACE_RE);
  if (!m) return null;

  const key = m[1].trim().replace(/\s+/g, ' ');
  if (!key || /^[-+]?\d/.test(key)) return null;

  const first = Number(m[2]);
  if (!Number.isFinite(first)) return null;

  const second = m[3] !== undefined ? Number(m[3]) : null;
  const hasRange = second !== null && Number.isFinite(second);
  const value = hasRange ? (first + second) / 2 : first;
  const unit = (m[4] || '').trim();

  const numText = hasRange ? `${m[2]}-${m[3]}` : String(m[2]);
  return {
    key,
    value,
    unit,
    display: unit ? `${numText} ${unit}` : numText,
  };
}

function classifyTxt(fileName, text) {
  const base = path.basename(fileName, path.extname(fileName));

  const featByName = FEAT_NAME_RE.test(base);
  const statsByName = !featByName && STATS_NAME_RE.test(base);
  const codeByName = !featByName && !statsByName && CODE_NAME_RE.test(base);
  if (featByName) return 'feat';
  if (codeByName) return 'code';
  if (statsByName) return 'stats';

  const lines = cleanLines(text);
  if (!lines.length) return null;

  const hits = lines.filter((l) => parseStatLine(l)).length;
  if (hits / lines.length >= 0.6) return 'stats';
  return 'code';
}

/** 一个方案文件夹里应该至少有图片或 txt */
function looksLikeBuildDir(dir) {
  return readdirSafe(dir).some((e) => {
    if (!e.isFile() || e.name.startsWith('.')) return false;
    const ext = path.extname(e.name).toLowerCase();
    return IMAGE_EXT.has(ext) || TXT_EXT.has(ext);
  });
}

function pickImage(dir, files) {
  const images = files.filter((f) => IMAGE_EXT.has(path.extname(f.name).toLowerCase()));
  if (!images.length) return null;
  const hinted = images.find((f) => IMAGE_HINTS.test(path.basename(f.name, path.extname(f.name))));
  const chosen = hinted || [...images].sort((a, b) => naturalCompare(a.name, b.name))[0];
  if (images.length > 1) {
    warn(`「${path.relative(ROOT, dir)}」有 ${images.length} 张图片，已使用 ${chosen.name}`);
  }
  return chosen.name;
}

/**
 * 解析一个方案文件夹（可能是数字编号目录，也可能是老结构的枪名目录）
 * @returns 方案对象
 */
function buildScheme(categoryLabel, categoryDirName, gunName, index, dirName, dir) {
  const files = readdirSafe(dir).filter((e) => e.isFile() && !e.name.startsWith('.'));
  const relDir = path.relative(ROOT, dir).split(path.sep);
  const where = path.relative(ROOT, dir);

  const readText = (name) => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (err) {
      warn(`读取 ${where}/${name} 失败：${err.message}`);
      return '';
    }
  };

  // ── 1. 概览图 ─────────────────────────────────────────────
  const imageFile = pickImage(dir, files);
  if (!imageFile) warn(`「${where}」没有找到概览图片`);

  // ── 2. 方案简介（可选的第三个 txt）────────────────────────
  const txts = files
    .filter((f) => TXT_EXT.has(path.extname(f.name).toLowerCase()))
    .map((f) => f.name)
    .sort(naturalCompare);

  const roles = new Map(); // 文件名 -> code | stats | feat
  for (const n of txts) roles.set(n, classifyTxt(n, readText(n)));

  const pickByName = (role, nameRe) => txts.find((n) => roles.get(n) === role && nameRe.test(n));

  const featFile = pickByName('feat', FEAT_NAME_RE) || txts.find((n) => roles.get(n) === 'feat');
  let codeFile = pickByName('code', CODE_NAME_RE);
  let statsFile = pickByName('stats', STATS_NAME_RE);

  const others = txts.filter((n) => n !== featFile);
  if (codeFile === statsFile) codeFile = undefined;
  if (!codeFile || !statsFile) {
    for (const n of others) {
      if (n === codeFile || n === statsFile) continue;
      const role = roles.get(n);
      if (role === 'stats' && !statsFile) statsFile = n;
      else if (role === 'code' && !codeFile) codeFile = n;
    }
  }
  // 兜底：按「第一个是改枪码、第二个是数据」的顺序补位
  if (!codeFile) codeFile = others.find((n) => n !== statsFile);
  if (!statsFile) statsFile = others.find((n) => n !== codeFile);
  if (codeFile === statsFile) statsFile = undefined;

  const feat = featFile ? cleanLines(readText(featFile)).join('\n') : '';
  const featShort = feat.split('\n')[0] || '';
  if (!feat) warn(`「${where}」没有 feat.txt 或内容为空（页面上方案标签会没有简介）`);

  // ── 3. 改枪码 ─────────────────────────────────────────────
  const code = codeFile ? cleanLines(readText(codeFile)).join('\n') : '';
  if (!code) warn(`「${where}」改枪码为空`);

  // ── 4. 属性数据 + 价格 ────────────────────────────────────
  const stats = [];
  let price = null;
  const seen = new Set();
  if (statsFile) {
    for (const line of cleanLines(readText(statsFile))) {
      const parsed = parseStatLine(line);
      if (!parsed || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      if (PRICE_KEY_RE.test(parsed.key)) {
        price = { key: parsed.key, value: parsed.value, unit: parsed.unit, display: parsed.display };
      } else {
        stats.push(parsed);
      }
    }
    const junk = cleanLines(readText(statsFile)).filter((s) => !parseStatLine(s));
    if (junk.length) warn(`「${where}/${statsFile}」有 ${junk.length} 行无法解析，已忽略`);
  }
  if (!stats.length && !price) warn(`「${where}」没有解析出任何属性数据`);

  return {
    id: `${categoryLabel}/${gunName}/${index}`,
    index,
    dirName,
    label: `方案 ${index}`,
    gunName,
    category: categoryLabel,
    dir: relDir.join('/'),
    feat,
    featShort,
    featFile: featFile || null,
    image: imageFile ? toUrl(...relDir, imageFile) : null,
    imageFile,
    code,
    codeFile: codeFile || null,
    statsFile: statsFile || null,
    price,
    stats,
  };
}

/** 解析一把枪（收集它的所有方案） */
function buildGun(categoryLabel, categoryDirName, gunName, dir) {
  const subdirs = readdirSafe(dir).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const schemeDirs = subdirs.filter((k) => looksLikeBuildDir(path.join(dir, k.name)));

  // 数字文件夹排在前面，按数字大小排；非数字的按名称排
  const ordered = schemeDirs
    .map((k) => ({
      name: k.name,
      numeric: /^\d+$/.test(k.name) ? Number(k.name) : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.numeric - b.numeric || naturalCompare(a.name, b.name));

  const schemes = ordered.length
    ? ordered.map((k, i) =>
        buildScheme(categoryLabel, categoryDirName, gunName, /^\d+$/.test(k.name) ? k.numeric : i + 1, k.name, path.join(dir, k.name)),
      )
    : [];

  // 老结构兜底：图片和 txt 直接放在枪名文件夹下
  if (!schemes.length && looksLikeBuildDir(dir)) {
    warn(`「${path.relative(ROOT, dir)}」是老结构（没有数字方案子目录），已当作「方案 1」处理`);
    schemes.push(buildScheme(categoryLabel, categoryDirName, gunName, 1, '', dir));
  }

  if (subdirs.length && !schemeDirs.length) {
    warn(`「${path.relative(ROOT, dir)}」下的子文件夹里没有图片也没有 txt，请检查方案目录结构`);
  }
  if (!schemes.length) {
    warn(`「${path.relative(ROOT, dir)}」里没有任何方案（既没有数字子目录，也没有图片/txt）`);
  }

  return {
    id: `${categoryLabel}/${gunName}`,
    name: gunName,
    category: categoryLabel,
    categoryDir: categoryDirName,
    dir: path.relative(ROOT, dir).split(path.sep).join('/'),
    schemeCount: schemes.length,
    schemes,
  };
}

/** 扫描 save/，返回 [{ name, dirName, guns: [...] }] */
function collectCategories() {
  const entries = readdirSafe(SAVE_DIR).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const buckets = new Map();

  const push = (category, gunDirs) => {
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(...gunDirs);
  };

  const looksLikeGunDir = (dir) => {
    const subs = readdirSafe(dir).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    return subs.some((k) => looksLikeBuildDir(path.join(dir, k.name))) || looksLikeBuildDir(dir);
  };

  for (const entry of entries) {
    const abs = path.join(SAVE_DIR, entry.name);
    const subdirs = readdirSafe(abs).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    const gunSubdirs = subdirs.filter((k) => looksLikeGunDir(path.join(abs, k.name)));

    if (gunSubdirs.length) {
      push(entry.name, gunSubdirs.map((k) => ({ name: k.name, dir: path.join(abs, k.name) })));
      const skipped = subdirs.filter((k) => !gunSubdirs.includes(k));
      if (skipped.length) {
        warn(`分类「${entry.name}」下有 ${skipped.length} 个子文件夹没有可用数据，已跳过：${skipped.map((s) => s.name).join('、')}`);
      }
    } else if (looksLikeGunDir(abs)) {
      // 平铺写法：save/M4A1/…
      push(UNCATEGORIZED_RAW, [{ name: entry.name, dir: abs }]);
    } else {
      warn(`「save/${entry.name}」既不是枪械分类也不是枪械文件夹，已跳过`);
    }
  }

  const catIndex = (name) => {
    const i = CATEGORY_ORDER.indexOf(name);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };

  const usedLabels = new Map();

  return [...buckets.entries()]
    .map(([rawName, gunDirs]) => {
      const isFlat = rawName === UNCATEGORIZED_RAW;
      const name = isFlat ? UNCATEGORIZED_LABEL : CATEGORY_LABELS[rawName] || rawName;

      if (usedLabels.has(name) && usedLabels.get(name) !== rawName) {
        warn(`目录「${usedLabels.get(name)}」和「${rawName}」都显示为「${name}」，两边的枪械会合并到同一个分类下`);
      }
      usedLabels.set(name, rawName);

      const guns = gunDirs
        .map((g) => buildGun(name, isFlat ? '' : rawName, g.name, g.dir))
        .sort((a, b) => naturalCompare(a.name, b.name));
      return { name, dirName: isFlat ? null : rawName, guns };
    })
    .sort((a, b) => catIndex(a.name) - catIndex(b.name) || naturalCompare(a.name, b.name));
}

/** 目标：仓库里的路径全部使用 ASCII 字符，发现非 ASCII 路径时提示（不阻断构建） */
function findNonAsciiPaths() {
  const bad = [];
  const walk = (dir) => {
    for (const entry of readdirSafe(dir)) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (/[^\x20-\x7E]/.test(entry.name)) bad.push(path.relative(ROOT, abs).split(path.sep).join('/'));
      if (entry.isDirectory()) walk(abs);
    }
  };
  if (fs.existsSync(SAVE_DIR)) walk(SAVE_DIR);
  return bad;
}

/**
 * 统一柱状图的长度。规则（按属性名跨全部方案统一决定，保证同一属性可比）：
 *   · 最大值 > 100        -> 按全局最大值折算（枪口初速、射程这类绝对数值）
 *   · 最大值 <= 5         -> 按全局最大值折算（重量 3.8 这类小数量级）
 *   · 其余（0-100 的分数）-> 直接用数值当长度，即百分制
 */
function attachBars(categories) {
  const allSchemes = categories.flatMap((c) => c.guns.flatMap((g) => g.schemes));
  const maxByKey = new Map();

  for (const scheme of allSchemes) {
    for (const s of scheme.stats) {
      const cur = maxByKey.get(s.key);
      if (cur === undefined || s.value > cur) maxByKey.set(s.key, s.value);
    }
  }

  for (const scheme of allSchemes) {
    for (const s of scheme.stats) {
      const max = maxByKey.get(s.key) || 0;
      const relative = max > 100 || max <= 5;
      const pct = relative ? (max > 0 ? (s.value / max) * 100 : 0) : s.value;
      s.inverse = INVERSE_STATS.has(s.key);
      s.scale = relative ? 'relative' : 'percent';
      s.bar = Math.max(2, Math.min(100, Math.round(pct * 10) / 10));
      s.percentOfMax = max > 0 ? Math.round((s.value / max) * 1000) / 10 : 0;
      s.max = max;
    }
    const orderIndex = (k) => {
      const i = STAT_ORDER.indexOf(k);
      return i === -1 ? STAT_ORDER.length : i;
    };
    scheme.stats.sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
  }
}

function main() {
  const saveExists = fs.existsSync(SAVE_DIR);
  const categories = saveExists ? collectCategories() : [];
  attachBars(categories);

  const guns = categories.flatMap((c) => c.guns);
  const schemes = guns.flatMap((g) => g.schemes);
  const statKeys = new Set(schemes.flatMap((s) => s.stats.map((x) => x.key)));

  const body = {
    sourceDir: 'save',
    gunCount: guns.length,
    schemeCount: schemes.length,
    priceKey: '价格',
    inverseStats: [...INVERSE_STATS],
    statOrder: STAT_ORDER,
    categories,
  };

  // 只有当内容真的变了才刷新时间戳，这样重复构建不会产生无意义的文件变动
  const comparable = (o) => JSON.stringify([o.gunCount, o.schemeCount, o.categories]);
  let generatedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    if (prev && prev.generatedAt && comparable(prev) === comparable(body)) {
      generatedAt = prev.generatedAt;
    }
  } catch {
    /* 首次生成或旧文件损坏，直接用当前时间 */
  }

  const payload = { generatedAt, ...body };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_JS,
    `/* 由 tools/build-data.mjs 自动生成，请勿手动修改 */\nwindow.__GUN_DATA__ = ${JSON.stringify(payload, null, 2)};\n`,
    'utf8',
  );
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`✔ 已生成 ${path.relative(ROOT, OUT_JS)} 和 ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`  分类 ${categories.length} 个 · 枪械 ${guns.length} 把 · 方案 ${schemes.length} 套 · 属性项 ${statKeys.size} 种`);
  for (const c of categories) {
    const detail = c.guns
      .map((g) => `${g.name}(${g.schemes.map((s) => s.index).join('/') || '无方案'})`)
      .join('、');
    console.log(`  ├─ ${c.name}（${c.guns.length} 把）：${detail || '空'}`);
  }

  if (!saveExists) {
    console.warn('⚠ 没有找到 save/ 目录，先按 README 建好目录再重新运行本脚本。');
  }

  const nonAscii = findNonAsciiPaths();
  if (nonAscii.length) {
    console.warn(`\n⚠ save/ 下有 ${nonAscii.length} 个路径包含非 ASCII 字符（建议改成英文）：`);
    for (const p of nonAscii.slice(0, 20)) console.warn(`  · ${p}`);
    if (nonAscii.length > 20) console.warn(`  · …另有 ${nonAscii.length - 20} 个`);
  } else if (saveExists) {
    console.log('  ✓ save/ 下所有路径都是 ASCII 字符');
  }

  if (warnings.length) {
    console.warn(`\n⚠ ${warnings.length} 条提示：`);
    for (const w of warnings) console.warn(`  · ${w}`);
  }
}

main();
