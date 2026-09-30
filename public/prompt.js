window.spotPrompt.content(value=>{for(const key of ['title','message','detail','confirm'])document.getElementById(key).textContent=value[key];document.title=value.title;document.body.classList.add("ready");});
document.getElementById('cancel').onclick=()=>window.spotPrompt.reply(false);
document.getElementById('confirm').onclick=()=>window.spotPrompt.reply(true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.spotPrompt.reply(false);if(e.key==='Tab'){const buttons=[document.getElementById('cancel'),document.getElementById('confirm')];if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[1].focus();}else if(!e.shiftKey&&document.activeElement===buttons[1]){e.preventDefault();buttons[0].focus();}}});

