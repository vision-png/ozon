# Ozon Scraper - Tampermonkey 脚本

爬取 [Ozon.ru](https://www.ozon.ru) 产品类目（3级层级）和搜索结果，支持 CSV / Excel 导出。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点击安装脚本](https://raw.githubusercontent.com/vision-png/ozon/main/ozon-scraper.user.js)
3. Tampermonkey 会自动识别并提示安装，确认即可

## 功能

- **类目浏览** — 自动解析 Ozon 3级类目树（一级 → 二级 → 三级）
- **商品搜索** — 在 Ozon 搜索结果页一键爬取商品列表
- **智能识别** — 自动检测类目页 / 搜索页 / 商品列表页
- **数据导出** — 支持 CSV 和 Excel (XLSX) 格式
- **自动更新** — 脚本内置 `@updateURL`，Tampermonkey 会定期检查更新

## 使用方式

1. 访问 [ozon.ru](https://www.ozon.ru)
2. 页面右侧会出现浮动面板，包含操作按钮
3. 点击「爬取类目」获取当前类目的商品
4. 搜索关键词后点击「爬取搜索结果」
5. 使用「导出」按钮下载数据

## 自动更新

脚本已配置自动更新，Tampermonkey 默认每 24 小时检查一次更新。
手动触发：Tampermonkey 面板 → 已安装脚本 → 右键此脚本 → 「检查更新」

## Requirements

- Tampermonkey 4.x+
- 浏览器需能访问 ozon.ru（可能需要代理）
- SheetJS 通过 CDN 自动加载，无需手动安装
