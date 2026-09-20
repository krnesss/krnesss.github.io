#!/usr/bin/env node
/**
 * 三角洲行动 · 改枪码展示站 —— 数据构建脚本
 * ------------------------------------------------------------------
 * 作用：扫描 save/ 目录，把每个枪械文件夹里的「概览图 + 改枪码 txt + 数据 txt」
 *       解析成前端可以直接读取的数据文件：
 *         data/guns.js    -> window.__GUN_DATA__ = {...}   （页面用 <script> 引入，file:// 也能用）
 *         data/guns.json  -> 同样的内容，纯 JSON，方便别的工具用
 *
 * 目录约定（分类用一级子目录表示）：
 *   save/
 *     AR/                   ← 一级目录 = 分类（缩写 / 中文名 / 英文全称都行，见 CATEGORY_LABELS）
 *       M4A1/
 *         overview.png      ← 概览图（png/jpg/webp/gif/svg 都行，任意文件名）
 *         改枪码.txt         ← 第一个 txt：改枪码
 *         数据.txt           ← 第二个 txt：各项数据，每行「名称: 数值」
 *     SMG/
 *       ...
 *
 * 容错说明：
 *   1. txt 的角色优先看文件名（含「码/code」→ 改枪码；含「数据/属性/数值/stats/data」→ 数据）；
 *      文件名看不出时按内容判断（≥60% 的行符合「名称: 数值」就当作数据文件）；
 *      仍无法判断时，按文件名的自然顺序取第一个为改枪码、第二个为数据。
 *   2. 数据行支持：`后坐力控制: 78`、`射程：45 m`、`伤害: 35-40`、`价格 = 250000 币`
 *      逗号/分号/斜杠开头的行会被当作注释忽略。
 *   3. 也兼容「枪械文件夹直接放在 save/ 下」的平铺写法，这类枪械会归入 OTHER。
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
 * 分类显示名：目录名可以用中文、英文全称或缩写，页面上一律显示成标准缩写。
 * 想加分类，在这里加一条映射即可；没登记的目录名会原样显示。
 */
const CATEGORY_LABELS = {
  突击步枪: 'AR',
  'Assault Rifle': 'AR',
  AR: 'AR',
  霰弹枪: 'SG',
  Shotgun: 'SG',
  SG: 'SG',
  冲锋枪: 'SMG',
  'Submachine Gun': 'SMG',
  SMG: 'SMG',
  精确射手步枪: 'DMR',
  射手步枪: 'DMR',
  'Designated Marksman Rifle': 'DMR',
  DMR: 'DMR',
  狙击步枪: 'SR',
  'Sniper Rifle': 'SR',
  SR: 'SR',
  轻机枪: 'LMG',
  'Light Machine Gun': 'LMG',
  LMG: 'LMG',
  手枪: 'HG',
  Handgun: 'HG',
  HG: 'HG',
  特殊: 'SP',
  Special: 'SP',
  SP: 'SP',
};

/** 分类在页面上的展示顺序（用显示名），没列到的分类排在后面（按名称） */
const CATEGORY_ORDER = ['AR', 'SG', 'SMG', 'DMR', 'SR', 'LMG', 'HG', 'SP', 'OTHER'];

/** 枪械文件夹直接放在 save/ 下（没有分类目录）时，归到这一类 */
const UNCATEGORIZED_RAW = '__uncategorized__';
const UNCATEGORIZED_LABEL = 'OTHER';

/** 取分类的显示名 */
function categoryLabel(rawName) {
  return CATEGORY_LABELS[rawName] || rawName;
}

/** 属性在图表里的展示顺序，txt 里没出现的会自动跳过，没列到的会排在后面 */
const STAT_ORDER = [
  '后坐力控制', '操控速度', '精准度', '稳定性', '腰射精度',
  '伤害', '射程', '枪口初速', '价格',
  '弹匣容量', '举镜时间', '换弹时间', '重量',
];

/** 这些属性「越低越好」，图表里会换一种颜色并加箭头提示 */
const INVERSE_STATS = new Set([
  '举镜时间', '开镜时间', '换弹时间', '重量', '跑射延迟',
]);

const IMAGE_HINTS = /概览|全貌|总览|预览|overview|preview|show|view/i;
const CODE_NAME_RE = /改枪码|枪码|代码|code/i;
const STATS_NAME_RE = /数据|属性|数值|参数|stats?|data|attrs?/i;

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

/** 把磁盘相对路径转成可直接放进 src / href 的 URL（逐段编码，中文与空格都安全） */
function toUrl(...segments) {
  return segments
    .map((seg) => String(seg).split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/'))
    .filter(Boolean)
    .join('/');
}

/** 解析一行数据，失败返回 null */
function parseStatLine(raw) {
  const line = String(raw).replace(/\uFEFF/g, '').trim();
  if (!line) return null;
  if (/^[#/;,*·]/.test(line)) return null; // 注释行

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

/** txt 角色判定：'code' | 'stats' | null */
function classifyTxt(fileName, text) {
  const base = path.basename(fileName, path.extname(fileName));
  const statsByName = STATS_NAME_RE.test(base);
  const codeByName = !statsByName && CODE_NAME_RE.test(base);
  if (codeByName) return 'code';
  if (statsByName) return 'stats';

  const lines = String(text)
    .split(/\r?\n/)
    .map((s) => s.replace(/\uFEFF/g, '').trim())
    .filter((s) => s && !/^[#/;,*·]/.test(s));
  if (!lines.length) return null;

  const hits = lines.filter((l) => parseStatLine(l)).length;
  if (hits / lines.length >= 0.6) return 'stats';
  return 'code';
}

function looksLikeGunDir(dir) {
  const items = readdirSafe(dir).filter((e) => e.isFile() && !e.name.startsWith('.'));
  return items.some((e) => {
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

function buildGun(categoryName, categoryDirName, gunName, dir) {
  const files = readdirSafe(dir).filter((e) => e.isFile() && !e.name.startsWith('.'));
  const relDir = path.relative(ROOT, dir).split(path.sep);

  // ── 1. 概览图 ─────────────────────────────────────────────
  const imageFile = pickImage(dir, files);
  if (!imageFile) warn(`「${path.relative(ROOT, dir)}」没有找到概览图片`);

  // ── 2. 两个 txt 的角色判定 ─────────────────────────────────
  const txts = files
    .filter((f) => TXT_EXT.has(path.extname(f.name).toLowerCase()))
    .map((f) => f.name)
    .sort(naturalCompare);

  if (!txts.length) warn(`「${path.relative(ROOT, dir)}」没有找到 txt 文件`);

  const readText = (name) => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (err) {
      warn(`读取 ${name} 失败：${err.message}`);
      return '';
    }
  };

  const explicitCode = txts.find((n) => classifyTxt(n, readText(n)) === 'code' && CODE_NAME_RE.test(n));
  const explicitStats = txts.find((n) => classifyTxt(n, readText(n)) === 'stats' && STATS_NAME_RE.test(n));

  let codeFile = explicitCode;
  let statsFile = explicitStats;

  if (codeFile === statsFile) codeFile = undefined;

  if (!codeFile || !statsFile) {
    for (const n of txts) {
      if (n === codeFile || n === statsFile) continue;
      const role = classifyTxt(n, readText(n));
      if (role === 'stats' && !statsFile) statsFile = n;
      else if (role === 'code' && !codeFile) codeFile = n;
    }
  }
  // 兜底：按「第一个是改枪码、第二个是数据」的顺序补位
  if (!codeFile) codeFile = txts.find((n) => n !== statsFile);
  if (!statsFile) statsFile = txts.find((n) => n !== codeFile);
  if (codeFile === statsFile) statsFile = undefined;

  // ── 3. 改枪码 ─────────────────────────────────────────────
  const code = codeFile
    ? readText(codeFile)
        .replace(/\uFEFF/g, '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !/^[#/;,*·]/.test(s))
        .join('\n')
    : '';
  if (!code) warn(`「${path.relative(ROOT, dir)}」改枪码为空`);

  // ── 4. 属性数据 ───────────────────────────────────────────
  const stats = [];
  const seen = new Set();
  if (statsFile) {
    for (const line of readText(statsFile).split(/\r?\n/)) {
      const parsed = parseStatLine(line);
      if (!parsed || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      stats.push(parsed);
    }
    const junk = readText(statsFile)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !/^[#/;,*·]/.test(s) && !parseStatLine(s));
    if (junk.length) warn(`「${path.relative(ROOT, dir)}/${statsFile}」有 ${junk.length} 行无法解析，已忽略`);
  }
  if (!stats.length) warn(`「${path.relative(ROOT, dir)}」没有解析出任何属性数据`);

  return {
    id: `${categoryName}/${gunName}`,
    name: gunName,
    category: categoryName,
    categoryDir: categoryDirName,
    dir: relDir.join('/'),
    image: imageFile ? toUrl(...relDir, imageFile) : null,
    imageFile,
    code,
    codeFile: codeFile || null,
    statsFile: statsFile || null,
    stats,
  };
}

/** 扫描 save/，返回 [{ name, guns: [...] }] */
function collectCategories() {
  const entries = readdirSafe(SAVE_DIR).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const buckets = new Map();

  const push = (category, gunDirs) => {
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(...gunDirs);
  };

  for (const entry of entries) {
    const abs = path.join(SAVE_DIR, entry.name);
    const subdirs = readdirSafe(abs).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    const gunSubdirs = subdirs.filter((k) => looksLikeGunDir(path.join(abs, k.name)));

    if (gunSubdirs.length) {
      push(
        entry.name,
        gunSubdirs.map((k) => ({ name: k.name, dir: path.join(abs, k.name) })),
      );
      const skipped = subdirs.filter((k) => !gunSubdirs.includes(k));
      if (skipped.length) {
        warn(`分类「${entry.name}」下有 ${skipped.length} 个子文件夹没有图片也没有 txt，已跳过：${skipped.map((s) => s.name).join('、')}`);
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

  // 目录名 -> 显示名（中文分类名会变成 AR / SMG 这类缩写）
  const usedLabels = new Map();

  return [...buckets.entries()]
    .map(([rawName, gunDirs]) => {
      const isFlat = rawName === UNCATEGORIZED_RAW;
      const name = isFlat ? UNCATEGORIZED_LABEL : categoryLabel(rawName);

      if (usedLabels.has(name) && usedLabels.get(name) !== rawName) {
        warn(`目录「${usedLabels.get(name)}」和「${rawName}」都显示为 ${name}，两边的枪械会合并到同一个分类下`);
      }
      usedLabels.set(name, rawName);

      const guns = gunDirs
        .map((g) => buildGun(name, isFlat ? '' : rawName, g.name, g.dir))
        .sort((a, b) => naturalCompare(a.name, b.name));
      return { name, dirName: isFlat ? null : rawName, guns };
    })
    .sort((a, b) => catIndex(a.name) - catIndex(b.name) || naturalCompare(a.name, b.name));;
}

/**
 * 统一柱状图的长度。判断规则（按属性名跨全部方案统一决定，保证同一属性可比）：
 *   · 最大值 > 100        -> 按全局最大值折算（价格、枪口初速、举镜时间这类绝对数值）
 *   · 最大值 <= 5         -> 按全局最大值折算（换弹时间 2.4 秒、重量 3.8 这类小数量级）
 *   · 其余（0-100 的整数分）-> 直接用数值当长度，即百分制
 */
function attachBars(categories) {
  const allGuns = categories.flatMap((c) => c.guns);
  const maxByKey = new Map();
  for (const gun of allGuns) {
    for (const s of gun.stats) {
      const cur = maxByKey.get(s.key);
      if (cur === undefined || s.value > cur) maxByKey.set(s.key, s.value);
    }
  }

  for (const gun of allGuns) {
    for (const s of gun.stats) {
      const max = maxByKey.get(s.key) || 0;
      const relative = max > 100 || max <= 5;
      const pct = relative ? (max > 0 ? (s.value / max) * 100 : 0) : s.value;
      s.inverse = INVERSE_STATS.has(s.key);
      s.scale = relative ? 'relative' : 'percent';
      s.bar = Math.max(2, Math.min(100, Math.round(pct * 10) / 10));
      s.percentOfMax = max > 0 ? Math.round((s.value / max) * 1000) / 10 : 0;
      s.max = max;
    }
    // 按预设顺序排列属性，未列出的保持 txt 中的顺序并排到后面
    const orderIndex = (k) => {
      const i = STAT_ORDER.indexOf(k);
      return i === -1 ? STAT_ORDER.length : i;
    };
    gun.stats.sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
  }
}

/**
 * 目标：仓库里的路径全部使用 ASCII 字符（枪名/分类名直接就是页面显示名，用英文最省事）。
 * 这条检查只提示、不阻断构建，方便你随时发现漏改的中文目录名或文件名。
 */
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

function main() {
  const saveExists = fs.existsSync(SAVE_DIR);
  const categories = saveExists ? collectCategories() : [];
  attachBars(categories);

  const gunCount = categories.reduce((n, c) => n + c.guns.length, 0);
  const statKeys = new Set(categories.flatMap((c) => c.guns.flatMap((g) => g.stats.map((s) => s.key))));

  const body = {
    sourceDir: 'save',
    gunCount,
    categories,
  };

  // 只有当内容真的变了才刷新时间戳，这样重复构建不会产生无意义的文件变动
  // （比较时固定字段顺序，避免因为键的顺序不同而误判为“变了”）
  const comparable = (o) => JSON.stringify([o.sourceDir, o.gunCount, o.categories]);
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
  console.log(`  分类 ${categories.length} 个 · 枪械 ${gunCount} 把 · 属性项 ${statKeys.size} 种`);
  for (const c of categories) {
    console.log(`  ├─ ${c.name}（${c.guns.length}）：${c.guns.map((g) => g.name).join('、') || '空'}`);
  }
  if (!saveExists) {
    console.warn('⚠ 没有找到 save/ 目录，先按 README 建好目录再重新运行本脚本。');
  }

  const nonAscii = findNonAsciiPaths();
  if (nonAscii.length) {
    console.warn(`\n⚠ save/ 下有 ${nonAscii.length} 个路径包含非 ASCII 字符（枪名/分类名会直接显示在页面上，建议改成英文）：`);
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
