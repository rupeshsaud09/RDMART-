(function(){
  'use strict';

  const DB_NAME='khata_pana_backups_v1';
  const DB_VERSION=1;
  const SNAPSHOTS='snapshots';
  const META='meta';
  const HANDLE_KEY='backup-directory';
  const CONFIG_KEY='khata_auto_backup_config_v2';
  const BACKUP_FOLDER='KHATA PANA Backups';
  const AUTO_BACKUP_INTERVAL_DAYS=7;
  const AUTO_BACKUP_INTERVAL_MS=AUTO_BACKUP_INTERVAL_DAYS*24*60*60*1000;
  const RETENTION_VALUES=[1];
  const FORMAT_VERSION=3;
  const CHECKPOINT_LIMIT=3;
  const REQUIRED_ARRAYS=['stores','customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','activity','loginEvents','staffAccounts','paymentRequests'];
  let databasePromise=null;
  let cachedDirectoryHandle=null;

  function localDay(date=new Date()){
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function slug(value){
    return String(value||'store').normalize('NFKD').replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'store';
  }
  function normalizeRetention(value){
    return RETENTION_VALUES[0];
  }
  function automaticBackupDue(previous,date=new Date()){
    const lastBackup=Date.parse(previous?.lastBackupAt||'');
    return!Number.isFinite(lastBackup)||date.getTime()-lastBackup>=AUTO_BACKUP_INTERVAL_MS;
  }
  function readConfig(){
    let saved={};
    try{saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')||{}}catch(e){}
    return{
      enabled:saved.enabled!==false,
      retention:normalizeRetention(saved.retention),
      mode:saved.mode==='folder'?'folder':'browser',
      folderName:String(saved.folderName||''),
      stores:saved.stores&&typeof saved.stores==='object'?saved.stores:{}
    };
  }
  function saveConfig(config){
    try{localStorage.setItem(CONFIG_KEY,JSON.stringify(config))}catch(e){}
    window.dispatchEvent(new CustomEvent('khata-backup-status',{detail:config}));
    return config;
  }
  function updateConfig(patch){
    const config=readConfig();
    Object.assign(config,patch||{});
    config.retention=normalizeRetention(config.retention);
    return saveConfig(config);
  }
  function storeContext(db){
    const activeStoreId=String(window.MartAI?.getActiveStoreId?.()||'default');
    const localScope=window.MartAI?.syncInfo?.().mode!=='tables';
    const active=(db?.stores||[]).find(store=>String(store.id)===activeStoreId);
    const activeStoreName=String(active?.name||db?.settings?.martName||'RD MART').trim()||'RD MART';
    const storeId=localScope?'all-stores':activeStoreId,storeName=localScope?'All stores':activeStoreName;
    return{storeId,storeName,activeStoreId,localScope,filePrefix:`KHATA-PANA__${slug(storeId)}__`};
  }
  function fileNameFor(context,day){return context.filePrefix+day+'.json'}
  function timestampToken(date=new Date()){return date.toISOString().replace(/[:.]/g,'-')}
  function revisionFileNameFor(context,day,date=new Date()){return context.filePrefix+day+'__'+timestampToken(date)+'__'+randomToken()+'.json'}
  function checkpointFileNameFor(context,envelope){return context.filePrefix+'checkpoint__'+timestampToken(new Date(envelope.createdAt))+'__'+slug(String(envelope.checkpointId||'').slice(-12))+'.json'}
  function fileInfo(context,name){
    if(!String(name).startsWith(context.filePrefix))return null;
    const suffix=String(name).slice(context.filePrefix.length);
    const checkpoint=suffix.match(/^checkpoint__(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:__([a-z0-9-]+))?\.json$/i);
    if(checkpoint)return{kind:'checkpoint',day:'',revision:checkpoint[1]};
    const daily=suffix.match(/^(\d{4}-\d{2}-\d{2})(?:__(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:__([a-z0-9-]+))?)?\.json$/i);
    return daily?{kind:'daily',day:daily[1],revision:daily[2]||''}:null;
  }
  function fileDay(context,name){
    const info=fileInfo(context,name);return info?.kind==='daily'?info.day:'';
  }
  function isRecord(value){return!!value&&typeof value==='object'&&!Array.isArray(value)}
  function validateDataStructure(data){
    if(!isRecord(data))throw new Error('Backup data must be an object');
    if(!Number.isFinite(Number(data.version))||Number(data.version)<1)throw new Error('Backup data version is missing or invalid');
    if(!isRecord(data.settings)||typeof data.settings.martName!=='string')throw new Error('Backup settings are missing or invalid');
    for(const key of REQUIRED_ARRAYS){
      if(!Array.isArray(data[key]))throw new Error('Backup data is missing the '+key+' list');
      if(data[key].some(item=>!isRecord(item)))throw new Error('Backup '+key+' list contains an invalid record');
    }
    return data;
  }
  function assertDataScope(data,context){
    if(!context||context.localScope)return data;
    const scoped=['customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','paymentRequests'];
    for(const key of scoped)for(const item of Array.isArray(data[key])?data[key]:[]){
      const recordStoreId=item.storeId?String(item.storeId):'default';
      if(recordStoreId!==context.storeId)throw new Error('Backup contains unscoped data or data from a different store');
    }
    return data;
  }
  function utf8Bytes(value){
    const bytes=[];
    for(const character of String(value)){
      let code=character.codePointAt(0);
      if(code<=0x7f)bytes.push(code);
      else if(code<=0x7ff)bytes.push(0xc0|(code>>6),0x80|(code&63));
      else if(code<=0xffff)bytes.push(0xe0|(code>>12),0x80|((code>>6)&63),0x80|(code&63));
      else bytes.push(0xf0|(code>>18),0x80|((code>>12)&63),0x80|((code>>6)&63),0x80|(code&63));
    }
    return bytes;
  }
  function sha256(value){
    const bytes=utf8Bytes(value),words=[],bitLength=bytes.length*8;
    bytes.push(0x80);while(bytes.length%64!==56)bytes.push(0);for(let shift=56;shift>=0;shift-=8)bytes.push(Math.floor(bitLength/Math.pow(2,shift))&255);
    for(let index=0;index<bytes.length;index++)words[index>>2]=(words[index>>2]||0)|(bytes[index]<<(24-(index%4)*8));
    const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotate=(word,bits)=>(word>>>bits)|(word<<(32-bits));
    for(let offset=0;offset<words.length;offset+=16){
      const schedule=new Array(64);for(let index=0;index<16;index++)schedule[index]=words[offset+index]|0;
      for(let index=16;index<64;index++){const a=schedule[index-15],b=schedule[index-2],s0=rotate(a,7)^rotate(a,18)^(a>>>3),s1=rotate(b,17)^rotate(b,19)^(b>>>10);schedule[index]=(schedule[index-16]+s0+schedule[index-7]+s1)|0}
      let[a,b,c,d,e,f,g,h]=hash;
      for(let index=0;index<64;index++){const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),temp1=(h+s1+choice+constants[index]+schedule[index])|0,s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),temp2=(s0+majority)|0;h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0}
      hash[0]=(hash[0]+a)|0;hash[1]=(hash[1]+b)|0;hash[2]=(hash[2]+c)|0;hash[3]=(hash[3]+d)|0;hash[4]=(hash[4]+e)|0;hash[5]=(hash[5]+f)|0;hash[6]=(hash[6]+g)|0;hash[7]=(hash[7]+h)|0;
    }
    return hash.map(word=>(word>>>0).toString(16).padStart(8,'0')).join('');
  }
  function envelopeKind(value){return value?.kind==='checkpoint'?'checkpoint':'daily'}
  function integrityPayload(value){return JSON.stringify({format:value.format,formatVersion:value.formatVersion,product:value.product,kind:envelopeKind(value),createdAt:value.createdAt,backupDay:value.backupDay,storeId:value.storeId,storeName:value.storeName,checkpointId:value.checkpointId||'',data:value.data})}
  function envelopeChecksum(value){return'sha256:'+sha256(integrityPayload(value))}
  function randomToken(){try{return crypto.randomUUID().replace(/-/g,'').slice(0,12)}catch(e){return Math.random().toString(36).slice(2,14)}}
  function sanitizeBackupData(db){
    const data=JSON.parse(JSON.stringify(db));
    if(data.settings)data.settings.adminPass='';
    for(const customer of data.customers||[])customer.pin='';
    for(const staff of data.staffAccounts||[])delete staff.password;
    return data;
  }
  function createEnvelope(db,date=new Date(),options={}){
    validateDataStructure(db);
    const context=storeContext(db),backupDay=localDay(date),kind=options.kind==='checkpoint'?'checkpoint':'daily';
    const envelope={
      format:'khata-pana-backup',
      formatVersion:FORMAT_VERSION,
      product:'KHATA PANA',
      kind,
      createdAt:date.toISOString(),
      backupDay,
      storeId:context.storeId,
      storeName:context.storeName,
      secretsExcluded:true,
      data:sanitizeBackupData(db)
    };
    if(kind==='checkpoint')envelope.checkpointId=date.toISOString()+'-'+randomToken();
    envelope.checksum=envelopeChecksum(envelope);
    return envelope;
  }
  function validateEnvelope(value,context,day,expectedKind){
    if(!isRecord(value)||value.format!=='khata-pana-backup'||![1,2,FORMAT_VERSION].includes(Number(value.formatVersion)))throw new Error('Backup verification failed');
    if(value.product!=='KHATA PANA'||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('Backup metadata verification failed');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value.backupDay||''))||typeof value.storeId!=='string'||!value.storeId||typeof value.storeName!=='string')throw new Error('Backup scope metadata is invalid');
    if(Number(value.formatVersion)>=2&&!['daily','checkpoint'].includes(value.kind))throw new Error('Backup type metadata is invalid');
    const kind=envelopeKind(value);
    if(expectedKind&&kind!==expectedKind)throw new Error('Backup type verification failed');
    if(kind==='checkpoint'&&Number(value.formatVersion)>=2&&(typeof value.checkpointId!=='string'||!value.checkpointId.trim()))throw new Error('Checkpoint identity verification failed');
    validateDataStructure(value.data);
    if(Number(value.formatVersion)>=2&&value.checksum!==envelopeChecksum(value))throw new Error('Backup integrity check failed');
    if(context&&String(value.storeId)!==context.storeId)throw new Error('Backup store verification failed');
    assertDataScope(value.data,context);
    if(day&&value.backupDay!==day)throw new Error('Backup date verification failed');
    return value;
  }
  function validateForRestore(db,envelope){return validateEnvelope(envelope,storeContext(db))}
  function byteSize(text){
    try{return new Blob([text]).size}catch(e){return String(text).length}
  }
  function dataSignature(db){
    const text=JSON.stringify(db);let hash=2166136261;
    for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return(hash>>>0).toString(36)+':'+text.length;
  }
  async function requestPersistentStorage(){
    try{if(await navigator.storage?.persisted?.())return true;return!!(await navigator.storage?.persist?.())}catch(e){return false}
  }

  function openDatabase(){
    if(databasePromise)return databasePromise;
    databasePromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB)return reject(new Error('Browser backup storage is unavailable'));
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains(SNAPSHOTS)){
          const store=database.createObjectStore(SNAPSHOTS,{keyPath:'key'});
          store.createIndex('storeId','storeId',{unique:false});
        }
        if(!database.objectStoreNames.contains(META))database.createObjectStore(META,{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open browser backup storage'));
      request.onblocked=()=>reject(new Error('Close other KHATA PANA tabs and try again'));
    });
    return databasePromise;
  }
  function requestResult(request){
    return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Backup storage request failed'))});
  }
  function transactionDone(transaction){
    return new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error||new Error('Backup storage transaction failed'));transaction.onabort=()=>reject(transaction.error||new Error('Backup storage transaction was cancelled'))});
  }
  async function putRecord(storeName,value){
    const database=await openDatabase(),transaction=database.transaction(storeName,'readwrite'),done=transactionDone(transaction);
    await Promise.all([requestResult(transaction.objectStore(storeName).put(value)),done]);return value;
  }
  async function getRecord(storeName,key){
    const database=await openDatabase(),transaction=database.transaction(storeName,'readonly'),done=transactionDone(transaction);
    const[value]=await Promise.all([requestResult(transaction.objectStore(storeName).get(key)),done]);return value;
  }
  async function getAllRecords(storeName){
    const database=await openDatabase(),transaction=database.transaction(storeName,'readonly'),done=transactionDone(transaction);
    const[values]=await Promise.all([requestResult(transaction.objectStore(storeName).getAll()),done]);return values||[];
  }
  async function deleteRecords(storeName,keys){
    if(!keys.length)return;
    const database=await openDatabase(),transaction=database.transaction(storeName,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(storeName);
    keys.forEach(key=>store.delete(key));await done;
  }
  async function saveDirectoryHandle(handle,name){
    cachedDirectoryHandle=handle;
    try{await putRecord(META,{key:HANDLE_KEY,handle,name:name||handle?.name||BACKUP_FOLDER})}catch(e){console.warn('Backup folder handle could not be persisted:',e)}
  }
  async function loadDirectoryHandle(){
    if(cachedDirectoryHandle)return cachedDirectoryHandle;
    try{const saved=await getRecord(META,HANDLE_KEY);cachedDirectoryHandle=saved?.handle||null}catch(e){}
    return cachedDirectoryHandle;
  }
  async function directoryPermission(handle,requestAccess){
    if(!handle)return'missing';
    if(typeof handle.queryPermission!=='function')return'granted';
    let state=await handle.queryPermission({mode:'readwrite'});
    if(state==='prompt'&&requestAccess&&typeof handle.requestPermission==='function')state=await handle.requestPermission({mode:'readwrite'});
    return state;
  }

  async function snapshotsForStore(storeId){
    return(await getAllRecords(SNAPSHOTS)).filter(item=>item.storeId===storeId).sort((a,b)=>String(b.backupDay).localeCompare(String(a.backupDay))||String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function verifiedInternalSnapshots(context,kind=''){
    const verified=[];
    for(const snapshot of await snapshotsForStore(context.storeId)){
      try{
        const envelope=validateEnvelope(JSON.parse(snapshot.text),context,snapshot.backupDay),actualKind=envelopeKind(envelope);
        if(!kind||actualKind===kind)verified.push({...snapshot,kind:actualKind,envelope});
      }catch(e){}
    }
    return verified;
  }
  async function pruneInternal(context,retention,protectedKey=''){
    const valid=await verifiedInternalSnapshots(context,'daily');
    const pinned=valid.find(snapshot=>snapshot.key===protectedKey),ordered=pinned?[pinned,...valid.filter(snapshot=>snapshot!==pinned)]:valid,remove=ordered.slice(Math.max(1,retention));
    await deleteRecords(SNAPSHOTS,remove.map(item=>item.key));
    return{kept:ordered.length-remove.length,deleted:remove.length};
  }
  async function pruneInternalCheckpoints(context,protectedKey=''){
    const valid=(await verifiedInternalSnapshots(context,'checkpoint')).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    const pinned=valid.find(snapshot=>snapshot.key===protectedKey),ordered=pinned?[pinned,...valid.filter(snapshot=>snapshot!==pinned)]:valid,remove=ordered.slice(CHECKPOINT_LIMIT);
    await deleteRecords(SNAPSHOTS,remove.map(item=>item.key));
    return{kept:ordered.length-remove.length,deleted:remove.length};
  }
  async function writeInternal(text,envelope,context,retention){
    const record={key:context.storeId+'|'+envelope.backupDay,kind:'daily',storeId:context.storeId,storeName:context.storeName,backupDay:envelope.backupDay,createdAt:envelope.createdAt,fileName:fileNameFor(context,envelope.backupDay),size:byteSize(text),text};
    await putRecord(SNAPSHOTS,record);
    const verified=await getRecord(SNAPSHOTS,record.key);
    validateEnvelope(JSON.parse(verified.text),context,envelope.backupDay,'daily');
    const pruned=await pruneInternal(context,retention,record.key);
    return{...record,...pruned};
  }
  async function writeInternalCheckpoint(text,envelope,context){
    const key=context.storeId+'|checkpoint|'+envelope.checkpointId;
    if(await getRecord(SNAPSHOTS,key))throw new Error('Checkpoint identity already exists');
    const record={key,kind:'checkpoint',storeId:context.storeId,storeName:context.storeName,backupDay:envelope.backupDay,createdAt:envelope.createdAt,fileName:checkpointFileNameFor(context,envelope),size:byteSize(text),text};
    await putRecord(SNAPSHOTS,record);
    const verified=await getRecord(SNAPSHOTS,key);
    validateEnvelope(JSON.parse(verified.text),context,envelope.backupDay,'checkpoint');
    const pruned=await pruneInternalCheckpoints(context,key);
    return{...record,...pruned};
  }

  async function folderFiles(handle,context){
    const files=[];
    for await(const[name,entry]of handle.entries()){
      const info=entry.kind==='file'?fileInfo(context,name):null;
      if(info)files.push({name,entry,...info});
    }
    return files.sort((a,b)=>b.day.localeCompare(a.day)||b.name.localeCompare(a.name));
  }
  async function verifiedFolderFiles(handle,context){
    const verified=[];
    for(const item of await folderFiles(handle,context)){
      try{const file=await item.entry.getFile(),envelope=validateEnvelope(JSON.parse(await file.text()),context,item.kind==='daily'?item.day:'',item.kind);verified.push({...item,day:envelope.backupDay,file,envelope,createdAt:envelope.createdAt})}catch(e){}
    }
    return verified;
  }
  async function pruneFolder(handle,context,retention,protectedName=''){
    const files=(await verifiedFolderFiles(handle,context)).filter(file=>file.kind==='daily'),pinned=files.find(file=>file.name===protectedName);
    const groups=new Map();
    for(const file of files){if(!groups.has(file.day))groups.set(file.day,[]);groups.get(file.day).push(file)}
    const days=[...groups.keys()].sort((a,b)=>b.localeCompare(a));
    if(pinned){const index=days.indexOf(pinned.day);if(index>0){days.splice(index,1);days.unshift(pinned.day)}}
    const keptDays=new Set(days.slice(0,Math.max(1,retention))),keepNames=new Set();
    for(const day of keptDays){
      const candidates=groups.get(day).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.name.localeCompare(a.name));
      keepNames.add(pinned?.day===day?pinned.name:candidates[0].name);
    }
    const remove=files.filter(file=>!keepNames.has(file.name));
    let deleted=0,warning='';
    for(const file of remove){
      try{await handle.removeEntry(file.name);deleted++}catch(error){warning='A previous backup could not be removed: '+(error.message||String(error))}
    }
    return{kept:files.length-deleted,deleted,warning};
  }
  async function writeFolder(handle,text,envelope,context,retention){
    const name=revisionFileNameFor(context,envelope.backupDay,new Date(envelope.createdAt)),fileHandle=await handle.getFileHandle(name,{create:true}),writable=await fileHandle.createWritable();
    try{await writable.write(text);await writable.close()}catch(error){try{await writable.abort()}catch(e){}throw error}
    const writtenFile=await fileHandle.getFile(),writtenText=await writtenFile.text();
    validateEnvelope(JSON.parse(writtenText),context,envelope.backupDay,'daily');
    const pruned=await pruneFolder(handle,context,retention,name);
    return{fileName:name,size:writtenFile.size,...pruned};
  }
  async function pruneFolderCheckpoints(handle,context,protectedName=''){
    const files=(await verifiedFolderFiles(handle,context)).filter(file=>file.kind==='checkpoint').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),pinned=files.find(file=>file.name===protectedName),ordered=pinned?[pinned,...files.filter(file=>file!==pinned)]:files,remove=ordered.slice(CHECKPOINT_LIMIT);
    let deleted=0,warning='';
    for(const file of remove){try{await handle.removeEntry(file.name);deleted++}catch(error){warning='An older checkpoint could not be removed: '+(error.message||String(error))}}
    return{kept:ordered.length-deleted,deleted,warning};
  }
  async function writeFolderCheckpoint(handle,text,envelope,context){
    const name=checkpointFileNameFor(context,envelope);
    try{await handle.getFileHandle(name);throw new Error('Checkpoint identity already exists')}catch(error){if(error.message==='Checkpoint identity already exists')throw error;if(error.name&&error.name!=='NotFoundError')throw error}
    const fileHandle=await handle.getFileHandle(name,{create:true}),writable=await fileHandle.createWritable();
    try{await writable.write(text);await writable.close()}catch(error){try{await writable.abort()}catch(e){}throw error}
    const writtenFile=await fileHandle.getFile(),writtenText=await writtenFile.text();
    validateEnvelope(JSON.parse(writtenText),context,envelope.backupDay,'checkpoint');
    const pruned=await pruneFolderCheckpoints(handle,context,name);
    return{fileName:name,size:writtenFile.size,...pruned};
  }

  async function performBackup(db,options={}){
    const context=storeContext(db),now=new Date(),day=localDay(now),config=readConfig(),previous=config.stores[context.storeId]||{},signature=dataSignature(db);
    if(!config.enabled&&!options.force)return{skipped:true,reason:'disabled',context};
    const externalNeedsRetry=config.mode==='folder'&&previous.lastMode!=='folder';
    const needsFormatUpgrade=Number(previous.lastFormatVersion)!==FORMAT_VERSION;
    if(!options.force&&!needsFormatUpgrade&&!externalNeedsRetry&&!automaticBackupDue(previous,now))return{skipped:true,reason:'not-due',context};
    const attemptAt=now.toISOString(),envelope=createEnvelope(db,now),text=JSON.stringify(envelope,null,2);
    let internal=null,external=null,internalError='',externalError='',permission='',storagePersistent=false;
    storagePersistent=await requestPersistentStorage();
    try{internal=await writeInternal(text,envelope,context,config.retention)}catch(error){internalError=error.message||String(error)}
    if(config.mode==='folder'){
      try{
        const handle=await loadDirectoryHandle();permission=await directoryPermission(handle,!!options.requestPermission);
        if(permission!=='granted')externalError=permission==='missing'?'Backup folder is not connected':'Backup folder permission needs to be reconnected';
        else external=await writeFolder(handle,text,envelope,context,config.retention);
      }catch(error){externalError=error.message||String(error)}
    }
    if(external){
      try{await pruneInternal(context,Math.min(3,config.retention),internal?.key||'')}catch(e){}
    }
    if(!internal&&!external){
      const message=[internalError,externalError].filter(Boolean).join(' | ')||'Automatic backup failed';
      config.stores[context.storeId]={...previous,lastAttemptAt:attemptAt,lastError:message};saveConfig(config);throw new Error(message);
    }
    const warning=[externalError,internalError,external?.warning].filter(Boolean).join(' | ');
    config.stores[context.storeId]={
      ...previous,
      lastAttemptAt:attemptAt,
      lastDay:day,
      lastSignature:signature,
      lastFormatVersion:FORMAT_VERSION,
      lastBackupAt:envelope.createdAt,
      lastInternalAt:internal?envelope.createdAt:previous.lastInternalAt||'',
      lastExternalAt:external?envelope.createdAt:previous.lastExternalAt||'',
      lastExternalDay:external?day:previous.lastExternalDay||'',
      lastExternalSignature:external?signature:previous.lastExternalSignature||'',
      lastMode:external?'folder':'browser',
      lastFile:external?.fileName||internal?.fileName||'',
      lastSize:external?.size||internal?.size||0,
      lastDeleted:(external?.deleted||0)+(internal?.deleted||0),
      storagePersistent,
      lastError:warning
    };
    saveConfig(config);
    return{created:true,context,envelope,internal,external,warning,permission};
  }
  async function withBackupLock(db,options){
    const context=storeContext(db),run=()=>performBackup(db,options);
    if(!navigator.locks?.request)return run();
    return navigator.locks.request('khata-pana-backup:'+context.storeId,{mode:'exclusive',ifAvailable:true},lock=>lock?run():{skipped:true,reason:'another-tab',context});
  }

  function assertMainAdmin(){
    if(window.MartAI?.getSession?.()?.role!=='admin')throw new Error('Only the main admin can manage backups');
  }

  async function createCheckpoint(db){
    assertMainAdmin();
    const context=storeContext(db),run=async()=>{
      const config=readConfig(),date=new Date(),envelope=createEnvelope(db,date,{kind:'checkpoint'}),text=JSON.stringify(envelope,null,2);
      await requestPersistentStorage();
      const internal=await writeInternalCheckpoint(text,envelope,context);
      let external=null,permission='';
      if(config.mode==='folder'){
        const handle=await loadDirectoryHandle();permission=await directoryPermission(handle,true);
        if(permission!=='granted')throw new Error('Pre-restore checkpoint was saved in browser storage, but the configured backup folder is not available');
        try{external=await writeFolderCheckpoint(handle,text,envelope,context)}catch(error){throw new Error('Pre-restore checkpoint was saved in browser storage, but the folder copy failed: '+(error.message||String(error)))}
      }
      return{created:true,kind:'checkpoint',context,envelope,internal,external,permission};
    };
    if(!navigator.locks?.request)return run();
    return navigator.locks.request('khata-pana-checkpoint:'+context.storeId,{mode:'exclusive'},run);
  }

  async function configureFolder(db){
    assertMainAdmin();
    if(typeof window.showDirectoryPicker!=='function')throw new Error('Folder backups need Chrome or Edge on HTTPS/localhost');
    let root;
    try{root=await window.showDirectoryPicker({id:'khata-pana-backups',mode:'readwrite',startIn:'documents'})}
    catch(error){if(error.name!=='TypeError')throw error;root=await window.showDirectoryPicker({id:'khata-pana-backups',mode:'readwrite'})}
    const handle=await root.getDirectoryHandle(BACKUP_FOLDER,{create:true}),permission=await directoryPermission(handle,true);
    if(permission!=='granted')throw new Error('Write permission was not granted for the backup folder');
    await saveDirectoryHandle(handle,root.name+' / '+BACKUP_FOLDER);
    try{await navigator.storage?.persist?.()}catch(e){}
    updateConfig({enabled:true,mode:'folder',folderName:root.name+' / '+BACKUP_FOLDER});
    return withBackupLock(db,{force:true,requestPermission:true});
  }
  async function setRetention(db,value){
    assertMainAdmin();
    const retention=normalizeRetention(value),config=updateConfig({retention}),context=storeContext(db);
    let folderReady=false;
    try{
      const handle=await loadDirectoryHandle();folderReady=config.mode==='folder'&&await directoryPermission(handle,false)==='granted';
      if(folderReady)await pruneFolder(handle,context,retention);
    }catch(e){}
    try{await pruneInternal(context,folderReady?Math.min(3,retention):retention)}catch(e){}
    return getStatus(db);
  }
  function setEnabled(db,enabled){assertMainAdmin();storeContext(db);return updateConfig({enabled:!!enabled})}
  async function getStatus(db){
    const context=storeContext(db),config=readConfig(),current=config.stores[context.storeId]||{};
    let internalCount=0,externalCount=0,permission='missing',handle=null,storage=null,storagePersistent=false;
    try{internalCount=(await verifiedInternalSnapshots(context)).length}catch(e){}
    try{handle=await loadDirectoryHandle();permission=await directoryPermission(handle,false);if(permission==='granted')externalCount=(await verifiedFolderFiles(handle,context)).length}catch(e){permission='error'}
    try{storage=await navigator.storage?.estimate?.()}catch(e){}
    try{storagePersistent=!!(await navigator.storage?.persisted?.())}catch(e){}
    const lastBackupTime=Date.parse(current.lastBackupAt||''),nextBackupAt=Number.isFinite(lastBackupTime)?new Date(lastBackupTime+AUTO_BACKUP_INTERVAL_MS).toISOString():'';
    return{...current,context,enabled:config.enabled,retention:config.retention,intervalDays:AUTO_BACKUP_INTERVAL_DAYS,nextBackupAt,mode:config.mode,folderName:config.folderName,folderSupported:typeof window.showDirectoryPicker==='function'&&window.isSecureContext!==false,folderPermission:permission,internalCount,externalCount,storage,storagePersistent};
  }
  async function listBackups(db){
    const context=storeContext(db),config=readConfig();
    const candidates=[];
    if(config.mode==='folder'){
      try{
        const handle=await loadDirectoryHandle();
        if(await directoryPermission(handle,false)==='granted'){
          for(const item of await verifiedFolderFiles(handle,context)){
            const kind=envelopeKind(item.envelope),logicalId=kind==='checkpoint'?'checkpoint:'+item.envelope.checkpointId:'daily:'+item.envelope.backupDay;
            candidates.push({id:'folder:'+encodeURIComponent(item.name),logicalId,kind,source:'folder',fileName:item.name,backupDay:item.envelope.backupDay,createdAt:item.envelope.createdAt});
          }
        }
      }catch(e){}
    }
    for(const snapshot of await verifiedInternalSnapshots(context)){
      const kind=envelopeKind(snapshot.envelope),logicalId=kind==='checkpoint'?'checkpoint:'+snapshot.envelope.checkpointId:'daily:'+snapshot.envelope.backupDay;
      candidates.push({id:'browser:'+encodeURIComponent(snapshot.key),logicalId,kind,source:'browser',fileName:snapshot.fileName,backupDay:snapshot.envelope.backupDay,createdAt:snapshot.envelope.createdAt});
    }
    const newest=new Map();
    for(const item of candidates){
      const current=newest.get(item.logicalId);
      if(!current||item.createdAt>current.createdAt||(item.createdAt===current.createdAt&&item.source==='folder'))newest.set(item.logicalId,item);
    }
    const backups=[...newest.values()];
    return backups.sort((a,b)=>b.backupDay.localeCompare(a.backupDay)||b.createdAt.localeCompare(a.createdAt));
  }
  async function readBackup(db,backupId){
    const context=storeContext(db),id=String(backupId||'');
    if(id.startsWith('folder:')){
      const name=decodeURIComponent(id.slice(7)),info=fileInfo(context,name),handle=await loadDirectoryHandle();
      if(!info||await directoryPermission(handle,false)!=='granted')throw new Error('The selected backup folder is not available');
      const entry=await handle.getFileHandle(name),file=await entry.getFile(),envelope=validateEnvelope(JSON.parse(await file.text()),context,info.day,info.kind);
      return{envelope,kind:envelopeKind(envelope),source:'folder',fileName:name,createdAt:envelope.createdAt};
    }
    if(id.startsWith('browser:')){
      const key=decodeURIComponent(id.slice(8)),snapshot=await getRecord(SNAPSHOTS,key);
      if(!snapshot||snapshot.storeId!==context.storeId)throw new Error('The selected browser backup is no longer available');
      const envelope=validateEnvelope(JSON.parse(snapshot.text),context,snapshot.backupDay);
      return{envelope,kind:envelopeKind(envelope),source:'browser',fileName:snapshot.fileName,createdAt:envelope.createdAt};
    }
    throw new Error('Select a backup to restore');
  }
  async function latestBackup(db){
    const backups=await listBackups(db);if(!backups.length)throw new Error('No automatic backup is available for this store yet');return readBackup(db,backups[0].id);
  }
  function retentionPlan(names,context,retention){
    const matching=(names||[]).map(name=>({name,info:fileInfo(context,name)})).filter(item=>item.info?.kind==='daily').map(item=>({...item,day:item.info.day})).sort((a,b)=>b.day.localeCompare(a.day)||String(b.info.revision).localeCompare(String(a.info.revision))||b.name.localeCompare(a.name)),keptDays=new Set(),keep=[],remove=[];
    for(const item of matching){if(!keptDays.has(item.day)&&keptDays.size<normalizeRetention(retention)){keptDays.add(item.day);keep.push(item.name)}else remove.push(item.name)}
    return{keep,remove};
  }

  window.KhataBackup={
    runIfDue:db=>withBackupLock(db,{force:false}),
    backupNow:db=>withBackupLock(db,{force:true}),
    createCheckpoint,
    configureFolder,
    setEnabled,
    setRetention,
    getStatus,
    listBackups,
    readBackup,
    latestBackup,
    createEnvelope,
    validateForRestore,
    config:readConfig,
    supported:()=>typeof window.showDirectoryPicker==='function'&&window.isSecureContext!==false,
    _test:{localDay,normalizeRetention,automaticBackupDue,sanitizeBackupData,storeContext,fileNameFor,revisionFileNameFor,checkpointFileNameFor,fileInfo,fileDay,retentionPlan,validateDataStructure,assertDataScope,validateEnvelope,validateForRestore,dataSignature,sha256,envelopeChecksum}
  };
})();
