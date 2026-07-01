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
  function id(){return 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
  function today(){return new Date().toISOString().slice(0,10)}
  function now(){return new Date().toISOString()}
  function num(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
  function money(v){return 'Rs '+num(v).toLocaleString('en-IN')}
  function esc(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}
  function phoneClean(v){return String(v||'').replace(/\D/g,'').slice(-10)}
  function defaultStore(){return{id:'default',name:'RD MART',phone:'',createdAt:now(),isActive:true}}
  function getActiveStoreId(){return localStorage.getItem(ACTIVE_STORE)||'default'}
  function setActiveStoreId(storeId){localStorage.setItem(ACTIVE_STORE,storeId||'default');currentDB=null}
  function makeDB(){return{version:1,createdAt:now(),settings:{martName:'MartAI',adminUser:'admin',adminPass:'mart2024',martPhone:'9800000000'},stores:[defaultStore()],customers:[],credits:[],sales:[],dailySales:[],partyPayments:[],cheques:[],activity:[],staffAccounts:[]}}
  function normalizeDB(db){if(!db||typeof db!=='object')db=makeDB();['settings','stores','customers','credits','sales','dailySales','partyPayments','cheques','activity','loginEvents','staffAccounts'].forEach(k=>{if(k==='settings'){db[k]=db[k]||makeDB().settings}else if(!Array.isArray(db[k]))db[k]=[]});if(!db.stores.length)db.stores=[defaultStore()];if(!db.settings.adminUser)db.settings.adminUser='admin';if(!db.settings.adminPass)db.settings.adminPass='mart2024';return db}
  function readLocal(){let db;try{db=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){db=null}return normalizeDB(db)}
  function writeLocal(db){localStorage.setItem(KEY,JSON.stringify(db))}
  function getDB(){if(!currentDB)currentDB=readLocal();return currentDB}
  function getSupabase(){const cfg=window.MARTAI_SUPABASE||{};const configured=cfg.url&&cfg.anonKey&&!String(cfg.url).includes('YOUR_SUPABASE')&&!String(cfg.anonKey).includes('YOUR_SUPABASE');if(!configured||!window.supabase)return null;if(!supabaseClient)supabaseClient=window.supabase.createClient(cfg.url,cfg.anonKey);return supabaseClient}
  function dbMode(){return (window.MARTAI_SUPABASE&&window.MARTAI_SUPABASE.mode)||'json'}
  function tableMode(){return dbMode()==='tables'}
  function isoDate(v){return String(v||today()).slice(0,10)}
  function fromStoreRow(r){return{id:r.id,name:r.name||'Store',phone:r.phone||'',createdAt:r.created_at,isActive:r.is_active!==false}}
  function fromCustomerRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),name:r.name||'',phone:r.phone||'',pin:'',avatarData:r.avatar_data||'',email:r.email||'',address:r.address||'',notes:r.notes||'',creditLimit:num(r.credit_limit)||0,createdAt:r.created_at,updatedAt:r.updated_at}}
  function fromCreditRow(r,customers){const c=customers.find(x=>x._tableId===r.customer_id)||{};return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),customerId:c.id||r.customer_id,customer:c.name||'',phone:c.phone||'',date:r.credit_date,items:r.items||'',amount:num(r.amount),paid:num(r.paid),note:r.note||'',paymentNote:r.payment_note||'',paidAt:r.paid_at,createdAt:r.created_at}}
  function fromSaleRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.sale_date,party:r.party||'Walk-in Customer',amount:num(r.amount),note:r.note||'',createdAt:r.created_at}}
  function fromDailyRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.sale_date,pos:num(r.pos),fonepay:num(r.fonepay),cash:num(r.cash),finance:num(r.finance),partyPayment:num(r.party_payment),other:num(r.other),note:r.note||'',createdAt:r.created_at}}
  function fromPartyPaymentRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),date:r.payment_date,party:r.party||'',amount:num(r.amount),method:r.method||'Cash',reference:r.reference||'',note:r.note||'',createdAt:r.created_at}}
  function fromChequeRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),party:r.party||'',chequeNo:r.cheque_no||'',amount:num(r.amount),bank:r.bank||'',chequeDate:r.cheque_date,status:r.status||'hold',note:r.note||'',createdAt:r.created_at,updatedAt:r.updated_at}}
  function fromActivityRow(r){return{id:r.legacy_id||r.id,_tableId:r.id,storeId:r.store_id||getActiveStoreId(),type:r.activity_type||'info',message:r.message||'',time:r.created_at}}
  function fromLoginEventRow(r){return{id:r.id,role:r.login_role||'',customerId:r.customer_id||'',name:r.display_name||'',phone:r.phone||'',email:r.email||'',time:r.created_at}}
  function fromStaffRow(r){return{id:r.id,email:r.email||'',name:r.full_name||'',active:r.is_active!==false,createdAt:r.created_at}}
  async function saveRemoteNow(db){const client=getSupabase();if(!client)return;const result=await client.from(TABLE).upsert({id:STATE_ID,data:db,updated_at:now()});if(result.error)throw result.error}
  async function loadTableDB(){
    const client=getSupabase();if(!client)return getDB();
    try{
      const storeResult=await client.from('mart_stores').select('*').eq('is_active',true).order('created_at',{ascending:true});
      const stores=storeResult.error?[defaultStore()]:(storeResult.data||[]).map(fromStoreRow);
      let storeId=getActiveStoreId();if(!stores.some(s=>s.id===storeId)){storeId=stores[0]?.id||'default';setActiveStoreId(storeId)}
      const byStore=q=>storeResult.error?q:q.eq('store_id',storeId);
      const [settings,customers,credits,sales,daily,party,cheques,activity]=await Promise.all([
        client.from('mart_settings').select('*').eq('id',true).maybeSingle(),
        byStore(client.from('customers').select('*')).order('created_at',{ascending:false}),
        byStore(client.from('credits').select('*')).order('credit_date',{ascending:false}),
        byStore(client.from('sales').select('*')).order('sale_date',{ascending:false}),
        byStore(client.from('daily_sales').select('*')).order('sale_date',{ascending:false}),
        byStore(client.from('party_payments').select('*')).order('payment_date',{ascending:false}),
        byStore(client.from('cheques').select('*')).order('cheque_date',{ascending:false}),
        byStore(client.from('activity').select('*')).order('created_at',{ascending:false}).limit(60)
      ]);
      [settings,customers,credits,sales,daily,party,cheques,activity].forEach(r=>{if(r.error)throw r.error});
      const customerRows=(customers.data||[]).map(fromCustomerRow);
      const activeStore=stores.find(s=>s.id===storeId)||stores[0]||defaultStore();
      currentDB=normalizeDB({
        version:2,
        createdAt:now(),
        settings:{martName:activeStore.name||settings.data?.mart_name||'RD MART',adminUser:'',adminPass:'',martPhone:activeStore.phone||settings.data?.mart_phone||''},
        stores,
        customers:customerRows,
        credits:(credits.data||[]).map(r=>fromCreditRow(r,customerRows)),
        sales:(sales.data||[]).map(fromSaleRow),
        dailySales:(daily.data||[]).map(fromDailyRow),
        partyPayments:(party.data||[]).map(fromPartyPaymentRow),
        cheques:(cheques.data||[]).map(fromChequeRow),
        activity:(activity.data||[]).map(fromActivityRow),
        loginEvents:[]
      });
      const logins=await client.from('login_events').select('*').order('created_at',{ascending:false}).limit(80);
      if(!logins.error)currentDB.loginEvents=(logins.data||[]).map(fromLoginEventRow);
      const staff=await client.from('mart_staff').select('*').order('created_at',{ascending:false}).limit(80);
      if(!staff.error)currentDB.staffAccounts=(staff.data||[]).map(fromStaffRow);
      writeLocal(currentDB);remoteEnabled=true;remoteError='';return currentDB;
    }catch(e){remoteEnabled=false;remoteError=e.message||String(e);console.error('Supabase table load failed:',e);return getDB()}
  }
  async function hashPin(pin){const client=getSupabase();const r=await client.rpc('hash_pin',{pin});if(r.error)throw r.error;return r.data}
  async function saveTableDB(db){
    const client=getSupabase();if(!client)return;
    db=normalizeDB(db);
    const s=db.settings||{};
    const storeId=getActiveStoreId();
    let r;
    if(isMainAdminSession()){
      r=await client.from('mart_settings').upsert({id:true,mart_name:s.martName||'RD MART',mart_phone:s.martPhone||'',updated_at:now()});if(r.error)throw r.error;
      r=await client.from('mart_stores').update({name:s.martName||'RD MART',phone:s.martPhone||'',updated_at:now()}).eq('id',storeId).select('id').maybeSingle();
      if(r.error&&String(r.error.message||'').includes('mart_stores')===false)throw r.error;
    }
    for(const c of db.customers){
      const base={legacy_id:c.id,store_id:storeId,name:c.name,phone:phoneClean(c.phone),avatar_data:c.avatarData||'',email:c.email||'',address:c.address||'',notes:c.notes||'',credit_limit:num(c.creditLimit)||0,updated_at:now()};
      if(c._tableId){
        const patch={...base};delete patch.legacy_id;if(c.pin)patch.pin_hash=await hashPin(c.pin);
        r=await client.from('customers').update(patch).eq('id',c._tableId).select('id').single();
      }else{
        r=await client.from('customers').insert({...base,pin_hash:await hashPin(c.pin||'0000')}).select('id').single();
      }
      if(r.error)throw r.error;c._tableId=r.data.id;c.pin='';
    }
    const byId=Object.fromEntries(db.customers.map(c=>[c.id,c]));
    for(const x of db.credits){const c=byId[x.customerId];if(!c?._tableId)continue;const row={legacy_id:x.id,store_id:storeId,customer_id:c._tableId,credit_date:isoDate(x.date),items:x.items||'',amount:num(x.amount),paid:num(x.paid),note:x.note||'',payment_note:x.paymentNote||'',paid_at:x.paidAt||null,created_at:x.createdAt||now()};r=x._tableId?await client.from('credits').update({...row,legacy_id:undefined}).eq('id',x._tableId).select('id').single():await client.from('credits').insert(row).select('id').single();if(r.error)throw r.error;x._tableId=r.data.id}
    for(const x of db.sales){const row={legacy_id:x.id,store_id:storeId,sale_date:isoDate(x.date),party:x.party||'Walk-in Customer',amount:num(x.amount),note:x.note||'',created_at:x.createdAt||now()};r=x._tableId?await client.from('sales').update({...row,legacy_id:undefined}).eq('id',x._tableId).select('id').single():await client.from('sales').insert(row).select('id').single();if(r.error)throw r.error;x._tableId=r.data.id}
    for(const x of db.dailySales){const row={legacy_id:x.id,store_id:storeId,sale_date:isoDate(x.date),pos:num(x.pos),fonepay:num(x.fonepay),cash:num(x.cash),finance:num(x.finance),party_payment:num(x.partyPayment),other:num(x.other),note:x.note||'',created_at:x.createdAt||now()};r=x._tableId?await client.from('daily_sales').update({...row,legacy_id:undefined}).eq('id',x._tableId).select('id').single():await client.from('daily_sales').insert(row).select('id').single();if(r.error)throw r.error;x._tableId=r.data.id}
    for(const x of db.partyPayments){const row={legacy_id:x.id,store_id:storeId,payment_date:isoDate(x.date),party:x.party||'',amount:num(x.amount),method:x.method||'Cash',reference:x.reference||'',note:x.note||'',created_at:x.createdAt||now()};r=x._tableId?await client.from('party_payments').update({...row,legacy_id:undefined}).eq('id',x._tableId).select('id').single():await client.from('party_payments').insert(row).select('id').single();if(r.error)throw r.error;x._tableId=r.data.id}
    for(const x of db.cheques){const row={legacy_id:x.id,store_id:storeId,party:x.party||'',cheque_no:x.chequeNo||'',amount:num(x.amount),bank:x.bank||'',cheque_date:isoDate(x.chequeDate),status:x.status||'hold',note:x.note||'',created_at:x.createdAt||now(),updated_at:x.updatedAt||null};r=x._tableId?await client.from('cheques').update({...row,legacy_id:undefined}).eq('id',x._tableId).select('id').single():await client.from('cheques').insert(row).select('id').single();if(r.error)throw r.error;x._tableId=r.data.id}
    writeLocal(db);remoteEnabled=true;remoteError='';
  }
  async function loadRemoteDB(){const client=getSupabase();if(!client){remoteEnabled=false;return getDB()}try{const result=await client.from(TABLE).select('data').eq('id',STATE_ID).maybeSingle();if(result.error)throw result.error;if(result.data&&result.data.data){currentDB=normalizeDB(result.data.data);writeLocal(currentDB)}else{currentDB=getDB();await saveRemoteNow(currentDB)}remoteEnabled=true;remoteError='';return currentDB}catch(e){remoteEnabled=false;remoteError=e.message||String(e);console.error('Supabase load failed:',e);return getDB()}}
  function queueRemoteSave(db){const client=getSupabase();if(!client)return;const saver=tableMode()?saveTableDB:saveRemoteNow;pendingSave=saver(db).then(()=>{remoteEnabled=true;remoteError=''}).catch(e=>{remoteEnabled=false;remoteError=e.message||String(e);console.error('Supabase save failed:',e)});return pendingSave}
  function saveDB(db){currentDB=normalizeDB(db);writeLocal(currentDB);queueRemoteSave(currentDB);return currentDB}
  function resetDB(){currentDB=makeDB();saveDB(currentDB);return currentDB}
  async function syncNow(){if(tableMode())await loadTableDB();else await loadRemoteDB();return getDB()}
  function syncInfo(){return{remoteEnabled,remoteError,configured:!!getSupabase(),mode:dbMode(),pendingSave}}
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
    const data=result.data||{};const c=data.customer||{};const customer={id:c.legacy_id||c.id,_tableId:c.id,name:c.name||'',phone:c.phone||'',avatarData:c.avatar_data||'',email:c.email||'',address:c.address||'',notes:c.notes||'',createdAt:c.created_at,updatedAt:c.updated_at};
    currentDB=normalizeDB({version:2,createdAt:now(),settings:{martName:'RD MART',adminUser:'',adminPass:'',martPhone:''},customers:[customer],credits:(data.credits||[]).map(r=>fromCreditRow(r,[customer])),sales:[],dailySales:[],partyPayments:[],cheques:[],activity:[]});
    writeLocal(currentDB);remoteEnabled=true;remoteError='';return currentDB;
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
  function deleteTableRow(table,row){const client=getSupabase();if(tableMode()&&client&&row?._tableId)client.from(table).delete().eq('id',row._tableId).then(r=>{if(r.error)console.error('Delete failed:',r.error)})}
  function customerBalance(db,customerId){const rows=db.credits.filter(c=>c.customerId===customerId);const taken=rows.reduce((s,c)=>s+num(c.amount),0);const paid=rows.reduce((s,c)=>s+num(c.paid),0);return{taken,paid,balance:Math.max(0,taken-paid),rows}}
  function findCustomer(db,phone,pin){const ph=phoneClean(phone);return db.customers.find(c=>phoneClean(c.phone)===ph&&String(c.pin||'')===String(pin||''))}
  function customerById(db,idv){return db.customers.find(c=>c.id===idv)}
  function addCustomer(db,input){const ph=phoneClean(input.phone);if(ph.length<10)throw new Error('Enter valid 10 digit phone number');if(!String(input.pin||'').match(/^\d{4}$/))throw new Error('PIN must be exactly 4 digits');if(db.customers.some(c=>phoneClean(c.phone)===ph))throw new Error('Customer phone already exists');const c={id:id(),name:String(input.name||'').trim(),phone:ph,pin:String(input.pin),email:String(input.email||'').trim(),address:String(input.address||'').trim(),notes:String(input.notes||'').trim(),creditLimit:num(input.creditLimit)||0,createdAt:now()};if(!c.name)throw new Error('Customer name is required');db.customers.unshift(c);addActivity(db,`Customer added: ${c.name}`,'customer');saveDB(db);return c}
  function updateCustomer(db,idv,patch){const c=customerById(db,idv);if(!c)throw new Error('Customer not found');if(patch.phone){const ph=phoneClean(patch.phone);if(ph.length<10)throw new Error('Enter valid 10 digit phone number');if(db.customers.some(x=>x.id!==idv&&phoneClean(x.phone)===ph))throw new Error('Phone already used by another customer');c.phone=ph}['name','email','address','notes'].forEach(k=>{if(k in patch)c[k]=String(patch[k]||'').trim()});if('creditLimit' in patch)c.creditLimit=num(patch.creditLimit)||0;if(patch.pin){if(!String(patch.pin).match(/^\d{4}$/))throw new Error('PIN must be exactly 4 digits');c.pin=String(patch.pin)}c.updatedAt=now();addActivity(db,`Customer updated: ${c.name}`,'customer');saveDB(db);return c}
  function deleteCustomer(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const c=customerById(db,idv);if(!c)throw new Error('Customer not found');if(db.credits.some(x=>x.customerId===idv))throw new Error('This customer has credit history. Keep the profile for records.');deleteTableRow('customers',c);db.customers=db.customers.filter(x=>x.id!==idv);addActivity(db,`Customer deleted: ${c.name}`,'customer');saveDB(db)}
  function addCredit(db,input){const c=customerById(db,input.customerId);if(!c)throw new Error('Select customer');const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const limit=num(c.creditLimit)||0;if(limit>0){const{balance}=customerBalance(db,c.id);if(balance+amount>limit)throw new Error(`Credit limit exceeded. ${c.name} limit is ${money(limit)}, current balance ${money(balance)}`)}const cr={id:id(),customerId:c.id,customer:c.name,phone:c.phone,date:input.date||today(),items:String(input.items||'').trim(),amount,paid:0,note:String(input.note||'').trim(),createdAt:now()};db.credits.unshift(cr);addActivity(db,`Credit ${money(amount)} added for ${c.name}`,'credit');saveDB(db);return cr}
  function addCreditPayment(db,customerId,amount,note){let remaining=num(amount);if(remaining<=0)throw new Error('Payment amount must be greater than 0');const c=customerById(db,customerId);if(!c)throw new Error('Customer not found');const rows=db.credits.filter(x=>x.customerId===customerId&&num(x.amount)>num(x.paid)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));for(const r of rows){const bal=num(r.amount)-num(r.paid);const pay=Math.min(bal,remaining);r.paid=num(r.paid)+pay;r.paidAt=now();if(note)r.paymentNote=String(note).trim();remaining-=pay;if(remaining<=0)break}addActivity(db,`Payment ${money(amount-remaining)} received from ${c.name}`,'payment');saveDB(db);return amount-remaining}
  function deleteCredit(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.credits.find(x=>x.id===idv);if(!r)throw new Error('Credit not found');deleteTableRow('credits',r);db.credits=db.credits.filter(x=>x.id!==idv);addActivity(db,`Credit deleted: ${r.customer} ${money(r.amount)}`,'credit');saveDB(db)}
  function addSale(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const s={id:id(),date:input.date||today(),party:String(input.party||'Walk-in Customer').trim(),amount,note:String(input.note||'').trim(),createdAt:now()};db.sales.unshift(s);addActivity(db,`Sale ${money(amount)} - ${s.party}`,'sale');saveDB(db);return s}
  function deleteSale(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.sales.find(x=>x.id===idv);deleteTableRow('sales',r);db.sales=db.sales.filter(x=>x.id!==idv);if(r)addActivity(db,`Sale deleted: ${money(r.amount)}`,'sale');saveDB(db)}
  function addDaily(db,input){const fields=['pos','fonepay','cash','finance','partyPayment','other'];const d={id:id(),date:input.date||today(),note:String(input.note||'').trim(),createdAt:now()};fields.forEach(f=>d[f]=num(input[f]));db.dailySales.unshift(d);addActivity(db,`Daily sales saved for ${d.date}`,'daily');saveDB(db);return d}
  function deleteDaily(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.dailySales.find(x=>x.id===idv);deleteTableRow('daily_sales',r);db.dailySales=db.dailySales.filter(x=>x.id!==idv);addActivity(db,'Daily sales entry deleted','daily');saveDB(db)}
  function addPartyPayment(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const p={id:id(),date:input.date||today(),party:String(input.party||'').trim(),amount,method:String(input.method||'Cash'),reference:String(input.reference||'').trim(),note:String(input.note||'').trim(),createdAt:now()};if(!p.party)throw new Error('Party name is required');db.partyPayments.unshift(p);addActivity(db,`Party payment ${money(amount)} to ${p.party}`,'party');saveDB(db);return p}
  function deletePartyPayment(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.partyPayments.find(x=>x.id===idv);deleteTableRow('party_payments',r);db.partyPayments=db.partyPayments.filter(x=>x.id!==idv);addActivity(db,'Party payment deleted','party');saveDB(db)}
  function addCheque(db,input){const amount=num(input.amount);if(amount<=0)throw new Error('Amount must be greater than 0');const ch={id:id(),party:String(input.party||'').trim(),chequeNo:String(input.chequeNo||'').trim(),amount,bank:String(input.bank||'').trim(),chequeDate:input.chequeDate||today(),status:String(input.status||'hold'),note:String(input.note||'').trim(),createdAt:now()};if(!ch.party||!ch.chequeNo)throw new Error('Party and cheque number are required');db.cheques.unshift(ch);addActivity(db,`Cheque added: ${ch.chequeNo} - ${ch.party}`,'cheque');saveDB(db);return ch}
  function updateChequeStatus(db,idv,status){const ch=db.cheques.find(x=>x.id===idv);if(!ch)throw new Error('Cheque not found');ch.status=status;ch.updatedAt=now();addActivity(db,`Cheque ${ch.chequeNo} marked ${status}`,'cheque');saveDB(db)}
  function deleteCheque(db,idv){if(isStaffSession())throw new Error('Staff cannot delete records');const r=db.cheques.find(x=>x.id===idv);deleteTableRow('cheques',r);db.cheques=db.cheques.filter(x=>x.id!==idv);addActivity(db,'Cheque deleted','cheque');saveDB(db)}
  function saveSettings(db,input){if(!isMainAdminSession())throw new Error('Only main admin can change settings');db.settings.martName=String(input.martName||db.settings.martName||'MartAI').trim();db.settings.martPhone=phoneClean(input.martPhone||db.settings.martPhone||'');const st=(db.stores||[]).find(x=>x.id===getActiveStoreId());if(st){st.name=db.settings.martName;st.phone=db.settings.martPhone}db.settings.adminUser=String(input.adminUser||db.settings.adminUser||'admin').trim();if(input.adminPass)db.settings.adminPass=String(input.adminPass);addActivity(db,'Settings updated','settings');saveDB(db)}
  async function addStaff(db,input){if(isStaffSession())throw new Error('Staff cannot manage staff');const email=String(input.email||'').trim().toLowerCase();const name=String(input.name||'').trim();if(!email.includes('@'))throw new Error('Enter staff email');if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_add_staff',{email_input:email,name_input:name});if(r.error)throw r.error;await loadTableDB();return r.data}if(db.staffAccounts.some(x=>x.email.toLowerCase()===email))throw new Error('Staff already exists');db.staffAccounts.unshift({id:id(),email,name,password:String(input.password||'1234'),active:true,createdAt:now()});saveDB(db)}
  async function setStaffActive(db,email,active){if(isStaffSession())throw new Error('Staff cannot manage staff');email=String(email||'').toLowerCase();if(tableMode()){const client=getSupabase();const r=await client.rpc('admin_set_staff_active',{email_input:email,active_input:!!active});if(r.error)throw r.error;await loadTableDB();return}const s=db.staffAccounts.find(x=>x.email.toLowerCase()===email);if(s)s.active=!!active;saveDB(db)}
  function csvEscape(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
  function download(filename,content){const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},100)}
  function wa(phone,message){const ph=phoneClean(phone);if(!ph)throw new Error('Phone missing');window.open('https://wa.me/977'+ph+'?text='+encodeURIComponent(message),'_blank')}
  function byDate(arr,dateField='date'){return [...arr].sort((a,b)=>String(b[dateField]||b.createdAt).localeCompare(String(a[dateField]||a.createdAt)))}
  async function initialize(){
    if(!tableMode())return loadRemoteDB();
    const s=getSession();
    if(s?.role==='admin'||s?.role==='staff')return loadTableDB();
    if(s?.role==='customer'&&s.customerToken)return loadCustomerPortal(s.customerToken);
    remoteEnabled=!!getSupabase();return getDB();
  }
  const ready=initialize();
  window.MartAI={KEY,SESSION,id,today,now,num,money,esc,phoneClean,getDB,saveDB,resetDB,syncNow,syncInfo,ready,adminLogin,customerLogin,updateCustomerPin,updateCustomerAvatar,setSession,getSession,clearSession,getStores,getActiveStoreId,setActiveStoreId,addStore,deleteStore,updateStore,addActivity,customerBalance,findCustomer,customerById,addCustomer,updateCustomer,deleteCustomer,addCredit,addCreditPayment,deleteCredit,addSale,deleteSale,addDaily,deleteDaily,addPartyPayment,deletePartyPayment,addCheque,updateChequeStatus,deleteCheque,saveSettings,addStaff,setStaffActive,csvEscape,download,wa,byDate};
})();
