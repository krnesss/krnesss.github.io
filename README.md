# 三角洲行动 · 改枪码展示站

按「枪械分类 → 枪械名称」浏览改枪方案：每个方案展示**改枪码**（一键复制）、**方案概览图**（点击放大）和**横向属性对比图**。
纯静态站点，不需要数据库和后端，直接托管在 **GitHub Pages** 上。

线上地址（开启 Pages 后）：<https://krnesss.github.io/>

---

## 一、目录结构

```
├─ index.html                 页面骨架
├─ assets/
│   ├─ style.css              样式（暗色主题 + 横向柱状图）
│   └─ app.js                 交互逻辑（分类 / 搜索 / 路由 / 复制 / 图片放大）
├─ tools/
│   ├─ build-data.mjs         扫描 save/ 生成 data/guns.js、data/guns.json
│   ├─ serve.mjs              本地预览用的小型静态服务器
│   └─ smoke-test.mjs         自检脚本：在 Node 里跑一遍页面逻辑，不需要浏览器
├─ data/
│   ├─ guns.js                自动生成，页面真正读取的数据
│   └─ guns.json              自动生成，同样的内容（给别的工具用）
└─ save/                      ★ 你只需要维护这个目录
    ├─ AR/                      ← 一级目录 = 分类（页面上显示 AR）
    │   ├─ M4A1-突击型/         ← 二级目录 = 枪械名（页面上显示的名字）
    │   │   ├─ 概览图.png        ← 概览图（图片文件名随便取）
    │   │   ├─ 改枪码.txt        ← 第一个 txt：改枪码
    │   │   └─ 数据.txt          ← 第二个 txt：各项数据
    │   └─ AK-12/
    └─ SMG/
        └─ Vector/
```

> 枪械名就是二级文件夹名，**页面上显示的就是文件夹名**，想改名字直接重命名文件夹即可。
> 文件夹名里请不要出现 `/` 或 `\`。

### 分类缩写对照表

一级目录名可以写**缩写**、**中文分类名**或**英文全称**，页面上统一显示成缩写。想加分类，改 `tools/build-data.mjs` 里的 `CATEGORY_LABELS` 即可。

| 缩写 | 中文分类名 | 英文全称 | 页面排序 |
| --- | --- | --- | --- |
| `AR` | 突击步枪 | Assault Rifle | 1 |
| `SG` | 霰弹枪 | Shotgun | 2 |
| `SMG` | 冲锋枪 | Submachine Gun | 3 |
| `DMR` | 精确射手步枪 / 射手步枪 | Designated Marksman Rifle | 4 |
| `SR` | 狙击步枪 | Sniper Rifle | 5 |
| `LMG` | 轻机枪 | Light Machine Gun | 6 |
| `HG` | 手枪 | Handgun | 7 |
| `SP` | 特殊 | Special | 8 |
| `OTHER` | — | — | 9（枪械直接放在 `save/` 下时的兜底分类） |

分类排序由 `CATEGORY_ORDER` 控制，没登记的目录名会原样显示并排在最后。

## 二、两个 txt 怎么写

**第一个 txt：改枪码**（文件名含「改枪码 / 枪码 / 代码 / code」最稳妥）

```text
# 以 # 开头的行会被忽略
M4A1-突击型-6F2A-9C41-7B8E-3D05
```

整段内容会原样显示，点「复制改枪码」一次性复制全部内容（多行也能复制）。

**第二个 txt：各项数据**（文件名含「数据 / 属性 / 数值 / 参数」最稳妥）

```text
后坐力控制: 78
操控速度: 62
精准度: 71
射程: 58 m
枪口初速: 880 m/s
换弹时间: 2.4 s
价格: 245000 币
```

格式规则：

| 写法 | 是否支持 | 说明 |
| --- | --- | --- |
| `后坐力控制: 78` | ✅ | 冒号中英文都行 |
| `射程：58 m` | ✅ | 数值后面的单位会一起显示 |
| `价格 = 250000 币` | ✅ | 等号也行 |
| `伤害: 38-42` | ✅ | 区间取平均值画柱子，数值显示成 `38-42` |
| `后坐力控制 78` | ✅ | 没有冒号时按空格/Tab 分隔也认 |
| `# 备注` | ✅ | 行首 `#` `/` `;` `,` `*` `·` 视为注释，忽略 |
| 属性名 / 属性数量 | ✅ 随意 | txt 里写几项，页面就画几条，顺序按下面的预设排 |

属性展示顺序（txt 里没写的自动跳过，没列到的属性排在最后）：

`后坐力控制` → `操控速度` → `精准度` → `稳定性` → `腰射精度` → `伤害` → `射程` → `枪口初速` → `价格` → `弹匣容量` → `举镜时间` → `换弹时间` → `重量`

柱状图长度规则（同一属性在所有方案之间统一口径，保证可比）：

- 数值都在 **0–100** 之间（如 `后坐力控制: 78`）→ 直接按百分制画，柱子 78%；
- 数值很大（如 `价格: 245000`、`枪口初速: 880`）或数量级很小（如 `换弹时间: 2.4 s`）→ 按**全部方案里该项的最大值**折算，并显示占比百分比。
- 以下属性会被标成**蓝色**并提示「越低越好」：`举镜时间`、`开镜时间`、`换弹时间`、`重量`、`跑射延迟`。

如果文件名看不出哪个是哪个，脚本会按内容自动判断，再不行就按「第一个 txt 是改枪码、第二个 txt 是数据」处理。所以两种命名都能跑：

```
1.txt + 2.txt        ✅
改枪码.txt + 数据.txt  ✅
方案码.txt + 属性.txt  ✅
```

## 三、新增/修改一把枪

1. 在 `save/<分类缩写>/` 下新建文件夹，文件夹名 = 枪名（分类可以用缩写、中文名或英文全称，见上面的对照表）；
2. 往里放：**一张概览图** + **两个 txt**；
3. 运行一次构建：

```powershell
node tools/build-data.mjs      # 或 npm run build
```

4. 本地看效果：

```powershell
node tools/serve.mjs           # 或 npm run serve
# 打开 http://localhost:4173
```

> 直接双击 `index.html` 用 `file://` 打开也能看：数据是通过 `<script src="data/guns.js">` 引入的，不走 fetch，所以没有跨域问题。
> 但用本地服务器预览更接近线上环境，推荐 `npm run serve`。

如果只推送到 GitHub、让 Actions 自动构建，则**第 3 步可以跳过**（见下一节）。

### 顺手自检（可选）

```powershell
npm test
```

它会先重新生成数据，再把 `assets/app.js` 放进一个最小 DOM 环境里跑一遍（首屏渲染、分类切换、搜索、复制、折叠、灯箱、图表行数），
任何一项不通过都会报错并退出。改完 `save/` 或 `app.js` 后想确认没弄坏东西，跑这个最省事。

## 四、部署到 GitHub Pages（用户名 krnesss）

### 方式 A：Actions 自动部署（推荐，以后只管往 `save/` 丢文件）

1. 在 GitHub 上新建**公开**仓库，仓库名必须是 `krnesss.github.io`；
2. 把本项目推上去（见下面第 5 步）；
3. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**；
4. 每次 `git push` 到 `main`，`.github/workflows/pages.yml` 会自动扫描 `save/`、生成数据并发布；
5. 一两分钟后访问 <https://krnesss.github.io/>。

### 方式 B：分支直接部署（不用 Actions）

1. 本地先跑 `node tools/build-data.mjs`，把 `data/guns.js` 一起提交；
2. **Settings → Pages → Source** 选 **Deploy from a branch**，分支 `main`、目录 `/ (root)`；
3. 以后每次改完 `save/`，都要先本地构建再把 `data/` 一起提交。

### 首次推送命令

```powershell
cd F:\dfpin
git init -b main
git add .
git commit -m "feat: 三角洲改枪码展示站"
git remote add origin https://github.com/krnesss/krnesss.github.io.git
git push -u origin main
```

## 五、页面功能

- 左侧按分类折叠展示枪械列表，支持**搜索**（输入即筛选，回车跳到第一把命中的枪，按 `/` 直接聚焦搜索框）；
- 地址栏带锚点，例如 `#/AR/M4A1-突击型`，可以直接分享某一把枪的链接，浏览器前进/后退可用；
- 改枪码一键复制（`file://` 下自动退化为全选文本）；
- 概览图点击放大，`Esc` 或点击空白处关闭；
- 分类折叠状态记忆在浏览器本地，刷新后保留。

## 六、想改外观

- 颜色、圆角、柱状图配色：`assets/style.css` 顶部的 `:root` 变量（`--accent` 是主色）；
- 想让某个属性算「越低越好」：往 `tools/build-data.mjs` 的 `INVERSE_STATS` 里加属性名；
- 想调整属性排序：改 `tools/build-data.mjs` 的 `STAT_ORDER`；
- 想调整分类排序：改 `tools/build-data.mjs` 的 `CATEGORY_ORDER`（按显示名写，例如 `AR`、`SMG`；没列到的分类排在最后）。
- 想增加或修改分类缩写：改 `tools/build-data.mjs` 的 `CATEGORY_LABELS`，例如加一条 `"步枪": "RF"`。

改完 `tools/build-data.mjs` 后记得重新运行 `node tools/build-data.mjs`。
