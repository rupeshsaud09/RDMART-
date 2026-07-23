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
