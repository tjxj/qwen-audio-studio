import {useEffect,useRef,useState} from 'react';
import {Sun,Moon,Loader2,X} from 'lucide-react';
import {getSettings,patchSettings} from '../../api';
import {applyTheme} from '../../theme';
export function ThemeToggle(){
 const [dark,setDark]=useState(document.documentElement.dataset.theme==='dark');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false);
 useEffect(()=>{const observer=new MutationObserver(()=>setDark(document.documentElement.dataset.theme==='dark'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect()},[]);
 const toggle=async()=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');const theme=dark?'light':'dark';try{const current=await getSettings();const updated=await patchSettings({expected_revision:current.revision,theme});applyTheme(theme);setDark(theme==='dark');window.dispatchEvent(new CustomEvent('qwen-theme-updated',{detail:updated}))}catch(e){setError(e instanceof Error?e.message:'主题保存失败，请重试')}finally{setBusy(false);locked.current=false}};
 return <div className="theme-control"><button className="theme-toggle" aria-label={dark?'切换为浅色模式':'切换为深色模式'} title={dark?'切换为浅色模式':'切换为深色模式'} disabled={busy} onClick={()=>void toggle()}>{busy?<Loader2 size={15} className="spin"/>:dark?<Moon size={15}/>:<Sun size={15}/>}<span>{dark?'深色':'浅色'}</span></button>{error?<div className="theme-notice" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭主题提示" onClick={()=>setError('')}><X size={14}/></button></div>:null}</div>;
}
