import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

const NAV=[['overview','01','Overview'],['architecture','02','Architecture'],['explorer','03','Explorer'],['setup','04','Setup'],['ask','05','Ask'],['missions','06','Missions']];
const fallback={summary:'Repository intelligence is ready.',language:'JavaScript',technologies:['Node.js','Express','React'],patterns:['REST API','Component UI'],architecture:[],keyFiles:[],setup:{prerequisites:[],install:[],commands:[],environment:[]},missions:[]};
function normalize(d){return {...fallback,...d,technologies:d?.technologies||[],patterns:d?.patterns||[],architecture:d?.architecture||[],keyFiles:d?.keyFiles||[],setup:{...fallback.setup,...(d?.setup||{})},missions:d?.missions||[]}}
function useScrollSpy(){const [active,setActive]=useState('overview');useEffect(()=>{const obs=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&setActive(e.target.id)),{rootMargin:'-32% 0px -58% 0px'});NAV.forEach(([id])=>{const el=document.getElementById(id);if(el)obs.observe(el)});return()=>obs.disconnect()},[]);return active}
function ParticleField(){
  const ref=useRef();
  useEffect(()=>{
    const c=ref.current,ctx=c.getContext('2d',{alpha:true});
    let w=0,h=0,dpr=1,pts=[],mx=0,my=0,lastX=0,lastY=0,energy=0,lastMove=0,raf=0,inside=false,lastT=performance.now(),hidden=false;
    let pointerVX=0,pointerVY=0,frame=0,quality=1,themeCache={bg:'#070707',color:'rgba(224,255,148,.78)',line:'rgba(220,255,150,ALPHA)',glow:'rgba(216,255,104,.45)'};
    let lastWidth=0,lastHeight=0;
    const isMobile=()=>innerWidth<700;
    const makePoints=(count)=>Array.from({length:count},(_,i)=>({
      x:Math.random()*w,y:Math.random()*h,
      vx:(Math.random()-.5)*(.18+Math.random()*.22),vy:(Math.random()-.5)*(.16+Math.random()*.20),
      r:Math.random()*.95+.45,a:Math.random()*.46+.34,p:Math.random()*Math.PI*2,seed:i
    }));
    const resize=()=>{
      w=innerWidth;h=innerHeight;
      if(Math.abs(w-lastWidth)<8&&Math.abs(h-lastHeight)<8)return;
      lastWidth=w;lastHeight=h;
      dpr=Math.min(devicePixelRatio||1,1.5);
      c.width=Math.floor(w*dpr);c.height=Math.floor(h*dpr);c.style.width=w+'px';c.style.height=h+'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);
      const mobile=isMobile(),area=Math.max(1,w*h);
      const base=mobile?Math.floor(area/5600):Math.floor(area/4700);
      const count=Math.max(mobile?100:205,Math.min(mobile?145:320,Math.floor(base*quality)));
      pts=makePoints(count);
    };
    const refreshTheme=()=>{
      const root=getComputedStyle(document.documentElement);
      themeCache={
        bg:root.getPropertyValue('--particle-bg').trim()||'#070707',
        color:root.getPropertyValue('--particle-color').trim()||'rgba(224,255,148,.78)',
        line:root.getPropertyValue('--particle-line').trim()||'rgba(220,255,150,ALPHA)',
        glow:root.getPropertyValue('--particle-glow').trim()||'rgba(216,255,104,.45)'
      };
    };
    const move=e=>{
      if(e.pointerType==='touch')return;
      const nx=e.clientX,ny=e.clientY,dx=nx-lastX,dy=ny-lastY;
      const s=Math.hypot(dx,dy);mx=nx;my=ny;inside=true;lastX=nx;lastY=ny;
      if(s>0.8){
        pointerVX=pointerVX*.55+dx*.45;pointerVY=pointerVY*.55+dy*.45;
        energy=Math.min(1,energy+s/105);lastMove=performance.now();
      }
    };
    const leave=()=>{inside=false;energy*=.3;pointerVX*=.35;pointerVY*=.35};
    const rebuildForQuality=()=>{
      const mobile=isMobile(),area=Math.max(1,w*h),base=mobile?Math.floor(area/5600):Math.floor(area/4700);
      const max=mobile?145:320,min=mobile?100:205;
      pts=makePoints(Math.max(min,Math.min(max,Math.floor(base*quality))));
    };
    const draw=(now)=>{
      if(hidden){raf=0;return;}
      const dt=Math.min(28,Math.max(10,now-lastT))/16.666;lastT=now;frame++;
      if(frame%45===0)refreshTheme();
      if(frame%180===0&&!isMobile()){
        const fps=1000/Math.max(16.7,dt*16.666);
        const next=fps<45?Math.max(.76,quality*.94):fps>58?Math.min(1.04,quality*1.015):quality;
        if(Math.abs(next-quality)>.035){quality=next;rebuildForQuality();}
      }

      ctx.clearRect(0,0,w,h);
      ctx.fillStyle=themeCache.bg;ctx.fillRect(0,0,w,h);

      const active=inside&&now-lastMove<240;
      energy*=Math.pow(active?.965:.875,dt);
      const pointerSpeed=Math.min(1,Math.hypot(pointerVX,pointerVY)/30);
      const speed=1+energy*(active?2.25:.62)+pointerSpeed*.3;
      pointerVX*=Math.pow(.80,dt);pointerVY*=Math.pow(.80,dt);

      if(energy>.02){
        const radius=active?(isMobile()?210:285):190;
        const g=ctx.createRadialGradient(mx,my,0,mx,my,radius);
        g.addColorStop(0,`rgba(216,255,104,${.095*energy})`);
        g.addColorStop(.45,`rgba(255,255,255,${.015*energy})`);
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      }

      // Batch particle circles by opacity. This avoids hundreds of shadow/paint state changes.
      const buckets=[[],[],[],[],[],[]];
      for(const p of pts){
        const phase=p.p+p.seed*.013;
        p.vx+=Math.sin(phase)*.00075*dt;
        p.vy+=Math.cos(p.p*.73+p.seed)*.00065*dt;

        if(active){
          const dx=p.x-mx,dy=p.y-my,dist2=dx*dx+dy*dy,radius=isMobile()?190:270;
          if(dist2<radius*radius){
            const dist=Math.sqrt(dist2)||1,influence=1-dist/radius;
            p.vx+=pointerVX*.0008*influence;
            p.vy+=pointerVY*.0008*influence;
            p.vx+=(-dy/dist)*.0038*influence*energy;
            p.vy+=(dx/dist)*.0038*influence*energy;
          }
        }

        const damp=Math.pow(.9965,dt);p.vx*=damp;p.vy*=damp;
        const maxV=active?.68:.36,mag2=p.vx*p.vx+p.vy*p.vy;
        if(mag2>maxV*maxV){const mag=Math.sqrt(mag2);p.vx=p.vx/mag*maxV;p.vy=p.vy/mag*maxV;}
        p.x+=p.vx*speed*dt;p.y+=p.vy*speed*dt;
        if(p.x<-16)p.x=w+16;if(p.x>w+16)p.x=-16;if(p.y<-16)p.y=h+16;if(p.y>h+16)p.y=-16;
        p.p+=.0115*speed*dt;

        const pulse=.84+.16*Math.sin(p.p),alpha=Math.min(.92,p.a*pulse*(1+energy*.3));
        const bucket=Math.min(5,Math.max(0,Math.floor(alpha*6)));
        buckets[bucket].push([p.x,p.y,p.r*pulse*(1+energy*.13)]);
      }
      ctx.fillStyle=themeCache.color;
      for(let b=0;b<6;b++){
        const alpha=(b+1)/7;
        ctx.globalAlpha=alpha;
        ctx.beginPath();
        for(const [x,y,r] of buckets[b]){ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);}
        ctx.fill();
      }
      ctx.globalAlpha=1;

      // Network lines only wake while the pointer is moving, keeping the idle page cheap.
      if(active&&energy>.025){
        const cell=120,grid=new Map();
        for(const p of pts){
          const gx=Math.floor(p.x/cell),gy=Math.floor(p.y/cell),k=gx+','+gy;
          let arr=grid.get(k);if(!arr){arr=[];grid.set(k,arr);}arr.push(p);
        }
        const connectDist=96,connect2=connectDist*connectDist;
        const alphaBuckets=[[],[],[],[]];
        for(const p of pts){
          const gx=Math.floor(p.x/cell),gy=Math.floor(p.y/cell);
          for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
            const arr=grid.get((gx+ox)+','+(gy+oy));
            if(!arr)continue;
            for(const q of arr){
              if(q===p||q.seed<=p.seed)continue;
              const dx=p.x-q.x,dy=p.y-q.y,dist2=dx*dx+dy*dy;
              if(dist2<connect2){
                const dist=Math.sqrt(dist2),near=1-dist/connectDist,midX=(p.x+q.x)*.5,midY=(p.y+q.y)*.5;
                const mdx=midX-mx,mdy=midY-my,mouseNear=Math.max(0,1-Math.sqrt(mdx*mdx+mdy*mdy)/260);
                const alpha=.045*near*energy*(.35+mouseNear*1.5);
                alphaBuckets[Math.min(3,Math.floor(alpha*90))].push([p.x,p.y,q.x,q.y]);
              }
            }
          }
        }
        ctx.lineWidth=.42;
        for(let b=0;b<4;b++){
          ctx.strokeStyle=themeCache.line.replace('ALPHA',String(.12*(b+1)));
          ctx.beginPath();
          for(const [x1,y1,x2,y2] of alphaBuckets[b]){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}
          ctx.stroke();
        }
      }

      raf=requestAnimationFrame(draw);
    };
    const onVisibility=()=>{
      hidden=document.visibilityState==='hidden';
      if(!hidden&&!raf){lastT=performance.now();raf=requestAnimationFrame(draw);}
    };

    refreshTheme();resize();
    addEventListener('resize',resize,{passive:true});
    addEventListener('pointermove',move,{passive:true});
    addEventListener('pointerleave',leave,{passive:true});
    document.addEventListener('visibilitychange',onVisibility);
    raf=requestAnimationFrame(draw);
    return()=>{
      cancelAnimationFrame(raf);
      removeEventListener('resize',resize);
      removeEventListener('pointermove',move);
      removeEventListener('pointerleave',leave);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[]);
  return <canvas ref={ref} className="particles" aria-hidden="true"/>;
}
function Cursor(){useEffect(()=>{if(matchMedia('(pointer:coarse)').matches)return;const el=document.createElement('div');el.className='cursor';el.innerHTML='<i></i><span>VIEW</span>';document.body.appendChild(el);let x=0,y=0,tx=0,ty=0,raf;const mv=e=>{tx=e.clientX;ty=e.clientY;el.classList.add('on');const t=e.target.closest('a,button,.interactive,.node,.file,.setup-copy,.command-item');if(t){el.classList.add('active');el.querySelector('span').textContent=t.dataset.cursor||'OPEN'}else{el.classList.remove('active');el.querySelector('span').textContent='VIEW'}};const leave=()=>el.classList.remove('on');const loop=()=>{x+=(tx-x)*.18;y+=(ty-y)*.18;el.style.transform=`translate3d(${x}px,${y}px,0)`;raf=requestAnimationFrame(loop)};addEventListener('pointermove',mv);addEventListener('pointerleave',leave);loop();return()=>{cancelAnimationFrame(raf);el.remove();removeEventListener('pointermove',mv);removeEventListener('pointerleave',leave)}},[]);return null}
function LocalTime(){const [now,setNow]=useState(new Date());useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[]);const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;const time=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);const place=zone.split('/').pop()?.replace(/_/g,' ')||'LOCAL';return <span className="local-time"><b>LOCAL</b> {place} · {time}</span>}
function Reveal({children,className=''}){const r=useRef();const [on,setOn]=useState(false);useEffect(()=>{const o=new IntersectionObserver(([e])=>e.isIntersecting&&setOn(true),{threshold:.08});if(r.current)o.observe(r.current);return()=>o.disconnect()},[]);return <div ref={r} className={`reveal ${on?'show':''} ${className}`}>{children}</div>}
function Architecture({data,isMapped=false}){const raw=(data.architecture?.length?data.architecture:[{name:'Application',type:'entry'},{name:'Routes',type:'api'},{name:'Services',type:'logic'},{name:'Data',type:'data'},{name:'UI',type:'frontend'}]).slice(0,10);const nodes=raw.map((n,i)=>({...n,x:[13,31,51,72,87,22,44,66,80,50][i],y:[27,16,30,18,42,61,72,59,76,48][i]}));return <div className="constellation interactive"><div className="constellation-grid"/><svg className="connections" viewBox="0 0 100 100" preserveAspectRatio="none">{nodes.map((n,i)=>nodes.slice(i+1).filter((_,j)=>j<2).map((m,j)=><line key={`${i}-${j}`} x1={n.x} y1={n.y} x2={m.x} y2={m.y}/>))}</svg>{nodes.map((n,i)=><div className="node" data-cursor="TRACE" key={i} style={{left:`${n.x}%`,top:`${n.y}%`}}><span>{String(i+1).padStart(2,'0')}</span><b>{n.name||n.title||'Module'}</b><small>{n.type||n.category||'component'}</small><i/></div>)}<div className="core"><span>CORE</span><strong>{isMapped?'MAPPED':'WAITING'}</strong><small>{nodes.length} MODULES</small></div><div className="scan"/></div>}
function App(){const active=useScrollSpy();const [repo,setRepo]=useState(()=>localStorage.getItem('cp_repo')||'');const [data,setData]=useState(null);const [loading,setLoading]=useState(false);const [analysisStage,setAnalysisStage]=useState(0);const [err,setErr]=useState('');const [q,setQ]=useState('How does this repository handle authentication?');const [answer,setAnswer]=useState('');const [askLoading,setAskLoading]=useState(false);const [mission,setMission]=useState(null);const [done,setDone]=useState(()=>{try{return JSON.parse(localStorage.getItem('cp_done')||'[]')}catch{return[]}});const [theme,setTheme]=useState(()=>localStorage.getItem('cp_theme')||'night');const [palette,setPalette]=useState(false);const [mobileNav,setMobileNav]=useState(false);const [explorerQuery,setExplorerQuery]=useState('');const [copied,setCopied]=useState('');
useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('cp_theme',theme)},[theme]);useEffect(()=>{const key=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(v=>!v)}if(e.key==='Escape'){setPalette(false);setMobileNav(false);setMission(null)}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key)},[]);
const d=normalize(data);const previewArch=[{name:'Entry',type:'runtime'},{name:'Routes',type:'api'},{name:'Services',type:'logic'},{name:'Data',type:'storage'},{name:'UI',type:'interface'}];const previewFiles=['package.json','src/','server.js','README.md','tests/'];const previewSetup=[['01','PREREQUISITES',['Runtime / package manager']],['02','INSTALL',['Install dependencies']],['03','COMMANDS',['Run the development server']],['04','ENVIRONMENT',['Configure local variables']]];const previewMissions=[{title:'Find the entry point',description:'Locate where the application starts.',difficulty:'EASY',files:[],skills:['Navigation']},{title:'Trace a request',description:'Follow a request from route to response.',difficulty:'MEDIUM',files:[],skills:['API']},{title:'Understand the data path',description:'Find where information enters and leaves the system.',difficulty:'MEDIUM',files:[],skills:['Data']},{title:'Ship a safe change',description:'Find a small contribution seam and its test path.',difficulty:'HARD',files:[],skills:['Testing']}];const missions=d.missions?.length?d.missions:previewMissions;const architectureNodes=data&&d.architecture?.length?d.architecture:previewArch;const filteredFiles=useMemo(()=>{const qx=explorerQuery.trim().toLowerCase();const source=d.keyFiles?.length?d.keyFiles:previewFiles;return source.filter(f=>!qx||JSON.stringify(f).toLowerCase().includes(qx)).slice(0,18)},[d.keyFiles,explorerQuery]);
const analyze=async()=>{if(!repo.trim())return;setLoading(true);setErr('');setAnswer('');setAnalysisStage(1);localStorage.setItem('cp_repo',repo);const stages=[1,2,3,4];let idx=0;const ticker=setInterval(()=>{idx=Math.min(idx+1,3);setAnalysisStage(stages[idx])},850);try{const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repoUrl:repo.trim()})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Analysis failed');setAnalysisStage(4);setData(normalize(j));setTimeout(()=>document.getElementById('overview')?.scrollIntoView({behavior:'smooth'}),500)}catch(e){setErr(e.message||'Could not analyze repository.')}finally{clearInterval(ticker);setLoading(false);setTimeout(()=>setAnalysisStage(0),1200)}};
const ask=async()=>{if(!q.trim())return;setAskLoading(true);try{const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repoUrl:repo.trim(),question:q.trim()})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Ask failed');setAnswer(j.answer||j.response||'No answer returned.')}catch(e){setAnswer('Could not reach CodePilot. '+e.message)}finally{setAskLoading(false)}};
const complete=i=>{const n=[...new Set([...done,i])];setDone(n);localStorage.setItem('cp_done',JSON.stringify(n))};const go=id=>{setMobileNav(false);document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})};const askAbout=text=>{setQ(text);setAnswer('');go('ask')};const copyText=async(text,key)=>{try{await navigator.clipboard.writeText(text);setCopied(key);setTimeout(()=>setCopied(''),1300)}catch{setCopied('no-clipboard')}};
const commands=[...NAV.map(([id,n,t])=>({label:`Go to ${t}`,meta:n,run:()=>go(id)})),{label:'Map repository',meta:'↵',run:analyze},{label:theme==='night'?'Switch to light mode':'Switch to night mode',meta:'THEME',run:()=>setTheme(theme==='night'?'day':'night')},{label:'Ask about authentication',meta:'ASK',run:()=>askAbout('How does this repository handle authentication?')}];
return <><ParticleField/><Cursor/><header className="top"><a className="brand" href="#top" data-cursor="HOME">CODE<span>/</span>PILOT</a><nav className="top-center" aria-label="Primary navigation">{NAV.map(([id,n,t])=><button key={id} className={active===id?'on':''} onClick={()=>go(id)}>{n}<span>{t}</span></button>)}</nav><div className="top-right"><span className="signal"/><span className="online-label">INTELLIGENCE ONLINE</span><LocalTime/><button className="theme-toggle" data-cursor="THEME" onClick={()=>setTheme(theme==='night'?'day':'night')} aria-label="Toggle theme">{theme==='night'?'☾ NIGHT':'☼ DAY'}</button><button className="palette-key" data-cursor="SEARCH" onClick={()=>setPalette(true)} aria-label="Open command palette">⌘K</button></div><button className="mobile-menu" onClick={()=>setMobileNav(v=>!v)} aria-label="Open navigation">{mobileNav?'×':'MENU'}</button></header>
{mobileNav&&<div className="mobile-nav"><div className="mobile-nav-head"><span>CHAPTERS</span><span>01—06</span></div>{NAV.map(([id,n,t])=><button key={id} onClick={()=>go(id)}><span>{n}</span><b>{t}</b><i>↘</i></button>)}<button onClick={()=>{setTheme(theme==='night'?'day':'night');setMobileNav(false)}}><span>07</span><b>{theme==='night'?'Light mode':'Night mode'}</b><i>{theme==='night'?'☼':'☾'}</i></button></div>}
<main id="top"><section className="hero"><div className="hero-orbit orbit-a"/><div className="hero-orbit orbit-b"/><div className="hero-inner"><div className="hero-kicker"><span>01</span> CODEBASE INTELLIGENCE / DEVELOPER ONBOARDING</div><h1>Meet the<br/><span>unknown.</span></h1><div className="hero-word">UNDERSTAND<br/>IT.</div><p>CodePilot turns an unfamiliar repository into something you can see, question, navigate and contribute to.</p><div className="repo-bar"><div className="repo-icon">⌁</div><input aria-label="GitHub repository" placeholder="https://github.com/your-username/your-repository" value={repo} onChange={e=>setRepo(e.target.value)} onKeyDown={e=>e.key==='Enter'&&analyze()}/><button data-cursor="RUN" onClick={analyze} disabled={loading}>{loading?'BUILDING MODEL…':'MAP REPOSITORY'} <b>↗</b></button></div>{err&&<div className="error" role="alert">{err}</div>}<div className="hero-data"><span>PUBLIC GITHUB</span><i/><span>STRUCTURE</span><i/><span>CONTEXT</span><i/><span>MISSIONS</span></div></div><div className="hero-side left"><span>CODEBASE<br/>INTELLIGENCE</span><b>∞</b></div><div className="hero-side right"><span>SCROLL<br/>TO EXPLORE</span><b>↓</b></div><div className="scroll-cue">SCROLL TO EXPLORE <span>↓</span></div></section>
<section className="statement"><div className="statement-line"><span>02 / WHY</span><i/></div><h2>The first hour in a new<br/><em>codebase</em> should not feel<br/>like archaeology.</h2><p>Instead of hunting through folders, README files and stale diagrams, CodePilot builds a living mental model of the project and gives you a path through it.</p><div className="statement-aside"><span>DESIGNED FOR</span><b>THE FIRST 60 MINUTES</b><small>Orientation → context → contribution</small></div></section>
<section id="overview" className="section overview"><div className="section-marker">03 / REPOSITORY</div><div className="section-title"><h3>{data?'A system has emerged.':'Your repository, made legible.'}</h3><div className="status"><span/> {data?'ANALYSIS COMPLETE':'AWAITING REPOSITORY'}</div></div><div className="signal-grid"><div className="signal-main"><span className="micro">{data?'REPOSITORY SIGNAL':'CODEPILOT PREVIEW'}</span><strong>{data?d.summary:'Paste a public GitHub URL above. Every chapter below is ready; analysis replaces the preview content with your repository.'}</strong><button data-cursor="EXPLORE" onClick={()=>go('architecture')}>{data?'EXPLORE THE MAP':'SEE HOW IT WORKS'} <b>↘</b></button></div><div className="signal-stat"><small>LANGUAGE</small><strong>{data?(d.language||'—'):'DETECTED'}</strong></div><div className="signal-stat"><small>STACK</small><strong>{data?(d.technologies.slice(0,4).join(' · ')||'—'):'AUTO-MAPPED'}</strong></div><div className="signal-stat"><small>PATTERNS</small><strong>{data?(d.patterns.slice(0,3).join(' · ')||'—'):'INFERRED'}</strong></div></div><div className="intelligence-strip"><div><span>KEY FILES</span><b>{data?d.keyFiles.length:'—'}</b></div><div><span>TECHNOLOGIES</span><b>{data?d.technologies.length:'—'}</b></div><div><span>MISSIONS</span><b>{missions.length}</b></div><div><span>AI MODE</span><b>{data?(d._provider==='watsonx'?'WATSONX':d._provider==='groq'?'GROQ':'MOCK'):'READY'}</b></div><div className="strip-note"><span>STATE</span><b>{data?'MAPPED':'PREVIEW'}</b></div></div><div className="tech-marquee"><span>REPOSITORY DNA</span>{(data?d.technologies:['NODE','API','STRUCTURE','CONTEXT','MISSIONS','ONBOARDING']).slice(0,8).map((x,i)=><b key={i}>{typeof x==='string'?x:x.name||'MODULE'}</b>)}</div></section>
<section id="architecture" className="section architecture"><div className="section-marker">04 / LIVE ARCHITECTURE</div><div className="arch-heading"><div><h3>{data?'Not a diagram.':'A model waiting for input.'}<br/><em>{data?'A living model.':'A living system.'}</em></h3></div><p>{data?'Hover the system. Follow the lines. Nodes are arranged as a visual model of the repository.':'Before analysis, this is the blueprint: entry, API, logic, data and interface. Analyze a repo and these nodes become repository-specific.'}</p></div><div className="arch-toolbar"><span>{data?'LIVE REPOSITORY MODEL':'INTERACTIVE BLUEPRINT'}</span><div><button onClick={()=>go('explorer')}>VIEW FILES ↘</button><button onClick={()=>askAbout('Explain the architecture of this repository and how its main modules connect.')}>ASK THE MAP ↗</button></div></div><Reveal><Architecture data={{...d,architecture:architectureNodes}} isMapped={Boolean(data)}/></Reveal></section>
<section id="explorer" className="section explorer"><div className="section-marker">05 / CODE EXPLORER</div><div className="explorer-heading"><div><h3>{data?'Some files':'A repository has landmarks.'}<br/><em>{data?'carry more gravity.':'Start with the important ones.'}</em></h3></div><p>{data?'CodePilot surfaces the places that matter first, so you can stop treating the repository like a flat directory.':'This preview shows the kinds of landmarks CodePilot looks for. Analyze the repository to replace them with real files.'}</p></div><div className="explorer-tools"><label><span>⌕</span><input value={explorerQuery} onChange={e=>setExplorerQuery(e.target.value)} placeholder="Search key files…" aria-label="Search key files"/></label><span>{filteredFiles.length} SHOWN</span></div><div className="file-radar">{filteredFiles.map((f,i)=><button className={`file ${!data?'preview-file':''}`} data-cursor="ASK" key={i} onClick={()=>data&&askAbout(`Explain the role of ${typeof f==='string'?f:f.path||f.name} in this repository.`)}><span>{String(i+1).padStart(2,'0')}</span><b>{typeof f==='string'?f:f.path||f.name}</b><small>{typeof f==='object'?(f.category||f.priority||'SOURCE'):'SOURCE'}</small><i>{data?'↗':'○'}</i></button>)}</div></section>
<section id="setup" className="section setup"><div className="section-marker">06 / FIRST RUN</div><div className="setup-heading"><h3>Clone.<br/>Run.<br/><em>Understand.</em></h3><div className="runline"><span>01</span><i/><span>02</span><i/><span>03</span><i/><span>04</span></div></div><div className="setup-grid">{(data?[['01','PREREQUISITES',d.setup.prerequisites],['02','INSTALL',d.setup.install],['03','COMMANDS',d.setup.commands],['04','ENVIRONMENT',d.setup.environment]]:previewSetup).map(([n,t,items])=><div className="setup-block" key={n}><span>{n}</span><h4>{t}</h4>{(items||[]).slice(0,6).map((x,i)=>{const text=typeof x==='string'?x:x.command||x.name;return <div className="setup-row" key={i}><code>{text}</code><button className="setup-copy" data-cursor="COPY" onClick={()=>copyText(text,`${n}-${i}`)} aria-label={`Copy ${text}`}>{copied===`${n}-${i}`?'✓':'↗'}</button></div>})}</div>)}</div></section>
<section id="ask" className="section ask"><div className="section-marker">07 / ASK THE SYSTEM</div><div className="ask-layout"><div><h3>Talk to the<br/><em>{data?'codebase.':'idea.'}</em></h3><p>{data?'Ask a question. CodePilot selects repository context and returns an explanation grounded in the analyzed system.':'Try a question now. After analysis, the same interface becomes grounded in the actual repository.'}</p><div className="quick-prompts">{['How does authentication work?','Where does the app start?','How does a request flow?','Where should I make a small change?'].map((x,i)=><button key={i} onClick={()=>{setQ(x);setAnswer('')}}>{x} ↗</button>)}</div></div><div className="ask-stage"><div className="ask-label"><span>CODEPILOT / QUERY</span><span className="mock">● {data?(d._provider==='watsonx'?'WATSONX':d._provider==='groq'?'GROQ':'MOCK AI'):'PREVIEW'}</span></div><textarea value={q} onChange={e=>setQ(e.target.value)} aria-label="Ask the codebase"/><button data-cursor="ASK" onClick={ask} disabled={askLoading}>{askLoading?'THINKING…':data?'ASK CODEPILOT':'TRY THE QUESTION'} <b>↗</b></button>{answer&&<Reveal><div className="answer"><span>RESPONSE</span><div className="answer-markdown">
<ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
</div></div></Reveal>}</div></div></section>
<section id="missions" className="section missions"><div className="section-marker">08 / ONBOARDING MISSIONS</div><div className="missions-hero"><div><h3>{data?'Your first days':'The onboarding path'}<br/><em>{data?'inside the system.':'before your first change.'}</em></h3><div className="mission-progress"><span>{done.length}/{missions.length} COMPLETE</span><i><b style={{width:`${Math.min(100,(done.length/missions.length)*100)}%`}}/></i></div></div><p>{data?'Learning by doing. Every mission moves from orientation toward a real contribution.':'A preview of the guided path. Once analyzed, missions become specific to the repository.'}</p></div><div className="mission-track">{missions.map((m,i)=>{const isDone=done.includes(i);return <button data-cursor="MISSION" className={`mission ${isDone?'complete':''} ${!data?'preview-mission':''}`} key={i} onClick={()=>setMission(m)}><span className="mission-no">{String(i+1).padStart(2,'0')}</span><span className="mission-line"/><div><small>{m.difficulty||'MISSION'}</small><strong>{m.title}</strong><p>{m.description}</p></div><i>{isDone?'✓':'↗'}</i></button>})}</div></section>
<div className="bottom-hud" aria-hidden="true"><span>SCROLL / <b>01—08</b></span><span className="hud-active">{active.toUpperCase()}</span><span>{data?'PUBLIC REPOSITORY / LIVE':'CODEPILOT / READY'}</span></div><section className="closing"><span>CODE/PILOT</span><h2>{data?'Make the unfamiliar':'Turn the unknown'}<br/><em>{data?'legible.':'into a map.'}</em></h2><button onClick={()=>go('top')} data-cursor="TOP">BACK TO TOP ↑</button></section><footer><span>CODE/PILOT</span><span>BUILT FOR IBM BOB 2.0</span><span>2026</span></footer></main>
{loading&&<div className="analysis-overlay"><div className="analysis-card"><span className="analysis-eyebrow">CODEPILOT / REPOSITORY REVEAL</span><h3>Building a model<br/><em>from the unknown.</em></h3><div className="analysis-steps">{['Inspect repository','Classify structure','Trace relationships','Assemble intelligence'].map((x,i)=><div className={analysisStage>i?'done':''} key={x}><span>{String(i+1).padStart(2,'0')}</span><b>{x}</b><i>{analysisStage>i?'✓':'○'}</i></div>)}</div><div className="analysis-bar"><i style={{width:`${Math.max(8,analysisStage*25)}%`}}/></div></div></div>}
{palette&&<div className="palette" onClick={()=>setPalette(false)}><div className="palette-card" onClick={e=>e.stopPropagation()}><div className="palette-top"><span>COMMAND / CODEPILOT</span><kbd>ESC</kbd></div><input autoFocus placeholder="Search actions or chapters…" onKeyDown={e=>{if(e.key==='Enter'){commands[0].run();setPalette(false)}}}/><div className="command-list">{commands.map((c,i)=><button className="command-item" data-cursor="RUN" key={i} onClick={()=>{c.run();setPalette(false)}}><span>{c.label}</span><b>{c.meta}</b></button>)}</div></div></div>}
{mission&&<div className="modal" onClick={()=>setMission(null)}><div className="modal-card" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setMission(null)} aria-label="Close mission">×</button><span className="section-marker">MISSION / DETAIL</span><h3>{mission.title}</h3><p>{mission.description}</p><div className="modal-meta"><div><small>FILES</small>{(mission.files||[]).length?(mission.files||[]).map((f,i)=><code key={i}>{typeof f==='string'?f:f.path||f.name}</code>):<code>Repository analysis will attach files</code>}</div><div><small>SKILLS</small>{(mission.skills||[]).map((s,i)=><span key={i}>{s}</span>)}</div></div><div className="mission-actions"><button className="secondary-btn" onClick={()=>{setMission(null);askAbout(`Help me complete the mission: ${mission.title}. What should I inspect first?`)}}>ASK ABOUT IT ↗</button>{data&&<button className="complete-btn" onClick={()=>{const i=missions.indexOf(mission);complete(i);setMission(null)}}>{done.includes(missions.indexOf(mission))?'MISSION COMPLETE':'MARK MISSION COMPLETE'} ↗</button>}</div></div></div>}
</>}

createRoot(document.getElementById('root')).render(<App/>);
