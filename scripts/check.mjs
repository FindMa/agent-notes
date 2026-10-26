import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChapterDiagrams } from './check-diagrams.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const docs=path.join(root,'docs');
const errors=[];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk(docs);
const htmls=files.filter(f=>f.endsWith('.html'));
const cache=new Map();
for(const f of htmls){
  const source=fs.readFileSync(f,'utf8');
  const ids=[...source.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  if(new Set(ids).size!==ids.length)errors.push(`Duplicate ids: ${path.relative(root,f)}`);
  cache.set(f,new Set(ids));
}
let localLinks=0;
for(const f of htmls){
  const source=fs.readFileSync(f,'utf8');
  for(const match of source.matchAll(/\b(?:href|src)="([^"]+)"/g)){
    const href=match[1].replace(/&amp;/g,'&');
    if(/^(https?:|mailto:|data:|\/\/)/.test(href))continue;
    if(href.startsWith('javascript:')){errors.push(`Executable URL: ${f}`);continue;}
    const [part,fragment]=href.split('#');
    let dest=part?path.resolve(path.dirname(f),decodeURI(part)):f;
    if(fs.existsSync(dest)&&fs.statSync(dest).isDirectory())dest=path.join(dest,'index.html');
    if(!fs.existsSync(dest)){errors.push(`Missing local target: ${path.relative(docs,f)} -> ${href}`);continue;}
    if(fragment&&cache.has(dest)&&!cache.get(dest).has(decodeURI(fragment)))errors.push(`Missing anchor: ${path.relative(docs,f)} -> ${href}`);
    localLinks++;
  }
}
const forbidden=[/\/Users\/[^\s"'<>]+/,/\/var\/folders\//,/file:\/\//,/\.claude\/projects\//,/session_memory_/,/larkoffice\.com/,/gh[pousr]_[A-Za-z0-9_]{30,}/,/sk-[A-Za-z0-9_-]{30,}/];
for(const f of [...files,...walk(path.join(root,'content'))]){
  const text=fs.readFileSync(f,'utf8');
  for(const pattern of forbidden)if(pattern.test(text))errors.push(`Non-public reference or credential pattern: ${path.relative(root,f)} ${pattern}`);
}
const index=JSON.parse(fs.readFileSync(path.join(docs,'posts/pi-harness/chapter-index.json'),'utf8'));
if(index.length!==12||index.some((c,i)=>c.number!==i+1))errors.push('PI chapter coverage differs from 01–12');
const piRoot=path.join(docs,'posts/pi-harness');
for(const c of index){
  const source=fs.readFileSync(path.join(piRoot,c.html),'utf8');
  if((source.match(/data-chapter-diagram=/g)??[]).length!==1||!source.includes(`data-chapter-diagram="${c.number}"`))errors.push(`Chapter ${c.number} must contain exactly one matching diagram`);
  if(!fs.existsSync(path.join(piRoot,'figures',`pi-chapter-${String(c.number).padStart(2,'0')}.html`)))errors.push(`Missing standalone diagram ${c.number}`);
}
if((fs.readFileSync(path.join(piRoot,'index.html'),'utf8').match(/data-chapter-diagram=/g)??[]).length!==12)errors.push('Combined reader must contain 12 chapter diagrams');
errors.push(...checkChapterDiagrams());
if(!fs.existsSync(path.join(docs,'.nojekyll')))errors.push('Missing .nojekyll');
if(!fs.readFileSync(path.join(docs,'posts/pi-harness/index.html'),'utf8').includes('id="pi-overview"'))errors.push('PI overview missing');
const posts=JSON.parse(fs.readFileSync(path.join(root,'content/posts.json'),'utf8'));
if(new Set(posts.map(p=>p.slug)).size!==posts.length)errors.push('Duplicate article slugs');
for(const post of posts)if(!fs.existsSync(path.join(docs,'posts',post.slug,'index.html')))errors.push(`Missing post: ${post.slug}`);
const config=JSON.parse(fs.readFileSync(path.join(root,'blog.config.json'),'utf8'));
if(process.argv.includes('--publish')){
  if(!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(config.repository))errors.push('Publication repository is not configured');
  if(!/^https:\/\/[^/]+\.github\.io\//.test(config.url))errors.push('GitHub Pages URL is not configured');
}
const result={ok:errors.length===0,htmlPages:htmls.length,posts:posts.length,piChapters:index.length,chapterDiagrams:12,checkedLocalLinks:localLinks,checks:['local assets and links','fragment targets','12 PI chapters and diagrams','diagram geometry','interactive overview included','publication content scan','article manifest'],errors};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exitCode=1;
