# Ozon Tools - Tampermonkey 脚本集

Ozon 平台的 Tampermonkey 工具脚本，支持前台类目爬取和卖家后台类目采集。

---

## 🛒 1. Ozon 前台类目爬取器

爬取 [Ozon.ru](https://www.ozon.ru) 产品类目（3级层级）和搜索结果，支持 CSV / Excel 导出。

### 安装

[点击安装 ozon-scraper.user.js](https://raw.githubusercontent.com/vision-png/ozon/main/ozon-scraper.user.js)

### 功能
- **类目浏览** — 自动解析 Ozon 3级类目树（一级 → 二级 → 三级）
- **商品搜索** — 在 Ozon 搜索结果页一键爬取商品列表
- **俄语翻译** — 内置常用类目俄中对照字典
- **数据导出** — 支持 CSV 和 Excel (XLSX) 格式

---

## 📦 2. Ozon 卖家后台类目采集器

批量采集 [Ozon 卖家后台](https://seller.ozon.ru) 的类目树信息，支持三种采集模式。

### 安装

[点击安装 ozon-seller-category-collector.user.js](https://raw.githubusercontent.com/vision-png/ozon/main/ozon-seller-category-collector.user.js)

### 功能
- **智能展开** — 点击类目旁的展开箭头，自动递归展开并采集该节点下所有子类目（L1 → L2 → L3 → ...）
- **手动追踪** — 在类目树里逐个点击记录
- **全量扫描** — 一键抓取当前页面所有可见类目
- **CSV 导出** — UTF-8-BOM 编码，Excel 直接打开无乱码

### 使用方式
1. 登录 [Ozon 卖家后台](https://seller.ozon.ru)
2. 打开商品发布页面，点击「类目」筛选按钮打开类目弹窗
3. 页面右下角出现蓝色悬浮按钮
4. 默认为「智能展开」模式：点击任意类目的展开箭头，脚本自动递归展开所有子类目并采集
5. 采集完成后点击「下载 CSV」

---

## 通用说明

- 需要安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
- 脚本内置 `@updateURL`，Tampermonkey 会自动检查更新
- 手动更新：Tampermonkey 面板 → 已安装脚本 → 右键 → 「检查更新」

## Requirements

- Tampermonkey 4.x+
- 浏览器需能访问 ozon.ru（可能需要代理）
- SheetJS 通过 CDN 自动加载，无需手动安装
