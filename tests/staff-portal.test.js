const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return{
    get length(){return values.size},
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
    key:index=>[...values.keys()][index]??null
  };
}

function loadStaffStore(){
  let inserted=null;
  const client={
    from(table){
      return{
        async insert(row){inserted={table,row};return{error:null}}
      };
    }
  };
  const sessionStorage=storage({martai_final_session:JSON.stringify({role:'staff',email:'staff@example.com'})});
  const sandbox={
    Blob,Date,Intl,TextEncoder,URL,clearTimeout,console,crypto:webcrypto,
    localStorage:storage(),sessionStorage,setTimeout,
    navigator:{},
    window:{
      MARTAI_SUPABASE:{url:'https://project.supabase.co',anonKey:'public-anon-key',mode:'json'},
      addEventListener(){},
      matchMedia:()=>({matches:false}),
      supabase:{createClient:()=>client}
    }
  };
  const source=fs.readFileSync(path.join(__dirname,'..','martai_final','assets','martai-store.js'),'utf8');
  vm.runInNewContext(source,sandbox);
  sandbox.window.MARTAI_SUPABASE.mode='tables';
  return{api:sandbox.window.MartAI,inserted:()=>inserted};
}

test('staff daily-sales entry writes directly without exposing a history row',async()=>{
  const state=loadStaffStore();
  const entry=await state.api.addStaffDaily({cash:'1200',fonepay:'350',note:'Evening counter'});
  assert.equal(entry.cash,1200);
  assert.equal(entry.fonepay,350);
  assert.equal(state.inserted().table,'daily_sales');
  assert.equal(state.inserted().row.cash,1200);
  assert.match(state.inserted().row.note,/Entered by staff@example\.com/);
  assert.deepEqual(Array.from(state.api.getDB().dailySales),[]);
});

test('staff daily-sales entry rejects empty and negative totals',async()=>{
  const {api}=loadStaffStore();
  await assert.rejects(()=>api.addStaffDaily({cash:'0'}),/at least one/i);
  await assert.rejects(()=>api.addStaffDaily({cash:'-1'}),/cannot be negative/i);
});

test('staff portal exposes statements and a PIN-gated write-only sales form',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','martai_final','staff.html'),'utf8');
  assert.match(html,/data-tab="daily"/);
  assert.match(html,/const GATED=\['customers','khata','daily'\]/);
  assert.match(html,/data-act-statement/);
  assert.match(html,/data-stmt-download/);
  assert.match(html,/A\.addStaffDaily\(/);
  assert.doesNotMatch(html,/dailySales\.(?:map|filter)|byDate\(d\.dailySales/);
});

test('database policy allows staff insert but denies staff daily-sales reads and updates',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','sql','setup-complete.sql'),'utf8');
  const section=sql.slice(sql.indexOf('-- daily_sales'),sql.indexOf('-- party_payments'));
  assert.match(section,/create policy "staff insert daily sales"[\s\S]*for insert[\s\S]*is_mart_staff\(\)/i);
  assert.match(section,/Asia\/Kathmandu/i);
  assert.doesNotMatch(section,/create policy "staff use daily sales"/i);
  assert.doesNotMatch(section,/create policy "staff update daily sales"/i);
});
