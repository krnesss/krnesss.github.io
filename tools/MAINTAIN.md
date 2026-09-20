# 维护说明（站点所有者自用）

面向维护者的技术参考。访客看的说明在根目录 `README.md`，这里记录目录约定、数据格式和常用命令。

---

## 一、目录结构

```
├─ index.html                 页面骨架
├─ assets/
│   ├─ style.css              样式（暗色主题 / 横向柱状图 / 对比表格）
│   └─ app.js                 交互逻辑（三级导航 / 方案切换 / 对比栏 / 复制 / 图片放大）
├─ tools/
│   ├─ build-data.mjs         扫描 save/ 生成 data/guns.js、data/guns.json
│   ├─ inspect-data.mjs       把生成的数据按「分类/枪械/方案」打印出来，方便核对
│   ├─ serve.mjs              本地预览用的小型静态服务器
│   ├─ smoke-test.mjs         自检脚本：在 Node 里跑一遍页面逻辑，不需要浏览器
│   ├─ update-repo.ps1        一键更新：构建 → 自检 → 提交 → 推送
│   ├─ fix-encoding.ps1       确保 update-repo.ps1 存成「UTF-8 带 BOM」
│   └─ MAINTAIN.md            本文件
├─ update-repo.cmd            双击即可运行的入口（调用上面的 ps1）
├─ data/
│   ├─ guns.js                自动生成，页面真正读取的数据
│   └─ guns.json              自动生成，同样的内容（给别的工具用）
└─ save/                      ★ 只需要维护这个目录
    ├─ AR/                        ← 一级目录 = 分类（缩写，页面显示「突击步枪」）
    │   ├─ M4A1/                  ← 二级目录 = 枪名（页面显示文件夹名）
    │   │   ├─ 1/                 ← 三级目录 = 第几套方案，用数字编号
    │   │   │   ├─ overview.png   　概览图
    │   │   │   ├─ code.txt       　改枪码
    │   │   │   ├─ stats.txt      　各项数据（其中「价格」会被单独醒目展示）
    │   │   │   └─ feat.txt       　方案简介
    │   │   └─ 2/                 ← 同一把枪的第 2 套方案，结构一样
    │   └─ AK-12/1/…
    └─ SMG/
        └─ Vector/1/…
```

同一把枪有几套方案就建几个数字文件夹（`1`、`2`、`3`…），页面上会自动出现「方案 N」切换标签。

## 二、路径命名规范：只用 ASCII 字符

**整个仓库的路径都不含中文**（分类目录、枪名目录、方案数字目录、图片名、txt 名都是英文字母、数字、`-`、`_`）。

- 枪名目录不带中文后缀：用 `M4A1`，不要用 `M4A1-突击型`；多个方案靠数字目录区分，不靠名字；
- 文件用英文名：`overview.png`、`code.txt`、`stats.txt`、`feat.txt`；
- 每次构建都会检查，没问题时输出 `✓ save/ 下所有路径都是 ASCII 字符`。

> 文件**内容**里的中文完全没问题（属性名、简介、注释都可以写中文），限制只针对路径。

## 三、图片格式

概览图支持 `.png` `.jpg` `.jpeg` `.webp` `.gif` `.svg` `.avif` `.bmp` —— **截图用 `.png` 就行，不要求 svg**。
文件名随便取；一个文件夹里有多张图时，优先用文件名含 `overview` / `概览` 的那张。`save/` 里现有的 `.svg` 只是占位图，替换掉即可。

## 四、分类目录名 → 页面显示名

一级目录名写**缩写**最省事（也可以写中文或英文全称），**页面上显示中文全称**。
想加分类，改 `tools/build-data.mjs` 里的 `CATEGORY_LABELS`。

| 目录名（推荐） | 也可写 | 页面显示 | 排序 |
| --- | --- | --- | --- |
| `AR` | 突击步枪 / Assault Rifle | 突击步枪 | 1 |
| `SG` | 霰弹枪 / Shotgun | 霰弹枪 | 2 |
| `SMG` | 冲锋枪 / Submachine Gun | 冲锋枪 | 3 |
| `DMR` | 精确射手步枪 / 射手步枪 | 精确射手步枪 | 4 |
| `SR` | 狙击步枪 / Sniper Rifle | 狙击步枪 | 5 |
| `LMG` | 轻机枪 / Light Machine Gun | 轻机枪 | 6 |
| `HG` | 手枪 / Handgun | 手枪 | 7 |
| `SP` | 特殊 / Special | 特殊 | 8 |
| — | — | 未分类 | 9（枪械直接放在 `save/` 下时的兜底） |

## 五、方案里的四个文件

| 文件 | 是否必需 | 作用 |
| --- | --- | --- |
| `overview.png` | 建议有 | 方案概览图，页面上可点击放大 |
| `code.txt` | 必需 | 改枪码，整段内容一键复制 |
| `stats.txt` | 必需 | 各项数据，画成横向柱状图；**价格行会被单独抽出来** |
| `feat.txt` | 建议有 | 方案简介，显示在枪名下方、方案标签和对比表头上 |

脚本按**文件名关键词 + 内容**自动判断这四个文件的角色，所以下面这些命名都能认：

| 改枪码 | 数据 | 简介 |
| --- | --- | --- |
| `code.txt` | `stats.txt` | `feat.txt` ✅ 推荐 |
| `改枪码.txt` | `数据.txt` | `介绍.txt` ✅ 也能认（路径含中文，不推荐） |
| `1.txt` | `2.txt` | —（认不出来时按「第一个是码、第二个是数据」处理） |

### code.txt

```text
# 以 # 开头的行会被忽略
M4A1-6F2A-9C41-7B8E-3D05
```

整段内容会原样显示，点「复制改枪码」一次性复制全部内容（多行也能复制）。

### stats.txt

```text
基础伤害: 42
优势射程: 58 m
后坐力控制: 78
操控速度: 62
据枪稳定性: 80
腰际射击精度: 44
护甲伤害: 45
射速: 800 发/分
枪口初速: 880 m/s
价格: 245000 币
```

格式规则：

| 写法 | 是否支持 | 说明 |
| --- | --- | --- |
| `后坐力控制: 78` | ✅ | 冒号中英文都行 |
| `优势射程：58 m` | ✅ | 数值后面的单位会一起显示 |
| `价格 = 250000 币` | ✅ | 等号也行 |
| `基础伤害: 38-42` | ✅ | 区间取平均值画柱子，数值显示成 `38-42` |
| `后坐力控制 78` | ✅ | 没有冒号时按空格/Tab 分隔也认 |
| `# 备注` | ✅ | 行首 `#` `/` `;` `,` `*` `·` 视为注释，忽略 |
| 属性名 / 属性数量 | ✅ 随意 | txt 里写几项，页面就画几条 |

> 旧名字也能写，会自动转成新名：`伤害`→`基础伤害`、`射程`→`优势射程`、
> `稳定性`→`据枪稳定性`、`腰射精度`→`腰际射击精度`。

**「价格」行**（也叫 `总价` / `造价` / `花费`）不参与柱状图，而是显示在改枪码正下方，
并在对比表里单独占一行、标出最省的一套。区间写法（如 `价格: 200000-260000`）也支持。

属性展示顺序（txt 里没写的自动跳过，没列到的属性排在最后）：

`基础伤害` → `优势射程` → `后坐力控制` → `操控速度` → `据枪稳定性` → `腰际射击精度` → `护甲伤害` → `射速` → `枪口初速`

柱状图长度规则（同一属性在所有方案之间统一口径，保证可比）：

- 数值都在 **0–100** 之间（如 `后坐力控制: 78`）→ 直接按百分制画，柱子 78%；
- 数值很大（`射速: 1200`、`枪口初速: 880`）或数量级很小（`重量: 3.8`）→ 按**全部方案里该项的最大值**折算，并显示占比百分比；
- 标准 9 项属性都是**越高越好**；如果以后写了 `举镜时间`、`重量`、`换弹时间`、`开镜时间`、`跑射延迟`，
  它们会被当成**越低越好**（标 ↓、蓝色），对比时高亮更优的一方。

### feat.txt

```text
近战突击流：腰射与操控优先，室内短兵相接几乎不用开镜
```

一两句话说明这套方案的定位；多行也能写，会按原样换行显示。

## 六、常用命令

```powershell
node tools/build-data.mjs      # 或 npm run build    扫描 save/ 生成 data/
node tools/serve.mjs           # 或 npm run serve    本地预览 http://localhost:4173
node tools/inspect-data.mjs    # 或 npm run inspect  打印构建结果，可加关键词：… M4A1
npm test                       # 或 node tools/smoke-test.mjs   77 项自检
```

> 直接双击 `index.html` 用 `file://` 打开也能看：数据是通过 `<script src="data/guns.js">` 引入的，不走 fetch，没有跨域问题。
> 但用本地服务器预览更接近线上环境。

## 七、一键更新脚本（构建 → 自检 → 提交 → 推送）

```powershell
# 方式 1：双击仓库根目录的 update-repo.cmd
# 方式 2：npm run update
# 方式 3：powershell -NoProfile -ExecutionPolicy Bypass -File tools\update-repo.ps1
```

脚本按顺序做 7 件事，**任何一步失败都会立刻停下并说明原因**：

| 步骤 | 做什么 |
| --- | --- |
| 1 检查环境 | git / node 是否可用；有没有卡在半途的 rebase、merge、cherry-pick |
| 2 准备仓库 | 没有 `.git` 就 `git init`；没有 `origin` 就自动添加远程地址 |
| 3 构建数据 | `node tools/build-data.mjs` |
| 4 自检 | `node tools/smoke-test.mjs` |
| 5 预览改动 | 列出这次会提交哪些文件，并提醒含非 ASCII 的路径 |
| 6 提交 | `git add -A` + `git commit`（信息不写就自动生成） |
| 7 推送 | `git push`，首次自动带 `-u origin <分支>` |

### 参数

| 参数 | 作用 |
| --- | --- |
| `-Message "..."` | 自定义提交信息（不写会自动生成，例如「更新改枪数据：M4A1（1 个文件）」） |
| `-DryRun` | 只预览：构建和自检照跑，但不提交、不推送、也不改仓库配置 |
| `-SkipTest` | 跳过自检（想快一点时用） |
| `-SkipBuild` | 跳过数据构建（确认 `data/` 已是最新时用） |
| `-Pull` | 提交前先 `git pull --rebase`，适合在多台电脑上改同一份数据 |
| `-NoPush` | 只提交到本地，不推送 |
| `-Remote <地址>` | 首次运行时的远程地址，默认 `https://github.com/krnesss/krnesss.github.io.git` |
| `-Branch <名字>` | 分支名，默认 `main` |

```powershell
npm run update -- -DryRun
npm run update -- -Message "补充 Vector 方案 2" -SkipTest
update-repo.cmd -Pull
```

### 推送失败怎么办

1. **GitHub 上还没建仓库** → 去 <https://github.com/new> 建一个公开仓库，名字填 `krnesss.github.io`；
2. **没登录 / 没权限** → 浏览器登录 GitHub，再用 Git Credential Manager 认证一次；
3. **报 non-fast-forward**（远端有新提交）→ 加 `-Pull` 再运行；
4. **网络问题** → 打开代理 / VPN 后重试。

### 为什么有 fix-encoding.ps1

Windows PowerShell 5.1 读取**没有 BOM** 的 `.ps1` 时会按系统 ANSI 编码解析，中文会变乱码并报语法错误，
所以 `update-repo.ps1` 必须保存成「UTF-8 带 BOM」。`update-repo.cmd` 每次启动前会静默跑一次
`tools/fix-encoding.ps1` 自动补 BOM（幂等）。改坏了就手动跑：

```powershell
npm run fix-encoding
```

> 用 VS Code 改这个脚本时，右下角编码选 **UTF-8 with BOM**；记事本「另存为」时选 **UTF-8（带 BOM）**。

## 八、部署

- **方式 A（推荐）**：仓库 **Settings → Pages → Source** 选 **GitHub Actions**。
  每次推送到 `main` 后，`.github/workflows/pages.yml` 会自动构建并发布，1–2 分钟后生效。
- **方式 B**：**Source** 选 **Deploy from a branch**，分支 `main`、目录 `/ (root)`。
  这种方式需要本地先跑 `node tools/build-data.mjs`，并把 `data/` 一起提交。

## 九、想改外观 / 想改规则

- 颜色、圆角、柱状图与对比表配色：`assets/style.css` 顶部的 `:root` 变量（`--accent` 是主色）；
- 分类显示名：`tools/build-data.mjs` 的 `CATEGORY_LABELS`；分类排序：`CATEGORY_ORDER`；
- 属性排序：`STAT_ORDER`；哪些属性「越低越好」：`INVERSE_STATS`；
- 对比数量上限：`assets/app.js` 顶部的 `MAX_COMPARE`（默认 6）；
- 非 ASCII 路径检查：`tools/build-data.mjs` 的 `findNonAsciiPaths()`，默认只提示，
  想让它直接中断构建就把里面的 `console.warn` 换成 `throw`。

改完 `tools/build-data.mjs` 后记得重新运行 `node tools/build-data.mjs`。
