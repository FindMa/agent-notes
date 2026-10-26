import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'agent-notes-article-check-'));
try{
  for(const file of ['content','scripts','package.json','blog.config.json','NOTICE'])fs.cpSync(path.join(root,file),path.join(temp,file),{recursive:true});
  fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
  const manifest=JSON.parse(fs.readFileSync(path.join(temp,'content/posts.json'),'utf8'));
  manifest.push({slug:'build-check',title:'构建检查',description:'仅在临时目录验证普通文章生成。',date:'2026-10-26',kind:'article',tags:['验证']});
  fs.writeFileSync(path.join(temp,'content/posts.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(temp,'content/articles/build-check.md'),'# 构建检查\n\n## 内容\n\n这是一份临时构建输入。\n');
  execFileSync(process.execPath,[path.join(temp,'scripts/build.mjs')],{cwd:temp,stdio:'pipe'});
  const check=execFileSync(process.execPath,[path.join(temp,'scripts/check.mjs')],{cwd:temp,encoding:'utf8'});
  const article=fs.readFileSync(path.join(temp,'docs/posts/build-check/index.html'),'utf8');
  const home=fs.readFileSync(path.join(temp,'docs/index.html'),'utf8');
  if(!article.includes('<h2>内容</h2>')||!home.includes('posts/build-check/index.html'))throw new Error('Article generation or homepage registration failed');
  console.log(JSON.stringify({ok:true,checks:['new Markdown article rendering','homepage article registration','all generated links and anchors'],temporaryValidation:JSON.parse(check)},null,2));
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
