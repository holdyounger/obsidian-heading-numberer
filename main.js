const { Plugin, PluginSettingTab, Setting } = require('obsidian');
const { ViewPlugin, Decoration, WidgetType } = require('@codemirror/view');

// ============================================================
//  常量 & 默认设置
// ============================================================

const STYLE_OPTIONS = {
  '1': '阿拉伯数字 (1, 2, 3...)',
  'a': '小写字母 (a, b, c...)',
  'A': '大写字母 (A, B, C...)',
  'i': '小写罗马数字 (i, ii, iii...)',
  'I': '大写罗马数字 (I, II, III...)',
  '一': '大写中文数字 (一, 二, 三...)',
  '①': '带圈阿拉伯数字 (①, ②, ③...)',
};

const DEFAULT_SETTINGS = {
  startLevel: 1,
  depth: 8,
  prependParentNumber: true,
  showInEditMode: true,
  showInReadingMode: true,
  showInOutline: true,
  numberSeparator: ' ',
  levelConfigs: [
    { style: '1', displayFormat: '{}', separator: '.' },
    { style: 'a', displayFormat: '{}', separator: '.' },
    { style: 'i', displayFormat: '{}', separator: '.' },
    { style: 'A', displayFormat: '{}', separator: '.' },
    { style: 'I', displayFormat: '{}', separator: '' },
    { style: '一', displayFormat: '{}', separator: '' },
    { style: '1', displayFormat: '{}', separator: '' },
    { style: 'a', displayFormat: '{}', separator: '' },
  ],
};

// ============================================================
//  数字格式化工具
// ============================================================

function formatNumber(num, style) {
  if (num <= 0) return '';
  switch (style) {
    case '1': return String(num);
    case 'a': return toLetters(num, false);
    case 'A': return toLetters(num, true);
    case 'i': return toRoman(num).toLowerCase();
    case 'I': return toRoman(num);
    case '一': return toChineseUpper(num);
    case '①': return toCircledNumber(num);
    default: return String(num);
  }
}

function toLetters(num, isUpperCase = false) {
  if (num <= 0) return '';
  if (num > 18278) return String(num);
  const base = isUpperCase ? 65 : 97;
  let result = '';
  let n = num;
  while (n > 0) {
    n--;
    result = String.fromCharCode(base + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function toRoman(num) {
  const matrix = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let roman = '';
  for (const [val, sym] of matrix) {
    while (num >= val) { roman += sym; num -= val; }
  }
  return roman;
}

function toChineseUpper(num) {
  if (num <= 0 || num > 999) return String(num);
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];
  if (num < 10) return digits[num];
  if (num < 20) {
    if (num === 10) return '十';
    return '十' + digits[num % 10];
  }
  let result = '';
  const str = String(num).split('').map(Number);
  for (let i = 0; i < str.length; i++) {
    const d = str[i];
    const unitIdx = str.length - 1 - i;
    if (d === 0) {
      if (result && !result.endsWith('零')) result += '零';
    } else {
      result += digits[d];
      if (unitIdx > 0) result += units[unitIdx];
    }
  }
  return result.replace(/零+$/, '').replace(/零+/g, '零');
}

function toCircledNumber(num) {
  const arr = [
    '①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩',
    '⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳',
  ];
  if (num >= 1 && num <= 20) return arr[num - 1];
  return String(num);
}

function applyDisplayFormat(number, displayFormat) {
  if (!displayFormat || displayFormat === '{}') return number;
  return displayFormat.replace('{}', number);
}

// ============================================================
//  核心序号计算（纯函数）
//  输入： headings = [{ level, text, line }, ...]
//  输出： Map<line, numberString>
// ============================================================

function computeNumbering(headings, settings) {
  const result = new Map();
  const counters = new Array(9).fill(0);
  const { startLevel, depth, prependParentNumber, levelConfigs } = settings;

  for (const h of headings) {
    const level = h.level;
    if (level < startLevel || level >= startLevel + depth) continue;
    for (let j = level + 1; j <= 8; j++) counters[j] = 0;
    counters[level]++;

    let numbering = '';
    const endLevel = Math.min(level, startLevel + depth - 1);
    let firstSegment = startLevel;
    if (!prependParentNumber && level > startLevel) {
      firstSegment = startLevel + 1;
    }

    for (let cur = firstSegment; cur <= endLevel; cur++) {
      const ci = cur - startLevel;
      const cfg = levelConfigs[ci] || { style: '1', displayFormat: '{}', separator: '' };
      const counter = counters[cur] || 0;
      const formatted = formatNumber(counter, cfg.style);
      numbering += applyDisplayFormat(formatted, cfg.displayFormat || '{}');
      if (cur < endLevel) numbering += (cfg.separator || '');
    }
    result.set(h.line, numbering);
  }
  return result;
}

// ============================================================
//  从全文提取标题信息
// ============================================================

function extractHeadings(text) {
  const lines = text.split('\n');
  const headings = [];
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,8})\s+(.*)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: i });
    }
  }
  return headings;
}

// ============================================================
//  从 Obsidian metadata cache 提取标题（用于大纲面板）
// ============================================================

function extractHeadingsFromCache(file, app) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.headings) return [];
  // cache.headings 已经按行号排序，且已过滤代码块
  return cache.headings.map((h) => ({
    level: h.level,
    text: h.heading,
    line: h.position.start.line,
  }));
}

// ============================================================
//  CM6 Widget — 编辑模式序号装饰
// ============================================================

class NumberWidget extends WidgetType {
  constructor(numberStr, separator) {
    super();
    this.numberStr = numberStr;
    this.separator = separator;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-heading-number';
    span.textContent = this.numberStr + this.separator;
    return span;
  }
  ignoreEvent() { return true; }
}

function buildEditorPlugin(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.none;
        this.update(view);
      }
      update(view) {
        if (!plugin.settings.showInEditMode) {
          this.decorations = Decoration.none;
          return;
        }
        const text = view.state.doc.toString();
        const headings = extractHeadings(text);
        const numberingMap = computeNumbering(headings, plugin.settings);
        const decorations = [];
        const sep = plugin.settings.numberSeparator || ' ';

        for (const [lineNum, numberStr] of numberingMap) {
          const line = view.state.doc.line(lineNum + 1);
          const match = line.text.match(/^(#{1,8})\s+/);
          if (!match) continue;
          const insertPos = line.from + match[0].length;
          decorations.push(
            Decoration.widget({
              widget: new NumberWidget(numberStr, sep),
              side: 1,
            }).range(insertPos)
          );
        }
        this.decorations = Decoration.set(decorations, true);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// ============================================================
//  主插件
// ============================================================

class HeadingNumbererPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new HeadingNumbererSettingTab(this.app, this));

    // CM6 编辑器扩展
    if (this.settings.showInEditMode) {
      this.registerEditorExtension(buildEditorPlugin(this));
    }

    // 阅读模式渲染
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.settings.showInReadingMode) return;
      const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings.length === 0) return;

      const file = ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
      if (!file) return;

      // 用 metadata cache 获取标题列表（同步、快速）
      const allHeadings = extractHeadingsFromCache(file, this.app);
      if (allHeadings.length === 0) return;

      const numberingMap = computeNumbering(allHeadings, this.settings);
      const info = ctx.getSectionInfo(el);
      if (!info) return;

      const startLine = info.lineStart;
      const endLine = info.lineEnd;
      const sep = this.settings.numberSeparator || ' ';

      // 遍历 section 行范围内的标题，匹配 DOM 元素
      let headingIdx = 0;
      for (let line = startLine; line <= endLine && headingIdx < headings.length; line++) {
        if (numberingMap.has(line)) {
          const h = headings[headingIdx];
          if (h) {
            const numberStr = numberingMap.get(line);
            const span = document.createElement('span');
            span.className = 'heading-number-reading';
            span.textContent = numberStr + sep;
            h.insertBefore(span, h.firstChild);
          }
          headingIdx++;
        }
        // 跳过非标题行
        const headingOnThisLine = allHeadings.find((h) => h.line === line);
        if (!headingOnThisLine) continue;
      }
    });

    // 大纲面板（Outline）序号注入
    if (this.settings.showInOutline) {
      this.setupOutlineObserver();
    }

    this.addStylesheet();
  }

  // ============================================================
  //  大纲面板支持
  //  Obsidian 大纲面板 DOM 结构（从 obsidian.asar 提取确认）:
  //  .workspace-leaf-content[data-type="outline"]
  //    └── .tree-item (每个标题项)
  //        └── .tree-item-self
  //            └── .tree-item-inner
  //                └── .tree-item-inner-text (标题文本)
  //        └── .tree-item-children (嵌套子标题)
  //            └── .tree-item ...
  //  注意：Obsidian 大纲面板使用通用 tree 组件，不是 .outline-item
  // ============================================================

  setupOutlineObserver() {
    this.outlineObserver = new MutationObserver(() => {
      this.updateOutlinePanels();
    });

    this.observeOutlinePanels();

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.observeOutlinePanels();
        this.updateOutlinePanels();
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        setTimeout(() => {
          this.observeOutlinePanels();
          this.updateOutlinePanels();
        }, 100);
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', () => {
        setTimeout(() => this.updateOutlinePanels(), 50);
      })
    );

    // 初始延迟一次，确保面板已渲染
    setTimeout(() => {
      this.observeOutlinePanels();
      this.updateOutlinePanels();
    }, 500);
  }

  observeOutlinePanels() {
    const outlineLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="outline"]');
    outlineLeaves.forEach((leaf) => {
      if (leaf.dataset.headingNumbererObserved) return;
      leaf.dataset.headingNumbererObserved = 'true';

      // 直接观察整个 leaf 内容（tree-item 会被动态创建/销毁）
      this.outlineObserver.observe(leaf, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      console.log('[Heading Numberer] Observing outline panel:', leaf.className);
    });
  }

  updateOutlinePanels() {
    if (!this.settings.showInOutline) return;

    const outlineLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="outline"]');
    if (outlineLeaves.length === 0) return;

    outlineLeaves.forEach((leaf) => {
      this.updateOutlinePanel(leaf);
    });
  }

  updateOutlinePanel(leafEl) {
    // 大纲面板用 .tree-item 结构渲染标题
    const treeItems = leafEl.querySelectorAll('.tree-item');
    if (treeItems.length === 0) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') return;

    const allHeadings = extractHeadingsFromCache(activeFile, this.app);
    if (allHeadings.length === 0) return;

    const numberingMap = computeNumbering(allHeadings, this.settings);
    const sep = this.settings.numberSeparator || ' ';

    console.log('[Heading Numberer] Outline panel:', treeItems.length, 'tree items,', allHeadings.length, 'headings');

    // tree-item 按文档顺序（深度优先）对应文件中的标题
    let headingIdx = 0;
    treeItems.forEach((item) => {
      // 移除已有序号
      const existing = item.querySelector('.heading-number-outline');
      if (existing) existing.remove();

      if (headingIdx < allHeadings.length) {
        const heading = allHeadings[headingIdx];
        const numberStr = numberingMap.get(heading.line);

        if (numberStr) {
          // 标题文本在 .tree-item-inner-text 或 .tree-item-inner
          const titleEl = item.querySelector('.tree-item-inner-text') ||
                          item.querySelector('.tree-item-inner') ||
                          item;
          const span = document.createElement('span');
          span.className = 'heading-number-outline';
          span.textContent = numberStr + sep;
          titleEl.insertBefore(span, titleEl.firstChild);
        }
        headingIdx++;
      }
    });
  }

  addStylesheet() {
    const css = `
      .cm-heading-number,
      .heading-number-reading,
      .heading-number-outline {
        color: var(--text-muted);
        font-weight: 600;
        user-select: none;
        opacity: 0.8;
      }
    `;
    const style = document.createElement('style');
    style.id = 'heading-numberer-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  onunload() {
    document.getElementById('heading-numberer-styles')?.remove();
    if (this.outlineObserver) {
      this.outlineObserver.disconnect();
    }
    // 清理大纲面板中的序号
    document.querySelectorAll('.heading-number-outline').forEach((e) => e.remove());
    console.log('Heading Numberer (render-only) 已卸载');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ============================================================
//  设置面板
// ============================================================

class HeadingNumbererSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Heading Numberer 设置' });
    containerEl.createEl('p', {
      text: '本插件仅在渲染时追加序号显示，不会修改文件内容。',
      cls: 'setting-item-description',
    });

    // --- 显示模式 ---
    new Setting(containerEl)
      .setName('编辑模式显示序号')
      .setDesc('在编辑/实时预览模式中显示序号')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showInEditMode).onChange(async (v) => {
          this.plugin.settings.showInEditMode = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName('阅读模式显示序号')
      .setDesc('在阅读模式中显示序号')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showInReadingMode).onChange(async (v) => {
          this.plugin.settings.showInReadingMode = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName('大纲面板显示序号')
      .setDesc('在左侧大纲（Outline）面板的标题项前显示序号')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showInOutline).onChange(async (v) => {
          this.plugin.settings.showInOutline = v;
          await this.plugin.saveSettings();
          if (v && !this.plugin.outlineObserver) {
            this.plugin.setupOutlineObserver();
          } else if (!v && this.plugin.outlineObserver) {
            this.plugin.outlineObserver.disconnect();
            document.querySelectorAll('.heading-number-outline').forEach((e) => e.remove());
          }
          this.plugin.updateOutlinePanels?.();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName('序号与标题的分隔符')
      .setDesc('序号和标题文本之间的字符（默认空格）')
      .addText((t) =>
        t.setPlaceholder(' ').setValue(this.plugin.settings.numberSeparator).onChange(async (v) => {
          this.plugin.settings.numberSeparator = v || ' ';
          await this.plugin.saveSettings();
          this.plugin.updateOutlinePanels?.();
        })
      );

    // --- 编号范围 ---
    new Setting(containerEl)
      .setName('起始标题级别')
      .setDesc('从第几级标题开始生成序号（1-8）')
      .addSlider((s) =>
        s.setLimits(1, 8, 1).setValue(this.plugin.settings.startLevel).onChange(async (v) => {
          this.plugin.settings.startLevel = v;
          await this.plugin.saveSettings();
          this.plugin.updateOutlinePanels?.();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName('生成深度')
      .setDesc('生成序号的层级数（1-8）')
      .addSlider((s) =>
        s.setLimits(1, 8, 1).setValue(this.plugin.settings.depth).onChange(async (v) => {
          this.plugin.settings.depth = v;
          while (this.plugin.settings.levelConfigs.length < v) {
            this.plugin.settings.levelConfigs.push({ style: '1', displayFormat: '{}', separator: '' });
          }
          await this.plugin.saveSettings();
          this.plugin.updateOutlinePanels?.();
          this.display();
        })
      );

    // --- 父级编号 ---
    new Setting(containerEl)
      .setName('在次级标题前添加首级序号')
      .setDesc('勾选后显示完整路径如 1.1.a；不勾选只显示当前级如 a')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.prependParentNumber).onChange(async (v) => {
          this.plugin.settings.prependParentNumber = v;
          await this.plugin.saveSettings();
          this.plugin.updateOutlinePanels?.();
          this._refreshPreviews(containerEl);
        })
      );

    // --- 每级配置 ---
    containerEl.createEl('h3', { text: '每级标题的序号配置' });

    for (let i = 0; i < this.plugin.settings.depth; i++) {
      const levelNum = this.plugin.settings.startLevel + i;
      const config = this.plugin.settings.levelConfigs[i] || { style: '1', displayFormat: '{}', separator: '' };

      const levelContainer = containerEl.createDiv({ cls: 'heading-level-config' });
      levelContainer.createEl('h4', { text: `第 ${levelNum} 级标题` });

      const preview = levelContainer.createDiv({ cls: 'heading-number-preview' });
      preview.dataset.level = String(levelNum);

      new Setting(levelContainer)
        .setName('样式')
        .setDesc('选择此级标题的序号样式')
        .addDropdown((d) =>
          d.addOptions(STYLE_OPTIONS).setValue(config.style).onChange(async (v) => {
            this.plugin.settings.levelConfigs[i].style = v;
            await this.plugin.saveSettings();
            this.plugin.updateOutlinePanels?.();
            this._refreshPreviewsFrom(containerEl, i);
          })
        );

      new Setting(levelContainer)
        .setName('显示格式')
        .setDesc('使用 {} 作为占位符。如 ({}) 生成 (1)、(2)')
        .addText((t) => {
          t.setPlaceholder('{}').setValue(config.displayFormat || '{}').onChange(async (v) => {
            this.plugin.settings.levelConfigs[i].displayFormat = v || '{}';
            await this.plugin.saveSettings();
            this.plugin.updateOutlinePanels?.();
            this._refreshPreviewsFrom(containerEl, i);
          });
          t.inputEl.addEventListener('input', () => {
            const v = t.inputEl.value || '{}';
            this._updatePreview(preview, levelNum, { [i]: { ...config, displayFormat: v } });
          });
        });

      new Setting(levelContainer)
        .setName('分隔符')
        .setDesc('此级与下一级的分隔符')
        .addText((t) => {
          t.setPlaceholder('(空)').setValue(config.separator).onChange(async (v) => {
            this.plugin.settings.levelConfigs[i].separator = v ?? '';
            await this.plugin.saveSettings();
            this.plugin.updateOutlinePanels?.();
            this._refreshPreviewsFrom(containerEl, i);
          });
          t.inputEl.addEventListener('input', () => {
            const v = t.inputEl.value ?? '';
            this._updatePreview(preview, levelNum, { [i]: { ...config, separator: v } });
          });
        });

      this._updatePreview(preview, levelNum);
    }
  }

  _updatePreview(container, level, overrides) {
    container.innerHTML = '';
    const examples = [1, 2, 3];
    const parts = examples.map((num) => {
      const counters = new Array(9).fill(0);
      const start = this.plugin.settings.startLevel;
      for (let l = start; l <= level; l++) counters[l] = num;
      const oldConfigs = this.plugin.settings.levelConfigs;
      const tempSettings = { ...this.plugin.settings };
      if (overrides) {
        tempSettings.levelConfigs = oldConfigs.map((c, idx) => overrides[idx] ? { ...c, ...overrides[idx] } : c);
      }
      return computeNumbering(
        [{ level, text: '', line: 0 }],
        { ...tempSettings, startLevel: start, depth: level - start + 1 }
      ).get(0) || '';
    });
    container.createEl('small', { text: `预览: ${parts.join('   ')}...` });
  }

  _refreshPreviews(containerEl) {
    containerEl.querySelectorAll('.heading-number-preview').forEach((p) => {
      const lvl = Number(p.dataset.level);
      if (!isNaN(lvl)) this._updatePreview(p, lvl);
    });
  }

  _refreshPreviewsFrom(containerEl, startIndex) {
    for (let i = startIndex; i < this.plugin.settings.depth; i++) {
      const levelNum = this.plugin.settings.startLevel + i;
      const preview = containerEl.querySelector(`[data-level="${levelNum}"]`);
      if (preview) this._updatePreview(preview, levelNum);
    }
  }
}

module.exports = HeadingNumbererPlugin;
