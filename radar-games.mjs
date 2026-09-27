/**
 * radar-games.mjs — jeux quotidiens déterministes du Quotidien du Radar 44.
 * Aucun service externe : une même date produit les mêmes grilles.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const seedOf = value => {
  let h = 2166136261 >>> 0;
  for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const rngOf = seed => {
  let x = seed || 0x9e3779b9;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
};
const shuffle = (arr, rand) => {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
};

const BASE_PUZZLE = [
  [5,3,0,0,7,0,0,0,0],[6,0,0,1,9,5,0,0,0],[0,9,8,0,0,0,0,6,0],
  [8,0,0,0,6,0,0,0,3],[4,0,0,8,0,3,0,0,1],[7,0,0,0,2,0,0,0,6],
  [0,6,0,0,0,0,2,8,0],[0,0,0,4,1,9,0,0,5],[0,0,0,0,8,0,0,7,9]
];
const BASE_SOLUTION = [
  [5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
  [8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
  [9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,9]
];

function permuteSudoku(grid, rand) {
  const digits = shuffle([1,2,3,4,5,6,7,8,9], rand);
  const map = n => n ? digits[n-1] : 0;
  const bands = shuffle([0,1,2], rand);
  const rows = bands.flatMap(b => shuffle([0,1,2], rand).map(r => b*3+r));
  const stacks = shuffle([0,1,2], rand);
  const cols = stacks.flatMap(s => shuffle([0,1,2], rand).map(c => s*3+c));
  let out = rows.map(r => cols.map(c => map(grid[r][c])));
  if (rand() < .5) out = out[0].map((_,c)=>out.map(row=>row[c]));
  return out;
}

export function sudokuFor(dayKey) {
  const rand = rngOf(seedOf('sudoku:'+dayKey));
  return { puzzle: permuteSudoku(BASE_PUZZLE, rand), solution: permuteSudoku(BASE_SOLUTION, rngOf(seedOf('sudoku:'+dayKey))) };
}

/* Les deux grilles doivent subir exactement les mêmes permutations. */
function sudokuPair(dayKey) {
  const seed = seedOf('sudoku:'+dayKey);
  const transform = grid => permuteSudoku(grid, rngOf(seed));
  return { puzzle: transform(BASE_PUZZLE), solution: transform(BASE_SOLUTION) };
}

const WORDS = [
  ['CHATEAUBRIANT','Sous-préfecture du nord du département'],
  ['ATLANTIQUE','Océan qui donne son nom au département'],
  ['NANTES','Préfecture de Loire-Atlantique'],
  ['DERVAL','Commune du Pays de Châteaubriant'],
  ['NOZAY','Commune située sur l’axe Nantes-Rennes'],
  ['MOISDON','Début du nom de Moisdon-la-Rivière'],
  ['MEILLERAYE','Commune de la communauté de communes Châteaubriant-Derval'],
  ['BRIERE','Grand marais de l’ouest de la Loire-Atlantique'],
  ['ERDRE','Rivière qui rejoint la Loire à Nantes'],
  ['LOIRE','Fleuve qui traverse le département'],
  ['ANCENIS','Ville ligérienne à l’est du département'],
  ['ROUGE','Commune au nord de Châteaubriant']
];

function canPlace(grid, word, row, col, dir) {
  const n=grid.length, dr=dir==='D'?1:0, dc=dir==='A'?1:0;
  const endR=row+dr*(word.length-1), endC=col+dc*(word.length-1);
  if(row<0||col<0||endR>=n||endC>=n) return false;
  let crosses=0;
  for(let k=0;k<word.length;k++){
    const r=row+dr*k,c=col+dc*k,cur=grid[r][c];
    if(cur && cur!==word[k]) return false;
    if(cur===word[k]) crosses++;
    if(!cur){
      if(dir==='A'){
        if((r>0&&grid[r-1][c])||(r<n-1&&grid[r+1][c])) return false;
      }else{
        if((c>0&&grid[r][c-1])||(c<n-1&&grid[r][c+1])) return false;
      }
    }
  }
  const beforeR=row-dr,beforeC=col-dc,afterR=endR+dr,afterC=endC+dc;
  if(beforeR>=0&&beforeC>=0&&beforeR<n&&beforeC<n&&grid[beforeR][beforeC]) return false;
  if(afterR>=0&&afterC>=0&&afterR<n&&afterC<n&&grid[afterR][afterC]) return false;
  return crosses>0;
}

function placeWord(grid, word, row, col, dir) {
  const dr=dir==='D'?1:0, dc=dir==='A'?1:0;
  for(let k=0;k<word.length;k++) grid[row+dr*k][col+dc*k]=word[k];
}

export function crosswordFor(dayKey) {
  const size=15, rand=rngOf(seedOf('crossword:'+dayKey));
  const grid=Array.from({length:size},()=>Array(size).fill(''));
  const bank=shuffle(WORDS,rand).sort((a,b)=>b[0].length-a[0].length);
  const placed=[];
  const first=bank.shift();
  const fc=Math.floor((size-first[0].length)/2);
  placeWord(grid,first[0],Math.floor(size/2),fc,'A');
  placed.push({word:first[0],clue:first[1],row:Math.floor(size/2),col:fc,dir:'A'});

  for(const [word,clue] of bank){
    const candidates=[];
    for(let pi=0;pi<placed.length;pi++){
      const p=placed[pi];
      for(let wi=0;wi<word.length;wi++){
        for(let pj=0;pj<p.word.length;pj++){
          if(word[wi]!==p.word[pj]) continue;
          const crossR=p.row+(p.dir==='D'?pj:0), crossC=p.col+(p.dir==='A'?pj:0);
          const dir=p.dir==='A'?'D':'A';
          const row=crossR-(dir==='D'?wi:0), col=crossC-(dir==='A'?wi:0);
          if(canPlace(grid,word,row,col,dir)) candidates.push({row,col,dir});
        }
      }
    }
    if(candidates.length){
      const pos=candidates[Math.floor(rand()*candidates.length)];
      placeWord(grid,word,pos.row,pos.col,pos.dir);
      placed.push({word,clue,...pos});
    }
    if(placed.length>=9) break;
  }

  let minR=size,minC=size,maxR=0,maxC=0;
  for(const p of placed){
    const er=p.row+(p.dir==='D'?p.word.length-1:0), ec=p.col+(p.dir==='A'?p.word.length-1:0);
    minR=Math.min(minR,p.row);minC=Math.min(minC,p.col);maxR=Math.max(maxR,er);maxC=Math.max(maxC,ec);
  }
  minR=Math.max(0,minR-1); minC=Math.max(0,minC-1); maxR=Math.min(size-1,maxR+1); maxC=Math.min(size-1,maxC+1);
  const numberAt=new Map(), clues=[], byStart=new Map();
  for(const p of placed){
    const key=p.row+','+p.col;
    if(!numberAt.has(key)) numberAt.set(key,0);
  }
  let num=1;
  [...numberAt.keys()].map(k=>k.split(',').map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).forEach(([r,c])=>numberAt.set(r+','+c,num++));
  for(const p of placed) clues.push({...p,num:numberAt.get(p.row+','+p.col)});
  return {grid,placed:clues,minR,minC,maxR,maxC,numberAt};
}

const SEARCH_WORDS = ['LOIRE','DERVAL','NOZAY','NANTES','ERDRE','BRIERE','ROUGE','MOISDON'];

export function wordSearchFor(dayKey) {
  const size=12, rand=rngOf(seedOf('wordsearch:'+dayKey)), grid=Array.from({length:size},()=>Array(size).fill(''));
  const dirs=[[0,1],[1,0],[1,1],[-1,1]];
  const placed=[];
  for(const word of shuffle(SEARCH_WORDS,rand)){
    let ok=false;
    for(let tries=0;tries<250&&!ok;tries++){
      const [dr,dc]=dirs[Math.floor(rand()*dirs.length)];
      const row=Math.floor(rand()*size), col=Math.floor(rand()*size);
      const er=row+dr*(word.length-1), ec=col+dc*(word.length-1);
      if(er<0||ec<0||er>=size||ec>=size) continue;
      let good=true;
      for(let k=0;k<word.length;k++){ const cur=grid[row+dr*k][col+dc*k]; if(cur&&cur!==word[k]){good=false;break;} }
      if(!good) continue;
      for(let k=0;k<word.length;k++) grid[row+dr*k][col+dc*k]=word[k];
      placed.push({word,row,col,dr,dc}); ok=true;
    }
  }
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!grid[r][c])grid[r][c]=alphabet[Math.floor(rand()*alphabet.length)];
  return {grid,placed};
}

function sudokuTable(grid, solution=false) {
  return '<table class="sudoku'+(solution?' solution':'')+'" aria-label="Sudoku">'+grid.map((row,r)=>
    '<tr>'+row.map((n,c)=>'<td class="'+((r%3===2&&r<8)?'bb ':'')+((c%3===2&&c<8)?'br':'')+'">'+(n||'')+'</td>').join('')+'</tr>'
  ).join('')+'</table>';
}

function crosswordHTML(cw) {
  let h='<table class="crossword" aria-label="Mots croisés">';
  for(let r=cw.minR;r<=cw.maxR;r++){
    h+='<tr>';
    for(let c=cw.minC;c<=cw.maxC;c++){
      const letter=cw.grid[r][c], n=cw.numberAt.get(r+','+c);
      h+=letter?'<td><span>'+(n||'')+'</span></td>':'<td class="blk"></td>';
    }
    h+='</tr>';
  }
  h+='</table>';
  const across=cw.placed.filter(p=>p.dir==='A').sort((a,b)=>a.num-b.num);
  const down=cw.placed.filter(p=>p.dir==='D').sort((a,b)=>a.num-b.num);
  const list=a=>'<ol>'+a.map(p=>'<li><b>'+p.num+'.</b> '+esc(p.clue)+'</li>').join('')+'</ol>';
  return h+'<div class="clues"><div><h4>Horizontal</h4>'+list(across)+'</div><div><h4>Vertical</h4>'+list(down)+'</div></div>';
}

function crosswordSolution(cw) {
  let h='<table class="crossword small">';
  for(let r=cw.minR;r<=cw.maxR;r++){ h+='<tr>'; for(let c=cw.minC;c<=cw.maxC;c++){const x=cw.grid[r][c];h+=x?'<td>'+x+'</td>':'<td class="blk"></td>';} h+='</tr>'; }
  return h+'</table>';
}

function wordSearchHTML(ws) {
  return '<table class="wordsearch">'+ws.grid.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</table><p class="wordbank">'+SEARCH_WORDS.join(' · ')+'</p>';
}

export function toGamesHTML(dayKey) {
  const s=sudokuPair(dayKey), cw=crosswordFor(dayKey), ws=wordSearchFor(dayKey);
  return `
<section class="games" id="jeux">
  <div class="games-head"><span>Cahier détachable</span><h2>Les jeux du jour</h2><p>Sudoku, mots croisés et mot mêlé — édition ${esc(dayKey)}</p></div>
  <div class="game-grid">
    <article class="game"><h3>Sudoku</h3><p>Complétez avec les chiffres de 1 à 9, sans répétition dans chaque ligne, colonne et carré.</p>${sudokuTable(s.puzzle)}<details><summary>Solution</summary>${sudokuTable(s.solution,true)}</details></article>
    <article class="game"><h3>Mots croisés du Pays</h3><p>Des lieux et repères de Loire-Atlantique.</p>${crosswordHTML(cw)}<details><summary>Solution</summary>${crosswordSolution(cw)}</details></article>
    <article class="game wide"><h3>Mot mêlé régional</h3><p>Retrouvez les huit noms cachés horizontalement, verticalement ou en diagonale.</p>${wordSearchHTML(ws)}<details><summary>Solution</summary><p>${ws.placed.map(p=>esc(p.word)+' : ligne '+(p.row+1)+', colonne '+(p.col+1)).join(' · ')}</p></details></article>
  </div>
</section>`;
}
