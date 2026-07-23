(function(root,factory){
  const api=factory(root&&root.localStorage);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MartAINotifications=api;
})(typeof window!=='undefined'?window:globalThis,function(browserStorage){
  const STORAGE_KEY='martai_notification_history_v1';
  const MAX_HISTORY=150;

  function safeText(value,max=240){
    return String(value??'').trim().slice(0,max);
  }
  function safeNumber(value){
    const number=Number(value);
    return Number.isFinite(number)?number:0;
  }
  function emptyState(){return{version:1,scopes:{}}}
  function createNotificationCenter(storage=browserStorage){
    let memory=emptyState();
    function load(){
      try{
        const parsed=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');
        if(parsed&&parsed.version===1&&parsed.scopes&&typeof parsed.scopes==='object')return parsed;
      }catch(_){}
      return memory;
    }
    function save(state){
      memory=state;
      try{storage?.setItem(STORAGE_KEY,JSON.stringify(state))}catch(_){}
    }
    function scopeState(state,scope){
      const key=safeText(scope,180)||'default';
      const existing=state.scopes[key];
      if(!existing||typeof existing!=='object')state.scopes[key]={entries:[],active:{}};
      const bucket=state.scopes[key];
      if(!Array.isArray(bucket.entries))bucket.entries=[];
      if(!bucket.active||typeof bucket.active!=='object')bucket.active={};
      return bucket;
    }
    function normalizeItem(item){
      return{
        key:safeText(item?.key,100),
        type:['notification','reminder'].includes(item?.type)?item.type:'notification',
        title:safeText(item?.title||item?.label,120),
        message:safeText(item?.message,240),
        count:Math.max(0,Math.round(safeNumber(item?.count))),
        amount:Math.max(0,safeNumber(item?.amount)),
        page:safeText(item?.page,40),
        tone:['danger','warning','info','success'].includes(item?.tone)?item.tone:'info'
      };
    }
    function signature(item){
      return JSON.stringify([item.count,item.amount,item.title,item.message,item.page,item.tone]);
    }
    function addEntry(bucket,item,createdAt){
      const stamp=safeText(createdAt,40)||new Date().toISOString();
      const entry={...item,id:'notice_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),createdAt:stamp,readAt:''};
      bucket.entries.unshift(entry);
      bucket.entries=bucket.entries.slice(0,MAX_HISTORY);
      return entry;
    }
    function view(bucket){
      const entries=bucket.entries.slice();
      return{entries,unread:entries.filter(entry=>!entry.readAt).length};
    }
    function sync(scope,items,createdAt){
      const state=load(),bucket=scopeState(state,scope),seen=new Set();
      (Array.isArray(items)?items:[]).map(normalizeItem).filter(item=>item.key&&item.title&&item.count>0).forEach(item=>{
        seen.add(item.key);
        const nextSignature=signature(item);
        if(bucket.active[item.key]!==nextSignature)addEntry(bucket,item,createdAt);
        bucket.active[item.key]=nextSignature;
      });
      Object.keys(bucket.active).forEach(key=>{if(!seen.has(key))delete bucket.active[key]});
      save(state);
      return view(bucket);
    }
    function record(scope,item,createdAt){
      const normalized=normalizeItem(item);
      if(!normalized.title)return null;
      const state=load(),bucket=scopeState(state,scope);
      const entry=addEntry(bucket,{...normalized,key:normalized.key||'manual_'+Date.now().toString(36),count:normalized.count||1},createdAt);
      save(state);
      return entry;
    }
    function get(scope){
      const state=load(),bucket=scopeState(state,scope);
      return view(bucket);
    }
    function markAllRead(scope,readAt){
      const state=load(),bucket=scopeState(state,scope),stamp=safeText(readAt,40)||new Date().toISOString();
      let changed=0;
      bucket.entries.forEach(entry=>{if(!entry.readAt){entry.readAt=stamp;changed++}});
      save(state);
      return changed;
    }
    function markRead(scope,idOrKey,readAt){
      const target=safeText(idOrKey,140);if(!target)return 0;
      const state=load(),bucket=scopeState(state,scope),stamp=safeText(readAt,40)||new Date().toISOString();
      let changed=0;
      bucket.entries.forEach(entry=>{if(!entry.readAt&&(entry.id===target||entry.key===target)){entry.readAt=stamp;changed++}});
      save(state);
      return changed;
    }
    function clear(scope){
      const state=load(),bucket=scopeState(state,scope),removed=bucket.entries.length;
      bucket.entries=[];
      save(state);
      return removed;
    }
    return{sync,record,get,markRead,markAllRead,clear};
  }
  const center=createNotificationCenter(browserStorage);
  return{STORAGE_KEY,MAX_HISTORY,createNotificationCenter,...center};
});
