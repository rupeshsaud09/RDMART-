(function(){
  const KEY='martai_final_db_v1';
  const SESSION='martai_final_session';
  const ACTIVE_STORE='martai_active_store_v1';
  const TABLE='martai_app_state';
  const STATE_ID='main';
  let currentDB=null;
  let supabaseClient=null;
  let remoteEnabled=false;
  let remoteError='';
  let pendingSave=null;
  // Dirty tracking: only records touched since the last successful sync are pushed to Supabase.
  // Records without a _tableId (never synced) are always pushed.
  const dirty={customers:new Set(),credits:new Set(),sales:new Set(),dailySales:new Set(),partyPayments:new Set(),cheques:new Set(),chequeQueue:new Set(),parties:new Set(),estimateBills:new Set(),paymentRequests:new Set()};
  let settingsDirty=false;
  // Offline queue: dirty ids and pending deletions survive reloads via localStorage,
  // and are flushed to Supabase before any remote load can overwrite local data.
  const PENDING='martai_pending_ops_v1';
  let deleteQueue=[];
  function persistPending(){try{const d={};for(const k in dirty)d[k]=[...dirty[k]];localStorage.setItem(PENDING,JSON.stringify({dirty:d,settingsDirty,deletes:deleteQueue}))}catch(e){}}
  function restorePending(){try{const p=JSON.parse(localStorage.getItem(PENDING)||'null');if(!p)return;for(const k in dirty)(p.dirty?.[k]||[]).forEach(v=>dirty[k].add(v));settingsDirty=!!p.settingsDirty;deleteQueue=Array.isArray(p.deletes)?p.deletes:[]}catch(e){}}
  function hasPending(){return settingsDirty||deleteQueue.length>0||Object.values(dirty).some(s=>s.size>0)}
  function pendingCount(){return deleteQueue.length+(settingsDirty?1:0)+Object.values(dirty).reduce((s,x)=>s+x.size,0)}
  function markDirty(coll,idv){if(dirty[coll]&&idv){dirty[coll].add(idv);persistPending()}}
  function clearDirty(){Object.values(dirty).forEach(s=>s.clear());settingsDirty=false;persistPending()}
  function id(){return 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
  function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function now(){return new Date().toISOString()}
  function num(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
  function money(v){return 'Rs '+num(v).toLocaleString('en-IN')}
  function esc(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}
  function phoneClean(v){return String(v||'').replace(/\D/g,'').slice(-10)}
  function defaultStore(){return{id:'default',name:'RD MART',phone:'',logoData:'',createdAt:now(),isActive:true}}
  function getActiveStoreId(){return localStorage.getItem(ACTIVE_STORE)||'default'}
  function setActiveStoreId(storeId){localStorage.setItem(ACTIVE_STORE,storeId||'default');currentDB=null}
  function makeDB(){return{version:1,createdAt:now(),settings:{martName:'MartAI',adminUser:'admin',adminPass:'mart2024',martPhone:'9800000000',storeLogo:''},stores:[defaultStore()],customers:[],credits:[],sales:[],dailySales:[],partyPayments:[],cheques:[],chequeQueue:[],parties:[],estimateBills:[],activity:[],staffAccounts:[]}}
  function normalizeDB(db){if(!db||typeof db!=='object')db=makeDB();['settings','stores','customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','activity','loginEvents','staffAccounts','paymentRequests'].forEach(k=>{if(k==='settings'){db[k]=db[k]||makeDB().settings}else if(!Array.isArray(db[k]))db[k]=[]});if(!db.stores.length)db.stores=[defaultStore()];if(!('storeLogo' in db.settings))db.settings.storeLogo='';if(!db.settings.adminUser)db.settings.adminUser='admin';if(!db.settings.adminPass)db.settings.adminPass='mart2024';return db}
  function readLocal(){let db;try{db=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){db=null}return normalizeDB(db)}
  function writeLocal(db){localStorage.setItem(KEY,JSON.stringify(db))}
  function getDB(){if(!currentDB)currentDB=readLocal();return currentDB}
  function getSupabase(){const cfg=window.MARTAI_SUPABASE||{};const configured=cfg.url&&cfg.anonKey&&!String(cfg.url).includes('YOUR_SUPABASE')&&!String(cfg.anonKey).includes('YOUR_SUPABASE');if(!configured||!window.supabase)return null;if(!supabaseClient)supabaseClient=window.supabase.createClient(cfg.url,cfg.anonKey);return supabaseClient}
  function dbMode(){return (window.MARTAI_SUPABASE&&window.MARTAI_SUPABASE.mode)||'json'}
  function tableMode(){return dbMode()==='tables'}
  function isoDate(v){return String(v||today()).slice(0,10)}
  function fromStoreRow(r){return{id:r.id,name:r.name||'Store',phone:r.phone||'',logoData:r.logo_data||'',qrData:r.qr_data||'',qrLabel:r.qr_label||'',createdAt:r.created_at,isActive:r.is_active!==false}}
  function fromCustomerRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),name:r.name||'',phone:r.phone||'',pin:'',avatarData:r.avatar_data||'',email:r.email||'',address:r.address||'',notes:r.notes||'',creditLimit:num(r.credit_limit)||0,createdAt:r.created_at,updatedAt:r.updated_at}}
  function fromCreditRow(r,customers){const c=customers.find(x=>x._tableId===r.customer_id)||{};return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),customerId:c.id||r.customer_id,customer:c.name||'',phone:c.phone||'',date:r.credit_date,dueDate:r.due_date||'',items:r.items||'',amount:num(r.amount),paid:num(r.paid),note:r.note||'',paymentNote:r.payment_note||'',paidAt:r.paid_at,createdAt:r.created_at}}
  function fromSaleRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.sale_date,party:r.party||'Walk-in Customer',amount:num(r.amount),note:r.note||'',createdAt:r.created_at}}
  function fromDailyRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.sale_date,pos:num(r.pos),fonepay:num(r.fonepay),cash:num(r.cash),finance:num(r.finance),partyPayment:num(r.party_payment),other:num(r.other),note:r.note||'',createdAt:r.created_at}}
  function fromPartyPaymentRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.payment_date,party:r.party||'',amount:num(r.amount),method:r.method||'Cash',reference:r.reference||'',note:r.note||'',createdAt:r.created_at}}
  function fromChequeQueueRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),party:r.party||'',amount:num(r.amount),note:r.note||'',createdAt:r.created_at}}
  function fromPartyRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),name:r.name||'',phone:r.phone||'',notes:r.notes||'',createdAt:r.created_at}}
  function fromChequeRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),party:r.party||'',chequeNo:r.cheque_no||'',amount:num(r.amount),bank:r.bank||'',chequeDate:r.cheque_date,status:r.status||'hold',note:r.note||'',createdAt:r.created_at,updatedAt:r.updated_at}}
  function fromEstimateRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.estimate_date,customer:r.customer||'',phone:r.phone||'',items:r.items||'',amount:num(r.amount),validUntil:r.valid_until||'',status:r.status||'draft',note:r.note||'',createdAt:r.created_at,updatedAt:r.updated_at}}
  function fromActivityRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),type:r.activity_type||'info',message:r.message||'',time:r.created_at}}
  function fromLoginEventRow(r){return{id:r.id,role:r.login_role||'',customerId:r.customer_id||'',name:r.display_name||'',phone:r.phone||'',email:r.email||'',time:r.created_at}}
  function fromStaffRow(r){return{id:r.id,email:r.email||'',name:r.full_name||'',active:r.is_active!==false,createdAt:r.created_at}}
  function fromPaymentRequestRow(r,customers){const c=customers.find(x=>x._tableId===r.customer_id)||{};return{id:r.id,storeId:r.store_id||getActiveStoreId(),customerId:c.id||r.customer_id,customer:c.name||'Customer',phone:c.phone||'',amount:num(r.amount),method:r.method||'',reference:r.reference||'',note:r.note||'',status:r.status||'pending',createdAt:r.created_at,resolvedAt:r.resolved_at}}
  async function saveRemoteNow(db){
    const client=getSupabase();
    if(!client)return;
    // UPSERT ensures both INSERT (if new) and UPDATE (if exists) work correctly
    const result=await client.from(TABLE).upsert({id:STATE_ID,data:db,updated_at:now()},{onConflict:'id'});
    if(result.error)throw result.error;
  }
  async function loadTableDB(){
    const client=getSupabase();if(!client)return getDB();
    // Flush unsynced offline changes first — otherwise the remote load would overwrite them.
    if(hasPending()){
      try{await saveTableDB(getDB())}
      catch(e){remoteEnabled=false;remoteError='Offline changes waiting to sync: '+(e.message||String(e));console.error('Pending sync failed, keeping local data:',e);return getDB()}
    }
    try{
      const storeResult=await client.from('mart_stores').select('*').eq('is_active',true).order('created_at',{ascending:true});
      const stores=storeResult.error?[defaultStore()]:(storeResult.data||[]).map(fromStoreRow);
      let storeId=getActiveStoreId();if(!stores.some(s=>s.id===storeId)){storeId=stores[0]?.id||'default';setActiveStoreId(storeId)}
      const byStore=q=>storeResult.error?q:q.eq('store_id',storeId);
      const [settings,customers,credits,sales,daily,party,cheques,estimates,activity,payReqs,chequeQueueRes,partiesRes]=await Promise.all([
        client.from('mart_settings').select('*').eq('id',true).maybeSingle(),
        byStore(client.from('customers').select('*')).order('created_at',{ascending:false}),
        byStore(client.from('credits').select('*')).order('credit_date',{ascending:false}),
        byStore(client.from('sales').select('*')).order('sale_date',{ascending:false}),
        byStore(client.from('daily_sales').select('*')).order('sale_date',{ascending:false}),
        byStore(client.from('party_payments').select('*')).order('payment_date',{ascending:false}),
        byStore(client.from('cheques').select('*')).order('cheque_date',{ascending:false}),
        byStore(client.from('estimate_bills').select('*')).order('estimate_date',{ascending:false}).limit(200),
        byStore(client.from('activity').select('*')).order('created_at',{ascending:false}).limit(60),
        byStore(client.from('payment_requests').select('*')).order('created_at',{ascending:false}).limit(120),
        byStore(client.from('cheque_queue').select('*')).order('created_at',{ascending:true}),
        byStore(client.from('parties').select('*')).order('name',{ascending:true})
      ]);
      [settings,customers,credits,sales,daily,party,cheques,activity].forEach(r=>{if(r.error)throw r.error});
      const customerRows=(customers.data||[]).map(fromCustomerRow);
      const activeStore=stores.find(s=>s.id===storeId)||stores[0]||defaultStore();
      currentDB=normalizeDB({
        version:2,
        createdAt:now(),
        settings:{martName:activeStore.name||settings.data?.mart_name||'RD MART',adminUser:'',adminPass:'',martPhone:activeStore.phone||settings.data?.mart_phone||'',storeLogo:activeStore.logoData||'',storePaymentQr:activeStore.qrData||'',storePaymentQrLabel:activeStore.qrLabel||''},
        stores,
        customers:customerRows,
        credits:(credits.data||[]).map(r=>fromCreditRow(r,customerRows)),
        sales:(sales.data||[]).map(fromSaleRow),
        dailySales:(daily.data||[]).map(fromDailyRow),
        partyPayments:(party.data||[]).map(fromPartyPaymentRow),
        cheques:(cheques.data||[]).map(fromChequeRow),
        // cheque_queue table may not exist until add-cheque-queue.sql is run — keep local copy then
        chequeQueue:chequeQueueRes.error?(getDB().chequeQueue||[]):(chequeQueueRes.data||[]).map(fromChequeQueueRow),
        // parties table may not exist until add-parties.sql is run — keep local copy then
        parties:partiesRes.error?(getDB().parties||[]):(partiesRes.data||[]).map(fromPartyRow),
        estimateBills:estimates.error?[]:(estimates.data||[]).map(fromEstimateRow),
        activity:(activity.data||[]).map(fromActivityRow),
        paymentRequests:payReqs.error?[]:(payReqs.data||[]).map(r=>fromPaymentRequestRow(r,customerRows)),
        loginEvents:[]
      });
      const logins=await client.from('login_events').select('*').order('created_at',{ascending:false}).limit(80);
      if(!logins.error)currentDB.loginEvents=(logins.data||[]).map(fromLoginEventRow);
      const staff=await client.from('mart_staff').select('*').order('created_at',{ascending:false}).limit(80);
      if(!staff.error)currentDB.staffAccounts=(staff.data||[]).map(fromStaffRow);
      writeLocal(currentDB);clearDirty();remoteEnabled=true;remoteError='';return currentDB;
    }catch(e){remoteEnabled=false;remoteError=e.message||String(e);console.error('Supabase table load failed:',e);return getDB()}
  }
  async function hashPin(pin){const client=getSupabase();const r=await client.rpc('hash_pin',{pin});if(r.error)throw r.error;return r.data}
  function noRowsError(error){const msg=String(error?.message||'');return error?.code==='PGRST116'||msg.includes('Cannot coerce')||msg.includes('JSON object')}
  async function saveLegacyRow(client,table,row,tableId){
    let r={data:null,error:null};
    if(tableId){
      const patch={...row};delete patch.legacy_id;
      r=await client.from(table).update(patch).eq('id',tableId).select('id').maybeSingle();
      if(r.error&&!noRowsError(r.error))throw r.error;
      if(r.data)return r.data.id;
    }
    r=await client.from(table).upsert(row,{onConflict:'legacy_id'}).select('id').maybeSingle();
    if(r.error)throw r.error;
    if(!r.data)throw new Error('Could not save '+table+' row');
    return r.data.id;
  }
  async function saveTableDB(db){
    const client=getSupabase();if(!client)return;
    db=normalizeDB(db);
    const s=db.settings||{};
    const storeId=getActiveStoreId();
    let r;
    while(deleteQueue.length){
      const t=deleteQueue[0];
      const dr=await client.from(t.table).delete().eq('id',t.tableId);
      if(dr.error)throw dr.error;
      deleteQueue.shift();persistPending();
    }
    if(settingsDirty&&isMainAdminSession()){
      r=await client.from('mart_settings').upsert({id:true,mart_name:s.martName||'RD MART',mart_phone:s.martPhone||'',updated_at:now()});if(r.error)throw r.error;
      r=await client.from('mart_stores').update({name:s.martName||'RD MART',phone:s.martPhone||'',updated_at:now()}).eq('id',storeId).select('id').maybeSingle();
      if(r.error&&String(r.error.message||'').includes('mart_stores')===false)throw r.error;
      settingsDirty=false;persistPending();
    }
    for(const c of db.customers){
      if(c._tableId&&!dirty.customers.has(c.id)&&!c.pin)continue;
      const base={legacy_id:c.id,store_id:storeId,name:c.name,phone:phoneClean(c.phone),avatar_data:c.avatarData||'',email:c.email||'',address:c.address||'',notes:c.notes||'',credit_limit:num(c.creditLimit)||0,updated_at:now()};
      const row={...base,pin_hash:await hashPin(c.pin||'0000')};
      if(c._tableId){
        const patch={...base};delete patch.legacy_id;if(c.pin)patch.pin_hash=row.pin_hash;
        r=await client.from('customers').update(patch).eq('id',c._tableId).select('id').maybeSingle();
        if(r.error&&!noRowsError(r.error))throw r.error;
      }else r={data:null,error:null};
      if(!r.data){
        r=await client.from('customers').upsert(row,{onConflict:'legacy_id'}).select('id').maybeSingle();
        if(r.error&&String(r.error.code)==='23505'&&/phone/i.test(String(r.error.message||''))){
          // Duplicate phone online. If that customer already exists in THIS store
          // (added on another device / re-added after a reset), merge into that row
          // instead of blocking the whole sync queue forever.
          const ex=await client.from('customers').select('id').eq('store_id',storeId).eq('phone',base.phone).maybeSingle();
          if(ex.data){
            const patch={...base};delete patch.legacy_id;if(c.pin)patch.pin_hash=row.pin_hash;
            r=await client.from('customers').update(patch).eq('id',ex.data.id).select('id').maybeSingle();
            if(r.error)throw r.error;
          }else{
            // Phone exists only in ANOTHER store — the database still has the old
            // global unique constraint. Point the admin at the one-time fix.
            throw new Error('Phone '+base.phone+' ('+(c.name||'customer')+') already exists in another store. Run fix-duplicate-phone-sync.sql once in Supabase SQL Editor, then press Sync.');
          }
        }else if(r.error)throw r.error;
      }
      if(!r.data)throw new Error('Could not save customer '+(c.name||c.phone||''));c._tableId=r.data.id;c.pin='';dirty.customers.delete(c.id);
    }
    const byId=Object.fromEntries(db.customers.map(c=>[c.id,c]));
    for(const x of db.credits){if(x._tableId&&!dirty.credits.has(x.id))continue;const c=byId[x.customerId];if(!c?._tableId)continue;const row={legacy_id:x.id,store_id:storeId,customer_id:c._tableId,credit_date:isoDate(x.date),due_date:x.dueDate?isoDate(x.dueDate):null,items:x.items||'',amount:num(x.amount),paid:num(x.paid),note:x.note||'',payment_note:x.paymentNote||'',paid_at:x.paidAt||null,created_at:x.createdAt||now()};x._tableId=await saveLegacyRow(client,'credits',row,x._tableId);dirty.credits.delete(x.id)}
    for(const x of db.sales){if(x._tableId&&!dirty.sales.has(x.id))continue;const row={legacy_id:x.id,store_id:storeId,sale_date:isoDate(x.date),party:x.party||'Walk-in Customer',amount:num(x.amount),note:x.note||'',created_at:x.createdAt||now()};x._tableId=await saveLegacyRow(client,'sales',row,x._tableId);dirty.sales.delete(x.id)}
    for(const x of db.dailySales){if(x._tableId&&!dirty.dailySales.has(x.id))continue;const row={legacy_id:x.id,store_id:storeId,sale_date:isoDate(x.date),pos:num(x.pos),fonepay:num(x.fonepay),cash:num(x.cash),finance:num(x.finance),party_payment:num(x.partyPayment),other:num(x.other),note:x.note||'',created_at:x.createdAt||now()};x._tableId=await saveLegacyRow(client,'daily_sales',row,x._tableId);dirty.dailySales.delete(x.id)}
    for(const x of db.partyPayments){if(x._tableId&&!dirty.partyPayments.has(x.id))continue;const row={legacy_id:x.id,store_id:storeId,payment_date:isoDate(x.date),party:x.party||'',amount:num(x.amount),method:x.method||'Cash',reference:x.reference||'',note:x.note||'',created_at:x.createdAt||now()};x._tableId=await saveLegacyRow(client,'party_payments',row,x._tableId);dirty.partyPayments.delete(x.id)}
    for(const x of db.cheques){if(x._tableId&&!dirty.cheques.has(x.id))continue;const row={legacy_id:x.id,store_id:storeId,party:x.party||'',cheque_no:x.chequeNo||'',amount:num(x.amount),bank:x.bank||'',cheque_date:isoDate(x.chequeDate),status:x.status||'hold',note:x.note||'',created_at:x.createdAt||now(),updated_at:x.updatedAt||null};x._tableId=await saveLegacyRow(client,'cheques',row,x._tableId);dirty.cheques.delete(x.id)}
    for(const x of db.chequeQueue||[]){
      if(x._tableId&&!dirty.chequeQueue.has(x.id))continue;
      const row={legacy_id:x.id,store_id:storeId,party:x.party||'',amount:num(x.amount),note:x.note||'',created_at:x.createdAt||now()};
      // Table may not exist until add-cheque-queue.sql is run — keep queue local-only
      // then (rows without _tableId retry automatically on every later save).
      try{x._tableId=await saveLegacyRow(client,'cheque_queue',row,x._tableId)}
      catch(e){if(String(e.message||'').includes('cheque_queue')){dirty.chequeQueue.clear();console.warn('cheque_queue table missing — run add-cheque-queue.sql in Supabase to sync the cheque queue');break}throw e}
      dirty.chequeQueue.delete(x.id)
    }
    for(const x of db.parties||[]){
      if(x._tableId&&!dirty.parties.has(x.id))continue;
      const row={legacy_id:x.id,store_id:storeId,name:x.name||'',phone:x.phone||'',notes:x.notes||'',created_at:x.createdAt||now()};
      // Table may not exist until add-parties.sql is run — keep parties local-only then
      try{x._tableId=await saveLegacyRow(client,'parties',row,x._tableId)}
      catch(e){if(String(e.message||'').includes('parties')){dirty.parties.clear();console.warn('parties table missing — run add-parties.sql in Supabase to sync party accounts');break}throw e}
      dirty.parties.delete(x.id)
    }
    for(const x of db.estimateBills||[]){
      if(x._tableId&&!dirty.estimateBills.has(x.id))continue;
      const row={legacy_id:x.id,store_id:storeId,estimate_date:isoDate(x.date),customer:x.customer||'',phone:phoneClean(x.phone)||'',items:x.items||'',amount:num(x.amount),valid_until:x.validUntil?isoDate(x.validUntil):null,status:x.status||'draft',note:x.note||'',created_at:x.createdAt||now(),updated_at:x.updatedAt||now()};
      // Missing table must not block the rest of the sync queue — run fix-missing-tables.sql
      try{x._tableId=await saveLegacyRow(client,'estimate_bills',row,x._tableId)}
      catch(e){if(String(e.message||'').includes('estimate_bills')){dirty.estimateBills.clear();console.warn('estimate_bills table missing — run fix-missing-tables.sql in Supabase to sync estimates');break}throw e}
      dirty.estimateBills.delete(x.id)
    }
    for(const x of db.paymentRequests||[]){const oldId=x.id;if(!dirty.paymentRequests.has(oldId))continue;const c=byId[x.customerId]||{};const customerId=c._tableId||x.customerTableId||x.customerId;if(!customerId)continue;const row={store_id:storeId,customer_id:customerId,amount:num(x.amount),method:x.method||'',reference:x.reference||'',note:x.note||'',status:x.status||'pending',created_at:x.createdAt||now(),resolved_at:x.resolvedAt||null,resolved_by:x.resolvedBy||null};const canKeepId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x.id||''));r=canKeepId?await client.from('payment_requests').upsert({id:x.id,...row},{onConflict:'id'}).select('id').single():await client.from('payment_requests').insert(row).select('id').single();if(r.error)throw r.error;x.id=r.data.id;dirty.paymentRequests.delete(oldId)}
    writeLocal(db);remoteEnabled=true;remoteError='';
  }
  async function loadRemoteDB(){const client=getSupabase();if(!client){remoteEnabled=false;return getDB()}try{const result=await client.from(TABLE).select('data').eq('id',STATE_ID).maybeSingle();if(result.error)throw result.error;if(result.data&&result.data.data){currentDB=normalizeDB(result.data.data);writeLocal(currentDB)}else{currentDB=getDB();await saveRemoteNow(currentDB)}remoteEnabled=true;remoteError='';return currentDB}catch(e){remoteEnabled=false;remoteError=e.message||String(e);console.error('Supabase load failed:',e);return getDB()}}
  function queueRemoteSave(db){const client=getSupabase();if(!client)return;touchLocal();const saver=tableMode()?saveTableDB:saveRemoteNow;pendingSave=(pendingSave||Promise.resolve()).catch(()=>{}).then(()=>saver(db)).then(()=>{remoteEnabled=true;remoteError='';touchLocal();persistPending()}).catch(e=>{remoteEnabled=false;remoteError=e.message||String(e);persistPending();console.error('Supabase save failed:',e)});return pendingSave}
  function saveDB(db){currentDB=normalizeDB(db);writeLocal(currentDB);queueRemoteSave(currentDB);return currentDB}
  function resetDB(){currentDB=makeDB();saveDB(currentDB);return currentDB}
  async function restoreBackup(input){
    const raw=input&&input.data&&input.data.settings?input.data:input;
    if(!raw||typeof raw!=='object')throw new Error('Backup file is empty or invalid');
    if(!raw.settings&&!Array.isArray(raw.customers)&&!Array.isArray(raw.credits)&&!Array.isArray(raw.dailySales))throw new Error('This does not look like a MartAI backup file');
    const oldDB=getDB();
    const restored=normalizeDB(JSON.parse(JSON.stringify(raw)));
    restored.version=Math.max(num(restored.version)||1,2);
    restored.restoredAt=now();
    ['customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','activity','loginEvents','staffAccounts','paymentRequests'].forEach(k=>{restored[k]=Array.isArray(restored[k])?restored[k]:[]});
    ['customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','paymentRequests'].forEach(k=>restored[k].forEach(x=>{if(!x.id)x.id=id();if(!x.createdAt)x.createdAt=now()}));
    if(!Array.isArray(restored.activity))restored.activity=[];
    restored.activity.unshift({id:id(),type:'settings',message:'Backup restored',time:now()});
    restored.activity=restored.activity.slice(0,60);
    Object.values(dirty).forEach(s=>s.clear());
    deleteQueue=[];
    if(tableMode()){
      const tableMap={credits:'credits',sales:'sales',dailySales:'daily_sales',partyPayments:'party_payments',cheques:'cheques',chequeQueue:'cheque_queue',parties:'parties',estimateBills:'estimate_bills',paymentRequests:'payment_requests',customers:'customers'};
      const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      ['credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','paymentRequests','customers'].forEach(k=>{
        const tableId=x=>x._tableId||(k==='paymentRequests'&&uuidRe.test(String(x.id||''))?x.id:'');
        const keep=new Set((restored[k]||[]).map(tableId).filter(Boolean));
        (oldDB[k]||[]).forEach(x=>{const tid=tableId(x);if(tid&&!keep.has(tid))deleteQueue.push({table:tableMap[k],tableId:tid})});
      });
    }
    ['customers','credits','sales','dailySales','partyPayments','cheques','chequeQueue','parties','estimateBills','paymentRequests'].forEach(k=>(restored[k]||[]).forEach(x=>dirty[k].add(x.id)));
    settingsDirty=true;
    currentDB=restored;
    writeLocal(currentDB);
    persistPending();
    queueRemoteSave(currentDB);
    return currentDB;
  }
  async function syncNow(){if(tableMode())await loadTableDB();else await loadRemoteDB();return getDB()}
  function syncInfo(){return{remoteEnabled,remoteError,configured:!!getSupabase(),mode:dbMode(),pendingSave,pendingCount:pendingCount(),hasPending:hasPending()}}
  async function adminLogin(username,password){
    if(!tableMode()){
      const db=getDB();
      if(username===db.settings.adminUser&&password===db.settings.adminPass){setSession('admin',{});return true}
      const staff=(db.staffAccounts||[]).find(x=>String(x.email).toLowerCase()===String(username).toLowerCase()&&String(x.password||'')===String(password)&&x.active!==false);
      if(staff){setSession('staff',{email:staff.email,name:staff.name});return true}
      return false;
    }
    const client=getSupabase();if(!client)throw new Error('Supabase is not configured');
    const result=await client.auth.signInWithPassword({email:username,password});
    if(result.error)throw result.error;
    const adminCheck=await client.rpc('is_mart_admin');
    const isAdmin=!adminCheck.error&&adminCheck.data===true;
    let isStaff=false;
    if(!isAdmin){const staffCheck=await client.rpc('is_mart_staff');isStaff=!staffCheck.error&&staffCheck.data===true}
    let storeAdminStore='';
    if(!isAdmin&&!isStaff){
      const storeCheck=await client.from('mart_stores').select('id').eq('is_active',true).limit(1);
      if(!storeCheck.error&&storeCheck.data&&storeCheck.data[0])storeAdminStore=storeCheck.data[0].id;
    }
    if(!isAdmin&&!isStaff&&!storeAdminStore){await client.auth.signOut();return false}
    if(storeAdminStore)setActiveStoreId(storeAdminStore);
    setSession(isAdmin?'admin':isStaff?'staff':'store_admin',{email:username,storeId:storeAdminStore||getActiveStoreId()});
    try{
      const loginEvent=await client.rpc('record_admin_login',{email_input:username});
      if(loginEvent.error)console.warn('Admin login event not recorded:',loginEvent.error);
    }catch(e){
      console.warn('Admin login event not recorded:',e);
    }
    await loadTableDB();
    return true;
  }
  async function customerLogin(phone,pin){
    if(!tableMode()){
      const customer=findCustomer(getDB(),phone,pin);
      if(customer)setSession('customer',{customerId:customer.id});
      return customer;
    }
    const client=getSupabase();if(!client)throw new Error('Supabase is not configured');
    const result=await client.rpc('customer_login',{phone_input:phone,pin_input:pin});
    if(result.error)throw result.error;
    const row=Array.isArray(result.data)?result.data[0]:result.data;
    if(!row)throw new Error('Login failed');
    const portalDB=await loadCustomerPortal(row.token);
    const customer=portalDB.customers[0]||{id:row.customer_id,name:row.name,phone:row.phone};
    setSession('customer',{customerId:customer.id,customerTableId:row.customer_id,customerToken:row.token});
    return customer;
  }
  async function loadCustomerPortal(token){
    const client=getSupabase();if(!client)return getDB();
    const result=await client.rpc('customer_portal',{raw_token:token});
    if(result.error)throw result.error;
    const data=result.data||{};const c=data.customer||{};
    const customer={id:c.legacy_id||c.id,_tableId:c.id,name:c.name||'',phone:c.phone||'',avatarData:c.avatar_data||'',email:c.email||'',address:c.address||'',notes:c.notes||'',createdAt:c.created_at,updatedAt:c.updated_at};
    let storePaymentQr='';let storePaymentQrLabel='';let storeLogo='';let storeName='RD MART';
    if(data.store){storeName=data.store.name||storeName;storeLogo=data.store.logo_data||'';storePaymentQr=data.store.qr_data||'';storePaymentQrLabel=data.store.qr_label||''}
    else if(c.store_id){try{const sq=await client.from('mart_stores').select('name,logo_data,qr_data,qr_label').eq('id',c.store_id).maybeSingle();if(!sq.error&&sq.data){storeName=sq.data.name||storeName;storeLogo=sq.data.logo_data||'';storePaymentQr=sq.data.qr_data||'';storePaymentQrLabel=sq.data.qr_label||''}}catch(e){}}
    currentDB=normalizeDB({version:2,createdAt:now(),settings:{martName:storeName,adminUser:'',adminPass:'',martPhone:'',storeLogo,storePaymentQr,storePaymentQrLabel},customers:[customer],credits:(data.credits||[]).map(r=>fromCreditRow(r,[customer])),sales:[],dailySales:[],partyPayments:[],cheques:[],activity:[],paymentRequests:(data.payment_requests||[]).map(r=>({id:r.id,amount:num(r.amount),method:r.method||'',reference:r.reference||'',note:r.note||'',status:r.status||'pending',createdAt:r.created_at}))});
    writeLocal(currentDB);remoteEnabled=true;remoteError='';return currentDB;
  }
  async function publicStoreInfo(){const client=getSupabase();if(!client)return null;const r=await client.rpc('public_store_info');if(r.error)return null;const row=Array.isArray(r.data)?r.data[0]:r.data;return row||null}
  async function customerRequestPayment(input){
    const s=getSession();if(!tableMode()||!s?.customerToken)throw new Error('Payment reports need the online database');
    const client=getSupabase();if(!client)throw new Error('Supabase is not configured');
    const amount=num(input.amount);if(amount<=0)throw new Error('Enter the amount you paid');
    const r=await client.rpc('customer_request_payment',{raw_token:s.customerToken,amount_input:amount,method_input:String(input.method||''),reference_input:String(input.reference||''),note_input:String(input.note||'')});
    if(r.error)throw new Error(r.error.message||'Could not send payment report');
    await loadCustomerPortal(s.customerToken);
    return true;
  }
  async function resolvePaymentRequest(db,requestId,approve){
    if(!tableMode())throw new Error('Payment reports need the online database');
    const client=getSupabase();if(!client)throw new Error('Supabase is not configured');
    const pr=(db.paymentRequests||[]).find(x=>x.id===requestId);if(!pr)throw new Error('Payment report not found');
    if(pr.status!=='pending')throw new Error('This report was already handled');
    touchLocal();
    // status guard makes double-approval from two devices impossible: second update matches 0 rows
    const r=await client.from('payment_requests').update({status:approve?'approved':'rejected',resolved_at:now(),resolved_by:getSession()?.email||''}).eq('id',requestId).eq('status','pending').select('id').single();
    if(r.error)throw new Error('Could not update — it may already be handled on another device');
    pr.status=approve?'approved':'rejected';pr.resolvedAt=now();
    if(approve){
      const applied=addCreditPayment(db,pr.customerId,pr.amount,'Portal payment'+(pr.method?' via '+pr.method:'')+(pr.reference?' ('+pr.reference+')':''));
      if(applied<pr.amount)addActivity(db,`Portal payment: ${money(pr.amount-applied)} was more than ${pr.customer}'s dues`,'payment');
    }else{
      addActivity(db,`Portal payment rejected: ${pr.customer} ${money(pr.amount)}`,'payment');saveDB(db);
    }
    return pr;
  }
  async function updateCustomerPin(newPin){
    const s=getSession();if(!tableMode()||!s?.customerToken)return false;
    const client=getSupabase();const result=await client.rpc('customer_update_pin',{raw_token:s.customerToken,new_pin:newPin});
    if(result.error)throw result.error;return true;
  }
  async function updateCustomerAvatar(avatarData){
    const s=getSession();if(!tableMode()||!s?.customerToken)return false;
    const client=getSupabase();let result=await client.rpc('update_customer_photo',{token:s.customerToken,image:avatarData});
    if(result.error&&String(result.error.message||'').includes('schema cache')){
      result=await client.rpc('customer_update_avatar',{avatar_data_input:avatarData,raw_token:s.customerToken});
    }
    if(result.error)throw result.error;const db=getDB();const c=customerById(db,s.customerId)||db.customers.find(x=>x._tableId===s.customerTableId);if(c)c.avatarData=avatarData;writeLocal(db);return true;
  }
  // Re-verify the logged-in admin's password before destructive actions
  // (reset / restore). Tables mode re-authenticates against Supabase Auth;
  // local mode checks the stored admin password.
  async function verifyAdminPassword(password){
    if(!password)return false;
    if(!tableMode()){const db=getDB();return String(password)===String(db.settings.adminPass||'')}
    const client=getSupabase();const s=getSession();
    if(!client||!s?.email)return false;
    const r=await client.auth.signInWithPassword({email:s.email,password});
    return !r.error;
  }
  function setSession(role,data){sessionStorage.setItem(SESSION,JSON.stringify({role,...data,loginAt:now()}))}
  function getSession(){try{return JSON.parse(sessionStorage.getItem(SESSION)||'null')}catch(e){return null}}
  function isStaffSession(){return getSession()?.role==='staff'}
  function isMainAdminSession(){return getSession()?.role==='admin'}
  function clearSession(){sessionStorage.removeItem(SESSION)}
  function getStores(){return (getDB().stores||[defaultStore()]).filter(s=>s.isActive!==false)}
  async function addStore(db,input){if(!isMainAdminSession())throw new Error('Only main admin can create stores');const name=String(input.name||'').trim();const phone=phoneClean(input.phone||'');const adminEmail=String(input.adminEmail||'').trim().toLowerCase();if(!name)throw new Error('Store name is required');if(!adminEmail.includes('@'))throw new Error('Store admin email is required');if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_create_store',{name_input:name,phone_input:phone,email_input:adminEmail});if(r.error)throw r.error;setActiveStoreId(r.data);await loadTableDB();return r.data}db.stores.unshift({id:id(),name,phone,adminEmail,createdAt:now(),isActive:true});setActiveStoreId(db.stores[0].id);saveDB(db);return db.stores[0]}
  async function deleteStore(db,storeId){if(!isMainAdminSession())throw new Error('Only main admin can delete stores');const stores=getStores();if(stores.length<=1)throw new Error('You must keep at least one store');if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_delete_store',{store_input:storeId});if(r.error)throw r.error;if(getActiveStoreId()===storeId)setActiveStoreId('default');await loadTableDB();return}db.stores=(db.stores||[]).filter(s=>s.id!==storeId);if(getActiveStoreId()===storeId)setActiveStoreId(db.stores[0]?.id||'default');saveDB(db)}
  async function updateStore(db,storeId,input){if(!isMainAdminSession())throw new Error('Only main admin can edit stores');const name=String(input.name||'').trim();const phone=phoneClean(input.phone||'');if(!name)throw new Error('Store name is required');if(tableMode()){const client=getSupabase();const r=await client.from('mart_stores').update({name,phone,updated_at:now()}).eq('id',storeId);if(r.error)throw r.error;await loadTableDB();return}const store=(db.stores||[]).find(s=>s.id===storeId);if(!store)throw new Error('Store not found');store.name=name;store.phone=phone;saveDB(db)}
  function addActivity(db,message,type='info'){db.activity.unshift({id:id(),type,message,time:now()});db.activity=db.activity.slice(0,60)}
  function deleteTableRow(table,row){const client=getSupabase();if(!(tableMode()&&client&&row?._tableId))return;touchLocal();const tableId=row._tableId;client.from(table).delete().eq('id',tableId).then(r=>{if(r.error){deleteQueue.push({table,tableId});persistPending();console.error('Delete failed, queued for retry:',r.error)}},()=>{deleteQueue.push({table,tableId});persistPending()})}
  function customerBalance(db,customerId){const rows=db.credits.filter(c=>c.customerId===customerId);const taken=rows.reduce((s,c)=>s+num(c.amount),0);const paid=rows.reduce((s,c)=>s+num(c.paid),0);return{taken,paid,balance:Math.max(0,taken-paid),rows}}
  function findCustomer(db,phone,pin){const ph=phoneClean(phone);return db.customers.find(c=>phoneClean(c.phone)===ph&&String(c.pin||'')===String(pin||''))}
  function customerById(db,idv){return db.customers.find(c=>c.id===idv)}
  function addCustomer(db,input){const ph=phoneClean(input.phone);if(ph.length<10)throw new Error('Enter valid 10 digit phone number');if(!String(input.pin||'').match(/^\d{4}$/))throw new Error('PIN must be exactly 4 digits');const sid=getActiveStoreId();if(db.customers.some(c=>phoneClean(c.phone)===ph&&(c.storeId===sid||(!c.storeId&&sid==='default'))))throw new Error('Customer phone already exists');const c={id:id(),storeId:sid,name:String(input.name||'').trim(),phone:ph,pin:String(input.pin),email:String(input.email||'').trim(),address:String(input.address||'').trim(),notes:String(input.notes||'').trim(),creditLimit:num(input.creditLimit)||0,createdAt:now()};if(!c.name)throw new Error('Customer name is required');db.customers.unshift(c);markDirty('customers',c.id);addActivity(db,`Customer added: ${c.name}`,'customer');saveDB(db);return c}
  function updateCustomer(db,idv,patch){const c=customerById(db,idv);if(!c)throw new Error('Customer not found');if(patch.phone){const ph=phoneClean(patch.phone);if(ph.length<10)throw new Error('Enter valid 10 digit phone number');if(db.customers.some(x=>x.id!==idv&&phoneClean(x.phone)===ph))throw new Error('Phone already used by another customer');c.phone=ph}['name','email','address','notes'].forEach(k=>{if(k in patch)c[k]=String(patch[k]||'').trim()});if('creditLimit' in patch)c.creditLimit=num(patch.creditLimit)||0;if(patch.pin){if(!String(patch.pin).match(/^\d{4}$/))throw new Error('PIN must be exactly 4 digits');c.pin=String(patch.pin)}c.updatedAt=now();markDirty('customers',c.id);addActivity(db,`Customer updated: ${c.name}`,'customer');saveDB(db);return c}
  function deleteCustomer(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const c=customerById(db,idv);if(!c)throw new Error('Customer not found');if(db.credits.some(x=>x.customerId===idv))throw new Error('This customer has credit history. Keep the profile for records.');deleteTableRow('customers',c);db.customers=db.customers.filter(x=>x.id!==idv);addActivity(db,`Customer deleted: ${c.name}`,'customer');saveDB(db)}
  function addCredit(db,input){const c=customerById(db,input.customerId);if(!c)throw new Error('Select customer');const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const limit=num(c.creditLimit)||0;if(limit>0){const{balance}=customerBalance(db,c.id);if(balance+amount>limit)throw new Error(`Credit limit exceeded. ${c.name} limit is ${money(limit)}, current balance ${money(balance)}`)}const cr={id:id(),storeId:getActiveStoreId(),customerId:c.id,customer:c.name,phone:c.phone,date:input.date||today(),dueDate:input.dueDate?isoDate(input.dueDate):'',items:String(input.items||'').trim(),amount,paid:0,note:String(input.note||'').trim(),createdAt:now()};db.credits.unshift(cr);markDirty('credits',cr.id);addActivity(db,`Credit ${money(amount)} added for ${c.name}`,'credit');saveDB(db);return cr}
  function addCreditPayment(db,customerId,amount,note){let remaining=num(amount);if(remaining<=0)throw new Error('Payment amount must be greater than 0');const c=customerById(db,customerId);if(!c)throw new Error('Customer not found');const rows=db.credits.filter(x=>x.customerId===customerId&&num(x.amount)>num(x.paid)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));for(const r of rows){const bal=num(r.amount)-num(r.paid);const pay=Math.min(bal,remaining);r.paid=num(r.paid)+pay;r.paidAt=now();if(note)r.paymentNote=String(note).trim();markDirty('credits',r.id);remaining-=pay;if(remaining<=0)break}addActivity(db,`Payment ${money(amount-remaining)} received from ${c.name}`,'payment');saveDB(db);return amount-remaining}
  function deleteCredit(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.credits.find(x=>x.id===idv);if(!r)throw new Error('Credit not found');deleteTableRow('credits',r);db.credits=db.credits.filter(x=>x.id!==idv);addActivity(db,`Credit deleted: ${r.customer} ${money(r.amount)}`,'credit');saveDB(db)}
  function addSale(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const s={id:id(),date:input.date||today(),party:String(input.party||'Walk-in Customer').trim(),amount,note:String(input.note||'').trim(),createdAt:now()};db.sales.unshift(s);markDirty('sales',s.id);addActivity(db,`Sale ${money(amount)} - ${s.party}`,'sale');saveDB(db);return s}
  function deleteSale(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.sales.find(x=>x.id===idv);deleteTableRow('sales',r);db.sales=db.sales.filter(x=>x.id!==idv);if(r)addActivity(db,`Sale deleted: ${money(r.amount)}`,'sale');saveDB(db)}
  function addDaily(db,input){const fields=['pos','fonepay','cash','finance','partyPayment','other'];const d={id:id(),storeId:getActiveStoreId(),date:input.date||today(),note:String(input.note||'').trim(),createdAt:now()};fields.forEach(f=>d[f]=num(input[f]));db.dailySales.unshift(d);markDirty('dailySales',d.id);addActivity(db,`Daily sales saved for ${d.date}`,'daily');saveDB(db);return d}
  function updateDaily(db,idv,input){const r=db.dailySales.find(x=>x.id===idv);if(!r)throw new Error('Daily sales entry not found');const fields=['pos','fonepay','cash','finance','partyPayment','other'];r.date=input.date||r.date||today();fields.forEach(f=>{if(f in input)r[f]=num(input[f])});r.note=String(input.note||'').trim();r.updatedAt=now();markDirty('dailySales',r.id);addActivity(db,`Daily sales updated for ${r.date}`,'daily');saveDB(db);return r}
  function deleteDaily(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.dailySales.find(x=>x.id===idv);deleteTableRow('daily_sales',r);db.dailySales=db.dailySales.filter(x=>x.id!==idv);addActivity(db,'Daily sales entry deleted','daily');saveDB(db)}
  function addPartyPayment(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const p={id:id(),storeId:getActiveStoreId(),date:input.date||today(),party:String(input.party||'').trim(),amount,method:String(input.method||'Cash'),reference:String(input.reference||'').trim(),note:String(input.note||'').trim(),createdAt:now()};if(!p.party)throw new Error('Party name is required');db.partyPayments.unshift(p);markDirty('partyPayments',p.id);addActivity(db,`Party payment ${money(amount)} to ${p.party}`,'party');saveDB(db);return p}
  function deletePartyPayment(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.partyPayments.find(x=>x.id===idv);deleteTableRow('party_payments',r);db.partyPayments=db.partyPayments.filter(x=>x.id!==idv);addActivity(db,'Party payment deleted','party');saveDB(db)}
  function addCheque(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const ch={id:id(),storeId:getActiveStoreId(),party:String(input.party||'').trim(),chequeNo:String(input.chequeNo||'').trim(),amount,bank:String(input.bank||'').trim(),chequeDate:input.chequeDate||today(),status:String(input.status||'hold'),note:String(input.note||'').trim(),createdAt:now()};if(!ch.party||!ch.chequeNo)throw new Error('Party and cheque number are required');db.cheques.unshift(ch);markDirty('cheques',ch.id);addActivity(db,`Cheque added: ${ch.chequeNo} - ${ch.party}`,'cheque');saveDB(db);return ch}
  // Cheque queue: quick reminders of parties whose cheque still has to be written
  // (e.g. a ledger arrived on WhatsApp). Cleared once the cheque is written.
  function addChequeQueue(db,input){const party=String(input.party||'').trim();if(!party)throw new Error('Party name is required');const q={id:id(),storeId:getActiveStoreId(),party,amount:num(input.amount)||0,note:String(input.note||'').trim(),createdAt:now()};db.chequeQueue=db.chequeQueue||[];db.chequeQueue.unshift(q);markDirty('chequeQueue',q.id);addActivity(db,`Cheque to write: ${party}`,'cheque');saveDB(db);return q}
  function deleteChequeQueue(db,idv){const r=(db.chequeQueue||[]).find(x=>x.id===idv);if(!r)throw new Error('Queue entry not found');deleteTableRow('cheque_queue',r);db.chequeQueue=(db.chequeQueue||[]).filter(x=>x.id!==idv);dirty.chequeQueue.delete(idv);persistPending();addActivity(db,`Cheque queue cleared: ${r.party}`,'cheque');saveDB(db);return r}
  function updateChequeStatus(db,idv,status){const ch=db.cheques.find(x=>x.id===idv);if(!ch)throw new Error('Cheque not found');ch.status=status;ch.updatedAt=now();markDirty('cheques',ch.id);addActivity(db,`Cheque ${ch.chequeNo} marked ${status}`,'cheque');saveDB(db)}
  function deleteCheque(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.cheques.find(x=>x.id===idv);deleteTableRow('cheques',r);db.cheques=db.cheques.filter(x=>x.id!==idv);addActivity(db,'Cheque deleted','cheque');saveDB(db)}
  // Party accounts: saved supplier/party master used by estimates, cheques and payments
  function addParty(db,input){const name=String(input.name||'').trim();if(!name)throw new Error('Party name is required');const sid=getActiveStoreId();db.parties=db.parties||[];if(db.parties.some(p=>String(p.name||'').trim().toLowerCase()===name.toLowerCase()&&(p.storeId===sid||(!p.storeId&&sid==='default'))))throw new Error('Party "'+name+'" already exists');const p={id:id(),storeId:sid,name,phone:phoneClean(input.phone||'')||String(input.phone||'').trim(),notes:String(input.notes||'').trim(),createdAt:now()};db.parties.unshift(p);markDirty('parties',p.id);addActivity(db,`Party account created: ${name}`,'party');saveDB(db);return p}
  function deleteParty(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=(db.parties||[]).find(x=>x.id===idv);if(!r)throw new Error('Party not found');deleteTableRow('parties',r);db.parties=(db.parties||[]).filter(x=>x.id!==idv);dirty.parties.delete(idv);persistPending();addActivity(db,`Party account deleted: ${r.name}`,'party');saveDB(db)}
  function estimateStatus(v){return ['draft','sent','approved','rejected','expired'].includes(String(v||''))?String(v):'draft'}
  function addEstimateBill(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const customer=String(input.customer||'').trim();if(!customer)throw new Error('Customer or party name is required');const est={id:id(),storeId:getActiveStoreId(),date:input.date||today(),customer,phone:phoneClean(input.phone||''),items:String(input.items||'').trim(),amount,validUntil:input.validUntil?isoDate(input.validUntil):'',status:estimateStatus(input.status),note:String(input.note||'').trim(),createdAt:now(),updatedAt:now()};db.estimateBills=db.estimateBills||[];db.estimateBills.unshift(est);markDirty('estimateBills',est.id);addActivity(db,`Estimate bill ${money(amount)} - ${customer}`,'estimate');saveDB(db);return est}
  function updateEstimateStatus(db,idv,status){const est=(db.estimateBills||[]).find(x=>x.id===idv);if(!est)throw new Error('Estimate bill not found');est.status=estimateStatus(status);est.updatedAt=now();markDirty('estimateBills',est.id);addActivity(db,`Estimate ${est.customer} marked ${est.status}`,'estimate');saveDB(db);return est}
  function deleteEstimateBill(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=(db.estimateBills||[]).find(x=>x.id===idv);if(!r)throw new Error('Estimate bill not found');deleteTableRow('estimate_bills',r);db.estimateBills=(db.estimateBills||[]).filter(x=>x.id!==idv);addActivity(db,`Estimate deleted: ${r.customer} ${money(r.amount)}`,'estimate');saveDB(db)}
  function saveSettings(db,input){if(!isMainAdminSession())throw new Error('Only main admin can change settings');db.settings.martName=String(input.martName||db.settings.martName||'MartAI').trim();db.settings.martPhone=phoneClean(input.martPhone||db.settings.martPhone||'');const st=(db.stores||[]).find(x=>x.id===getActiveStoreId());if(st){st.name=db.settings.martName;st.phone=db.settings.martPhone}db.settings.adminUser=String(input.adminUser||db.settings.adminUser||'admin').trim();if(input.adminPass)db.settings.adminPass=String(input.adminPass);settingsDirty=true;addActivity(db,'Settings updated','settings');saveDB(db)}
  async function saveStoreLogo(logoData){const db=getDB();db.settings.storeLogo=logoData||'';const storeId=getActiveStoreId();const store=(db.stores||[]).find(s=>s.id===storeId);if(store)store.logoData=logoData||'';if(tableMode()){const client=getSupabase();if(client){const r=await client.from('mart_stores').update({logo_data:logoData||'',updated_at:now()}).eq('id',storeId);if(r.error)throw r.error}}saveDB(db)}
  async function saveStoreQr(qrData,label){const db=getDB();db.settings.storePaymentQr=qrData||'';db.settings.storePaymentQrLabel=label||'';const storeId=getActiveStoreId();const store=(db.stores||[]).find(s=>s.id===storeId);if(store){store.qrData=qrData||'';store.qrLabel=label||''}if(tableMode()){const client=getSupabase();if(client){const r=await client.from('mart_stores').update({qr_data:qrData||'',qr_label:label||'',updated_at:now()}).eq('id',storeId);if(r.error)throw r.error}}saveDB(db)}
  async function addStaff(db,input){if(isStaffSession())throw new Error('Staff cannot manage staff');const email=String(input.email||'').trim().toLowerCase();const name=String(input.name||'').trim();if(!email.includes('@'))throw new Error('Enter staff email');if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_add_staff',{email_input:email,name_input:name});if(r.error)throw r.error;await loadTableDB();return r.data}if(db.staffAccounts.some(x=>x.email.toLowerCase()===email))throw new Error('Staff already exists');db.staffAccounts.unshift({id:id(),email,name,password:String(input.password||'1234'),active:true,createdAt:now()});saveDB(db)}
  async function setStaffActive(db,email,active){if(isStaffSession())throw new Error('Staff cannot manage staff');email=String(email||'').toLowerCase();if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_set_staff_active',{email_input:email,active_input:!!active});if(r.error)throw r.error;await loadTableDB();return}const s=db.staffAccounts.find(x=>x.email.toLowerCase()===email);if(s)s.active=!!active;saveDB(db)}
  function csvEscape(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
  function download(filename,content){const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},100)}
  function wa(phone,message){const ph=phoneClean(phone);if(!ph)throw new Error('Phone missing');window.open('https://wa.me/977'+ph+'?text='+encodeURIComponent(message),'_blank')}
  function byDate(arr,dateField='date'){return [...arr].sort((a,b)=>String(b[dateField]||b.createdAt).localeCompare(String(a[dateField]||a.createdAt)))}
  // === LIVE MULTI-DEVICE SYNC (Supabase Realtime) ===
  // Any change made on another device triggers a debounced reload + re-render.
  // Our own writes also emit events; the echo window skips those.
  let realtimeChannel=null,onRemoteChange=null,realtimeTimer=null,lastLocalWriteAt=0;
  function touchLocal(){lastLocalWriteAt=Date.now()}
  function onDataChange(cb){onRemoteChange=cb}
  function startRealtime(){
    if(!tableMode()||realtimeChannel)return false;
    const client=getSupabase();if(!client||typeof client.channel!=='function')return false;
    const s=getSession();if(!(s?.role==='admin'||s?.role==='staff'||s?.role==='store_admin'))return false;
    const tables=['customers','credits','sales','daily_sales','party_payments','cheques','cheque_queue','parties','estimate_bills','payment_requests','mart_stores'];
    realtimeChannel=client.channel('martai-live');
    tables.forEach(t=>realtimeChannel.on('postgres_changes',{event:'*',schema:'public',table:t},()=>{
      if(Date.now()-lastLocalWriteAt<3000)return; // our own write echoing back
      if(hasPending())return;                     // don't clobber unsynced offline work
      clearTimeout(realtimeTimer);
      realtimeTimer=setTimeout(async()=>{
        try{await loadTableDB();if(typeof onRemoteChange==='function')onRemoteChange()}catch(e){console.warn('Live sync reload failed:',e)}
      },900);
    }));
    realtimeChannel.subscribe();
    return true;
  }
  // 3D tilt-toward-cursor effect. Desktop pointers only; disabled for reduced-motion users.
  function tilt3d(el,max=6){
    if(!el)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
    let raf=0;
    el.style.transformStyle='preserve-3d';el.style.willChange='transform';
    el.addEventListener('pointermove',e=>{
      const r=el.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-.5;
      const y=(e.clientY-r.top)/r.height-.5;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{el.style.transform=`perspective(1000px) rotateX(${(-y*max).toFixed(2)}deg) rotateY(${(x*max).toFixed(2)}deg) translateZ(8px)`});
    });
    el.addEventListener('pointerleave',()=>{
      cancelAnimationFrame(raf);
      el.style.transition='transform .55s cubic-bezier(.2,.8,.3,1)';
      el.style.transform='perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0)';
      setTimeout(()=>{el.style.transition=''},560);
    });
  }
  async function initialize(){
    restorePending();
    if(!tableMode())return loadRemoteDB();
    const s=getSession();
    if(s?.role==='admin'||s?.role==='staff'||s?.role==='store_admin')return loadTableDB();
    if(s?.role==='customer'&&s.customerToken)return loadCustomerPortal(s.customerToken);
    remoteEnabled=!!getSupabase();return getDB();
  }
  window.addEventListener('online',()=>{const s=getSession();if(tableMode()&&hasPending()&&(s?.role==='admin'||s?.role==='staff'||s?.role==='store_admin'))queueRemoteSave(getDB())});
  // PWA: register the service worker (all pages load this file)
  if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}
  const ready=initialize();
  window.MartAI={KEY,SESSION,id,today,now,num,money,esc,phoneClean,getDB,saveDB,markDirty,resetDB,restoreBackup,syncNow,syncInfo,ready,adminLogin,customerLogin,publicStoreInfo,verifyAdminPassword,customerRequestPayment,resolvePaymentRequest,startRealtime,onDataChange,updateCustomerPin,updateCustomerAvatar,setSession,getSession,clearSession,getStores,getActiveStoreId,setActiveStoreId,addStore,deleteStore,updateStore,addActivity,customerBalance,findCustomer,customerById,addCustomer,updateCustomer,deleteCustomer,addCredit,addCreditPayment,deleteCredit,addSale,deleteSale,addDaily,updateDaily,deleteDaily,addPartyPayment,deletePartyPayment,addCheque,updateChequeStatus,deleteCheque,addChequeQueue,deleteChequeQueue,addParty,deleteParty,addEstimateBill,updateEstimateStatus,deleteEstimateBill,saveSettings,saveStoreLogo,saveStoreQr,addStaff,setStaffActive,csvEscape,download,wa,byDate,tilt3d};
})();
