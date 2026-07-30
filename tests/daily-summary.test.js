const test=require('node:test');
const assert=require('node:assert/strict');
const dailySummary=require('../api/daily-summary');

const USER_ID='11111111-1111-4111-8111-111111111111';
const STORE_ID='22222222-2222-4222-8222-222222222222';
const TOKEN='signed-test-access-token-value';

function fetchResponse(status,data){
  return{ok:status>=200&&status<300,status,async text(){return JSON.stringify(data)}};
}
function responseCapture(){
  return{
    statusCode:200,
    headers:{},
    setHeader(name,value){this.headers[name]=value},
    end(text){this.body=JSON.parse(text)}
  };
}
function request(method='POST'){
  return{
    method,
    headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},
    body:{storeId:STORE_ID}
  };
}
function emailOnlyEnvironment(){
  return{
    SUPABASE_URL:'https://project.supabase.co',
    SUPABASE_ANON_KEY:'public-anon-key-for-tests',
    RESEND_API_KEY:'re_test_key',
    RESEND_FROM_EMAIL:'RD MART <summary@example.com>',
    SUMMARY_EMAIL_TO:'owner@example.com'
  };
}
function successfulDataFetch(calls,{subscriptionStatus=200,subscriptions=[]}={}){
  return async(url)=>{
    calls.push(url);
    if(url.endsWith('/auth/v1/user'))return fetchResponse(200,{id:USER_ID});
    if(url.includes('/rpc/is_mart_admin'))return fetchResponse(200,true);
    if(url.includes('/push_subscriptions?'))return fetchResponse(subscriptionStatus,subscriptionStatus===200?subscriptions:{message:'missing table'});
    if(url==='https://api.resend.com/emails')return fetchResponse(200,{id:'email_123'});
    if(url.includes('/rest/v1/'))return fetchResponse(200,[]);
    throw new Error('Unexpected URL: '+url);
  };
}

test('manual summary test does not require cron or service-role secrets when email is configured',async()=>{
  const calls=[];
  const handler=dailySummary.createHandler({
    env:emailOnlyEnvironment(),
    fetch:successfulDataFetch(calls),
    webpush:{sendNotification(){throw new Error('push should not run')}}
  });
  const response=responseCapture();
  await handler(request(),response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.ok,true);
  assert.equal(response.body.email.sent,true);
  assert.equal(response.body.push.configured,false);
  assert.equal(response.body.push.sent,0);
  assert.ok(calls.includes('https://api.resend.com/emails'));
  assert.equal(calls.some(url=>url.includes('/push_subscriptions?')),false);
});

test('email test still sends when the optional push-subscription table is unavailable',async()=>{
  const calls=[];
  const env={
    ...emailOnlyEnvironment(),
    VAPID_PUBLIC_KEY:'public-vapid-key',
    VAPID_PRIVATE_KEY:'private-vapid-key',
    VAPID_SUBJECT:'mailto:owner@example.com'
  };
  const handler=dailySummary.createHandler({
    env,
    fetch:successfulDataFetch(calls,{subscriptionStatus:404}),
    webpush:{sendNotification(){throw new Error('push should not run')}}
  });
  const response=responseCapture();
  await handler(request(),response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.ok,true);
  assert.equal(response.body.email.sent,true);
  assert.match(response.body.push.error,/registration/i);
});

test('manual push test does not require cron or service-role secrets',async()=>{
  const calls=[],pushCalls=[];
  const env={
    SUPABASE_URL:'https://project.supabase.co',
    SUPABASE_ANON_KEY:'public-anon-key-for-tests',
    VAPID_PUBLIC_KEY:'public-vapid-key',
    VAPID_PRIVATE_KEY:'private-vapid-key',
    VAPID_SUBJECT:'mailto:owner@example.com'
  };
  const subscriptions=[{id:'sub-1',endpoint:'https://push.example/one',p256dh:'key',auth_key:'auth'}];
  const handler=dailySummary.createHandler({
    env,
    fetch:successfulDataFetch(calls,{subscriptions}),
    webpush:{async sendNotification(subscription){pushCalls.push(subscription)}}
  });
  const response=responseCapture();
  await handler(request(),response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.ok,true);
  assert.equal(response.body.push.sent,1);
  assert.equal(response.body.email.attempted,false);
  assert.equal(pushCalls.length,1);
});

test('scheduled summaries still fail closed without cron-only configuration',async()=>{
  let fetchCalls=0;
  const handler=dailySummary.createHandler({
    env:emailOnlyEnvironment(),
    fetch:async()=>{fetchCalls++;return fetchResponse(500,{})},
    webpush:{sendNotification(){throw new Error('push should not run')}}
  });
  const response=responseCapture();
  await handler({method:'GET',headers:{}},response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.ok,false);
  assert.equal(response.body.state,'NOT_CONFIGURED');
  assert.equal(fetchCalls,0);
});

test('manual tests can reuse the browser public Supabase configuration',()=>{
  const config=dailySummary._test.loadConfiguration(
    {
      VAPID_PUBLIC_KEY:'public-vapid-key',
      VAPID_PRIVATE_KEY:'private-vapid-key',
      VAPID_SUBJECT:'mailto:owner@example.com'
    },
    {url:'https://project.supabase.co',anonKey:'public-anon-key-for-tests'}
  );
  assert.equal(config.testAuthOk,true);
  assert.equal(config.supabaseUrl,'https://project.supabase.co');
  assert.equal(config.anonKey,'public-anon-key-for-tests');
  assert.equal(config.ok,false);
  assert.deepEqual(config.missing,['SUPABASE_SERVICE_ROLE_KEY','CRON_SECRET']);
});

test('new Supabase secret keys are never sent as Bearer JWTs',()=>{
  const modern=dailySummary._test.serviceHeaders('sb_secret_example',true);
  assert.equal(modern.apikey,'sb_secret_example');
  assert.equal(modern.Authorization,undefined);
  assert.equal(modern['Content-Type'],'application/json');

  const legacy=dailySummary._test.serviceHeaders('legacy-service-role-jwt',false);
  assert.equal(legacy.apikey,'legacy-service-role-jwt');
  assert.equal(legacy.Authorization,'Bearer legacy-service-role-jwt');
});

test('Monday summary rolls Saturday and Sunday hold cheques into today',async()=>{
  const calls=[];
  const rest=async(table,query)=>{
    calls.push({table,query});
    if(table==='cheques')return{data:[
      {amount:100000,cheque_date:'2026-07-25'},
      {amount:80000,cheque_date:'2026-07-26'},
      {amount:60909,cheque_date:'2026-07-27'},
      {amount:30000,cheque_date:'2026-07-25'},
      {amount:20000,cheque_date:'2026-07-26'},
      {amount:20000,cheque_date:'2026-07-25'},
      {amount:20000,cheque_date:'2026-07-26'},
      {amount:20000,cheque_date:'2026-07-25'},
      {amount:20000,cheque_date:'2026-07-26'},
      {amount:20000,cheque_date:'2026-07-25'},
      {amount:20000,cheque_date:'2026-07-26'},
      {amount:50000,cheque_date:'2026-07-24'}
    ]};
    return{data:[]};
  };
  const summary=await dailySummary._test.buildStoreSummary(rest,STORE_ID,'2026-07-27','2026-07-26');
  assert.equal(summary.counts.dueCount,11);
  assert.equal(summary.counts.dueAmount,410909);
  assert.equal(summary.counts.overdueCount,1);
  const chequeCalls=calls.filter(call=>call.table==='cheques');
  assert.equal(chequeCalls.length,1);
  assert.match(chequeCalls[0].query,/select=amount,cheque_date/);
  assert.match(summary.line2,/11 cheques due \(Rs 4,10,909\)/);
});

/* ===== "Morning summary shows everything 0" regression tests =====
   Two independent causes, both real:
     1. A failed/denied table read was summed as 0, so a broken query produced a
        confident "Rs 0 sales" summary instead of failing loudly.
     2. A phone registered while a now-deleted/renamed store was active kept
        querying that store id, which legitimately returns no rows — every
        figure zero, forever, with no error anywhere. */

function cronEnvironment(){
  return{
    SUPABASE_URL:'https://project.supabase.co',
    SUPABASE_ANON_KEY:'public-anon-key-for-tests',
    SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_key',
    VAPID_PUBLIC_KEY:'vapid-public',
    VAPID_PRIVATE_KEY:'vapid-private',
    VAPID_SUBJECT:'mailto:owner@example.com',
    CRON_SECRET:'cron-secret-value'
  };
}
function cronRequest(){
  return{method:'GET',headers:{authorization:'Bearer cron-secret-value'}};
}

test('a failed data read never becomes a zero summary',async()=>{
  const rest=async table=>{
    if(table==='daily_sales')return{ok:false,status:401,data:{message:'permission denied for table daily_sales'}};
    return{ok:true,status:200,data:[]};
  };
  await assert.rejects(
    ()=>dailySummary._test.buildStoreSummary(rest,STORE_ID,'2026-07-30','2026-07-29'),
    /summary_read_failed/
  );
});

test('a real all-zero day still sends a summary',async()=>{
  const rest=async()=>({ok:true,status:200,data:[]});
  const summary=await dailySummary._test.buildStoreSummary(rest,STORE_ID,'2026-07-30','2026-07-29');
  assert.equal(summary.counts.salesYesterday,0);
  assert.match(summary.line1,/Rs 0 sales/);
});

test('a phone bound to a deleted store is relinked to the only active store',async()=>{
  const DEAD_STORE='33333333-3333-4333-8333-333333333333';
  const patches=[],summarised=[];
  const fetchImpl=async(url,init)=>{
    if(url.includes('/push_subscriptions?select='))
      return fetchResponse(200,[{id:'sub-1',store_id:DEAD_STORE,endpoint:'https://push.example/1',p256dh:'key',auth_key:'auth'}]);
    if(url.includes('/mart_stores?select=id'))return fetchResponse(200,[{id:STORE_ID}]);
    if(url.includes('/push_subscriptions?id=eq.')){patches.push({url,body:JSON.parse(init.body)});return fetchResponse(204,{})}
    if(url.includes('/rest/v1/')){
      const match=url.match(/store_id=eq\.([0-9a-f-]+)/i);
      if(match)summarised.push(match[1]);
      return fetchResponse(200,url.includes('daily_sales')?[{pos:1200,fonepay:800,cash:500,finance:0,party_payment:300,other:0}]:[]);
    }
    throw new Error('Unexpected URL: '+url);
  };
  const sent=[];
  const handler=dailySummary.createHandler({
    env:cronEnvironment(),
    fetch:fetchImpl,
    webpush:{async sendNotification(sub,payload){sent.push(JSON.parse(payload));return{}}}
  });
  const response=responseCapture();
  await handler(cronRequest(),response);

  assert.equal(response.body.ok,true);
  assert.equal(response.body.push.sent,1);
  assert.equal(summarised.includes(DEAD_STORE),false,'must not query the dead store');
  assert.ok(summarised.includes(STORE_ID),'summary is built for the live store');
  assert.match(sent[0].body,/Rs 2,500 sales/,'real figures, not zeros');
  assert.ok(patches.some(p=>p.body.store_id===STORE_ID),'binding is healed permanently');
});

test('an ambiguous stale binding is skipped rather than guessed',async()=>{
  const DEAD_STORE='33333333-3333-4333-8333-333333333333';
  const OTHER_STORE='44444444-4444-4444-8444-444444444444';
  const patches=[];
  const fetchImpl=async(url,init)=>{
    if(url.includes('/push_subscriptions?select='))
      return fetchResponse(200,[{id:'sub-1',store_id:DEAD_STORE,endpoint:'https://push.example/1',p256dh:'key',auth_key:'auth'}]);
    if(url.includes('/mart_stores?select=id'))return fetchResponse(200,[{id:STORE_ID},{id:OTHER_STORE}]);
    if(url.includes('/push_subscriptions?id=eq.')){patches.push(JSON.parse(init.body));return fetchResponse(204,{})}
    if(url.includes('/rest/v1/'))return fetchResponse(200,[]);
    throw new Error('Unexpected URL: '+url);
  };
  const sent=[];
  const handler=dailySummary.createHandler({
    env:cronEnvironment(),
    fetch:fetchImpl,
    webpush:{async sendNotification(sub,payload){sent.push(JSON.parse(payload));return{}}}
  });
  const response=responseCapture();
  await handler(cronRequest(),response);

  assert.equal(response.body.push.skippedStale,1);
  assert.equal(sent.length,0,'no misleading zero summary is sent');
  assert.match(patches[0].last_error,/no longer exists/,'the reason is recorded for the admin');
});
