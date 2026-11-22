const $=id=>document.getElementById(id),v=$('video'),c=$('source'),ctx=c.getContext('2d'),pc=$('preview').getContext('2d');
let id=null,still=null,sourceW=0,sourceH=0,sourceDuration=0,mode='cam',layout='stack',style='gta',drag=null,highlights=[],words=null,wordRange='',pendingImport=null,importToken=0,selectedTime=0;
let rectEdited=false,layoutClicked=false,layoutSpecs={},editingClip=null;
let rect={cam:{x:0,y:0,w:.25,h:.3},game:{x:.25,y:0,w:.75,h:1}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const status=t=>$('status').textContent=t;
async function request(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.detail||'Request failed');return data;}
function signature(){return [id,Number($('start').value),Number($('end').value),$('language').value].join(':');}
function clearWords(){words=null;wordRange='';$('words').replaceChildren();}
function setRange(start,end){$('start').value=start;$('end').value=end;clearWords();}
function setSource(j,seek=0){editingClip=null;$('saved-edit').hidden=true;id=j.id;sourceW=j.w;sourceH=j.h;sourceDuration=j.duration;still=null;v.onloadeddata=()=>{if(seek>0&&seek<v.duration)v.currentTime=seek;};v.src='/media/'+id;c.width=j.w;c.height=j.h;$('empty-source').hidden=true;$('source-mode').textContent='SOURCE READY';}
async function requireSource(){if(pendingImport&&!id){status('Source is downloading. Your layout is saved; this step will continue when ready.');await pendingImport;}if(!id)throw Error('Add a video link or upload a file first.');}
function showFrame(frame,meta,button){const image=new Image();image.onload=()=>{still=image;sourceW=image.naturalWidth;sourceH=image.naturalHeight;c.width=sourceW;c.height=sourceH;sourceDuration=meta.duration;selectedTime=frame.time;$('empty-source').hidden=true;$('source-mode').textContent=frame.kind.includes('storyboard')?'EARLY FRAME · LOW RES':'PREVIEW FRAME';v.pause();document.querySelectorAll('.frame-btn').forEach(b=>b.classList.remove('active'));button.classList.add('active');};image.src=frame.url;}
function addFrames(frames,meta){const current=$('frames').children.length;frames.slice(current).forEach((frame,index)=>{const button=document.createElement('button');button.className='frame-btn';const image=document.createElement('img');image.src=frame.url;image.alt='Source frame at '+frame.time+' seconds';const label=document.createElement('small');label.textContent=frame.time+'s';button.append(image,label);button.onclick=()=>showFrame(frame,meta,button);$('frames').append(button);if(current===0&&index===0&&!id){showFrame(frame,meta,button);if(Number($('end').value)>meta.duration)$('end').value=meta.duration;}});}
$('link').onclick=async()=>{
 const url=$('url').value.trim();if(!url){status('Paste a video link first.');return;}
 const token=++importToken;id=null;still=null;clearWords();$('frames').replaceChildren();$('link').disabled=true;$('progress-wrap').hidden=false;$('progress').style.width='2%';$('link-status').textContent='Getting early source frames…';
 const operation=(async()=>{const {job}=await request('/link',{url});let completed=false;
  for(;;){const s=await request('/status/'+job);if(token!==importToken)return;if(s.preview_frames)addFrames(s.preview_frames,s.preview_meta);
   $('link-status').textContent=s.status==='done'?'Source ready. Your selected areas are preserved.':(s.message||s.stage||'Importing source');$('progress').style.width=(s.status==='done'?100:Math.min(95,(s.progress||.05)*300))+'%';
   if(s.status==='error')throw Error(s.error);
   if(s.status==='done'&&!completed){completed=true;setSource(s,selectedTime);if(!Number($('end').value)||Number($('end').value)>s.duration)$('end').value=Math.min(30,s.duration);$('link-status').textContent='Source ready. Your selected areas are preserved.';status('Source ready. Find highlights or export your selected range.');}
   if(completed&&(s.preview_status!=='loading'||s.preview_frames?.length>=4))break;
   await sleep(700);
  }
 })();pendingImport=operation;
 try{await operation;}catch(e){$('link-status').textContent=e.message;status(e.message);}finally{if(token===importToken){pendingImport=null;$('link').disabled=false;}}
 if(token===importToken&&id&&$('auto-analyze').checked&&!$('analyze').disabled)await $('analyze').onclick();
};
$('file').onchange=async()=>{try{if(!$('file').files[0])return;++importToken;pendingImport=null;id=null;still=null;$('link').disabled=false;$('frames').replaceChildren();status('Uploading source…');const form=new FormData();form.append('file',$('file').files[0]);const response=await fetch('/upload',{method:'POST',body:form});const j=await response.json();if(!response.ok)throw Error(j.detail);$('url').value='';setSource(j);setRange(0,Math.min(30,j.duration));$('link-status').textContent='File ready';status('Draw the facecam and gameplay areas.');}catch(e){status(e.message);}};
function showHighlights(jobs){highlights=jobs.flatMap(job=>(job.clips||[]).map(clip=>({...clip,job:job.job||job.id,video:job.title})));const select=$('recent');select.replaceChildren();if(!highlights.length){const option=document.createElement('option');option.textContent='No highlights yet — add a video and Find highlights';select.append(option);}highlights.forEach((h,index)=>{const option=document.createElement('option');option.value=index;option.textContent=h.start.toFixed(1)+'–'+h.end.toFixed(1)+'s · '+h.title+(h.score!==undefined?' · activity '+h.score:'');select.append(option);});}
async function openHighlight(){const h=highlights[Number($('recent').value)];if(!h)return;const j=await request('/highlight-source',{job:h.job});setSource(j,h.start);setRange(h.start,h.end);status('Moment loaded. Review the source and selected areas.');}
$('import').onclick=()=>openHighlight().catch(e=>status(e.message));
$('analyze').onclick=async()=>{const button=$('analyze');button.disabled=true;try{if(!id&&!pendingImport&&$('url').value.trim()){await $('link').onclick();}await requireSource();status('Finding activity highlights locally…');const {job}=await request('/analyze',{id,count:Number($('count').value),length:Number($('length').value),min_len:Number($('minlen').value)});for(;;){const s=await request('/analysis/'+job);status((s.stage||s.status)+' · '+Math.round((s.progress||0)*100)+'%');if(s.status==='error')throw Error(s.error);if(s.status==='done'){showHighlights([s]);await openHighlight();status('Highlights ready. Choose a moment, review it and export.');break;}await sleep(900);}}catch(e){status(e.message);}finally{button.disabled=false;}};
['cam','game'].forEach(k=>$(k).onclick=()=>{mode=k;['cam','game'].forEach(x=>$(x).classList.toggle('active',x===k));});
function point(e){const b=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};}
c.onpointerdown=e=>{if(!still&&v.readyState<2)return;drag=point(e);c.setPointerCapture(e.pointerId);};c.onpointermove=e=>{if(!drag)return;rectEdited=true;const p=point(e);rect[mode]={x:Math.min(p.x,drag.x),y:Math.min(p.y,drag.y),w:Math.max(.01,Math.abs(p.x-drag.x)),h:Math.max(.01,Math.abs(p.y-drag.y))};};c.onpointerup=()=>drag=null;c.onpointercancel=()=>drag=null;
$('save').onclick=()=>{localStorage.setItem('ajay-crop',JSON.stringify({rect,top:$('top').value,layout}));status('Layout saved in this browser.');};$('load').onclick=()=>{try{const j=JSON.parse(localStorage.getItem('ajay-crop')||'null');if(j){rect=j.rect;rectEdited=true;$('top').value=j.top;setLayout(j.layout||'stack');status('Saved layout loaded.');}else status('No saved layout yet.');}catch(e){status('Saved layout could not be read.');}};
function setLayout(value){layout=value;if($('edit-top'))$('edit-top').value=$('top').value;document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active',b.dataset.layout===layout));$('height-control').hidden=['blur','fill','game'].includes(layout);}
document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{layoutClicked=true;setLayout(b.dataset.layout);});document.querySelectorAll('[data-style]').forEach(b=>b.onclick=()=>{style=b.dataset.style;document.querySelectorAll('[data-style]').forEach(x=>x.classList.toggle('active',x===b));});
v.onplay=()=>still=null;v.ontimeupdate=()=>{const end=Number($('end').value);if(end>Number($('start').value)&&v.currentTime>end&&end<v.duration)v.pause();};
['start','end','language'].forEach(key=>$(key).addEventListener('change',()=>{clearWords();if(key==='start'&&id)v.currentTime=Math.max(0,Math.min(v.duration||Infinity,Number($('start').value)));}));
function cover(source,r,x,y,w,h){const sw=r.w*sourceW,sh=r.h*sourceH,ratio=Math.max(w/sw,h/sh),cw=w/ratio,ch=h/ratio;pc.drawImage(source,r.x*sourceW+(sw-cw)/2,r.y*sourceH+(sh-ch)/2,cw,ch,x,y,w,h);}
function captionPreview(){if(!$('captions').checked)return;let line='YOUR NEXT BIG MOMENT';if(words&&wordRange===signature()&&words.length){const time=Math.max(0,v.currentTime-Number($('start').value));let index=words.findIndex(w=>time>=w.start&&time<=w.end);if(index<0)index=0;line=words.slice(Math.floor(index/3)*3,Math.floor(index/3)*3+3).map(w=>w.text).join(' ');}pc.save();pc.textAlign='center';pc.textBaseline='middle';pc.font=(style==='clean'?'500 28px':'900 36px')+' Arial';const max=480;while(pc.measureText(line).width>max){const size=parseFloat(pc.font.match(/(\d+)px/)[1]);pc.font='900 '+Math.max(12,size-1)+'px Arial';if(size<=12)break;}const y=(Number($('caption-y').value)===1450?(layoutSpecs[layout]?.caption_y||1450):Number($('caption-y').value))/2;pc.lineWidth=5;pc.strokeStyle='#160b22';pc.shadowBlur=style==='gta'?10:0;pc.shadowColor='#ff4ba5';pc.strokeText(line,270,y);pc.fillStyle=style==='gta'?'#58e8f7':style==='bold'?'#d4fb58':'white';pc.fillText(line,270,y);pc.restore();}
function paint(){const source=still||(v.readyState>=2?v:null);if(source){if(!still){sourceW=v.videoWidth;sourceH=v.videoHeight;}if(sourceW&&sourceH){ctx.drawImage(source,0,0,c.width,c.height);['cam','game'].forEach(k=>{const r=rect[k];ctx.strokeStyle=k==='cam'?'#ff4ba5':'#58e8f7';ctx.lineWidth=Math.max(2,c.width/350);ctx.strokeRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height);});pc.clearRect(0,0,540,960);drawNativeLayout(source);captionPreview();}}$('height-value').textContent=$('top').value+'%';requestAnimationFrame(paint);}paint();
function collectWords(){if(words&&wordRange===signature())return words;return null;}
function renderWords(){const editor=$('words');editor.replaceChildren();for(const word of words||[]){const input=document.createElement('input');input.value=word.text;input.title=word.start.toFixed(2)+'–'+word.end.toFixed(2)+'s';input.oninput=()=>word.text=input.value;editor.append(input);}}
async function generateSubtitles(){await requireSource();status('Starting local subtitles…');const range=signature();const {job}=await request('/transcribe',{id,start:Number($('start').value),end:Number($('end').value),language:$('language').value});for(;;){const s=await request('/status/'+job);status(s.message||s.status);if(s.status==='error')throw Error(s.error);if(s.status==='done'){if(signature()!==range)throw Error('Selected range changed. Generate subtitles for the current range.');words=s.words;wordRange=range;renderWords();const text=words.map(w=>w.text).join(' ');if(!$('clip-title').value)$('clip-title').value=text.split(/\s+/).slice(0,9).join(' ');if(!$('post-caption').value)$('post-caption').value=text.slice(0,220)+(text.length>220?'…':'')+'\n\n#Gaming #Clips';status(words.length?'Subtitles ready. Edit any word before exporting.':'No speech detected in this range.');return;}await sleep(1100);}}
$('transcribe').onclick=async()=>{$('transcribe').disabled=true;try{await generateSubtitles();}catch(e){status(e.message);}finally{$('transcribe').disabled=false;}};
function exportSettings(source,start,end){const res=$('resolution')?.value||'1080p';const b={id:source,...rect,layout,resolution:res,top:Number($('top').value)/100,start,end,captions:$('captions').checked,caption_style:style,caption_y:Number($('caption-y').value),language:$('language').value,hook:$('hook').value,title:$('clip-title').value,post_caption:$('post-caption').value};if(source===id&&start===Number($('start').value)&&end===Number($('end').value)){const edited=collectWords();if(edited!==null)b.words=edited;}return b;}
async function runExport(body,prefix=''){const {job}=await request('/export',body);for(;;){const s=await request('/status/'+job);status(prefix+(s.message||'Rendering…'));if(s.status==='error')throw Error(s.error);if(s.status==='done')return s;await sleep(1000);}}
function showDownload(s){$('download').href='/media/'+s.file;$('download').hidden=false;}
$('export').onclick=async()=>{const button=$('export');button.disabled=true;$('download').hidden=true;if($('srt'))$('srt').hidden=true;try{await requireSource();const res=$('resolution')?.value||'1080p';const s=await runExport(exportSettings(id,Number($('start').value),Number($('end').value)));showDownload(s);status('Ready · '+res+' · '+s.encoder+' · '+s.caption_words+' caption words');await refreshLibrary();}catch(e){status(e.message);}finally{button.disabled=false;}};
$('batch').onclick=async()=>{const button=$('batch');button.disabled=true;$('export').disabled=true;try{await requireSource();const selected=highlights[Number($('recent').value)];if(!selected)throw Error('Find highlights first.');const candidates=highlights.filter(h=>h.job===selected.job);const source=await request('/highlight-source',{job:selected.job});for(let i=0;i<candidates.length;i++){const h=candidates[i],body=exportSettings(source.id,h.start,h.end);body.title=($('clip-title').value||'Highlight')+' '+(i+1);const s=await runExport(body,'Clip '+(i+1)+' / '+candidates.length+' · ');showDownload(s);await refreshLibrary();}status(candidates.length+' clips exported. Open My clips to preview and download.');}catch(e){status(e.message);}finally{button.disabled=false;$('export').disabled=false;}};

let libraryClips=[];let libraryViewMode='folders';
function getClipDateBucket(timestamp){
 const d=new Date(timestamp*1000);const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const clipDay=new Date(d.getFullYear(),d.getMonth(),d.getDate());const diffDays=Math.round((today-clipDay)/(1000*60*60*24));
 const options={month:'short',day:'numeric',year:'numeric'};const formatted=d.toLocaleDateString(undefined,options);
 if(diffDays===0)return {key:'today',label:'Today — '+formatted,sortKey:0};
 if(diffDays===1)return {key:'yesterday',label:'Yesterday — '+formatted,sortKey:1};
 if(diffDays>1&&diffDays<7){const weekday=d.toLocaleDateString(undefined,{weekday:'long'});return {key:'this-week',label:weekday+' — '+formatted,sortKey:diffDays};}
 return {key:'date-'+formatted,label:formatted,sortKey:diffDays};
}

function renderClipCard(clip){
 const card=document.createElement('article');card.className='clip-card';
 const vidWrapper=document.createElement('div');vidWrapper.className='clip-vid-wrapper';
 const video=document.createElement('video');video.src='/media/'+clip.id;video.controls=true;video.preload='metadata';
 const resBadge=document.createElement('span');resBadge.className='clip-badge res';
 const h=clip.meta?.h||(clip.settings?.resolution==='720p'?1280:clip.settings?.resolution==='360p'?640:1920);
 const resLabel=h<=700?'360p':h<=1400?'720p':'1080p';resBadge.textContent=resLabel;
 const durBadge=document.createElement('span');durBadge.className='clip-badge dur';durBadge.textContent=(clip.meta?.duration||0).toFixed(1)+'s';
 vidWrapper.append(video,resBadge,durBadge);
 const title=document.createElement('h3');title.className='clip-title';title.textContent=clip.title||'avelly clip';title.title=clip.title||'avelly clip';
 const meta=document.createElement('div');meta.className='clip-meta';
 const dateStr=new Date(clip.created*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 const layoutName=(clip.settings?.layout||'stack').replace('_',' ');
 meta.textContent=dateStr+' · '+layoutName;
 const links=document.createElement('div');links.className='card-links';
 const download=document.createElement('a');download.className='btn-card-action primary-action';download.href='/media/'+clip.id;download.download='avelly-'+clip.id+'.mp4';download.textContent='↓ MP4';links.append(download);
 const edit=document.createElement('button');edit.className='btn-card-action';edit.textContent='✎ Edit';edit.onclick=()=>openSavedClip(clip.id).catch(e=>status(e.message));links.append(edit);
 card.append(vidWrapper,title,meta,links);
 return card;
}

function renderLibraryView(){
 const host=$('library');if(!host)return;host.replaceChildren();
 if(!libraryClips.length){const empty=document.createElement('div');empty.className='empty-library';empty.textContent='Your first clip belongs here. Export a moment to start your library.';host.append(empty);return;}
 let clips=[...libraryClips];
 const query=($('lib-search')?.value||'').trim().toLowerCase();
 if(query){clips=clips.filter(c=>(c.title||'').toLowerCase().includes(query)||new Date(c.created*1000).toLocaleDateString().toLowerCase().includes(query));}
 const sortMode=$('lib-sort')?.value||'newest';
 if(sortMode==='newest'){clips.sort((a,b)=>b.created-a.created);}
 else if(sortMode==='oldest'){clips.sort((a,b)=>a.created-b.created);}
 else if(sortMode==='duration'){clips.sort((a,b)=>(b.meta?.duration||0)-(a.meta?.duration||0));}
 if(!clips.length){const noResults=document.createElement('div');noResults.className='empty-library';noResults.textContent='No clips matched your search query.';host.append(noResults);return;}
 if(libraryViewMode==='flat'){const grid=document.createElement('div');grid.className='library-grid';clips.forEach(clip=>grid.append(renderClipCard(clip)));host.append(grid);}
 else{
  const groups=new Map();
  for(const clip of clips){const bucket=getClipDateBucket(clip.created);if(!groups.has(bucket.label))groups.set(bucket.label,{...bucket,clips:[]});groups.get(bucket.label).clips.push(clip);}
  for(const [label,group] of groups.entries()){
   const folder=document.createElement('div');folder.className='date-folder';
   const fHeader=document.createElement('div');fHeader.className='folder-header';
   fHeader.innerHTML='<div class="folder-title"><span class="folder-icon">📁</span><b>'+label+'</b><span class="folder-count">'+group.clips.length+' clip'+(group.clips.length===1?'':'s')+'</span></div><button class="folder-toggle" type="button">▼</button>';
   const grid=document.createElement('div');grid.className='library-grid';group.clips.forEach(clip=>grid.append(renderClipCard(clip)));
   fHeader.onclick=()=>{const isCollapsed=grid.classList.toggle('collapsed');fHeader.querySelector('.folder-toggle').textContent=isCollapsed?'▶':'▼';};
   folder.append(fHeader,grid);host.append(folder);
  }
 }
}

async function refreshLibrary(){libraryClips=await request('/library');$('library-count').textContent=libraryClips.length;renderLibraryView();}
$('lib-view-folders')?.addEventListener('click',()=>{libraryViewMode='folders';$('lib-view-folders')?.classList.add('on');$('lib-view-flat')?.classList.remove('on');renderLibraryView();});
$('lib-view-flat')?.addEventListener('click',()=>{libraryViewMode='flat';$('lib-view-flat')?.classList.add('on');$('lib-view-folders')?.classList.remove('on');renderLibraryView();});
$('lib-search')?.addEventListener('input',renderLibraryView);
$('lib-sort')?.addEventListener('change',renderLibraryView);

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));$('editor-view').hidden=b.dataset.view!=='editor';$('library-view').hidden=b.dataset.view!=='library';if(b.dataset.view==='library')refreshLibrary().catch(e=>status(e.message));});$('refresh-library').onclick=()=>refreshLibrary().catch(e=>status(e.message));
request('/highlights').then(showHighlights).catch(e=>status(e.message));refreshLibrary().catch(e=>status(e.message));
if(location.hash==='#library'||new URLSearchParams(location.search).get('view')==='library'){setTimeout(()=>document.querySelector('[data-view=library]')?.click(),50);}

$('make').onclick=async()=>{const url=$('url').value.trim();if(!url&&!id){status('Paste a video link or upload a file first.');return;}
 const b=$('make');b.disabled=true;$('make-results').hidden=false;$('make-grid').replaceChildren();$('make-progress').style.width='2%';
 try{const {job}=await request('/make',{...(url?{url}:{id}),count:Number($('count').value),mode:$('mode').value,accurate:$('accurate').value,resolution:$('resolution')?.value||'1080p',min_len:Number($('minlen').value),max_len:Number($('length').value),layout:makeLayout(),cam:rect.cam,game:rect.game,top:Number($('top').value)/100,caption_style:style,language:$('language').value==='auto'?'':$('language').value});
  const shown=new Set();
  for(;;){const s=await request('/make/'+job);$('make-status').textContent=(s.stage||s.status)+' · '+Math.round((s.progress||0)*100)+'%';$('make-progress').style.width=Math.max(2,(s.progress||0)*100)+'%';
   (s.clips||[]).forEach(c=>{if(shown.has(c.file))return;shown.add(c.file);const d=document.createElement('div');d.className='mk';
    if(c.error){d.textContent='Failed: '+c.error.slice(0,120);}else{const vid=document.createElement('video');vid.src='/media/'+c.file;vid.controls=true;vid.preload='metadata';const t=document.createElement('b');t.textContent=c.title;const m=document.createElement('small');m.textContent=Math.round(c.start)+'–'+Math.round(c.end)+'s · score '+c.score+(c.hook?' · "'+c.hook+'"':'');const a=document.createElement('a');a.href='/media/'+c.file;a.download='avelly-'+c.file+'.mp4';a.textContent='Download MP4';const rs=document.createElement('small');rs.textContent=c.reason||'';const vb=document.createElement('div');vb.className='viral';const ax=c.axes||{};const fmt=v=>v==null?'–':v;vb.title='Viral score is a heuristic: loudness, shouting, what is said, on-screen action and a local AI read. Your star ratings tune it.';vb.innerHTML='<b>🔥 Viral '+(c.viral??'–')+'</b><span>Energy '+fmt(ax.energy)+'</span><span>Action '+fmt(ax.action)+'</span><span>Words '+fmt(ax.words)+'</span><span>AI '+fmt(ax.ai)+'</span>';const stars=document.createElement('div');stars.className='stars';stars.title='Rate this clip: it teaches avelly what a good clip is';
    for(let n=1;n<=5;n++){const sb=document.createElement('button');sb.textContent='★';sb.onclick=async()=>{try{const r=await request('/feedback',{file:c.file,rating:n});[...stars.children].forEach((x,i)=>x.classList.toggle('on',i<n));fb.textContent='Thanks! Learning from '+r.ratings+' rating'+(r.ratings===1?'':'s')+(r.fitted?' · '+(r.insight[0]||''):' (needs 8 to start adapting)');}catch(e){fb.textContent=e.message;}};stars.append(sb);}
    const fb=document.createElement('small');fb.className='fb';fb.textContent='Rate this clip ↑';const edit=document.createElement('button');edit.textContent='Edit clip';edit.onclick=()=>openSavedClip(c.file).catch(e=>status(e.message));d.append(vid,t,vb,m,rs,a,edit,stars,fb);}
    $('make-grid').append(d);});
   if(s.status==='error')throw Error(s.error);if(s.status==='done'){$('make-status').textContent='Done · '+(s.clips||[]).length+' clips in '+s.elapsed_seconds+'s · also in My clips ('+(s.engine||'')+')';if(!$('make-results').querySelector('.star-ask')){const q=document.createElement('div');q.className='star-ask';q.innerHTML='Follow on Instagram: <a href="https://www.instagram.com/avellycode?evlk=ZDNlZDc0MzIxNw==" target="_blank" rel="noopener">@avellycode</a>';$('make-results').append(q);}break;}
   await sleep(1000);}}catch(e){$('make-status').textContent=e.message;}finally{b.disabled=false;}};

const PRESETS={tl:{cam:{x:0,y:0,w:.24,h:.32},game:{x:.24,y:0,w:.76,h:1}},tr:{cam:{x:.76,y:0,w:.24,h:.32},game:{x:0,y:0,w:.76,h:1}},
 bl:{cam:{x:0,y:.68,w:.24,h:.32},game:{x:.24,y:0,w:.76,h:1}},br:{cam:{x:.76,y:.68,w:.24,h:.32},game:{x:0,y:0,w:.76,h:1}},bc:{cam:{x:.37,y:.68,w:.26,h:.32},game:{x:0,y:0,w:1,h:.68}}};
let preset=null;
function applyPreset(k,save=true){preset=k;document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('on',b.dataset.preset===k));
 if(k==='none'){$('preset-note').textContent='Blurred full frame, no separate facecam.';document.querySelector('[data-layout=blur]')?.click();}
 else{rectEdited=true;rect={cam:{...PRESETS[k].cam},game:{...PRESETS[k].game}};$('preset-note').textContent='Preset set. Fine-tune by drawing in step 03 if your cam sits a bit differently.';document.querySelector('[data-layout=stack]')?.click();}
 if(save)try{localStorage.setItem('neonclipping-preset',k);}catch(e){}}
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));
try{const k=localStorage.getItem('neonclipping-preset');if(k)applyPreset(k,false);}catch(e){}

// Make clips uses what the user set up: preset or drawn boxes -> that layout; else the layout they clicked; else blurred full frame.
function makeLayout(){return (layoutClicked||rectEdited)?layout:'blur';}

async function loadNativeLayouts(){
 const entries=await request('/layouts?top='+Number($('top').value)/100);
 layoutSpecs=Object.fromEntries(entries.map(x=>[x.id,x]));
 for(const host of [$('layouts'),$('edit-layouts')].filter(Boolean)){host.replaceChildren();
 for(const entry of entries){const button=document.createElement('button');button.className='choice';button.dataset.layout=entry.id;
 const icon=document.createElement('span');icon.className='mini native-layout-mini';icon.setAttribute('aria-hidden','true');
 if(entry.mode==='blur'){const backdrop=document.createElement('i');backdrop.className='layout-backdrop';const inset=document.createElement('i');inset.className='layout-inset';icon.append(backdrop,inset);}
 else for(const layer of entry.layers){const shape=document.createElement('i');shape.className='layout-'+layer.source+(layer.circle?' layout-circle':'');Object.assign(shape.style,{left:(layer.x/1080*100)+'%',top:(layer.y/1920*100)+'%',width:(layer.w/1080*100)+'%',height:(layer.h/1920*100)+'%'});icon.append(shape);}
 const name=document.createElement('b');name.textContent=entry.name;const desc=document.createElement('small');desc.textContent=entry.description;
 button.append(icon,name,desc);button.onclick=()=>{layoutClicked=true;setLayout(entry.id);};host.append(button);}}
 setLayout(layout);
}
function drawNativeLayout(source){
 const spec=layoutSpecs[layout];if(!spec)return;
 if(spec.mode==='blur'){pc.save();pc.filter='blur(16px)';cover(source,{x:0,y:0,w:1,h:1},-15,-15,570,990);pc.restore();const ratio=Math.min(540/sourceW,960/sourceH),w=sourceW*ratio,h=sourceH*ratio;pc.drawImage(source,0,0,sourceW,sourceH,(540-w)/2,(960-h)/2,w,h);}
 else{pc.fillStyle='#000';pc.fillRect(0,0,540,960);for(const layer of spec.layers){pc.save();if(layer.circle){pc.beginPath();pc.arc((layer.x+layer.w/2)/2,(layer.y+layer.h/2)/2,Math.min(layer.w,layer.h)/4,0,Math.PI*2);pc.clip();}cover(source,layer.source==='full'?{x:0,y:0,w:1,h:1}:rect[layer.source],layer.x/2,layer.y/2,layer.w/2,layer.h/2);pc.restore();}}
 if($('safe-zones')?.checked){pc.save();pc.fillStyle='#ff4ba52b';pc.fillRect(0,0,540,48);pc.fillRect(0,840,540,120);pc.fillRect(470,250,70,590);pc.fillStyle='#fff';pc.font='14px sans-serif';pc.fillText('Platform controls — preview only',12,927);pc.restore();}
}
$('top').addEventListener('input',()=>loadNativeLayouts().catch(e=>status(e.message)));
loadNativeLayouts().catch(e=>status(e.message));

async function openSavedClip(file){
 const saved=await request('/clips/'+file+'/edit'),s=saved.settings;
 document.querySelector('[data-view=editor]').click();
 setSource(saved.source,Number(s.start));setRange(s.start,s.end);rect={cam:{...s.cam},game:{...s.game}};rectEdited=true;layoutClicked=true;
 $('top').value=Math.round((s.top||.32)*100);$('edit-top').value=$('top').value;await loadNativeLayouts();setLayout(s.layout||'stack');
 style=s.caption_style||'gta';document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('active',b.dataset.style===style));
 $('language').value=s.language||'';$('captions').checked=s.captions!==false;$('caption-y').value=s.caption_y||1450;
 $('hook').value=s.hook||'';$('clip-title').value=s.title||'';$('post-caption').value=s.post_caption||'';
 words=s.words||[];wordRange=signature();renderWords();editingClip=file;$('saved-edit').hidden=false;
 if($('edit-resolution'))$('edit-resolution').value=s.resolution||'1080p';
 if($('resolution'))$('resolution').value=s.resolution||'1080p';
 status('Saved clip loaded. Change framing or captions; saved source and words are reused.');
}
async function applySavedEdit(scope){
 if(!editingClip)throw Error('Open Edit clip from My clips first.');
 const settings=exportSettings(id,Number($('start').value),Number($('end').value));
 const changes={};for(const k of ['layout','top','cam','game','caption_style','caption_y','captions','hook','title','post_caption','resolution'])changes[k]=settings[k];
 if($('edit-resolution'))changes.resolution=$('edit-resolution').value;
 const body={file:editingClip,scope,changes};const edited=collectWords();if(edited!==null)body.words=edited;
 $('apply-one').disabled=true;$('apply-video').disabled=true;
 try{const {job,clips}=await request('/clips/reedit',body);status('Updating '+clips+' saved clip(s) — no download, AI picking or transcription.');
 for(;;){const result=await request('/status/'+job);status(result.stage||result.status);if(result.status==='error')throw Error(result.error);if(result.status==='done'){if(result.clips?.length){const changed=result.clips.find(c=>c.previous===editingClip)||result.clips[0];editingClip=changed.file;showDownload({file:changed.file,srt:changed.srt});}await refreshLibrary();status(clips+' clip(s) updated in '+result.elapsed_seconds+'s. Source, moments and subtitles reused.');break;}await sleep(500);}}
 finally{$('apply-one').disabled=false;$('apply-video').disabled=false;}
}
$('apply-one').onclick=()=>applySavedEdit('one').catch(e=>status(e.message));
$('apply-video').onclick=()=>applySavedEdit('video').catch(e=>status(e.message));

$('edit-top').addEventListener('input',()=>{$('top').value=$('edit-top').value;loadNativeLayouts().catch(e=>status(e.message));});

// Donate removed

// ---- Live clipping (record + chat spikes + backdated clips)
let liveId=null,liveTimer=null;const liveShown=new Set();
function liveStars(d,file){const stars=document.createElement('div');stars.className='stars';const fb=document.createElement('small');fb.className='fb';fb.textContent='Rate this clip ↑';
 for(let n=1;n<=5;n++){const sb=document.createElement('button');sb.textContent='★';sb.onclick=async()=>{try{const r=await request('/feedback',{file,rating:n});[...stars.children].forEach((x,i)=>x.classList.toggle('on',i<n));fb.textContent='Thanks! Learning from '+r.ratings+' rating'+(r.ratings===1?'':'s');}catch(e){fb.textContent=e.message;}};stars.append(sb);}
 d.append(stars,fb);}
function liveCard(c){const d=document.createElement('div');d.className='mk';
 if(c.error){d.textContent='Clip failed: '+c.error;return d;}
 const vid=document.createElement('video');vid.src='/media/'+c.file;vid.controls=true;vid.preload='metadata';
 const t=document.createElement('b');t.textContent=c.title;
 const ax=c.axes||{},f=v=>v==null?'–':v;const vb=document.createElement('div');vb.className='viral';vb.innerHTML='<b>🔥 Viral '+(c.viral??'–')+'</b><span>Chat '+f(ax.chat)+'</span><span>Energy '+f(ax.energy)+'</span><span>Words '+f(ax.words)+'</span><span>AI '+f(ax.ai)+'</span>';
 const m=document.createElement('small');m.textContent=(c.why||'')+(c.hook?' · "'+c.hook+'"':'');
 const a=document.createElement('a');a.href='/media/'+c.file;a.download='neonclipping-live-'+c.file+'.mp4';a.textContent='Download MP4';
 d.append(vid,t,vb,m,a);liveStars(d,c.file);return d;}
function liveStatus(s){const mm=String(Math.floor((s.elapsed||0)/60)).padStart(2,'0')+':'+String((s.elapsed||0)%60).padStart(2,'0');
 if(s.status==='error')return '⚠ '+(s.error||'Could not start');
 if(s.status==='starting')return s.stage;
 if(s.status==='recording')return '● Recording '+mm+' · chat '+s.chat_now+' msgs/10 s (normal '+s.baseline+') · chat '+s.chat+' · spikes '+s.spikes+' · clips '+s.clips.length+(s.pending?' · cutting '+s.pending+'…':'');
 return s.stage+' · clips '+s.clips.length;}
async function livePoll(){if(!liveId)return;try{const s=await request('/live/'+liveId);$('live-stats').textContent=liveStatus(s);
 s.clips.forEach((c,i)=>{if(liveShown.has(i))return;liveShown.add(i);$('live-grid').prepend(liveCard(c));});
 if(['stopped','ended','error'].includes(s.status)){clearInterval(liveTimer);liveTimer=null;$('live-start').disabled=false;}}catch(e){$('live-stats').textContent=e.message;clearInterval(liveTimer);$('live-start').disabled=false;}}
$('live-start').onclick=async()=>{const url=$('live-url').value.trim();if(!url){$('live-stats').textContent='Paste a Twitch or YouTube Live link first.';$('live-box').hidden=false;return;}
 $('live-start').disabled=true;$('live-box').hidden=false;$('live-grid').replaceChildren();liveShown.clear();$('live-stats').textContent='Starting the recorder…';
 try{const r=await request('/live/start',{url,layout:makeLayout(),cam:rect.cam,game:rect.game,top:Number($('top').value)/100,caption_style:style,language:$('language').value});liveId=r.live;liveTimer=setInterval(livePoll,2000);livePoll();}
 catch(e){$('live-stats').textContent='⚠ '+e.message;$('live-start').disabled=false;if(/already running/.test(e.message)){try{const r=await request('/live-active');if(r.live){liveId=r.live;$('live-start').disabled=true;liveTimer=setInterval(livePoll,2000);livePoll();}}catch(_){}}}};
$('live-now').onclick=async()=>{if(!liveId)return;try{await request('/live/'+liveId+'/clip-now',{});$('live-stats').textContent='Cutting the last 30 s…';}catch(e){$('live-stats').textContent='⚠ '+e.message;}};
$('live-stop').onclick=async()=>{if(!liveId)return;try{await request('/live/'+liveId+'/stop',{});}catch(e){}livePoll();};

// Re-attach to a live session that is already running (after a page reload) so Stop always works.
(async()=>{try{const r=await request('/live-active');if(r.live){liveId=r.live;$('live-box').hidden=false;$('live-start').disabled=true;liveTimer=setInterval(livePoll,2000);livePoll();}}catch(e){}})();
