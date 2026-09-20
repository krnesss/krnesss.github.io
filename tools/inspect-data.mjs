#!/usr/bin/env node
/**
 * 数据检视工具：把 data/guns.json 的内容按「分类 / 枪械 / 方案」打印出来，
 * 方便确认构建结果对不对（改枪码、价格、简介、属性、柱子长度、图片路径）。
 *
 * 用法：
 *   node tools/inspect-data.mjs            # 全部打印
 *   node tools/inspect-data.mjs M4A1       # 只看名字里含 M4A1 的枪
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'guns.json');

if (!fs.existsSync(DATA)) {
  console.error('还没有 data/guns.json，请先运行： node tools/build-data.mjs');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const keyword = (process.argv[2] || '').toLowerCase();

console.log(`生成时间：${data.generatedAt}`);
console.log(`分类 ${data.categories.length} 个 · 枪械 ${data.gunCount} 把 · 方案 ${data.schemeCount} 套`);
console.log(`价格字段：${data.priceKey}（不参与柱状图，单独展示）`);

const ASCII = /^[\x20-\x7E]*$/;
const pathFields = [];
data.categories.forEach((c) => {
  if (c.dirName) pathFields.push(c.dirName);
  c.guns.forEach((g) => {
    pathFields.push(g.dir, g.categoryDir);
    g.schemes.forEach((s) => pathFields.push(s.dir, s.image, s.imageFile, s.codeFile, s.statsFile, s.featFile));
  });
});
const badPaths = pathFields.filter((p) => p && !ASCII.test(p));
console.log(`路径全 ASCII：${badPaths.length ? '✘ ' + badPaths.join(' , ') : '✓'}`);
console.log('─'.repeat(72));

let shown = 0;
for (const cat of data.categories) {
  const guns = cat.guns.filter((g) => !keyword || g.name.toLowerCase().includes(keyword));
  if (!guns.length) continue;

  console.log(`\n【${cat.name}】目录名 ${cat.dirName}`);
  for (const gun of guns) {
    shown += 1;
    console.log(`  ${gun.name}  —  ${gun.schemeCount} 套方案   (${gun.dir})`);
    for (const s of gun.schemes) {
      console.log(`    ▸ ${s.id}   ${s.label}${s.featShort ? ' · ' + s.featShort : ''}`);
      console.log(`      图片    : ${s.image || '（缺）'}`);
      console.log(`      改枪码  : ${s.code ? JSON.stringify(s.code) : '（空）'}`);
      console.log(`      价格    : ${s.price ? s.price.display : '（未填写）'}`);
      const stats = s.stats.map((x) => `${x.key} ${x.display} [${x.bar}%${x.inverse ? ' ↓' : ''}]`);
      console.log(`      属性(${s.stats.length}): ${stats.join('  ') || '（无）'}`);
      if (s.feat) console.log(`      简介    : ${s.feat}`);
    }
  }
}

if (!shown) console.log(`\n没有匹配「${keyword}」的枪械`);
