import { chapterDiagrams } from './chapter-diagrams.mjs';

// Check structural geometry before browser checks measure real font bounds.
export function checkChapterDiagrams(){
  const errors=[];
  const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  for(const d of chapterDiagrams){
    const fail=message=>errors.push(`Chapter ${d.chapter}: ${message}`);
    const nodes=d.nodes??d.actors.map(a=>({...a,x:a.x-80,y:56,w:160,h:56}));
    if(nodes.length+(d.actions?.length??0)>9)fail('more than 9 nodes');
    if((d.edges??d.messages).length>12)fail('more than 12 connectors');
    if(nodes.filter(n=>n.focal).length>2)fail('more than 2 focal nodes');
    for(const n of nodes){
      if([n.x,n.y,n.w,n.h].some(v=>v%4))fail(`off-grid node ${n.id}`);
      if(n.x<0||n.y<0||n.x+n.w>960||n.y+n.h>536)fail(`node outside content area ${n.id}`);
    }
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(overlap(nodes[i],nodes[j]))fail(`overlapping nodes ${nodes[i].id}/${nodes[j].id}`);
    const segments=[];
    const ports=[];
    for(const [index,e] of (d.edges??[]).entries()){
      if(e.label){
        for(const n of nodes)if(overlap(e.label,n))fail(`label ${e.label.text} overlaps ${n.id}`);
      }
      for(const [at,id] of [[0,e.from],[e.points.length-1,e.to]]){
        const point=e.points[at];
        for(const p of ports)if(p.id===id&&Math.hypot(p.point[0]-point[0],p.point[1]-point[1])<12)fail(`shared attachment at ${id}`);
        ports.push({id,point});
      }
      for(let i=1;i<e.points.length;i++){
        const a=e.points[i-1],b=e.points[i];
        if(a[0]!==b[0]&&a[1]!==b[1])fail(`diagonal connector ${e.from}/${e.to}`);
        const s={x1:Math.min(a[0],b[0]),x2:Math.max(a[0],b[0]),y1:Math.min(a[1],b[1]),y2:Math.max(a[1],b[1]),horizontal:a[1]===b[1],index};
        segments.push(s);
        for(const n of nodes.filter(n=>n.id!==e.from&&n.id!==e.to)){
          if(s.horizontal?s.y1>n.y&&s.y1<n.y+n.h&&s.x1<n.x+n.w&&s.x2>n.x:s.x1>n.x&&s.x1<n.x+n.w&&s.y1<n.y+n.h&&s.y2>n.y)fail(`connector ${e.from}/${e.to} passes through ${n.id}`);
        }
      }
    }
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
      const a=segments[i],b=segments[j];if(a.index===b.index)continue;
      if(a.horizontal===b.horizontal){
        if(a.horizontal?a.y1===b.y1&&a.x1<b.x2&&a.x2>b.x1:a.x1===b.x1&&a.y1<b.y2&&a.y2>b.y1)fail('overlapping connector segments');
      }else{
        const h=a.horizontal?a:b,v=a.horizontal?b:a;
        if(v.x1>h.x1&&v.x1<h.x2&&h.y1>v.y1&&h.y1<v.y2)fail('connector crossing without a bridge');
      }
    }
  }
  return errors;
}
