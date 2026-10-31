import { pdfCache } from './pdf-cache.js';
import { cloudSync } from './cloud-sync.js';
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { PATTERN_DATA as DATA } from './pattern-data.js';
import { DMC_COLORS } from './dmc-colors.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const $ = id => document.getElementById(id);
const viewer = $('viewerScroll'), pages = $('pdfPages'), panel = $('threadsPanel');
const STEP = DATA.geometry.step, COLS = 70, ROWS = 94, PER_ROW = 7;
const MIN_ZOOM = .5, MAX_ZOOM = 3, BASE_SIZE = 18;
const KNOWN_COLORS = DMC_COLORS;
let pdf = null, zoom = 1, mode = 'select', selected = null, done = new Set(), colorOverrides = {}, slots = [], observer = null, generation = 0, raf = 0;
let validDocument = false, allCells = new Map(), stats = new Map(), renderQueue = [], rendering = 0;
const colorFor = dmc => colorOverrides[dmc] || KNOWN_COLORS[dmc] || '#bac0c8';
const idFor = (page,row,col) => `${page}:${row}:${col}`;
const status = message => $('status').textContent = message;
const storageKey = type => `pattern-keeper-exact:${DATA.sha256}:${type}`;
const cellSize = () => BASE_SIZE * zoom;
const pageCols = i => i % 7 === 0 ? 5 : 70;
const pageRows = i => i > 28 ? 44 : 94;
const physicalWidth = () => (6 * 70 + 5) * cellSize();
const physicalHeight = () => (4 * 94 + 44) * cellSize();
const lookup = (page,row,col) => allCells.get(idFor(page,row,col));
const actions = document.createElement('div'); actions.className='pattern-actions';
actions.innerHTML = `<button id="selectMode" class="active">기호 선택</button><button id="checkMode">완료 체크</button><button id="clearSymbol">선택 해제</button><span id="chosenSymbol">선택한 기호 없음</span><span id="overallProgress">0 / 0</span>`;
viewer.before(actions);
const sortWrap=document.createElement('div');sortWrap.className='sort-wrap';sortWrap.innerHTML='<label for="sortThreads">실 목록 정렬</label><select id="sortThreads"><option value="most">많은 칸 순</option><option value="few">적은 칸 순</option><option value="number">DMC 번호 순</option></select>';
panel.querySelector('.panel-note').textContent='DMC 색상은 화면용 근삿값입니다. 완료 체크에서는 선택한 기호의 칸만 체크됩니다.';
panel.querySelector('.thread-placeholder').replaceWith(sortWrap);
const threadList=document.createElement('div');threadList.id='threadList';panel.append(threadList);
const root=document.createElement('div');root.id='wholePattern';pages.replaceChildren(root);
const canvasCache=new Map();
function loadSaved(){try{done=new Set(JSON.parse(localStorage.getItem(storageKey('done'))||'[]'));colorOverrides=JSON.parse(localStorage.getItem(storageKey('colors'))||'{}')}catch{done=new Set();colorOverrides={}}}
function saveSaved(){try{localStorage.setItem(storageKey('done'),JSON.stringify([...done]));localStorage.setItem(storageKey('colors'),JSON.stringify(colorOverrides))}catch(e){console.warn('저장 실패',e)}}
async function sha256(buffer){const hash=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function buildCells(){allCells=new Map();stats=new Map();for(let page=1;page<=35;page++){const grid=DATA.pages[page-1];for(let row=0;row<pageRows(page);row++)for(let col=0;col<pageCols(page);col++){const symbol=grid[row]?.[col];if(!symbol||symbol==='\uE000')continue;const dmc=DATA.mapping[symbol]||null;const id=idFor(page,row,col);const cell={page,row,col,id,symbol,dmc};allCells.set(id,cell);const key=dmc||`미확인 ${symbol}`;if(!stats.has(key))stats.set(key,{key,dmc,symbol,total:0,done:0});stats.get(key).total++}}recalculate()}
function recalculate(){for(const s of stats.values())s.done=0;for(const id of done){const cell=allCells.get(id);if(!cell)continue;const s=stats.get(cell.dmc||`미확인 ${cell.symbol}`);if(s)s.done++}const total=allCells.size;const checked=[...done].filter(id=>allCells.has(id)).length;$('overallProgress').textContent=`완료 ${checked.toLocaleString()} / ${total.toLocaleString()}`;updateSelected();updateThreads()}
function updateSelected(){const key=selected;const s=key?stats.get(key):null;$('chosenSymbol').textContent=s?`${s.dmc?'DMC '+s.dmc:s.key} (${s.done}/${s.total})`:'선택한 기호 없음'}
function updateThreads(){const sort=$('sortThreads').value;const sorted=[...stats.values()].sort((a,b)=>{const fa=a.done===a.total?1:0,fb=b.done===b.total?1:0;if(fa!==fb)return fa-fb;if(sort==='few')return a.total-b.total;if(sort==='number')return (Number(a.dmc)||99999)-(Number(b.dmc)||99999);return b.total-a.total});const fragment=document.createDocumentFragment();for(const s of sorted){const row=document.createElement('div');row.className='thread-row';if(selected===s.key)row.classList.add('selected');const btn=document.createElement('button');btn.className='thread-pick';btn.textContent=`${s.dmc?'DMC '+s.dmc:s.key}  (${s.done}/${s.total})`;btn.onclick=()=>{selected=s.key;mode='select';syncMode();updateSelected();updateThreads();redrawVisible()};row.append(btn);if(s.dmc){const color=document.createElement('input');color.type='color';color.className='thread-color';color.title=`DMC ${s.dmc} 색상 지정`;color.value=colorFor(s.dmc);color.onchange=()=>{colorOverrides[s.dmc]=color.value;saveSaved();cloudSync.color(s.dmc,color.value);redrawVisible()};color.setAttribute('aria-label',`DMC ${s.dmc} 색상 수정`);row.append(color)}fragment.append(row)}threadList.replaceChildren(fragment);panel.querySelector('.panel-title span').textContent=`${stats.size}종 / ${Object.keys(DATA.mapping).length}개 매핑`}
function syncMode(){$('selectMode').classList.toggle('active',mode==='select');$('checkMode').classList.toggle('active',mode==='check')}
function dispose(){generation++;observer?.disconnect();observer=null;renderQueue=[];for(const slot of slots){slot.task?.cancel();slot.canvas?.remove()}slots=[];canvasCache.clear();root.replaceChildren()}
function setDimensions(){const s=cellSize();root.style.width=`${physicalWidth()+78}px`;root.style.height=`${physicalHeight()+78}px`;for(const slot of slots){slot.box.style.left=`${48+slot.x*s}px`;slot.box.style.top=`${30+slot.y*s}px`;slot.box.style.width=`${slot.cols*s}px`;slot.box.style.height=`${slot.rows*s}px`;slot.canvas.style.width=`${slot.cols*s}px`;slot.canvas.style.height=`${slot.rows*s}px`;slot.overlay.style.width=`${slot.cols*s}px`;slot.overlay.style.height=`${slot.rows*s}px`;}}
function makeSlots(){dispose();for(let page=1;page<=35;page++){const cols=pageCols(page),rows=pageRows(page),x=((page-1)%7)*70,y=Math.floor((page-1)/7)*94;const box=document.createElement('div');box.className='pattern-tile';box.dataset.page=page;const canvas=document.createElement('canvas');canvas.className='tile-canvas';const overlay=document.createElement('canvas');overlay.className='tile-overlay';box.append(canvas,overlay);root.append(box);slots.push({page,cols,rows,x,y,box,canvas,overlay,task:null,ready:false,renderVersion:0});canvas.addEventListener('click',e=>onCellClick(e,page))}setDimensions();observer=new IntersectionObserver(entries=>{for(const entry of entries){const page=Number(entry.target.dataset.page),slot=slots[page-1];if(entry.isIntersecting)enqueue(slot);else{slot.renderVersion++;slot.task?.cancel();slot.task=null;slot.ready=false;slot.canvas.width=1;slot.canvas.height=1;slot.overlay.width=1;slot.overlay.height=1}}},{root:viewer,rootMargin:'220px'});for(const slot of slots)observer.observe(slot.box)}
function enqueue(slot){if(!pdf||!validDocument||slot.ready||slot.queued)return;slot.queued=true;renderQueue.push({slot,gen:generation});pump()}
function pump(){while(rendering<2&&renderQueue.length){const item=renderQueue.shift();item.slot.queued=false;if(item.gen!==generation)continue;rendering++;renderTile(item.slot,item.gen).finally(()=>{rendering--;pump()})}}
async function renderTile(slot,gen){const token=++slot.renderVersion;try{const currentPdf=pdf;const page=await currentPdf.getPage(slot.page);if(gen!==generation||token!==slot.renderVersion)return;const s=cellSize(),dpr=Math.min(devicePixelRatio||1,2);const outputScale=Math.min(dpr,Math.sqrt(5000000/(slot.cols*slot.rows*s*s)));const factor=s/STEP*outputScale;const viewport=page.getViewport({scale:factor});const c=slot.canvas;c.width=Math.ceil(slot.cols*s*outputScale);c.height=Math.ceil(slot.rows*s*outputScale);const context=c.getContext('2d');context.fillStyle='white';context.fillRect(0,0,c.width,c.height);
// PDF 원본에서 격자 부분만 그린다. 페이지 여백과 제목은 잘라낸다.
context.save();context.translate(-DATA.geometry.x*factor,-DATA.geometry.y*factor);slot.task=page.render({canvasContext:context,viewport});await slot.task.promise;context.restore();slot.task=null;if(gen!==generation||token!==slot.renderVersion)return;slot.ready=true;drawOverlay(slot)}catch(e){if(e?.name!=='RenderingCancelledException')console.error('페이지 렌더링 실패',slot.page,e)}}
function drawOverlay(slot){if(!slot.ready)return;const c=slot.overlay,ctx=c.getContext('2d');const s=cellSize(),scale=Math.min(devicePixelRatio||1,2);c.width=Math.ceil(slot.cols*s*scale);c.height=Math.ceil(slot.rows*s*scale);ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,slot.cols*s,slot.rows*s);ctx.save();for(let row=0;row<slot.rows;row++)for(let col=0;col<slot.cols;col++){const cell=lookup(slot.page,row,col);if(!cell)continue;const key=cell.dmc||`미확인 ${cell.symbol}`;if(done.has(cell.id)){ctx.fillStyle=cell.dmc?colorFor(cell.dmc):'#bac0c8';ctx.globalAlpha=.96;ctx.fillRect(col*s+.5,row*s+.5,Math.max(0,s-1),Math.max(0,s-1));ctx.globalAlpha=1}else if(selected===key){ctx.fillStyle='rgba(255,170,35,.42)';ctx.fillRect(col*s,row*s,s,s)}}ctx.beginPath();for(let x=0;x<=slot.cols;x++){const xx=x*s;ctx.moveTo(xx,0);ctx.lineTo(xx,slot.rows*s)}for(let y=0;y<=slot.rows;y++){const yy=y*s;ctx.moveTo(0,yy);ctx.lineTo(slot.cols*s,yy)}ctx.strokeStyle='rgba(0,0,0,.12)';ctx.lineWidth=.45;ctx.stroke();ctx.beginPath();for(let x=0;x<=slot.cols;x++){const globalX=slot.x+x;if(globalX%10!==0)continue;ctx.moveTo(x*s,0);ctx.lineTo(x*s,slot.rows*s)}for(let y=0;y<=slot.rows;y++){const globalY=slot.y+y;if(globalY%10!==0)continue;ctx.moveTo(0,y*s);ctx.lineTo(slot.cols*s,y*s)}ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=1.2;ctx.stroke();ctx.restore()}
// PDF를 재렌더링하지 않고 선택/체크만 바꿀 때 원본 캔버스가 필요하므로 해당 타일만 다시 렌더링한다.
function redrawVisible(){if(!pdf)return;for(const slot of slots){if(slot.ready)drawOverlay(slot)}}
function onCellClick(e,page){const slot=slots[page-1],rect=slot.canvas.getBoundingClientRect();const col=Math.floor((e.clientX-rect.left)/cellSize()),row=Math.floor((e.clientY-rect.top)/cellSize());const cell=lookup(page,row,col);if(!cell)return;const cellKey=cell.dmc||`미확인 ${cell.symbol}`;if(mode==='select'){selected=cellKey;updateSelected();updateThreads()}else{if(!selected||cellKey!==selected)return;if(done.has(cell.id))done.delete(cell.id);else done.add(cell.id);saveSaved();cloudSync.cell(cell.id,done.has(cell.id));recalculate()}redrawVisible()}
function zoomTo(next){if(!pdf)return;const z=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Math.round(next*100)/100));if(z===zoom)return;const old=zoom;const cx=viewer.scrollLeft+viewer.clientWidth/2,cy=viewer.scrollTop+viewer.clientHeight/2;zoom=z;$('zoomLabel').textContent=`${Math.round(zoom*100)}%`;const live=[...slots];for(const slot of live){slot.renderVersion++;slot.task?.cancel();slot.task=null;slot.ready=false;slot.canvas.width=1;slot.canvas.height=1;slot.overlay.width=1;slot.overlay.height=1}renderQueue=[];setDimensions();viewer.scrollLeft=cx*z/old-viewer.clientWidth/2;viewer.scrollTop=cy*z/old-viewer.clientHeight/2;observer?.disconnect();observer=new IntersectionObserver(entries=>{for(const entry of entries){const slot=slots[Number(entry.target.dataset.page)-1];if(entry.isIntersecting)enqueue(slot)}},{root:viewer,rootMargin:'220px'});slots.forEach(slot=>observer.observe(slot.box))}
function makeLabels(){root.querySelectorAll('.axis-label').forEach(e=>e.remove());const s=cellSize();const width=6*70+5,height=4*94+44;for(let x=10;x<=width;x+=10){const el=document.createElement('span');el.className='axis-label axis-top';el.style.left=`${48+x*s}px`;el.textContent=x;root.append(el)}for(let y=10;y<=height;y+=10){const el=document.createElement('span');el.className='axis-label axis-left';el.style.top=`${30+y*s}px`;el.textContent=y;root.append(el)}}
let openSequence = 0;
async function openPdfBuffer(buffer, filename, {remember = false} = {}) {
  const sequence = ++openSequence;
  let nextPdf;
  try {
    status('PDF 파일 확인 중...');
    const digest = await sha256(buffer);
    if (sequence !== openSequence) return;
    if (digest !== DATA.sha256) {
      status('등록된 41페이지 도안 PDF만 열 수 있어요.');
      return;
    }
    status('도안 불러오는 중...');
    nextPdf = await pdfjsLib.getDocument({data:new Uint8Array(buffer.slice(0))}).promise;
    if (sequence !== openSequence) { await nextPdf.destroy(); return; }
    if (nextPdf.numPages !== 41) throw Error('예상한 41페이지 PDF가 아닙니다.');
    const oldPdf = pdf;
    validDocument = false;
    dispose();
    pdf = nextPdf;
    validDocument = true;
    $('fileName').textContent = filename;
    $('pageInfo').textContent = '도안 35페이지';
    $('emptyState').hidden = true;
    $('emptyState').style.display = 'none';
    loadSaved();
    buildCells();
    makeSlots();
    makeLabels();
    if (oldPdf && oldPdf !== pdf) oldPdf.destroy().catch(console.warn);
    if (remember) {
      try { await pdfCache.put(DATA.sha256, buffer, filename); }
      catch (error) { console.warn('PDF 로컬 저장 실패:', error); status('도안은 열렸지만 브라우저에 PDF를 저장하지 못했어요.'); }
    }
    await cloudSync.openPattern(DATA.sha256,(progress,colors)=>{
      for(const item of progress){if(item.checked)done.add(item.cell_id);else done.delete(item.cell_id)}
      for(const item of colors)colorOverrides[item.dmc]=item.hex;
      saveSaved();recalculate();redrawVisible();
    });
    if (sequence === openSequence) status(`도안 준비 완료 · ${allCells.size.toLocaleString()}칸 · 자동 저장 사용 중`);
  } catch(error) {
    console.error(error);
    if(sequence === openSequence) status('PDF 열기 오류: '+error.message);
  }
}
$('pdfInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try { await openPdfBuffer(await file.arrayBuffer(), file.name, {remember:true}); }
  catch(error) { status('PDF 읽기 오류: '+error.message); }
});
// 페이지를 다시 열어도 동일한 기기에서 마지막 PDF를 자동으로 복원합니다.
(async()=>{
  try {
    const saved = await pdfCache.get(DATA.sha256);
    if (saved?.buffer && !pdf && openSequence === 0) {
      await openPdfBuffer(saved.buffer, saved.name || '저장된 PDF');
    }
  } catch(error) { console.warn('PDF 자동 복원 불가:',error); }
})();
$('zoomIn').onclick=()=>{zoomTo(zoom+.2);makeLabels()};$('zoomOut').onclick=()=>{zoomTo(zoom-.2);makeLabels()};$('zoomReset').onclick=()=>{zoomTo(1);makeLabels()};
$('selectMode').onclick=()=>{mode='select';syncMode()};$('checkMode').onclick=()=>{if(!selected){status('먼저 실 목록이나 도안에서 기호를 선택해 주세요.');return;}mode='check';syncMode()};$('clearSymbol').onclick=()=>{selected=null;mode='select';syncMode();updateSelected();updateThreads();redrawVisible()};$('sortThreads').onchange=updateThreads;
$('toggleThreads').onclick=()=>{panel.hidden=!panel.hidden;$('toggleThreads').textContent='실 목록';$('toggleThreads').setAttribute('aria-expanded',String(!panel.hidden))};
viewer.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoomTo(zoom+(e.deltaY<0?.1:-.1));makeLabels()},{passive:false});
if(matchMedia('(max-width:720px)').matches){panel.hidden=true;$('toggleThreads').textContent='실 목록'}

// Compact settings drawer: authentication is available without occupying the viewer.
const settingsDrawer = $('settingsDrawer'), drawerBackdrop = $('drawerBackdrop');
function setSettings(open){settingsDrawer.hidden=!open;drawerBackdrop.hidden=!open;$('openSettings').setAttribute('aria-expanded',String(open));if(open)$('closeSettings').focus();else $('openSettings').focus()}
$('openSettings').addEventListener('click',()=>setSettings(true));
$('closeSettings').addEventListener('click',()=>setSettings(false));
drawerBackdrop.addEventListener('click',()=>setSettings(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!settingsDrawer.hidden)setSettings(false)});
// Keep the chart wide on first load; threads remain accessible on demand.
panel.hidden=true;$('toggleThreads').setAttribute('aria-expanded','false');

$('forgetLocalPdf').addEventListener('click', async () => {
  if (!confirm('이 기기에 저장된 PDF만 삭제할까요? 완료 체크 기록은 유지됩니다.')) return;
  try { await pdfCache.remove(DATA.sha256); status('저장된 PDF를 삭제했어요. 현재 열린 도안은 그대로 유지됩니다.'); }
  catch (error) { status('PDF 삭제 실패: '+error.message); }
});
