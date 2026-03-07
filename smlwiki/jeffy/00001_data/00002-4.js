const ctx=new(window.AudioContext||window.webkitAudioContext),urls=["/smlwiki/jeffy/JEFFY_END_00.opus","/smlwiki/jeffy/JEFFY_END_01.opus","/smlwiki/jeffy/JEFFY_END_02.opus","/smlwiki/jeffy/JEFFY_END_02.opus"];
const buffers={},gains={},sources={};let endsequence=!1;
function LA(e){return fetch(e).then(e=>e.arrayBuffer()).then(e=>ctx.decodeAudioData(e))}
Promise.all(urls.map(LA)).then(loaded => {
urls.forEach((a,c)=>{buffers[a]=loaded[c]});
urls.forEach(e=>{let c=ctx.createBufferSource();c.buffer=buffers[e];let n=ctx.createGain();n.gain.value=(e===urls[0]?1:0),c.connect(n).connect(ctx.destination),sources[e]=c,gains[e]=n});
window.postMessage({type:"musicready"},"*"),window.addEventListener("message",e=>{"musicstart"===e.data.type&&Object.values(sources).forEach(e=>e.start())});
});
function fadeIn(e,a=1){let n=gains[e];n&&(n.gain.cancelScheduledValues(ctx.currentTime),n.gain.setValueAtTime(n.gain.value,ctx.currentTime),n.gain.linearRampToValueAtTime(1,ctx.currentTime+a))}
function fadeOut(e,a=1){let i=gains[e];i&&(i.gain.cancelScheduledValues(ctx.currentTime),i.gain.setValueAtTime(i.gain.value,ctx.currentTime),i.gain.linearRampToValueAtTime(0,ctx.currentTime+a))}

function adddrums(){fadeIn(urls[2]),endsequence=!0}
function B1amb(){fadeIn(urls[1]);fadeOut(urls[0]);}
function B1amb_(){fadeOut(urls[1]);fadeIn(urls[0]);}
function C1amb(){fadeOut(urls[0]);fadeIn(urls[3]);}
function C1amb_(){fadeOut(urls[3]);fadeIn(urls[0]);}
function fadeall(){urls.forEach(e=>fadeOut(e)),handlecscenepass(document.querySelector("#timer-back"))}
function addfinal(){fadeOut(urls[2]),fadeOut(urls[0]),fadeIn(urls[3]),handlecscenepass(document.querySelector("#timer-back"));let e=gains[urls[3]];e&&(e.gain.setValueAtTime(e.gain.value,ctx.currentTime),e.gain.linearRampToValueAtTime(0,ctx.currentTime+4.7))}
const actions={adddrums,addfinal,fadeall,B1amb_,B1amb,C1amb,C1amb_};window.addEventListener("message",t=>{let a=actions[t.data.action];a&&a()});
