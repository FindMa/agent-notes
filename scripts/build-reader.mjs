import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { overviewCss, overviewMarkup, writeOverview } from './overview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/posts/pi-harness');
const sha = 'eb326d265ae0b88489a6d10319307780df827cdf';
const base = `https://github.com/earendil-works/pi/blob/${sha}/`;
const files = fs.readdirSync(path.join(root, 'chapters')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
if (files.length !== 12) throw new Error(`Expected 12 chapters, got ${files.length}`);
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lessons = files.map((file, i) => {
  const filePath = path.join(root, 'chapters', file);
  let md = fs.readFileSync(filePath, 'utf8');
  md = md.replace(/\]\(pi\/([^\s)]+)\)/g, (_, target) => `](${base}${target})`);
  fs.writeFileSync(filePath, md);
  const title = md.split('\n')[0].replace(/^#\s+/, '');
  let count = 0;
  const outline = [];
  let html = marked.parse(md, {gfm:true});
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, content) => {
    const id = Number(level) === 1 ? `chapter-${String(i+1).padStart(2,'0')}` : `c${i+1}-s${++count}`;
    if (Number(level) === 2) outline.push({id, text: content.replace(/<[^>]+>/g, '')});
    return `<h${level} id="${id}" tabindex="-1">${content}</h${level}>`;
  });
  html = html.replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,'</table></div>');
  html = html.replace(/<a href="https:\/\//g, '<a target="_blank" rel="noopener noreferrer" href="https://');
  return {file, title, md, html, outline, number: i+1, htmlFile:file.replace(/\.md$/,'.html')};
});
const css = `
.blog-back{display:block;max-width:1440px;margin:18px auto 0;padding:0 28px;font-size:14px}
:root{color-scheme:light;--bg:#f5f3ee;--paper:#fffefa;--text:#26332e;--muted:#65736b;--line:#d9dfd6;--accent:#28664e;--code:#eef2ed;--nav:#edf1e9}
:root[data-theme=dark]{color-scheme:dark;--bg:#151c19;--paper:#1c2520;--text:#e0e8df;--muted:#abb9ad;--line:#3b4b40;--accent:#9ed4ac;--code:#25332a;--nav:#202c24}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}a:hover{text-decoration-thickness:2px}button,input{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--text);padding:7px 13px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.layout{max-width:1440px;margin:0 auto;display:grid;grid-template-columns:275px minmax(0,1fr);gap:30px;padding:28px 28px 70px}.sidebar{position:sticky;top:24px;max-height:calc(100vh - 48px);overflow:auto;padding:5px 15px 20px 0;scrollbar-width:thin}.brand{font-size:20px;font-weight:700;line-height:1.5;margin-bottom:8px}.eyebrow{font-size:12px;letter-spacing:.13em;color:var(--muted)}.sidebar p{font-size:13px;color:var(--muted);margin:8px 0 18px}.nav-link{display:block;padding:10px 12px;border-radius:7px;font-size:14px;text-decoration:none;line-height:1.7}.nav-link:hover,.nav-link.current{background:var(--nav)}.nav-link[aria-current=true]{background:var(--nav);font-weight:600}.nav-tools{display:flex;gap:8px;margin:16px 0}.nav-tools button{font-size:13px}.nav-search{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--text);margin:0 0 13px}.main{min-width:0}.hero{padding:34px 44px;background:var(--paper);border:1px solid var(--line);border-radius:12px;margin-bottom:24px}.hero h1{font-size:30px;line-height:1.5;margin:8px 0 12px}.hero p{margin:9px 0}.meta{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:13px;color:var(--muted)}.downloads{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;margin-top:18px}.notice{border-left:3px solid var(--accent);padding:8px 14px;background:var(--nav);margin:18px 0 0;font-size:14px}
.chapter{padding:35px 44px 40px;background:var(--paper);border:1px solid var(--line);border-radius:12px;margin-bottom:26px;overflow-wrap:break-word}.chapter h1{font-size:27px;line-height:1.55;margin:0 0 24px}.chapter h2{font-size:22px;line-height:1.65;margin:42px 0 16px;padding-top:8px;border-top:1px solid var(--line)}.chapter h3{font-size:18px;line-height:1.7;margin:28px 0 12px}.chapter h4{font-size:16px;margin:22px 0 10px}p{margin:14px 0}ul,ol{padding-left:1.55em}li{margin:6px 0}blockquote{border-left:3px solid var(--accent);margin:20px 0;padding:1px 18px;color:var(--muted);background:var(--nav);border-radius:0 7px 7px 0}blockquote p{margin:12px 0}code{font: .88em/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--code);padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}pre{background:var(--code);padding:18px 20px;border:1px solid var(--line);border-radius:9px;overflow-x:auto;max-width:100%;font-size:14px;line-height:1.75;tab-size:2}pre code{padding:0;background:transparent;white-space:pre;overflow-wrap:normal;word-break:normal;font-size:inherit}.table-wrap{overflow-x:auto;margin:22px 0;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;min-width:440px;font-size:14px;line-height:1.75}th,td{padding:11px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{background:var(--nav);font-weight:600}tr:last-child td{border-bottom:0}hr{border:0;border-top:1px solid var(--line);margin:30px 0}strong{font-weight:650}.chapter-toc{background:var(--nav);border-radius:8px;padding:12px 16px;margin:0 0 24px}.chapter-toc summary{cursor:pointer;font-size:14px}.chapter-toc ol{columns:2;font-size:13px;line-height:1.7;margin:12px 0 3px}.chapter-toc li{break-inside:avoid;margin:5px 0}.chapter-toc a{text-decoration:none}.chapter-links{display:flex;flex-wrap:wrap;gap:16px;margin:25px 0 0;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:17px}.mobile-head{display:none}.footer{color:var(--muted);font-size:13px;padding:8px 8px 0}.back-top{position:fixed;right:20px;bottom:20px;font-size:13px;box-shadow:0 2px 12px #0001}.read-progress{position:fixed;top:0;left:0;height:3px;background:var(--accent);width:0;z-index:10}.source-tag{font-size:12px;color:var(--muted)}
@media(max-width:900px){.layout{grid-template-columns:1fr;padding:15px 14px 60px;gap:15px}.sidebar{position:static;max-height:none;display:none;padding:16px;background:var(--paper);border:1px solid var(--line);border-radius:10px}.sidebar.open{display:block}.mobile-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 0}.hero,.chapter{padding:24px}.hero h1{font-size:26px}.chapter h1{font-size:24px}.chapter h2{font-size:21px}.chapter-toc ol{columns:1}.back-top{bottom:12px;right:12px}}
@media(max-width:480px){body{font-size:15px}.hero,.chapter{padding:19px 17px}.hero h1{font-size:24px}.chapter h1{font-size:23px}pre{padding:14px;font-size:12px}.table-wrap{margin:18px 0}.chapter h2{font-size:19px}.meta{font-size:12px}}
@media print{body{background:white;color:#111;font-size:11pt}.layout{display:block;padding:0}.sidebar,.mobile-head,.nav-tools,.back-top,.read-progress,.downloads,.chapter-links,.chapter-toc{display:none!important}.hero,.chapter{border:none;padding:0;border-radius:0}.chapter{break-before:page}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ddd;font-size:9pt}pre code{white-space:pre-wrap;overflow-wrap:anywhere}table{min-width:0}.table-wrap{overflow:visible}a{color:#111}h1,h2,h3{break-after:avoid}tr{break-inside:avoid}}
.nav-link[hidden]{display:none}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
` + overviewCss;
const js = `
const root=document.documentElement;
try{root.dataset.theme=localStorage.getItem('pi-study-theme')||'light'}catch{}
document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('pi-study-theme',root.dataset.theme)}catch{}}));
document.querySelector('[data-menu]')?.addEventListener('click',e=>{const expanded=document.querySelector('.sidebar').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(expanded))});
document.querySelector('[data-search]')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('.nav-link').forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(q))});
document.querySelector('[data-top]')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'}));
function progress(){const total=document.documentElement.scrollHeight-innerHeight;document.querySelector('.read-progress').style.width=(total>0?scrollY/total*100:100)+'%'}
addEventListener('scroll',progress,{passive:true});addEventListener('resize',progress);progress();
const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const id=entry.target.id;document.querySelectorAll('.nav-link[href^="#"]').forEach(a=>a.setAttribute('aria-current',String(a.getAttribute('href')==='#'+id))) }},{rootMargin:'-5% 0px -75% 0px'});
document.querySelectorAll('.chapter>h1').forEach(h=>observer.observe(h));
`;
const toc = lesson => `<details class="chapter-toc"><summary>本节小节目录 · ${lesson.outline.length} 项</summary><ol>${lesson.outline.map(o=>`<li><a href="#${o.id}">${o.text}</a></li>`).join('')}</ol></details>`;
function chapterHtml(lesson, combined){
  const body = lesson.html.replace(/(<\/h1>)/, '$1'+toc(lesson));
  const prev=lessons[lesson.number-2], next=lessons[lesson.number];
  const target=x=>combined?`#chapter-${String(x.number).padStart(2,'0')}`:encodeURI(x.htmlFile);
  return `<section class="chapter" data-chapter="${lesson.number}">${body}<div class="chapter-links">${prev?`<a href="${target(prev)}">← 第 ${prev.number} 节</a>`:''}${next?`<a href="${target(next)}">第 ${next.number} 节 →</a>`:''}<a href="${combined?'chapters/':''}${encodeURI(lesson.file)}" download>本节 Markdown</a>${combined?`<a href="chapters/${encodeURI(lesson.htmlFile)}">单独阅读本节</a>`:'<a href="../index.html">返回合订本</a>'}</div></section>`;
}
function page(selected, combined){
  const title=combined?'PI Agent Harness · 01–12 源码伴读':selected[0].title;
  const nav=`<a class="nav-link" href="${combined?'#pi-overview':'../pi-overview.html'}">总览 · 各部分怎样配合</a>`+lessons.map(l=>`<a class="nav-link${!combined&&l.number===selected[0].number?' current':''}" href="${combined?'#chapter-'+String(l.number).padStart(2,'0'):encodeURI(l.htmlFile)}">${escape(l.title.replace(/^第 /,'').replace(' 节：',' · '))}</a>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(title)}</title><style>${css}</style></head><body><div class="read-progress" aria-hidden="true"></div><div class="mobile-head"><span>PI · 源码伴读</span><button data-menu aria-expanded="false" aria-controls="chapter-nav">章节目录</button></div><div class="layout"><aside class="sidebar" id="chapter-nav"><div class="eyebrow">SOURCE WALKTHROUGH</div><div class="brand">PI Agent Harness</div><p>从一次请求到执行、历史和恢复。<br>按 01 → 12 顺序阅读。</p><input class="nav-search" data-search aria-label="筛选章节" placeholder="筛选章节标题"><nav aria-label="章节目录">${nav}</nav><div class="nav-tools"><button data-theme-toggle>切换明暗</button><button onclick="window.print()">打印</button></div><p>源码：<a href="${base.replace('/blob/','/tree/')}" target="_blank" rel="noopener noreferrer">eb326d2</a><br>包版本：1.0.4<br>本地整理：2026-10-26</p></aside><main class="main"><header class="hero"><div class="eyebrow">PI STUDY NOTES / 01—12</div><h1>${escape(title)}</h1><p>逐段看代码怎样接收输入、请求模型、执行工具、保存历史，并处理取消、重试和恢复。</p><div class="meta"><span>12 节完整讲解</span><span>固定提交源码引用</span><span>解释 · 例子 · 练习 · 面试追问</span></div><div class="downloads"><a href="${combined?'':'../'}PI-Agent-Harness-01-12.md" download>下载 Markdown 合订本</a><a href="${combined?'':'../'}README.md">阅读说明</a></div><div class="notice">静态源码伴读。示意轨迹、待执行练习与实际运行结果分别说明。本文提供源码分析与待执行练习，不将源码阅读作为模型实测或生产验收。</div></header>${selected.map(l=>chapterHtml(l,combined)).join('')}<footer class="footer">本系列按固定版本源码整理。源码链接固定到研究提交；本地源码若更新，请按函数名复核。HTML 内嵌样式和脚本，正文可离线阅读。</footer></main></div><button class="back-top" data-top aria-label="返回顶部">↑ 顶部</button><script>${js}</script></body></html>`;
}
writeOverview();
for (const lesson of lessons) fs.writeFileSync(path.join(root,'chapters',lesson.htmlFile),page([lesson],false).replace('<body>', '<body><a class="blog-back" href="../../../index.html">← Agent 笔记 · 所有文章</a>'));
fs.writeFileSync(path.join(root,'index.html'),page(lessons,true).replace('<body>', '<body><a class="blog-back" href="../../index.html">← Agent 笔记 · 所有文章</a>').replace('</header><section class="chapter"','</header>'+overviewMarkup()+'<section class="chapter"'));
const intro=`# PI Agent Harness：第 01–12 节源码伴读\n\n适合有基本编程能力、希望理解 Agent 实现并准备开发面试的读者。\n\n- 源码提交：\`${sha}\`，coding-agent 1.0.4。\n- 本地整理日期：2026-10-26。本系列基于固定版本源码整理。\n- 正文包含源码事实、标明的示意过程和待执行练习。本轮未运行 PI 项目测试、真实模型或生产服务。\n- 章节引用固定到同一提交；少量节选代码省略了不影响解释的字段。\n- F1–F8 统一采用第 06 节的编号。\n\n## 目录\n\n${lessons.map(l=>`- [${l.title}](#chapter-${String(l.number).padStart(2,'0')})`).join('\n')}\n\n`;
const combined=intro+lessons.map(l=>`<a id="chapter-${String(l.number).padStart(2,'0')}"></a>\n\n${l.md}`).join('\n\n---\n\n');
fs.writeFileSync(path.join(root,'PI-Agent-Harness-01-12.md'),combined);
fs.writeFileSync(path.join(root,'chapter-index.json'),JSON.stringify(lessons.map(l=>({number:l.number,title:l.title,markdown:'chapters/'+l.file,html:'chapters/'+l.htmlFile,characters:l.md.length,sections:l.outline.length})),null,2)+'\n');
console.log(JSON.stringify({chapters:lessons.length,characters:combined.length,markdown:path.join(root,'PI-Agent-Harness-01-12.md'),html:path.join(root,'index.html')},null,2));
