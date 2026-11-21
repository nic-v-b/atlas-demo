// Shared appearance preference only. Store a fixed enum, NEVER financial data.
// This client-only preference is deliberately separate from any future secure vault.
const KEY='atlas-theme-preference-v1';
const choices=new Set(['light','dark']);
export function initializeAtlasTheme(){
  const button=document.getElementById('theme');
  if(!button) return;
  let saved=null;
  try{
    const candidate=window.localStorage.getItem(KEY);
    if(choices.has(candidate))saved=candidate;
  }catch{/* theme still works without persistent browser storage */}
  if(saved)document.body.classList.toggle('light',saved==='light');
  const update=()=>{
    const isLight=document.body.classList.contains('light');
    button.textContent=isLight?'☾':'☼';
    button.setAttribute('aria-label',isLight?'Switch to dark theme':'Switch to light theme');
    button.setAttribute('title',isLight?'Switch to dark theme':'Switch to light theme');
    button.setAttribute('aria-pressed',String(isLight));
  };
  button.addEventListener('click',()=>{
    document.body.classList.toggle('light');
    update();
    try{window.localStorage.setItem(KEY,document.body.classList.contains('light')?'light':'dark');}
    catch{/* never block theme toggle on storage availability */}
  });
  update();
}
